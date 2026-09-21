Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $root
try {
    $unwired = @(git ls-files --cached --others --exclude-standard -- '*Cargo.toml' '*go.mod' '*pyproject.toml')
    if ($unwired.Count -gt 0) {
        throw "verify has no stages yet for: $($unwired -join ', '). Add that runtime's format, lint, typecheck and test commands to tools/Verify.ps1."
    }

    $stages = [ordered]@{
        format    = @({ pnpm exec prettier --check . }, { buf format --diff --exit-code })
        lint      = @({ pnpm lint }, { buf lint }, { buf breaking --against '.git#ref=HEAD' })
        typecheck = @({ pnpm typecheck })
        test      = @({ pnpm test })
    }

    foreach ($name in $stages.Keys) {
        Write-Host "==> $name" -ForegroundColor Cyan
        foreach ($step in $stages[$name]) {
            & $step
            if ($LASTEXITCODE -ne 0) {
                throw "verify failed at '$name' (exit $LASTEXITCODE)."
            }
        }
    }

    Write-Host 'verify: format, lint, typecheck, test all green' -ForegroundColor Green
}
finally {
    Pop-Location
}
