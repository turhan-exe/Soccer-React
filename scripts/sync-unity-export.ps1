param(
    [switch]$FullReplace,
    [switch]$EnableFastIl2CppSync,
    [switch]$SafeMode,
    [switch]$RequireManifest
)

$exportRoot = 'C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\.tmp\AndroidUnityLibraryExport\unityLibrary'
$targetRoot = 'C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\android\unityLibrary'
$backupRoot = 'C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\.tmp\unityLibrary-custom-backup'
$artifactManifestPath = 'C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\.tmp\AndroidUnityLibraryExport\android-artifact-manifest.json'
$cachedArtifactManifestPath = 'C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\.tmp\current-android-artifact-manifest.json'
$unitySdkAliasPath = 'C:/Users/TURHAN/Desktop/MGX/workspace/football-manager-ui/.tmp/unity-tools/sdk'
$unityNdkAliasPath = 'C:/Users/TURHAN/Desktop/MGX/workspace/football-manager-ui/.tmp/unity-tools/ndk'
$targetBuildGradlePath = Join-Path $targetRoot 'build.gradle'
$preservedBuildGradleContent = $null
if (Test-Path $targetBuildGradlePath) {
    $preservedBuildGradleContent = Get-Content $targetBuildGradlePath -Raw
}
$preserveRelativePaths = @(
    'proguard-unity.txt',
    'src\main\AndroidManifest.xml',
    'src\main\java\com\unity3d\player\UnityPlayerActivity.java',
    'src\main\java\com\unity3d\player\EmbeddedUnityPlayerActivity.java',
    'src\main\res\values\styles.xml',
    'src\main\res\values-v21\styles.xml',
    'src\main\res\values-v31\styles.xml'
)
foreach ($relativePath in $preserveRelativePaths) {
    $sourcePath = Join-Path $targetRoot $relativePath
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        continue
    }

    $backupPath = Join-Path $backupRoot $relativePath
    $backupParent = Split-Path $backupPath -Parent
    if (-not (Test-Path -LiteralPath $backupParent)) {
        New-Item -ItemType Directory -Path $backupParent -Force | Out-Null
    }

    Copy-Item $sourcePath $backupPath -Force
}

$runtimeType = ''
$abiNames = @()
$artifactManifestFound = $false
if (Test-Path $artifactManifestPath) {
    try {
        $artifactManifest = Get-Content $artifactManifestPath -Raw | ConvertFrom-Json
        $runtimeType = [string]$artifactManifest.runtimeType
        if ($null -ne $artifactManifest.abis) {
            $abiNames = @($artifactManifest.abis | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        }
        Copy-Item $artifactManifestPath $cachedArtifactManifestPath -Force
        $artifactManifestFound = $true
    } catch {
        Write-Warning "Failed to parse Android artifact manifest: $artifactManifestPath"
    }
}
$artifactManifest = if ($artifactManifestFound) { $artifactManifest } else { $null }
$useOverlaySync = -not $FullReplace
$isMonoRuntime = $runtimeType.StartsWith('Mono', [System.StringComparison]::OrdinalIgnoreCase)

if ($SafeMode -and $EnableFastIl2CppSync) {
    Write-Warning "SafeMode ignores fast IL2CPP sync. Falling back to full deterministic sync."
    $EnableFastIl2CppSync = $false
}

if ($RequireManifest -and -not $artifactManifestFound) {
    throw "Android artifact manifest is required but missing: $artifactManifestPath"
}
$prebuiltIl2CppBinary = Join-Path $exportRoot 'src\main\jniLibs\arm64-v8a\libil2cpp.so'
$shouldUseFastIl2CppSync =
    $EnableFastIl2CppSync -and
    $runtimeType -eq 'IL2CPPFastDebug' -and
    (Test-Path -LiteralPath $prebuiltIl2CppBinary)

if ($EnableFastIl2CppSync -and -not $shouldUseFastIl2CppSync) {
    Write-Warning "Fast IL2CPP sync requested but export does not contain prebuilt IL2CPP binaries. Falling back to safe Unity export sync."
}

if ($FullReplace -and (Test-Path $targetRoot)) {
    try {
        Remove-Item $targetRoot -Recurse -Force -ErrorAction Stop
        Copy-Item $exportRoot $targetRoot -Recurse -Force
        $useOverlaySync = $false
    } catch {
        if ($SafeMode) {
            throw "SafeMode requires a clean unityLibrary full replace. Failed to replace $targetRoot. $($_.Exception.Message)"
        }

        Write-Warning "Failed to fully replace unityLibrary; falling back to overlay sync. $($_.Exception.Message)"
        $useOverlaySync = $true
    }
}

function Remove-SafePathIfPresent {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    try {
        Remove-Item $Path -Recurse -Force -ErrorAction Stop
    } catch {
        Write-Warning "Failed to remove stale safe-sync path: $Path"
    }
}

if ($SafeMode -and $useOverlaySync) {
    foreach ($relativePath in @(
        'src\main\jniLibs',
        'src\main\jniStaticLibs',
        'src\main\Il2CppOutputProject',
        'symbols',
        'build\intermediates\merged_native_libs',
        'build\intermediates\stripped_native_libs',
        'build\intermediates\merged_jni_libs',
        'build\intermediates\library_jni',
        'build\intermediates\library_and_local_jars_jni'
    )) {
        Remove-SafePathIfPresent -Path (Join-Path $targetRoot $relativePath)
    }
}

if ($useOverlaySync) {
    New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
    $lockedIl2CppDeployDir = Join-Path $exportRoot 'src\main\Il2CppOutputProject\IL2CPP\build\deploy'
    $robocopyArgs = @(
        $exportRoot,
        $targetRoot,
        "/E",
        "/R:1",
        "/W:1",
        "/NFL",
        "/NDL",
        "/NJH",
        "/NJS",
        "/NP",
        "/XF",
        "Bee.BeeDriver2.dll"
    )
    if (Test-Path $lockedIl2CppDeployDir) {
        $robocopyArgs += @("/XD", $lockedIl2CppDeployDir)
    }
    & robocopy @robocopyArgs | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "robocopy overlay sync failed with exit code $LASTEXITCODE"
    }
}

