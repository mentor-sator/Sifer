Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'SiferSecrets.psm1') -Force

$script:Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:Recipients = Join-Path $script:Root 'secrets\recipients.txt'
$script:DevFile = Join-Path $script:Root 'secrets\dev.age'
$script:IdentityKeyFile = Join-Path $script:Root 'secrets\identity.key.age'
$script:GrantKeyFile = Join-Path $script:Root 'secrets\identity.grant.age'
$script:Pfx = Join-Path $script:Root 'secrets\sifer-codesign.pfx'
$script:Thumbprint = 'C8DBC5E9EB36C7A7CD46118940D3F270B0FCB051'
$script:Ephemeral = [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet

function Assert-PfxPassword {
    param([Parameter(Mandatory)][string]$Password)
    try {
        $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($script:Pfx, $Password, $script:Ephemeral)
    } catch {
        throw 'PFX password is incorrect for secrets\sifer-codesign.pfx.'
    }
    if ($certificate.Thumbprint -ne $script:Thumbprint) {
        throw "PFX thumbprint $($certificate.Thumbprint) does not match $script:Thumbprint."
    }
}

function Get-PfxPassword {
    if (Test-SiferSecret -Name 'signing/pfx-password') {
        $password = Get-SiferSecret -Name 'signing/pfx-password'
        Assert-PfxPassword -Password $password
        return $password
    }
    $secure = Read-Host -Prompt 'Code-signing PFX password' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    Assert-PfxPassword -Password $password
    Set-SiferSecret -Name 'signing/pfx-password' -Value $password
    $password
}

function New-SiferDevSecrets {
    if (-not (Test-Path $script:Pfx)) {
        throw "Signing certificate missing: $script:Pfx"
    }

    $postgres = Get-SiferSecret -Name 'postgres/superuser'
    $identity = Get-SiferSecret -Name 'postgres/identity'
    $redis = Get-SiferSecret -Name 'redis/default'
    $qdrant = Get-SiferSecret -Name 'qdrant/api-key'
    $silo = Get-SiferSecret -Name 'silo/root-password'
    $livekit = Get-SiferSecret -Name 'livekit/api-secret'
    $googleId = Get-SiferSecret -Name 'google/oauth-client-id'
    $googleSecret = Get-SiferSecret -Name 'google/oauth-client-secret'
    $pfxPassword = Get-PfxPassword

    $entries = [ordered]@{
        POSTGRES_SUPERUSER_URL  = "postgresql://postgres:$postgres@127.0.0.1:5433/postgres"
        IDENTITY_DATABASE_URL   = "postgresql://sifer_identity:$identity@127.0.0.1:5433/sifer?sslmode=disable"
        REDIS_URL               = "redis://default:$redis@127.0.0.1:6390/0"
        QDRANT_URL              = 'http://127.0.0.1:6333'
        QDRANT_GRPC_URL         = 'http://127.0.0.1:6334'
        QDRANT_API_KEY          = $qdrant
        S3_ENDPOINT             = 'http://127.0.0.1:9000'
        S3_REGION               = 'us-east-1'
        S3_ACCESS_KEY_ID        = 'sifer-admin'
        S3_SECRET_ACCESS_KEY    = $silo
        LIVEKIT_URL             = 'ws://127.0.0.1:7880'
        LIVEKIT_API_KEY         = 'sifer-dev'
        LIVEKIT_API_SECRET      = $livekit
        GOOGLE_OAUTH_CLIENT_ID     = $googleId
        GOOGLE_OAUTH_CLIENT_SECRET = $googleSecret
        SIGNING_CERT_THUMBPRINT = $script:Thumbprint
        SIGNING_PFX_PASSWORD    = $pfxPassword
        SIGNING_PFX_BASE64      = [Convert]::ToBase64String([IO.File]::ReadAllBytes($script:Pfx))
    }

    $content = ($entries.GetEnumerator() | ForEach-Object { '{0}={1}' -f $_.Key, $_.Value }) -join "`n"
    $content | age -R $script:Recipients -o $script:DevFile
    if ($LASTEXITCODE -ne 0) {
        throw 'age failed to encrypt secrets\dev.age.'
    }
    "secrets\dev.age written: $($entries.Count) entries, $((Get-Item $script:DevFile).Length) bytes"
}

function Get-SiferDevSecrets {
    if (-not (Test-Path $script:DevFile)) {
        throw "Not found: $script:DevFile. Run 'just secrets'."
    }
    $lines = Get-SiferSecret -Name 'age/workstation' | age -d -i - $script:DevFile
    if ($LASTEXITCODE -ne 0) {
        throw 'age failed to decrypt secrets\dev.age.'
    }
    $secrets = [ordered]@{}
    foreach ($line in $lines) {
        if ($line -match '^([A-Z0-9_]+)=(.*)$') {
            $secrets[$Matches[1]] = $Matches[2]
        }
    }
    $secrets
}

function Test-SiferDevSecrets {
    $secrets = Get-SiferDevSecrets
    $pfxBytes = [Convert]::FromBase64String($secrets['SIGNING_PFX_BASE64'])
    $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($pfxBytes, $secrets['SIGNING_PFX_PASSWORD'], $script:Ephemeral)
    $secrets.Keys | ForEach-Object { [pscustomobject]@{ Key = $_; Length = $secrets[$_].Length } } | Format-Table -AutoSize | Out-String
    if ($certificate.Thumbprint -eq $secrets['SIGNING_CERT_THUMBPRINT']) {
        'PFX round trip: ok'
    } else {
        throw 'PFX round trip: thumbprint mismatch.'
    }
}

function New-SealedKey {
    param(
        [Parameter(Mandatory)][string]$File,
        [Parameter(Mandatory)][string]$Subcommand,
        [Parameter(Mandatory)][string]$Consequence,
        [Parameter(Mandatory)][string]$Rotation,
        [switch]$Rotate
    )
    $name = 'secrets\' + (Split-Path $File -Leaf)
    if ((Test-Path $File) -and -not $Rotate) {
        throw "$name already exists. Replacing it $Consequence; call $Rotation -Rotate to do that deliberately."
    }
    Push-Location $script:Root
    try {
        $encoded = go run ./services/identity $Subcommand
        if ($LASTEXITCODE -ne 0) {
            throw "identity $Subcommand failed."
        }
        $encoded | age -R $script:Recipients -o $File
        if ($LASTEXITCODE -ne 0) {
            throw "age failed to encrypt $name."
        }
    } finally {
        Pop-Location
    }
    "$name written: $((Get-Item $File).Length) bytes"
}

function Get-SealedKey {
    param(
        [Parameter(Mandatory)][string]$File,
        [Parameter(Mandatory)][string]$Recipe
    )
    if (-not (Test-Path $File)) {
        throw "Not found: $File. Run 'just $Recipe'."
    }
    $lines = Get-SiferSecret -Name 'age/workstation' | age -d -i - $File
    if ($LASTEXITCODE -ne 0) {
        throw "age failed to decrypt secrets\$(Split-Path $File -Leaf)."
    }
    (@($lines) -join '').Trim()
}

function New-SiferIdentityKey {
    param([switch]$Rotate)
    New-SealedKey -File $script:IdentityKeyFile -Subcommand 'keygen' -Rotation 'New-SiferIdentityKey' -Rotate:$Rotate `
        -Consequence 'signs every user out'
}

function Get-SiferIdentityKey {
    Get-SealedKey -File $script:IdentityKeyFile -Recipe 'identity-key'
}

function New-SiferGrantKey {
    param([switch]$Rotate)
    New-SealedKey -File $script:GrantKeyFile -Subcommand 'grantkey' -Rotation 'New-SiferGrantKey' -Rotate:$Rotate `
        -Consequence 'makes every stored provider grant unreadable, so each user must consent again'
}

function Get-SiferGrantKey {
    Get-SealedKey -File $script:GrantKeyFile -Recipe 'identity-grant-key'
}

function Start-SiferIdentity {
    $secrets = Get-SiferDevSecrets
    $environment = [ordered]@{
        SIFER_IDENTITY_DATABASE_URL = $secrets['IDENTITY_DATABASE_URL']
        SIFER_IDENTITY_SIGNING_KEY  = Get-SiferIdentityKey
    }
    if ($secrets.Contains('GOOGLE_OAUTH_CLIENT_ID') -and $secrets.Contains('GOOGLE_OAUTH_CLIENT_SECRET')) {
        $environment['SIFER_GOOGLE_CLIENT_ID'] = $secrets['GOOGLE_OAUTH_CLIENT_ID']
        $environment['SIFER_GOOGLE_CLIENT_SECRET'] = $secrets['GOOGLE_OAUTH_CLIENT_SECRET']
        $environment['SIFER_IDENTITY_GRANT_KEY'] = Get-SiferGrantKey
    }
    Push-Location $script:Root
    try {
        foreach ($name in $environment.Keys) {
            Set-Item "Env:$name" $environment[$name]
        }
        go run ./services/identity
    } finally {
        foreach ($name in $environment.Keys) {
            Remove-Item "Env:$name" -ErrorAction SilentlyContinue
        }
        Pop-Location
    }
}

Export-ModuleMember -Function New-SiferDevSecrets, Get-SiferDevSecrets, Test-SiferDevSecrets, New-SiferIdentityKey, Get-SiferIdentityKey, New-SiferGrantKey, Get-SiferGrantKey, Start-SiferIdentity