Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:MigrationsRoot = Join-Path (Join-Path $script:Root 'db') 'migrations'
$script:FixturesRoot = Join-Path (Join-Path $script:Root 'db') 'fixtures'
$script:ServiceRoles = @(
    [pscustomobject]@{ Role = 'sifer_identity'; Secret = 'postgres/identity' }
)

function Get-SiferDbTarget {
    param(
        [string]$Server = '127.0.0.1',
        [int]$Port = 5433,
        [string]$User = 'postgres',
        [string]$Password,
        [string]$Database = 'sifer',
        [string]$Psql,
        [string]$Atlas = 'atlas',
        [hashtable]$RolePasswords
    )
    if (-not $Password -or -not $RolePasswords) {
        Import-Module (Join-Path $PSScriptRoot 'SiferSecrets.psm1') -Force
    }
    if (-not $Password) {
        $Password = Get-SiferSecret -Name 'postgres/superuser'
    }
    $roles = foreach ($entry in $script:ServiceRoles) {
        $rolePassword = if ($RolePasswords) { $RolePasswords[$entry.Role] } else { Get-SiferSecret -Name $entry.Secret }
        if ($rolePassword -notmatch '^[0-9a-f]{64}$') {
            throw "Password for role $($entry.Role) must be 64 lowercase hex characters."
        }
        [pscustomobject]@{ Role = $entry.Role; Password = $rolePassword }
    }
    if (-not $Psql) {
        $Psql = 'psql'
        if ($env:LOCALAPPDATA) {
            $native = Join-Path $env:LOCALAPPDATA 'sifer-infra\postgresql-16.4\bin\psql.exe'
            if (Test-Path $native) { $Psql = $native }
        }
    }
    [pscustomobject]@{
        Server   = $Server
        Port     = $Port
        User     = $User
        Password = $Password
        Database = $Database
        Psql     = $Psql
        Atlas    = $Atlas
        Roles    = @($roles)
    }
}

function Invoke-Tool {
    param([string]$FilePath, [string[]]$Arguments)
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$(Split-Path $FilePath -Leaf) failed with exit code $LASTEXITCODE."
    }
}

function Invoke-SiferPsql {
    param(
        [Parameter(Mandatory)][pscustomobject]$Target,
        [Parameter(Mandatory)][string]$Database,
        [Parameter(Mandatory)][string[]]$Arguments,
        [string]$InputText
    )
    $previous = $env:PGPASSWORD
    $env:PGPASSWORD = $Target.Password
    try {
        $connection = @('-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', $Target.Server, '-p', "$($Target.Port)", '-U', $Target.User, '-d', $Database)
        if ($PSBoundParameters.ContainsKey('InputText')) {
            $InputText | & $Target.Psql @($connection + $Arguments)
            if ($LASTEXITCODE -ne 0) {
                throw "$(Split-Path $Target.Psql -Leaf) failed with exit code $LASTEXITCODE."
            }
        } else {
            Invoke-Tool -FilePath $Target.Psql -Arguments ($connection + $Arguments)
        }
    } finally {
        $env:PGPASSWORD = $previous
    }
}

function Initialize-SiferRoleSecrets {
    Import-Module (Join-Path $PSScriptRoot 'SiferSecrets.psm1') -Force
    foreach ($entry in $script:ServiceRoles) {
        if (Test-SiferSecret -Name $entry.Secret) {
            "secret sifer/$($entry.Secret) present"
            continue
        }
        $bytes = [byte[]]::new(32)
        $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
        Set-SiferSecret -Name $entry.Secret -Value (-join ($bytes | ForEach-Object { $_.ToString('x2') }))
        "secret sifer/$($entry.Secret) created"
    }
}

