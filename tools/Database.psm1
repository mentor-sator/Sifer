Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:MigrationsRoot = Join-Path (Join-Path $script:Root 'db') 'migrations'
$script:FixturesRoot = Join-Path (Join-Path $script:Root 'db') 'fixtures'

function Get-SiferDbTarget {
    param(
        [string]$Server = '127.0.0.1',
        [int]$Port = 5433,
        [string]$User = 'postgres',
        [string]$Password,
        [string]$Database = 'sifer',
        [string]$Psql,
        [string]$Atlas = 'atlas'
    )
    if (-not $Password) {
        Import-Module (Join-Path $PSScriptRoot 'SiferSecrets.psm1') -Force
        $Password = Get-SiferSecret -Name 'postgres/superuser'
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
        [Parameter(Mandatory)][string[]]$Arguments
    )
    $previous = $env:PGPASSWORD
    $env:PGPASSWORD = $Target.Password
    try {
        $connection = @('-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', $Target.Server, '-p', "$($Target.Port)", '-U', $Target.User, '-d', $Database)
        Invoke-Tool -FilePath $Target.Psql -Arguments ($connection + $Arguments)
    } finally {
        $env:PGPASSWORD = $previous
    }
}

function Get-MigrationDirectories {
    if (-not (Test-Path $script:MigrationsRoot)) { return @() }
    @(Get-ChildItem $script:MigrationsRoot -Directory | Sort-Object Name)
}

function Invoke-SiferMigrate {
    param([Parameter(Mandatory)][pscustomobject]$Target)
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

Export-ModuleMember -Function Get-SiferDbTarget, Invoke-SiferMigrate, Reset-SiferDatabase, Get-SiferDbSchemas