$staleNestedUnityLibrary = Join-Path $targetRoot 'unityLibrary'
if ((Test-Path $staleNestedUnityLibrary) -and -not (Test-Path (Join-Path $exportRoot 'unityLibrary'))) {
    try {
        Remove-Item $staleNestedUnityLibrary -Recurse -Force -ErrorAction Stop
    } catch {
        Write-Warning "Failed to remove stale nested unityLibrary module: $staleNestedUnityLibrary"
    }
}

if ($isMonoRuntime) {
    $staleIl2CppRoot = Join-Path $targetRoot 'src\main\Il2CppOutputProject'
    if (Test-Path $staleIl2CppRoot) {
        try {
            Remove-Item $staleIl2CppRoot -Recurse -Force -ErrorAction Stop
        } catch {
            Write-Warning "Mono export left stale Il2CppOutputProject in place because it is locked: $staleIl2CppRoot"
        }
    }
}

if ($abiNames.Count -gt 0) {
    foreach ($abiParent in @(
        (Join-Path $targetRoot 'src\main\jniLibs'),
        (Join-Path $targetRoot 'src\main\jniStaticLibs'),
        (Join-Path $targetRoot 'src\main\libs'),
        (Join-Path $targetRoot 'symbols')
    )) {
        if (-not (Test-Path $abiParent)) {
            continue
        }

        Get-ChildItem -Path $abiParent -Directory | Where-Object { $abiNames -notcontains $_.Name } | ForEach-Object {
            try {
                Remove-Item $_.FullName -Recurse -Force -ErrorAction Stop
            } catch {
                Write-Warning "Failed to remove stale ABI directory: $($_.FullName)"
            }
        }
    }

    $il2CppBuildRoot = Join-Path $targetRoot 'build'
    if (Test-Path $il2CppBuildRoot) {
        Get-ChildItem -Path $il2CppBuildRoot -Directory -Filter 'il2cpp_*' | Where-Object {
            $abiSegment = $_.Name.Substring('il2cpp_'.Length)
            $abiName = $abiSegment -replace '_[^_]+$',''
            $abiNames -notcontains $abiName
        } | ForEach-Object {
            try {
                Remove-Item $_.FullName -Recurse -Force -ErrorAction Stop
            } catch {
                Write-Warning "Failed to remove stale IL2CPP build cache: $($_.FullName)"
            }
        }
    }
}

if (-not $shouldUseFastIl2CppSync) {
    foreach ($relativeRoot in @(
        'src\main\jniLibs',
        'symbols'
    )) {
        $fullRoot = Join-Path $targetRoot $relativeRoot
        if (-not (Test-Path $fullRoot)) {
            continue
        }

        Get-ChildItem -Path $fullRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $staleLib = Join-Path $_.FullName 'libil2cpp.so'
            if (Test-Path $staleLib) {
                try {
                    Remove-Item $staleLib -Force -ErrorAction Stop
                } catch {
                    Write-Warning "Failed to remove stale IL2CPP binary: $staleLib"
                }
            }
        }
    }

    foreach ($intermediateRoot in @(
        (Join-Path $targetRoot 'build\intermediates\merged_native_libs'),
        (Join-Path $targetRoot 'build\intermediates\stripped_native_libs'),
        (Join-Path $targetRoot 'build\intermediates\merged_jni_libs'),
        (Join-Path $targetRoot 'build\intermediates\library_jni'),
        (Join-Path $targetRoot 'build\intermediates\library_and_local_jars_jni')
    )) {
        if (-not (Test-Path $intermediateRoot)) {
            continue
        }

        try {
            Remove-Item $intermediateRoot -Recurse -Force -ErrorAction Stop
        } catch {
            Write-Warning "Failed to remove stale IL2CPP intermediate root: $intermediateRoot"
        }
    }
}