function ConvertTo-ScramVerifier {
    param([Parameter(Mandatory)][string]$Password)
    $iterations = 4096
    $salt = [byte[]]::new(16)
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($salt) } finally { $generator.Dispose() }
    $utf8 = [Text.Encoding]::UTF8
    $derive = [Security.Cryptography.Rfc2898DeriveBytes]::new($utf8.GetBytes($Password), $salt, $iterations, [Security.Cryptography.HashAlgorithmName]::SHA256)
    try { $salted = $derive.GetBytes(32) } finally { $derive.Dispose() }
    $hmac = [Security.Cryptography.HMACSHA256]::new($salted)
    try {
        $clientKey = $hmac.ComputeHash($utf8.GetBytes('Client Key'))
        $serverKey = $hmac.ComputeHash($utf8.GetBytes('Server Key'))
    } finally { $hmac.Dispose() }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $storedKey = $sha.ComputeHash($clientKey) } finally { $sha.Dispose() }
    'SCRAM-SHA-256${0}:{1}${2}:{3}' -f $iterations, [Convert]::ToBase64String($salt), [Convert]::ToBase64String($storedKey), [Convert]::ToBase64String($serverKey)
}

function Set-SiferServiceRoles {
    param([Parameter(Mandatory)][pscustomobject]$Target)
    $database = $Target.Database
    $lines = @("REVOKE ALL ON DATABASE $database FROM PUBLIC;", 'REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;')
    foreach ($entry in $Target.Roles) {
        $role = $entry.Role
        if ($role -notmatch '^sifer_[a-z]+$') {
            throw "Refusing unusual role name '$role'."
        }
        $lines += "SELECT 'CREATE ROLE $role' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$role')\gexec"
        $lines += "ALTER ROLE $role WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 50 PASSWORD '$(ConvertTo-ScramVerifier -Password $entry.Password)';"
        $lines += "GRANT CONNECT ON DATABASE $database TO $role;"
    }
    Invoke-SiferPsql -Target $Target -Database 'postgres' -Arguments @('-f', '-') -InputText ($lines -join "`n")
    foreach ($entry in $Target.Roles) { "role $($entry.Role) ready" }
}

function Get-MigrationDirectories {
    if (-not (Test-Path $script:MigrationsRoot)) { return @() }
    @(Get-ChildItem $script:MigrationsRoot -Directory | Sort-Object Name)
}

function Invoke-SiferMigrate {
    param([Parameter(Mandatory)][pscustomobject]$Target)
    Set-SiferServiceRoles -Target $Target
    $url = 'postgres://{0}:{1}@{2}:{3}/{4}?sslmode=disable' -f $Target.User, $Target.Password, $Target.Server, $Target.Port, $Target.Database
    Push-Location $script:Root
    try {
        foreach ($directory in Get-MigrationDirectories) {
            $name = $directory.Name
            Invoke-Tool -FilePath $Target.Atlas -Arguments @(
                'migrate', 'apply',
                '--dir', "file://db/migrations/$name",
                '--url', $url,
                '--revisions-schema', "atlas_$name",
                '--allow-dirty'
            )
            "migrated $name"
        }
    } finally {
        Pop-Location
    }
}

function Reset-SiferDatabase {
    param([Parameter(Mandatory)][pscustomobject]$Target)
    $database = $Target.Database
    if ($database -notmatch '^[a-z_][a-z0-9_]*$') {
        throw "Refusing unusual database name '$database'."
    }
    Invoke-SiferPsql -Target $Target -Database 'postgres' -Arguments @(
        '-c', "DROP DATABASE IF EXISTS $database WITH (FORCE)",
        '-c', "CREATE DATABASE $database"
    )
    "database $database recreated"

    Invoke-SiferMigrate -Target $Target

    if (Test-Path $script:FixturesRoot) {
        foreach ($fixture in Get-ChildItem $script:FixturesRoot -Filter '*.sql' | Sort-Object Name) {
            Invoke-SiferPsql -Target $Target -Database $database -Arguments @('-f', $fixture.FullName)
            "fixture $($fixture.Name) loaded"
        }
    }
}

function Get-SiferDbSchemas {
    param([Parameter(Mandatory)][pscustomobject]$Target)
    Invoke-SiferPsql -Target $Target -Database $Target.Database -Arguments @(
        '-A', '-t', '-c',
        "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema' ORDER BY nspname"
    )
}

Export-ModuleMember -Function Get-SiferDbTarget, Initialize-SiferRoleSecrets, Set-SiferServiceRoles, Invoke-SiferMigrate, Reset-SiferDatabase, Get-SiferDbSchemas