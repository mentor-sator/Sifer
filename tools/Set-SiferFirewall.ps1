param(
    [string]$InfraRoot = (Join-Path $env:LOCALAPPDATA 'sifer-infra')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$group = 'Sifer'
$servers = @('postgres.exe', 'redis-server.exe', 'qdrant.exe', 'silo.exe', 'livekit-server.exe')
$errorLog = Join-Path $env:TEMP 'sifer-firewall-error.txt'

function Test-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-InfraRules {
    Get-NetFirewallApplicationFilter |
        Where-Object { $_.Program -like '*\sifer-infra\*' } |
        ForEach-Object {
            $rule = $_ | Get-NetFirewallRule
            [pscustomobject]@{
                Rule      = $rule.DisplayName
                Direction = $rule.Direction
                Action    = $rule.Action
                Profile   = $rule.Profile
                Enabled   = $rule.Enabled
                Program   = Split-Path $_.Program -Leaf
            }
        } |
        Sort-Object Program
}

if (-not (Test-Elevated)) {
    Remove-Item $errorLog -ErrorAction SilentlyContinue
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-InfraRoot', "`"$InfraRoot`"")
    $process = Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "Firewall update failed in the elevated process. Details: $errorLog"
    }
    Get-InfraRules | Format-Table -AutoSize
    return
}

try {
    $binaries = @(Get-ChildItem -Path $InfraRoot -Recurse -File | Where-Object { $_.Name -in $servers })
    $found = @($binaries | ForEach-Object Name)
    $missing = @($servers | Where-Object { $_ -notin $found })
    if ($missing.Count -gt 0) {
        throw "Server binaries not found under ${InfraRoot}: $($missing -join ', ')"
    }

    Get-NetFirewallApplicationFilter |
        Where-Object { $_.Program -like '*\sifer-infra\*' } |
        Get-NetFirewallRule |
        Remove-NetFirewallRule

    foreach ($binary in $binaries) {
        New-NetFirewallRule `
            -DisplayName "Sifer block inbound $($binary.BaseName)" `
            -Group $group `
            -Direction Inbound `
            -Action Block `
            -Profile Any `
            -Program $binary.FullName | Out-Null
    }
    exit 0
}
catch {
    $_ | Out-String | Set-Content -Path $errorLog
    exit 1
}