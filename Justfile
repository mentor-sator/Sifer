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

secrets:
    Import-Module ./tools/DevSecrets.psm1 -Force; New-SiferDevSecrets

secrets-check:
    Import-Module ./tools/DevSecrets.psm1 -Force; Test-SiferDevSecrets

verify:
    ./tools/Verify.ps1

fmt:
    pnpm exec prettier --write .

gen:
    buf generate

gateway:
    go run ./services/edge-gateway

identity:
    Import-Module ./tools/DevSecrets.psm1 -Force; $env:SIFER_IDENTITY_DATABASE_URL = (Get-SiferDevSecrets)['IDENTITY_DATABASE_URL']; $env:SIFER_IDENTITY_SIGNING_KEY = Get-SiferIdentityKey; go run ./services/identity

identity-key:
    Import-Module ./tools/DevSecrets.psm1 -Force; New-SiferIdentityKey

motion:
    pnpm --filter @sifer/motion dev

motion-package:
    pnpm --filter @sifer/motion package

orchestrator:
    uv run --locked --all-packages sifer-orchestrator

obs-up:
    docker compose -f infra/observability/compose.yml up --detach --wait --wait-timeout 300

obs-down:
    docker compose -f infra/observability/compose.yml down

trace id:
    ./tools/Get-SiferTrace.ps1 -TraceId {{id}}

seed:
    Import-Module ./tools/Database.psm1 -Force; Reset-SiferDatabase -Target (Get-SiferDbTarget)

migrate:
    Import-Module ./tools/Database.psm1 -Force; Invoke-SiferMigrate -Target (Get-SiferDbTarget)
