param(
    [string]$BaseUrl = 'https://fhsmanager.duckdns.org',
    [int]$OlderThanSec = 60,
    [int]$Limit = 200
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot 'services\match-control-api\.env'

function Get-EnvValue {
    param(
        [string]$Path,
        [string]$Name
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return ''
    }

    $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } | Select-Object -First 1
    if ($line -match "^$([regex]::Escape($Name))=(.*)$") {
        return $Matches[1].Trim()
    }

    return ''
}

$secret = Get-EnvValue -Path $envPath -Name 'MATCH_CONTROL_SECRET'
if ([string]::IsNullOrWhiteSpace($secret)) {
    throw "MATCH_CONTROL_SECRET not found in $envPath"
}

$body = @{
    olderThanSec = $OlderThanSec
    limit = $Limit
} | ConvertTo-Json

$headers = @{
    Authorization = "Bearer $secret"
    'Content-Type' = 'application/json'
}

$response = Invoke-RestMethod -Method Post -Uri ($BaseUrl.TrimEnd('/') + '/v1/internal/friendly/cleanup-stale-state') -Headers $headers -Body $body
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputPath = Join-Path $repoRoot ".tmp\friendly-cleanup\$timestamp.json"
New-Item -ItemType Directory -Path (Split-Path -Parent $outputPath) -Force | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outputPath, ($response | ConvertTo-Json -Depth 8), $utf8NoBom)
Write-Host "[friendly-cleanup] wrote $outputPath"
Write-Host ($response | ConvertTo-Json -Depth 6)
