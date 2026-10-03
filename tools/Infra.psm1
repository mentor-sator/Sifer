Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'SiferSecrets.psm1') -Force

$script:Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:InfraRoot = Join-Path $env:LOCALAPPDATA 'sifer-infra'
$script:DataRoot = Join-Path $env:LOCALAPPDATA 'sifer'
$script:Loopback = @('127.0.0.1', '::1')

$script:Services = @(
    @{
        Name    = 'postgres'
        Ports   = @(5433)
        Exe     = Join-Path $script:InfraRoot 'postgresql-16.4\bin\postgres.exe'
        Control = Join-Path $script:InfraRoot 'postgresql-16.4\bin\pg_ctl.exe'
        Data    = Join-Path $script:DataRoot 'pgdata'
        Log     = Join-Path $script:DataRoot 'logs\postgres.log'
    },
    @{
        Name      = 'redis'
        Ports     = @(6390)
        Exe       = Join-Path $script:InfraRoot 'redis-7.4.11\redis-server.exe'
        Data      = Join-Path $script:DataRoot 'redis'
        Arguments = 'redis.conf --include auth.conf'
        Config    = 'redis.conf'
        Log       = Join-Path $script:DataRoot 'redis\redis.log'
    },
    @{
        Name        = 'qdrant'
        Ports       = @(6333, 6334)
        Exe         = Join-Path $script:InfraRoot 'qdrant-1.12.4\qdrant.exe'
        Data        = Join-Path $script:DataRoot 'qdrant'
        Arguments   = '--config-path qdrant.yaml'
        Config      = 'qdrant.yaml'
        Environment = @{ QDRANT__SERVICE__API_KEY = @{ Secret = 'qdrant/api-key' } }
        Log         = Join-Path $script:DataRoot 'qdrant\stdout.txt'
    },
    @{
        Name        = 'silo'
        Ports       = @(9000, 9001)
        Exe         = Join-Path $script:InfraRoot 'silo-2026.09.16\silo.exe'
        Data        = Join-Path $script:DataRoot 'silo'
        Arguments   = 'server data --address 127.0.0.1:9000 --console-address 127.0.0.1:9001'
        Environment = @{
            MINIO_ROOT_USER     = @{ Value = 'sifer-admin' }
            MINIO_ROOT_PASSWORD = @{ Secret = 'silo/root-password' }
            MINIO_UPDATE        = @{ Value = 'off' }
        }
        Log         = Join-Path $script:DataRoot 'silo\stdout.txt'
    },
    @{
        Name        = 'livekit'
        Ports       = @(7880, 7881)
        Exe         = Join-Path $script:InfraRoot 'livekit-1.13.7\livekit-server.exe'
        Data        = Join-Path $script:DataRoot 'livekit'
        Arguments   = '--config livekit.yaml'
        Config      = 'livekit.yaml'
        Environment = @{ LIVEKIT_KEYS = @{ Secret = 'livekit/api-secret'; Format = 'sifer-dev: {0}' } }
        Log         = Join-Path $script:DataRoot 'livekit\stdout.txt'
    }
)

function Get-ServiceDefinition {
    param([string]$Name)
    $definition = $script:Services | Where-Object { $_.Name -eq $Name }
    if (-not $definition) {
        throw "Unknown service '$Name'. Known: $(($script:Services | ForEach-Object { $_.Name }) -join ', ')"
    }
    $definition
}

function Get-PortListener {
    param([int]$Port)
    foreach ($connection in @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
        $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
        [pscustomobject]@{
            Port        = $Port
            Address     = $connection.LocalAddress
            ProcessId   = $connection.OwningProcess
            ProcessName = if ($process) { $process.ProcessName } else { 'unknown' }
            Path        = if ($process) { $process.Path } else { $null }
        }
    }
}

function Get-SiferStatus {
    param([string[]]$Name)
    $selected = if ($Name) { @($Name | ForEach-Object { Get-ServiceDefinition -Name $_ }) } else { $script:Services }
    foreach ($service in $selected) {
        $listeners = @($service.Ports | ForEach-Object { Get-PortListener -Port $_ })

        $state = 'stopped'
        $tcp = ''
        $udp = ''
        $exposed = ''
        $processId = $null
        $owner = ''

        if ($listeners.Count -gt 0) {
            $foreign = @($listeners | Where-Object { $_.Path -ne $service.Exe })
            $state = if ($foreign.Count -gt 0) { 'foreign' } else { 'running' }
            $processId = $listeners[0].ProcessId
            $owner = $listeners[0].ProcessName

            $tcpAddresses = @($listeners | ForEach-Object Address | Sort-Object -Unique)
            $udpEndpoints = @(Get-NetUDPEndpoint -OwningProcess $processId -ErrorAction SilentlyContinue)
            $udpAddresses = @($udpEndpoints | ForEach-Object LocalAddress | Sort-Object -Unique)

            $tcp = $tcpAddresses -join ', '
            $udp = if ($udpEndpoints.Count -gt 0) { '{0} ({1})' -f ($udpAddresses -join ', '), $udpEndpoints.Count } else { '-' }
            $wide = @(@($tcpAddresses) + @($udpAddresses) | Where-Object { $_ -notin $script:Loopback })
            $exposed = if ($wide.Count -gt 0) { 'yes' } else { 'no' }
        }

        [pscustomobject]@{
            Service   = $service.Name
            Ports     = ($service.Ports -join ', ')
            State     = $state
            Tcp       = $tcp
            Udp       = $udp
            Exposed   = $exposed
            ProcessId = $processId
            Owner     = $owner
        }
    }
}

