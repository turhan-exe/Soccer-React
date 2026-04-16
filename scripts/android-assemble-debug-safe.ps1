param(
    [string]$Abi = 'arm64-v8a',
    [int]$HangTimeoutSec = 900,
    [int]$TotalTimeoutSec = 2400,
    [switch]$UseBeeBuilder,
    [bool]$ExcludeMatchViewerFromMobileAssets = $true,
    [switch]$SkipWebPrepare,
    [switch]$SkipUnityExport
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $repoRoot 'android'
$manifestPath = Join-Path $repoRoot '.tmp\current-android-artifact-manifest.json'
$exportRoot = Join-Path $repoRoot '.tmp\AndroidUnityLibraryExport'
$syncScript = Join-Path $repoRoot 'scripts\sync-unity-export.ps1'
$unityExportScript = Join-Path $repoRoot 'scripts\run-unity-android-export.cmd'
$manifestScript = Join-Path $repoRoot 'scripts\write-android-build-manifest.ps1'
$verifyScript = Join-Path $repoRoot 'scripts\android-verify-apk-manifest.ps1'
$apkPath = Join-Path $repoRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
$mobileExcludedMatchViewerDir = Join-Path $repoRoot 'android\app\src\main\assets\public\Unity\match-viewer'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$diagRoot = Join-Path $repoRoot ".tmp\android-il2cpp-diag\$timestamp"
$logFile = Join-Path $diagRoot 'gradle-assemble.log'
$commandFile = Join-Path $diagRoot 'gradle-command.txt'
$statusFile = Join-Path $diagRoot 'status.txt'
$webBuildLog = Join-Path $diagRoot 'web-build.log'
$capSyncLog = Join-Path $diagRoot 'cap-sync.log'
$unityExportLog = Join-Path $diagRoot 'unity-export-wrapper.log'

function Invoke-CmdOrThrow {
    param(
        [string]$Command,
        [string]$WorkingDirectory,
        [string]$LogPath,
        [string]$StepName
    )

    $cmdArguments = "/c call $Command > `"$LogPath`" 2>&1"
    $process = Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArguments -WorkingDirectory $WorkingDirectory -PassThru -WindowStyle Hidden
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "$StepName failed with exit code $($process.ExitCode). See $LogPath"
    }
}

function Copy-DiagnosticFileIfPresent {
    param(
        [string]$SourcePath,
        [string]$DestinationPath
    )

    if (-not (Test-Path -LiteralPath $SourcePath)) {
        return
    }

    $destinationDirectory = Split-Path -Parent $DestinationPath
    if (-not [string]::IsNullOrWhiteSpace($destinationDirectory)) {
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    }

    Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
}

function Write-TimestampsReport {
    param([string]$Path)

    $candidates = @(
        (Join-Path $repoRoot "android\unityLibrary\build\il2cpp_${Abi}_Release\il2cpp_cache\buildstate\bee-inputdata.json"),
        (Join-Path $repoRoot "android\unityLibrary\build\il2cpp_${Abi}_Release\il2cpp_conv.traceevents"),
        (Join-Path $repoRoot "android\unityLibrary\src\main\jniLibs\$Abi\libil2cpp.so"),
        (Join-Path $repoRoot "android\unityLibrary\symbols\$Abi\libil2cpp.so"),
        $apkPath,
        $manifestPath
    )

    $rows = foreach ($candidate in $candidates) {
        [ordered]@{
            path = $candidate
            exists = (Test-Path -LiteralPath $candidate)
            lastWriteTimeUtc = if (Test-Path -LiteralPath $candidate) { (Get-Item -LiteralPath $candidate).LastWriteTimeUtc.ToString('o') } else { $null }
            length = if (Test-Path -LiteralPath $candidate) { (Get-Item -LiteralPath $candidate).Length } else { $null }
        }
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, ($rows | ConvertTo-Json -Depth 4), $utf8NoBom)
}

New-Item -ItemType Directory -Path $diagRoot -Force | Out-Null

if (-not $SkipWebPrepare) {
    Invoke-CmdOrThrow -Command 'npm run build' -WorkingDirectory $repoRoot -LogPath $webBuildLog -StepName 'Web build'
    Invoke-CmdOrThrow -Command 'npx cap sync android' -WorkingDirectory $repoRoot -LogPath $capSyncLog -StepName 'Capacitor Android sync'
}

if (-not $SkipUnityExport) {
    if (-not (Test-Path -LiteralPath $unityExportScript)) {
        throw "Unity Android export script missing: $unityExportScript"
    }

    Invoke-CmdOrThrow -Command ('"' + $unityExportScript + '"') -WorkingDirectory $repoRoot -LogPath $unityExportLog -StepName 'Unity Android export'
}

& $syncScript -FullReplace -SafeMode -RequireManifest

if ($ExcludeMatchViewerFromMobileAssets -and (Test-Path -LiteralPath $mobileExcludedMatchViewerDir)) {
    $resolvedRepoRoot = [System.IO.Path]::GetFullPath($repoRoot)
    $resolvedMatchViewerDir = [System.IO.Path]::GetFullPath($mobileExcludedMatchViewerDir)
    if (-not $resolvedMatchViewerDir.StartsWith($resolvedRepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove asset directory outside repo root: $resolvedMatchViewerDir"
    }

    Write-Host "[assemble-safe] removing Android-only WebGL payload: $resolvedMatchViewerDir"
    Remove-Item -LiteralPath $resolvedMatchViewerDir -Recurse -Force
}

if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Current manifest missing after safe sync: $manifestPath"
}

$gradleArgs = @(
    '--parallel',
    '--build-cache',
    "-PunityTargetAbis=$Abi",
    "-PunityDiagDir=$diagRoot",
    '-PunityEnableIl2CppDebugger=false',
    ':app:assembleDebug'
)
if (-not $UseBeeBuilder) {
    $gradleArgs += '-PunityDisableBeeBuilder=true'
}
if ($ExcludeMatchViewerFromMobileAssets) {
    $gradleArgs += '-PexcludeMatchViewerFromMobileAssets=true'
}

$gradleCommand = 'call gradlew.bat ' + (($gradleArgs | ForEach-Object {
            if ($_ -match '\s') {
                '"' + $_ + '"'
            } else {
                $_
            }
        }) -join ' ')
[System.IO.File]::WriteAllText($commandFile, $gradleCommand, (New-Object System.Text.UTF8Encoding($false)))

$cmdArguments = "/c $gradleCommand > `"$logFile`" 2>&1"
$process = Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArguments -WorkingDirectory $androidRoot -PassThru -WindowStyle Hidden
$startTime = Get-Date
$hangDetected = $false
$totalTimeoutHit = $false
$buildIl2CppSeen = $false
$lastLogWrite = $startTime

while (-not $process.HasExited) {
    Start-Sleep -Seconds 5

    if (Test-Path -LiteralPath $logFile) {
        $logInfo = Get-Item -LiteralPath $logFile
        $lastLogWrite = $logInfo.LastWriteTime
        if (-not $buildIl2CppSeen) {
            $tail = Get-Content -LiteralPath $logFile -Tail 80 -ErrorAction SilentlyContinue
            if ($tail -match 'Task :unityLibrary:buildIl2Cpp') {
                $buildIl2CppSeen = $true
            }
        }
    }

    if ($buildIl2CppSeen -and ((Get-Date) - $lastLogWrite).TotalSeconds -ge $HangTimeoutSec) {
        & cmd /c "taskkill /PID $($process.Id) /T /F 2>nul" | Out-Null
        $hangDetected = $true
        break
    }

    if (((Get-Date) - $startTime).TotalSeconds -ge $TotalTimeoutSec) {
        & cmd /c "taskkill /PID $($process.Id) /T /F 2>nul" | Out-Null
        $totalTimeoutHit = $true
        break
    }
}

if (-not $process.HasExited) {
    $process.WaitForExit()
}

$exitCode = if ($process.HasExited) { $process.ExitCode } else { 1 }

Copy-DiagnosticFileIfPresent -SourcePath (Join-Path $repoRoot "android\unityLibrary\build\il2cpp_${Abi}_Release\il2cpp_cache\buildstate\bee-inputdata.json") -DestinationPath (Join-Path $diagRoot 'bee-inputdata.json')
Copy-DiagnosticFileIfPresent -SourcePath (Join-Path $repoRoot "android\unityLibrary\build\il2cpp_${Abi}_Release\il2cpp_conv.traceevents") -DestinationPath (Join-Path $diagRoot 'il2cpp_conv.traceevents')
Copy-DiagnosticFileIfPresent -SourcePath (Join-Path $repoRoot "android\unityLibrary\src\main\jniLibs\$Abi\libil2cpp.so") -DestinationPath (Join-Path $diagRoot 'libil2cpp.so')
Copy-DiagnosticFileIfPresent -SourcePath (Join-Path $repoRoot "android\unityLibrary\symbols\$Abi\libil2cpp.so") -DestinationPath (Join-Path $diagRoot 'libil2cpp.symbols.so')
Copy-DiagnosticFileIfPresent -SourcePath (Join-Path $repoRoot 'unity-android-export.log') -DestinationPath (Join-Path $diagRoot 'unity-export.log')
Copy-DiagnosticFileIfPresent -SourcePath $manifestPath -DestinationPath (Join-Path $diagRoot 'current-android-artifact-manifest.json')
Write-TimestampsReport -Path (Join-Path $diagRoot 'timestamps.json')

if ($hangDetected) {
    [System.IO.File]::WriteAllText($statusFile, "status=hang`nreason=buildIl2Cpp inactivity exceeded ${HangTimeoutSec}s", (New-Object System.Text.UTF8Encoding($false)))
    throw "Gradle assemble hang detected. Diagnostics written to $diagRoot"
}

if ($totalTimeoutHit) {
    [System.IO.File]::WriteAllText($statusFile, "status=timeout`nreason=total runtime exceeded ${TotalTimeoutSec}s", (New-Object System.Text.UTF8Encoding($false)))
    throw "Gradle assemble total timeout reached. Diagnostics written to $diagRoot"
}

if ($exitCode -ne 0) {
    [System.IO.File]::WriteAllText($statusFile, "status=failed`nexitCode=$exitCode", (New-Object System.Text.UTF8Encoding($false)))
    throw "Gradle assemble failed with exit code $exitCode. Diagnostics written to $diagRoot"
}

if (-not (Test-Path -LiteralPath $apkPath)) {
    [System.IO.File]::WriteAllText($statusFile, "status=failed`nreason=apk_missing", (New-Object System.Text.UTF8Encoding($false)))
    throw "APK missing after assemble: $apkPath"
}

& $manifestScript -ExportRoot $exportRoot -ManifestPath (Join-Path $exportRoot 'android-artifact-manifest.json') -ApkPath $apkPath -UpdateCurrentManifest
& $verifyScript -ManifestPath $manifestPath -ApkPath $apkPath -Abi $Abi -OutputPath (Join-Path $diagRoot 'verify-apk.json')
[System.IO.File]::WriteAllText($statusFile, "status=ok`napk=$apkPath", (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[assemble-safe] completed. diagnostics=$diagRoot"