New-Item -ItemType Directory -Path (Join-Path $targetRoot 'src\main\java\com\unity3d\player') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $targetRoot 'src\main\res\values') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $targetRoot 'src\main\res\values-v21') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $targetRoot 'src\main\res\values-v31') -Force | Out-Null

$buildGradleSource = Join-Path $exportRoot 'build.gradle'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Apply-UnityShellReturnDestroyGuard {
    param(
        [string]$UnityPlayerActivityPath,
        [string]$EmbeddedUnityPlayerActivityPath,
        [System.Text.UTF8Encoding]$Encoding
    )

    if (Test-Path -LiteralPath $UnityPlayerActivityPath) {
        $unityPlayerActivity = Get-Content $UnityPlayerActivityPath -Raw
        $playerMethodNeedle = "    protected String updateUnityCommandLineArguments(String cmdLine)`r`n    {`r`n        return cmdLine;`r`n    }"
        $playerMethodReplacement = "    protected String updateUnityCommandLineArguments(String cmdLine)`r`n    {`r`n        return cmdLine;`r`n    }`r`n`r`n    /**`r`n     * Allows embedded callers to unload Unity and return to the host shell without`r`n     * routing back through UnityPlayer.destroy(), which hard-kills the process.`r`n     */`r`n    protected boolean shouldDestroyUnityPlayerOnDestroy()`r`n    {`r`n        return true;`r`n    }"

        if (-not $unityPlayerActivity.Contains('shouldDestroyUnityPlayerOnDestroy')) {
            $unityPlayerActivity = $unityPlayerActivity.Replace($playerMethodNeedle, $playerMethodReplacement)
        }

        if (-not $unityPlayerActivity.Contains('if (mUnityPlayer != null && shouldDestroyUnityPlayerOnDestroy())')) {
            $unityPlayerActivity = $unityPlayerActivity.Replace(
                "        mUnityPlayer.destroy();",
                "        if (mUnityPlayer != null && shouldDestroyUnityPlayerOnDestroy())`r`n            mUnityPlayer.destroy();")
        }

        [System.IO.File]::WriteAllText($UnityPlayerActivityPath, $unityPlayerActivity, $Encoding)
    }

    if (Test-Path -LiteralPath $EmbeddedUnityPlayerActivityPath) {
        $embeddedUnityPlayerActivity = Get-Content $EmbeddedUnityPlayerActivityPath -Raw
        $embeddedFieldNeedle = "    private boolean shellReturnRequested;"
        $embeddedFieldReplacement = "    private boolean shellReturnRequested;`r`n    private boolean skipDestroyOnDestroy;`r`n`r`n    @Override`r`n    protected boolean shouldDestroyUnityPlayerOnDestroy() {`r`n        return !skipDestroyOnDestroy;`r`n    }"

        if (-not $embeddedUnityPlayerActivity.Contains('skipDestroyOnDestroy')) {
            $embeddedUnityPlayerActivity = $embeddedUnityPlayerActivity.Replace($embeddedFieldNeedle, $embeddedFieldReplacement)
        }

        $embeddedUnityPlayerActivity = $embeddedUnityPlayerActivity.Replace(
            "            shellReturnRequested = true;",
            "            shellReturnRequested = true;`r`n            skipDestroyOnDestroy = true;")

        $embeddedUnityPlayerActivity = $embeddedUnityPlayerActivity.Replace(
            "        Log.d(TAG, ""onUnityPlayerUnloaded: finishing embedded activity for shell return."");`r`n        finishForShellReturn();",
            "        Log.d(TAG, ""onUnityPlayerUnloaded: finishing embedded activity for shell return."");`r`n        skipDestroyOnDestroy = true;`r`n        finishForShellReturn();")

        $embeddedUnityPlayerActivity = $embeddedUnityPlayerActivity.Replace(
            "        Log.d(TAG, ""onUnityPlayerQuitted: finishing embedded activity for shell return."");`r`n        finishForShellReturn();",
            "        Log.d(TAG, ""onUnityPlayerQuitted: finishing embedded activity for shell return."");`r`n        skipDestroyOnDestroy = shellReturnRequested || skipDestroyOnDestroy;`r`n        finishForShellReturn();")

        $embeddedUnityPlayerActivity = $embeddedUnityPlayerActivity.Replace(
            "            skipDestroyOnDestroy = true;`r`n            skipDestroyOnDestroy = true;",
            "            skipDestroyOnDestroy = true;")

        [System.IO.File]::WriteAllText($EmbeddedUnityPlayerActivityPath, $embeddedUnityPlayerActivity, $Encoding)
    }
}