function Resolve-EnvironmentValue {
    param([hashtable]$Spec)
    if ($Spec.ContainsKey('Secret')) {
        $value = Get-SiferSecret -Name $Spec.Secret
        if ($Spec.ContainsKey('Format')) { return $Spec.Format -f $value }
        return $value
    }
    $Spec.Value
}

function Wait-ForPorts {
    param([int[]]$Ports, [int]$TimeoutSeconds = 20)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $open = @($Ports | Where-Object { Get-PortListener -Port $_ })
        if ($open.Count -eq $Ports.Count) { return $true }
        Start-Sleep -Milliseconds 400
    }
    $false
}

function Start-SiferService {
    param([string]$Name)
    $service = Get-ServiceDefinition -Name $Name
    $status = Get-SiferStatus -Name $Name

    if ($status.State -eq 'running') { return "$Name already running" }
    if ($status.State -eq 'foreign') {
        throw "$Name cannot start: port $($status.Ports) held by $($status.Owner) (pid $($status.ProcessId))"
    }
    if (-not (Test-Path $service.Exe)) {
        throw "$Name binary missing: $($service.Exe)"
    }

    New-Item -ItemType Directory -Force $service.Data | Out-Null
    if ($service.ContainsKey('Config')) {
        Copy-Item (Join-Path $script:Root "infra\local\$($service.Config)") (Join-Path $service.Data $service.Config) -Force
    }

    if ($Name -eq 'postgres') {
        New-Item -ItemType Directory -Force (Split-Path $service.Log) | Out-Null
        $control = Start-Process -FilePath $service.Control `
            -ArgumentList ('-D "{0}" -l "{1}" -w start' -f $service.Data, $service.Log) `
            -WorkingDirectory $service.Data `
            -RedirectStandardOutput (Join-Path $service.Data 'pgctl-out.txt') `
            -RedirectStandardError (Join-Path $service.Data 'pgctl-err.txt') `
            -WindowStyle Hidden -PassThru
        $control.WaitForExit()
    } else {
        $applied = @()
        if ($service.ContainsKey('Environment')) {
            foreach ($key in $service.Environment.Keys) {
                Set-Item "Env:$key" (Resolve-EnvironmentValue -Spec $service.Environment[$key])
                $applied += $key
            }
        }
        try {
            Start-Process -FilePath $service.Exe `
                -ArgumentList $service.Arguments `
                -WorkingDirectory $service.Data `
                -RedirectStandardOutput (Join-Path $service.Data 'stdout.txt') `
                -RedirectStandardError (Join-Path $service.Data 'stderr.txt') `
                -WindowStyle Hidden | Out-Null
        } finally {
            foreach ($key in $applied) { Remove-Item "Env:$key" -ErrorAction SilentlyContinue }
        }
    }

    if (-not (Wait-ForPorts -Ports $service.Ports)) {
        throw "$Name did not start. Check $($service.Log)"
    }
    "$Name started"
}

function Stop-SiferService {
    param([string]$Name)
    $service = Get-ServiceDefinition -Name $Name
    $status = Get-SiferStatus -Name $Name

    if ($status.State -eq 'stopped') { return "$Name already stopped" }
    if ($status.State -eq 'foreign') { return "$Name skipped: port owned by $($status.Owner)" }

    if ($Name -eq 'postgres') {
        $control = Start-Process -FilePath $service.Control `
            -ArgumentList ('-D "{0}" -m fast -w stop' -f $service.Data) `
            -WorkingDirectory $service.Data `
            -RedirectStandardOutput (Join-Path $service.Data 'pgctl-out.txt') `
            -RedirectStandardError (Join-Path $service.Data 'pgctl-err.txt') `
            -WindowStyle Hidden -PassThru
        $control.WaitForExit()
    } else {
        Stop-Process -Id $status.ProcessId -Force
    }

    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline -and (Get-SiferStatus -Name $Name).State -ne 'stopped') {
        Start-Sleep -Milliseconds 400
    }
    "$Name stopped"
}

function Start-SiferInfra {
    param([string[]]$Name)
    $targets = if ($Name) { $Name } else { @($script:Services | ForEach-Object { $_.Name }) }
    foreach ($target in $targets) { Start-SiferService -Name $target }
    Get-SiferStatus -Name $targets | Format-Table -AutoSize
}

function Stop-SiferInfra {
    param([string[]]$Name)
    $targets = if ($Name) { $Name } else { @($script:Services | ForEach-Object { $_.Name }) }
    $ordered = @($targets)
    [array]::Reverse($ordered)
    foreach ($target in $ordered) { Stop-SiferService -Name $target }
    Get-SiferStatus -Name $targets | Format-Table -AutoSize
}

function Show-SiferLogs {
    param([Parameter(Mandatory)][string]$Name, [int]$Tail = 20)
    $service = Get-ServiceDefinition -Name $Name
    foreach ($path in @($service.Log, (Join-Path $service.Data 'stderr.txt'))) {
        if (Test-Path $path) {
            "--- $path"
            Get-Content $path -Tail $Tail
        }
    }
}

Export-ModuleMember -Function Start-SiferInfra, Stop-SiferInfra, Start-SiferService, Stop-SiferService, Get-SiferStatus, Show-SiferLogs