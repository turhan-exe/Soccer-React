param(
    [Parameter(Mandatory = $true)][string]$MatchId,
    [string[]]$DeviceIds = @('R9WMC1ADPPJ', '4TK7OVXOPVSGTCV4'),
    [string]$ControlHost = 'root@89.167.24.132',
    [string]$KeyPath = 'C:\Users\TURHAN\.ssh\hetzner_fhs_ed25519',
    [string]$OutputRoot = '',
    [string]$Since = '',
    [switch]$ClearLogcat
)

$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutputRoot = Join-Path $repoRoot ".tmp\friendly-log-compare\$timestamp-$MatchId"
}

New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null

$sshArgs = @(
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=15'
)
if (-not [string]::IsNullOrWhiteSpace($KeyPath)) {
    $sshArgs += @('-i', $KeyPath)
}

$logPatterns = @(
    $MatchId,
    'MatchNetworkManager',
    'LateJoinBootstrap',
    'MatchEngineLoader',
    'SingleAddressableLoader',
    'AndroidMatchPerformanceController',
    'SimulationLoadingOverlay',
    'MatchManager',
    'actors_ready_sent',
    'simulation_release_seen',
    'bootstrap_timeout',
    'friendly_bootstrap_timeout',
    'UnityHostActivity',
    'EmbeddedUnityPlayerActivity'
)

function Test-AdbDeviceAvailable {
    param([string]$DeviceId)

    & cmd /c "adb start-server >nul 2>nul" | Out-Null
    $deviceList = & cmd /c "adb devices 2>nul"
    if ($LASTEXITCODE -ne 0 -or $null -eq $deviceList) {
        return $false
    }

    $escapedDeviceId = [regex]::Escape($DeviceId)
    return @($deviceList) -match "^$escapedDeviceId\s+device$"
}

function Write-FilteredDeviceLogs {
    param(
        [string]$DeviceId,
        [string]$DestinationRoot
    )

    $deviceInfoPath = Join-Path $DestinationRoot "$DeviceId-device-info.txt"
    $filteredLogPath = Join-Path $DestinationRoot "$DeviceId-filtered-logcat.txt"
    $exitInfoPath = Join-Path $DestinationRoot "$DeviceId-exit-info.txt"

    if (-not (Test-AdbDeviceAvailable -DeviceId $DeviceId)) {
        @(
            "device=$DeviceId",
            "status=not_connected"
        ) | Set-Content -Path $deviceInfoPath -Encoding utf8
        "device_not_connected" | Set-Content -Path $filteredLogPath -Encoding utf8
        "device_not_connected" | Set-Content -Path $exitInfoPath -Encoding utf8
        Write-Warning "[logs] adb device not connected: $DeviceId"
        return
    }

    if ($ClearLogcat) {
        & adb -s $DeviceId logcat -c | Out-Null
    }

    $model = (& adb -s $DeviceId shell getprop ro.product.model).Trim()
    $abi = (& adb -s $DeviceId shell getprop ro.product.cpu.abi).Trim()
    $androidVersion = (& adb -s $DeviceId shell getprop ro.build.version.release).Trim()
    @(
        "device=$DeviceId",
        "model=$model",
        "abi=$abi",
        "android=$androidVersion"
    ) | Set-Content -Path $deviceInfoPath -Encoding utf8

    $logcatArgs = @('-d', '-v', 'threadtime')
    if (-not [string]::IsNullOrWhiteSpace($Since)) {
        $logcatArgs += @('-T', $Since)
    }

    $rawLogPath = Join-Path $DestinationRoot "$DeviceId-raw-logcat.txt"
    $crashLogPath = Join-Path $DestinationRoot "$DeviceId-crash-logcat.txt"
    $logcatLines = & adb -s $DeviceId logcat @logcatArgs
    $logcatLines | Set-Content -Path $rawLogPath -Encoding utf8
    $logcatLines |
        Select-String -Pattern $logPatterns -SimpleMatch |
        ForEach-Object { $_.Line } |
        Set-Content -Path $filteredLogPath -Encoding utf8

    $crashLogcatArgs = @('-d', '-b', 'crash', '-v', 'threadtime')
    if (-not [string]::IsNullOrWhiteSpace($Since)) {
        $crashLogcatArgs += @('-T', $Since)
    }
    & adb -s $DeviceId logcat @crashLogcatArgs |
        Set-Content -Path $crashLogPath -Encoding utf8

    & adb -s $DeviceId shell dumpsys activity exit-info com.nerbuss.fhsmanager |
        Set-Content -Path $exitInfoPath -Encoding utf8
}

foreach ($deviceId in $DeviceIds) {
    Write-Host "[logs] collecting from $deviceId"
    Write-FilteredDeviceLogs -DeviceId $deviceId -DestinationRoot $OutputRoot
}

$remoteCommand = @"
python3 - <<'PY'
from collections import deque

match_id = '$MatchId'
with open('/var/log/match-control-api.log', 'r', encoding='utf-8', errors='replace') as handle:
    tail = deque(handle, maxlen=20000)

for line in tail:
    if match_id in line:
        print(line.rstrip())
PY
"@
$controlLogPath = Join-Path $OutputRoot 'control-host-match-control.log'
& ssh @sshArgs $ControlHost $remoteCommand | Set-Content -Path $controlLogPath -Encoding utf8

$summaryPath = Join-Path $OutputRoot 'summary.txt'
$summaryLines = New-Object System.Collections.Generic.List[string]
$summaryLines.Add("matchId=$MatchId")
$summaryLines.Add("output=$OutputRoot")
foreach ($deviceId in $DeviceIds) {
    $deviceInfoPath = Join-Path $OutputRoot "$DeviceId-device-info.txt"
    $filteredLogPath = Join-Path $OutputRoot "$DeviceId-filtered-logcat.txt"
    if (Test-Path -LiteralPath $deviceInfoPath) {
        $deviceInfo = Get-Content -Path $deviceInfoPath
        $deviceStatusLine = $deviceInfo | Where-Object { $_ -like 'status=*' } | Select-Object -First 1
        if ($deviceStatusLine) {
            $summaryLines.Add("$DeviceId $deviceStatusLine")
        }
    }

    if (-not (Test-Path -LiteralPath $filteredLogPath)) {
        continue
    }

    $content = Get-Content -Path $filteredLogPath
    $clientSetupDone = ($content | Select-String -SimpleMatch 'client_setup_done').Count
    $actorsReady = ($content | Select-String -SimpleMatch 'actors_ready_sent').Count
    $simulationReleased = ($content | Select-String -SimpleMatch 'simulation_release_seen').Count
    $missingManager = ($content | Select-String -SimpleMatch 'MatchManager is still missing').Count
    $assetFallbackTimeout = ($content | Select-String -SimpleMatch 'asset_fallback_timeout').Count
    $bootstrapTimeout = ($content | Select-String -SimpleMatch 'friendly_bootstrap_timeout').Count
    $summaryLines.Add(
        "$deviceId client_setup_done=$clientSetupDone actors_ready=$actorsReady simulation_released=$simulationReleased missing_manager=$missingManager asset_fallback_timeout=$assetFallbackTimeout bootstrap_timeout=$bootstrapTimeout")
}

$summaryLines | Set-Content -Path $summaryPath -Encoding utf8
Write-Host "[logs] wrote artifacts to $OutputRoot"
