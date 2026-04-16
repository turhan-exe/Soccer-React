param(
    [string]$ExportRoot = '',
    [string]$ManifestPath = '',
    [string]$ApkPath = '',
    [switch]$UpdateCurrentManifest
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repoRoot = Split-Path -Parent $PSScriptRoot
$unityProjectRoot = 'C:\UnityProject\FHS'
if ([string]::IsNullOrWhiteSpace($ExportRoot)) {
    $ExportRoot = Join-Path $repoRoot '.tmp\AndroidUnityLibraryExport'
}
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $ExportRoot 'android-artifact-manifest.json'
}

$currentManifestPath = Join-Path $repoRoot '.tmp\current-android-artifact-manifest.json'
$historyRoot = Join-Path $repoRoot '.tmp\android-build-manifests'
$exportUnityLibraryRoot = Join-Path $ExportRoot 'unityLibrary'
$targetUnityLibraryRoot = Join-Path $repoRoot 'android\unityLibrary'
$readElfPath = Join-Path $repoRoot '.tmp\unity-tools\ndk\toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-readelf.exe'

function Read-JsonFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Write-Utf8Json {
    param(
        [string]$Path,
        [object]$Value
    )

    $directory = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $json = $Value | ConvertTo-Json -Depth 12
    [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

function Get-ExistingValue {
    param(
        [object]$Source,
        [string]$PropertyName,
        $Fallback = $null
    )

    if ($null -eq $Source) {
        return $Fallback
    }

    $property = $Source.PSObject.Properties[$PropertyName]
    if ($null -eq $property) {
        return $Fallback
    }

    return $property.Value
}

function Get-FileSha256 {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-GitSha {
    param([string]$Root)

    try {
        $sha = (& git -C $Root rev-parse HEAD 2>$null).Trim()
        return $sha
    } catch {
        return ''
    }
}

function Get-ShortGitSha {
    param([string]$Sha)

    if ([string]::IsNullOrWhiteSpace($Sha)) {
        return 'nogit'
    }

    $trimmed = $Sha.Trim()
    return $trimmed.Substring(0, [Math]::Min(7, $trimmed.Length)).ToLowerInvariant()
}

function Get-UnityVersion {
    param([string]$Root)

    $projectVersionPath = Join-Path $Root 'ProjectSettings\ProjectVersion.txt'
    if (-not (Test-Path -LiteralPath $projectVersionPath)) {
        return ''
    }

    $line = Get-Content -LiteralPath $projectVersionPath | Where-Object { $_ -match '^m_EditorVersion:\s*(.+)$' } | Select-Object -First 1
    if ($line -match '^m_EditorVersion:\s*(.+)$') {
        return $Matches[1].Trim()
    }

    return ''
}

function Get-ElfBuildId {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return ''
    }

    if (-not (Test-Path -LiteralPath $readElfPath)) {
        return ''
    }

    $output = & $readElfPath -n $Path 2>$null
    if ($LASTEXITCODE -ne 0 -or $null -eq $output) {
        return ''
    }

    foreach ($line in $output) {
        if ($line -match 'Build ID:\s*([0-9A-Fa-f]+)') {
            return $Matches[1].ToLowerInvariant()
        }
    }

    return ''
}

function Resolve-ExistingAbis {
    param([object]$ExistingManifest)

    $existingAbis = Get-ExistingValue -Source $ExistingManifest -PropertyName 'abis'
    if ($null -ne $existingAbis) {
        $abiList = @($existingAbis | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        if ($abiList.Count -gt 0) {
            return $abiList
        }
    }

    $jniLibsRoots = @(
        (Join-Path $exportUnityLibraryRoot 'src\main\jniLibs'),
        (Join-Path $targetUnityLibraryRoot 'src\main\jniLibs')
    )
    foreach ($root in $jniLibsRoots) {
        if (-not (Test-Path -LiteralPath $root)) {
            continue
        }

        $directories = Get-ChildItem -LiteralPath $root -Directory | Select-Object -ExpandProperty Name
        if ($directories.Count -gt 0) {
            return @($directories)
        }
    }

    return @('arm64-v8a')
}

function Resolve-ArtifactPath {
    param([string[]]$Candidates)

    foreach ($candidate in $Candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    return $null
}

function Get-ArtifactTimestamps {
    param(
        [string[]]$Abis,
        [string]$UnityLibraryRoot
    )

    $timestamps = New-Object System.Collections.Generic.List[datetime]
    $sharedCandidates = @(
        (Join-Path $UnityLibraryRoot 'src\main\assets\bin\Data\Managed\Metadata\global-metadata.dat'),
        (Join-Path $UnityLibraryRoot 'src\main\assets\bin\Data\globalgamemanagers')
    )

    foreach ($candidate in $sharedCandidates) {
        if (Test-Path -LiteralPath $candidate) {
            $timestamps.Add((Get-Item -LiteralPath $candidate).LastWriteTimeUtc)
        }
    }

    foreach ($abi in $Abis) {
        foreach ($artifactPath in @(
            (Join-Path $UnityLibraryRoot "src\main\jniLibs\$abi\libil2cpp.so"),
            (Join-Path $UnityLibraryRoot "src\main\jniLibs\$abi\libunity.so")
        )) {
            if (Test-Path -LiteralPath $artifactPath) {
                $timestamps.Add((Get-Item -LiteralPath $artifactPath).LastWriteTimeUtc)
            }
        }
    }

    return $timestamps
}

function Get-ExportArtifactTimestampUtc {
    param([string[]]$Abis)

    $exportTimestamps = Get-ArtifactTimestamps -Abis $Abis -UnityLibraryRoot $exportUnityLibraryRoot
    if ($exportTimestamps.Count -gt 0) {
        return ($exportTimestamps | Sort-Object -Descending | Select-Object -First 1)
    }

    $targetTimestamps = Get-ArtifactTimestamps -Abis $Abis -UnityLibraryRoot $targetUnityLibraryRoot
    if ($targetTimestamps.Count -gt 0) {
        return ($targetTimestamps | Sort-Object -Descending | Select-Object -First 1)
    }

    return (Get-Date).ToUniversalTime()
}

function New-ArtifactInfo {
    param(
        [string]$RelativePath,
        [string[]]$Candidates,
        [switch]$IncludeBuildId
    )

    $resolvedPath = Resolve-ArtifactPath -Candidates $Candidates
    if ([string]::IsNullOrWhiteSpace($resolvedPath)) {
        return [ordered]@{
            relativePath = $RelativePath
            sourcePath = $null
            sha256 = $null
            buildId = $null
        }
    }

    return [ordered]@{
        relativePath = $RelativePath
        sourcePath = $resolvedPath
        sha256 = Get-FileSha256 -Path $resolvedPath
        buildId = if ($IncludeBuildId) { Get-ElfBuildId -Path $resolvedPath } else { $null }
    }
}

function Get-ApkEntryArtifact {
    param(
        [System.IO.Compression.ZipArchive]$Zip,
        [string]$EntryPath,
        [string]$TempRoot,
        [switch]$IncludeBuildId
    )

    $entry = $Zip.Entries | Where-Object { $_.FullName -eq $EntryPath } | Select-Object -First 1
    if ($null -eq $entry) {
        return [ordered]@{
            relativePath = $EntryPath
            sha256 = $null
            buildId = $null
        }
    }

    $destination = Join-Path $TempRoot ([System.Guid]::NewGuid().ToString('N') + '-' + [System.IO.Path]::GetFileName($EntryPath))
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)

    return [ordered]@{
        relativePath = $EntryPath
        sha256 = Get-FileSha256 -Path $destination
        buildId = if ($IncludeBuildId) { Get-ElfBuildId -Path $destination } else { $null }
    }
}

function Get-ApkArtifacts {
    param(
        [string]$ApkPath,
        [string[]]$Abis
    )

    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('fhs-apk-artifacts-' + [System.Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    try {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($ApkPath)
        try {
            $result = [ordered]@{}
            foreach ($abi in $Abis) {
                $result[$abi] = [ordered]@{
                    libil2cpp = Get-ApkEntryArtifact -Zip $zip -EntryPath "lib/$abi/libil2cpp.so" -TempRoot $tempRoot -IncludeBuildId
                    libunity = Get-ApkEntryArtifact -Zip $zip -EntryPath "lib/$abi/libunity.so" -TempRoot $tempRoot -IncludeBuildId
                }
            }

            $result.shared = [ordered]@{
                globalMetadata = Get-ApkEntryArtifact -Zip $zip -EntryPath 'assets/bin/Data/Managed/Metadata/global-metadata.dat' -TempRoot $tempRoot
                globalGameManagers = Get-ApkEntryArtifact -Zip $zip -EntryPath 'assets/bin/Data/globalgamemanagers' -TempRoot $tempRoot
            }
            return $result
        } finally {
            $zip.Dispose()
        }
    } finally {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$existingManifest = Read-JsonFile -Path $ManifestPath
$versionName = [string](Get-ExistingValue -Source $existingManifest -PropertyName 'versionName' -Fallback '1.0.0')
$versionCode = [int](Get-ExistingValue -Source $existingManifest -PropertyName 'versionCode' -Fallback 0)
$unityVersion = [string](Get-ExistingValue -Source $existingManifest -PropertyName 'unityVersion' -Fallback (Get-UnityVersion -Root $unityProjectRoot))
$abis = Resolve-ExistingAbis -ExistingManifest $existingManifest
$resolvedGitSha = (Get-GitSha -Root $unityProjectRoot)
if ([string]::IsNullOrWhiteSpace($resolvedGitSha)) {
    $resolvedGitSha = [string](Get-ExistingValue -Source $existingManifest -PropertyName 'gitSha' -Fallback '')
}
$gitSha = [string]$resolvedGitSha
$runtimeType = [string](Get-ExistingValue -Source $existingManifest -PropertyName 'runtimeType' -Fallback 'unknown')
$exportTimestampUtc = Get-ExportArtifactTimestampUtc -Abis $abis
$buildTimestampUtc = $exportTimestampUtc.ToString('yyyy-MM-ddTHH:mm:ssZ')
$buildId = "androidexport-{0}-{1}" -f (Get-ShortGitSha -Sha $gitSha), $exportTimestampUtc.ToString('yyyyMMddTHHmmssZ')
$developmentBuild = [bool](Get-ExistingValue -Source $existingManifest -PropertyName 'developmentBuild' -Fallback $true)
$allowDebugging = [bool](Get-ExistingValue -Source $existingManifest -PropertyName 'allowDebugging' -Fallback $true)
$unityBuildFlavor = [string](Get-ExistingValue -Source $existingManifest -PropertyName 'unityBuildFlavor' -Fallback '')
if ([string]::IsNullOrWhiteSpace($unityBuildFlavor)) {
    $unityBuildFlavor = if ($developmentBuild) { 'live_fastdebug_dev' } else { 'live_safe_nondev' }
}

$graphicsApis = @((Get-ExistingValue -Source $existingManifest -PropertyName 'graphicsApis' -Fallback @()) | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($graphicsApis.Count -eq 0 -and -not $developmentBuild) {
    $graphicsApis = @('gles3')
}

$manifest = [ordered]@{
    buildId = $buildId
    buildTimestampUtc = $buildTimestampUtc
    runtimeType = $runtimeType
    unityBinaryName = [string](Get-ExistingValue -Source $existingManifest -PropertyName 'unityBinaryName' -Fallback 'unityLibrary')
    versionName = $versionName
    versionCode = $versionCode
    gitSha = $gitSha
    unityVersion = $unityVersion
    scriptingBackend = [string](Get-ExistingValue -Source $existingManifest -PropertyName 'scriptingBackend' -Fallback 'IL2CPP')
    managedStrippingLevel = [string](Get-ExistingValue -Source $existingManifest -PropertyName 'managedStrippingLevel' -Fallback '')
    stripEngineCode = [bool](Get-ExistingValue -Source $existingManifest -PropertyName 'stripEngineCode' -Fallback $false)
    developmentBuild = $developmentBuild
    allowDebugging = $allowDebugging
    unityBuildFlavor = $unityBuildFlavor
    graphicsApis = @($graphicsApis)
    abis = @($abis)
    artifacts = [ordered]@{
        export = [ordered]@{}
    }
}

foreach ($abi in $abis) {
    $manifest.artifacts.export[$abi] = [ordered]@{
        libil2cpp = New-ArtifactInfo -RelativePath "lib/$abi/libil2cpp.so" -Candidates @(
            (Join-Path $exportUnityLibraryRoot "src\main\jniLibs\$abi\libil2cpp.so"),
            (Join-Path $targetUnityLibraryRoot "src\main\jniLibs\$abi\libil2cpp.so")
        ) -IncludeBuildId
        libunity = New-ArtifactInfo -RelativePath "lib/$abi/libunity.so" -Candidates @(
            (Join-Path $exportUnityLibraryRoot "src\main\jniLibs\$abi\libunity.so"),
            (Join-Path $targetUnityLibraryRoot "src\main\jniLibs\$abi\libunity.so")
        ) -IncludeBuildId
    }
}

$manifest.artifacts.export.shared = [ordered]@{
    globalMetadata = New-ArtifactInfo -RelativePath 'assets/bin/Data/Managed/Metadata/global-metadata.dat' -Candidates @(
        (Join-Path $exportUnityLibraryRoot 'src\main\assets\bin\Data\Managed\Metadata\global-metadata.dat'),
        (Join-Path $targetUnityLibraryRoot 'src\main\assets\bin\Data\Managed\Metadata\global-metadata.dat')
    )
    globalGameManagers = New-ArtifactInfo -RelativePath 'assets/bin/Data/globalgamemanagers' -Candidates @(
        (Join-Path $exportUnityLibraryRoot 'src\main\assets\bin\Data\globalgamemanagers'),
        (Join-Path $targetUnityLibraryRoot 'src\main\assets\bin\Data\globalgamemanagers')
    )
}

if (-not [string]::IsNullOrWhiteSpace($ApkPath) -and (Test-Path -LiteralPath $ApkPath)) {
    $resolvedApkPath = (Resolve-Path -LiteralPath $ApkPath).ProviderPath
    $manifest.apk = [ordered]@{
        path = $resolvedApkPath
        sha256 = Get-FileSha256 -Path $resolvedApkPath
    }
    $manifest.artifacts.apk = Get-ApkArtifacts -ApkPath $resolvedApkPath -Abis $abis
}

Write-Utf8Json -Path $ManifestPath -Value $manifest
Write-Utf8Json -Path (Join-Path $historyRoot "$buildId.json") -Value $manifest
if ($UpdateCurrentManifest) {
    Write-Utf8Json -Path $currentManifestPath -Value $manifest
}

Write-Host "[manifest] wrote $ManifestPath"
