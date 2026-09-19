set shell := ["powershell.exe", "-NoProfile", "-Command"]
set windows-shell := ["powershell.exe", "-NoProfile", "-Command"]

_default:
    @just --list

up:
    Import-Module ./tools/Infra.psm1 -Force; Start-SiferInfra

down:
    Import-Module ./tools/Infra.psm1 -Force; Stop-SiferInfra

status:
    Import-Module ./tools/Infra.psm1 -Force; Get-SiferStatus | Format-Table -AutoSize

logs service:
    Import-Module ./tools/Infra.psm1 -Force; Show-SiferLogs -Name {{service}}

restart service:
    Import-Module ./tools/Infra.psm1 -Force; Stop-SiferService -Name {{service}}; Start-SiferService -Name {{service}}

firewall:
    ./tools/Set-SiferFirewall.ps1
