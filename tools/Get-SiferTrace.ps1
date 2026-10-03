param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9a-f]{32}$')]
    [string]$TraceId,
    [int]$WaitSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-Member([object]$Object, [string]$Name) {
    if ($null -ne $Object -and $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $null
}

$uri = "http://127.0.0.1:3000/api/datasources/proxy/uid/tempo/api/traces/$TraceId"
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$response = $null
while (-not $response) {
    try {
        $response = Invoke-RestMethod -Uri $uri -Headers @{ Accept = 'application/json' } -TimeoutSec 10
    }
    catch {
        if ((Get-Date) -gt $deadline) { throw "trace $TraceId not found in Tempo after $WaitSeconds s" }
        Start-Sleep -Seconds 2
    }
}

$batches = Get-Member $response 'batches'
if (-not $batches) { $batches = Get-Member (Get-Member $response 'trace') 'resourceSpans' }

$rows = foreach ($batch in @($batches)) {
    $attributes = @(Get-Member (Get-Member $batch 'resource') 'attributes')
    $service = (@($attributes | Where-Object { $_.key -eq 'service.name' }) | Select-Object -First 1).value.stringValue
    foreach ($scope in @(Get-Member $batch 'scopeSpans')) {
        foreach ($span in @(Get-Member $scope 'spans')) {
            [pscustomobject]@{
                Start   = [decimal]$span.startTimeUnixNano
                Service = $service
                Span    = $span.name
                Kind    = ([string]$span.kind) -replace '^SPAN_KIND_', ''
                Ms      = [math]::Round(([decimal]$span.endTimeUnixNano - [decimal]$span.startTimeUnixNano) / 1000000, 2)
            }
        }
    }
}

"trace $TraceId"
$rows | Sort-Object Start | Select-Object Service, Span, Kind, Ms | Format-Table -AutoSize
