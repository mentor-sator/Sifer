Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-GoFormatted {
    $name = if ($env:OS -eq 'Windows_NT') { 'gofmt.exe' } else { 'gofmt' }
    $gofmt = Join-Path (Join-Path (go env GOROOT) 'bin') $name
    $unformatted = @(& $gofmt -l gen/go internal services)
    if ($LASTEXITCODE -ne 0) {
        throw "gofmt failed (exit $LASTEXITCODE)."
    }
    if ($unformatted.Count -gt 0) {
        throw "gofmt: not formatted: $($unformatted -join ', ')"
    }
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $root
try {
    $wired = @(
        'go.mod',
        'pyproject.toml',
        'packages/contracts-py/pyproject.toml',
        'services/orchestrator/pyproject.toml'
    )
    $manifests = @(git ls-files --cached --others --exclude-standard -- '*Cargo.toml' '*go.mod' '*pyproject.toml')
    $unwired = @($manifests | Where-Object { $_ -notin $wired })
    if ($unwired.Count -gt 0) {
        throw "verify has no stages yet for: $($unwired -join ', '). Add that runtime's format, lint, typecheck and test commands to tools/Verify.ps1."
    }

    $goPackages = @('./gen/...', './internal/...', './services/...')
    $uvRun = @('run', '--locked', '--all-packages')

    $stages = [ordered]@{
        format    = @(
            { pnpm exec prettier --check . },
            { buf format --diff --exit-code },
            { Assert-GoFormatted },
            { uv @uvRun ruff format --check }
        )
        lint      = @(
            { pnpm lint },
            { buf lint },
            { buf breaking --against '.git#ref=HEAD' },
            { go vet @goPackages },
            { uv @uvRun ruff check }
        )
        typecheck = @(
            { pnpm typecheck },
            { go build @goPackages },
            { uv @uvRun mypy }
        )
        test      = @(
            { pnpm test },
            { go test @goPackages },
            { uv @uvRun pytest }
        )
    }

    foreach ($name in $stages.Keys) {
        Write-Host "==> $name" -ForegroundColor Cyan
        foreach ($step in $stages[$name]) {
            $global:LASTEXITCODE = 0
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