if ($null -ne $preservedBuildGradleContent) {
    [System.IO.File]::WriteAllText((Join-Path $targetRoot 'build.gradle'), $preservedBuildGradleContent, $utf8NoBom)
} else {
    Copy-Item $buildGradleSource (Join-Path $targetRoot 'build.gradle') -Force
}

if ($shouldUseFastIl2CppSync) {
    $buildGradlePath = Join-Path $targetRoot 'build.gradle'
    $buildGradle = Get-Content $buildGradlePath -Raw
    $buildGradle = $buildGradle.Replace(
        'ndkPath "C:/Program Files/Unity/Hub/Editor/6000.3.11f1/Editor/Data/PlaybackEngines/AndroidPlayer/NDK"',
        ('ndkPath "' + $unityNdkAliasPath + '"')
    )
    $needle = '    commandLineArgs.add("--tool-chain-path=" + getProperty("unity.androidNdkPath"))'
    $replacement = @'
    commandLineArgs.add("--disable-bee-builder")
    commandLineArgs.add("--tool-chain-path=" + getProperty("unity.androidNdkPath"))
'@
    if ($buildGradle.Contains($needle) -and -not $buildGradle.Contains('--disable-bee-builder')) {
        $buildGradle = $buildGradle.Replace($needle, $replacement.TrimEnd())
    }

    $prebuiltNeedle = @'
            else {
                archs.each { arch, abi ->
                    buildIl2CppImpl(workingDir, 'Release', arch, abi, staticLibs[arch] as String[]);
                }
            }
'@
    $prebuiltReplacement = @'
            else if (project.hasProperty("unityUsePrebuiltIl2Cpp")) {
                println("Using prebuilt il2cpp binaries from synced Unity export.")
                archs.each { arch, abi ->
                    def outputFile = file(getIl2CppOutputPath(workingDir, abi))
                    def symbolFile = file(getIl2CppSymbolPath(workingDir, abi))
                    if (!outputFile.exists()) {
                        throw new GradleException("Prebuilt il2cpp binary missing: ${outputFile}")
                    }
                    if (!symbolFile.exists()) {
                        ant.copy(file: outputFile, tofile: symbolFile)
                    }
                }
            }
            else {
                archs.each { arch, abi ->
                    buildIl2CppImpl(workingDir, 'Release', arch, abi, staticLibs[arch] as String[]);
                }
            }
'@
    if ($buildGradle.Contains($prebuiltNeedle) -and -not $buildGradle.Contains('unityUsePrebuiltIl2Cpp')) {
        $buildGradle = $buildGradle.Replace($prebuiltNeedle, $prebuiltReplacement.TrimEnd())
    }

    [System.IO.File]::WriteAllText($buildGradlePath, $buildGradle, $utf8NoBom)
}

Copy-Item (Join-Path $backupRoot 'proguard-unity.txt') (Join-Path $targetRoot 'proguard-unity.txt') -Force
Copy-Item (Join-Path $backupRoot 'src\main\AndroidManifest.xml') (Join-Path $targetRoot 'src\main\AndroidManifest.xml') -Force
Copy-Item (Join-Path $backupRoot 'src\main\java\com\unity3d\player\UnityPlayerActivity.java') (Join-Path $targetRoot 'src\main\java\com\unity3d\player\UnityPlayerActivity.java') -Force
Copy-Item (Join-Path $backupRoot 'src\main\java\com\unity3d\player\EmbeddedUnityPlayerActivity.java') (Join-Path $targetRoot 'src\main\java\com\unity3d\player\EmbeddedUnityPlayerActivity.java') -Force
Copy-Item (Join-Path $backupRoot 'src\main\res\values\styles.xml') (Join-Path $targetRoot 'src\main\res\values\styles.xml') -Force
Copy-Item (Join-Path $backupRoot 'src\main\res\values-v21\styles.xml') (Join-Path $targetRoot 'src\main\res\values-v21\styles.xml') -Force
Copy-Item (Join-Path $backupRoot 'src\main\res\values-v31\styles.xml') (Join-Path $targetRoot 'src\main\res\values-v31\styles.xml') -Force
Apply-UnityShellReturnDestroyGuard `
    -UnityPlayerActivityPath (Join-Path $targetRoot 'src\main\java\com\unity3d\player\UnityPlayerActivity.java') `
    -EmbeddedUnityPlayerActivityPath (Join-Path $targetRoot 'src\main\java\com\unity3d\player\EmbeddedUnityPlayerActivity.java') `
    -Encoding $utf8NoBom
