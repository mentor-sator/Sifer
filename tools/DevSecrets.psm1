Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'SiferSecrets.psm1') -Force

$script:Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:Recipients = Join-Path $script:Root 'secrets\recipients.txt'
$script:DevFile = Join-Path $script:Root 'secrets\dev.age'
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
    $redis = Get-SiferSecret -Name 'redis/default'
    $qdrant = Get-SiferSecret -Name 'qdrant/api-key'
    $silo = Get-SiferSecret -Name 'silo/root-password'
    $livekit = Get-SiferSecret -Name 'livekit/api-secret'
    $pfxPassword = Get-PfxPassword

    $entries = [ordered]@{
        POSTGRES_SUPERUSER_URL  = "postgresql://postgres:$postgres@127.0.0.1:5433/postgres"
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

Export-ModuleMember -Function New-SiferDevSecrets, Get-SiferDevSecrets, Test-SiferDevSecrets