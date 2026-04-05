param(
    [Parameter(Mandatory = $true)][string]$DeviceId,
    [string]$PackageName = 'com.nerbuss.fhsmanager',
    [string]$ManifestPath = '',
    [string]$OutputRoot = '',
    [string]$Since = '',
    [string]$MatchId = '',
    [switch]$ClearLogcat
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $repoRoot '.tmp\current-android-artifact-manifest.json'
}
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $OutputRoot = Join-Path $repoRoot ".tmp\android-device-repros\$timestamp-$DeviceId"
}

$verifyScript = Join-Path $repoRoot 'scripts\android-verify-apk-manifest.ps1'
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null

& cmd /c "adb start-server >nul 2>nul" | Out-Null
$deviceList = & adb devices
$escapedDeviceId = [regex]::Escape($DeviceId)
if (-not (@($deviceList) -match "^$escapedDeviceId\s+device$")) {
    throw "ADB device not connected: $DeviceId"
}

if ($ClearLogcat) {
    & adb -s $DeviceId logcat -c | Out-Null
}

$deviceInfoPath = Join-Path $OutputRoot 'device-info.txt'
@(
    "deviceId=$DeviceId",
    "model=$((& adb -s $DeviceId shell getprop ro.product.model).Trim())",
    "android=$((& adb -s $DeviceId shell getprop ro.build.version.release).Trim())",
    "abi=$((& adb -s $DeviceId shell getprop ro.product.cpu.abi).Trim())",
    "fingerprint=$((& adb -s $DeviceId shell getprop ro.build.fingerprint).Trim())"
) | Set-Content -LiteralPath $deviceInfoPath -Encoding utf8

& adb -s $DeviceId shell dumpsys package $PackageName | Set-Content -LiteralPath (Join-Path $OutputRoot 'dumpsys-package.txt') -Encoding utf8
& adb -s $DeviceId shell dumpsys activity exit-info $PackageName | Set-Content -LiteralPath (Join-Path $OutputRoot 'exit-info.txt') -Encoding utf8
$crashLogcatArgs = @('-d', '-b', 'crash', '-v', 'threadtime')
if (-not [string]::IsNullOrWhiteSpace($Since)) {
    $crashLogcatArgs += @('-T', $Since)
}
& adb -s $DeviceId logcat @crashLogcatArgs | Set-Content -LiteralPath (Join-Path $OutputRoot 'logcat-crash.txt') -Encoding utf8

$logcatArgs = @('-d', '-v', 'threadtime')
if (-not [string]::IsNullOrWhiteSpace($Since)) {
    $logcatArgs += @('-T', $Since)
}
$allLogcatPath = Join-Path $OutputRoot 'logcat-threadtime.txt'
$allLogcat = & adb -s $DeviceId logcat @logcatArgs
$allLogcat | Set-Content -LiteralPath $allLogcatPath -Encoding utf8
$patterns = @(
    'UnityHostActivity',
    'EmbeddedUnityPlayerActivity',
    'MatchNetworkManager',
    'LateJoinBootstrap',
    'SimulationLoadingOverlay',
    'AndroidMatchPerformanceController',
    'MatchEngineLoader',
    'MatchManager',
    'friendly_bootstrap_timeout',
    'actors_ready_sent',
    'simulation_release_seen',
    'bootstrap_timeout',
    'libil2cpp',
    'SIGSEGV',
    'stack overflow'
)
if (-not [string]::IsNullOrWhiteSpace($MatchId)) {
    $patterns += $MatchId
}
$allLogcat |
    Select-String -Pattern $patterns -SimpleMatch |
    ForEach-Object { $_.Line } |
    Set-Content -LiteralPath (Join-Path $OutputRoot 'logcat-filtered.txt') -Encoding utf8

$pmPathLine = (& adb -s $DeviceId shell pm path $PackageName | Select-Object -First 1).Trim()
if ($pmPathLine -match '^package:(.+)$') {
    $remoteApkPath = $Matches[1]
    $localApkPath = Join-Path $OutputRoot 'installed-base.apk'
    & adb -s $DeviceId pull $remoteApkPath $localApkPath | Out-Null
    if ((Test-Path -LiteralPath $localApkPath) -and (Test-Path -LiteralPath $ManifestPath)) {
        try {
            & $verifyScript -ManifestPath $ManifestPath -ApkPath $localApkPath -OutputPath (Join-Path $OutputRoot 'verify-installed-apk.json')
        } catch {
            $_ | Out-String | Set-Content -LiteralPath (Join-Path $OutputRoot 'verify-installed-apk-error.txt') -Encoding utf8
        }
    }
}

Write-Host "[device-crash] wrote $OutputRoot"
