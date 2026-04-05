param(
    [switch]$DeepClean
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$unityProjectRoot = 'C:\UnityProject\FHS'
$exportRoot = Join-Path $repoRoot '.tmp\AndroidUnityLibraryExport'
$fastDebugRoot = Join-Path $repoRoot '.tmp\AndroidFastDebug'
$cachedArtifactManifestPath = Join-Path $repoRoot '.tmp\current-android-artifact-manifest.json'
$friendlyRuntimePrunePaths = @(
    (Join-Path $repoRoot '.tmp\unity-linux-runtime-friendly'),
    (Join-Path $repoRoot '.tmp\unity-linux-runtime-friendly.tar'),
    (Join-Path $repoRoot '.tmp\unity-friendly-runtime'),
    (Join-Path $repoRoot '.tmp\friendly-runtime-stage')
)

function Remove-Tree {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    Remove-Item -LiteralPath $Path -Recurse -Force
    Write-Host "[prune] removed $Path"
}

function Remove-FileSafe {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    Remove-Item -LiteralPath $Path -Force
    Write-Host "[prune] removed $Path"
}

function Remove-EmptyDirectories {
    param([string]$Root)

    if (-not (Test-Path -LiteralPath $Root)) {
        return
    }

    Get-ChildItem -LiteralPath $Root -Directory -Recurse |
        Sort-Object FullName -Descending |
        ForEach-Object {
            if (-not (Get-ChildItem -LiteralPath $_.FullName -Force | Select-Object -First 1)) {
                Remove-Item -LiteralPath $_.FullName -Force
            }
        }
}

function Add-NewestArtifactsToKeepSet {
    param(
        [System.Collections.Generic.HashSet[string]]$KeepSet,
        [string]$Root,
        [string]$Filter,
        [int]$Count
    )

    if (-not (Test-Path -LiteralPath $Root) -or $Count -le 0) {
        return
    }

    Get-ChildItem -LiteralPath $Root -File -Recurse -Filter $Filter |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First $Count |
        ForEach-Object { [void]$KeepSet.Add($_.FullName) }
}

function Prune-FilesKeepingNewestArtifacts {
    param(
        [string]$Root,
        [System.Collections.Generic.HashSet[string]]$KeepSet
    )

    if (-not (Test-Path -LiteralPath $Root)) {
        return
    }

    Get-ChildItem -LiteralPath $Root -File -Recurse |
        Where-Object { -not $KeepSet.Contains($_.FullName) } |
        ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Force
        }

    Remove-EmptyDirectories -Root $Root
    Write-Host "[prune] pruned $Root"
}

function Resolve-ArtifactManifest {
    $manifestCandidates = @(
        (Join-Path $exportRoot 'android-artifact-manifest.json'),
        $cachedArtifactManifestPath
    )

    foreach ($path in $manifestCandidates) {
        if (-not (Test-Path -LiteralPath $path)) {
            continue
        }

        try {
            return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        } catch {
            Write-Warning "Failed to parse Android artifact manifest: $path"
        }
    }

    return $null
}

function Prune-StaleUnityLibraryAbiArtifacts {
    param([object]$ArtifactManifest)

    if ($null -eq $ArtifactManifest -or $null -eq $ArtifactManifest.abis) {
        return
    }

    $abiNames = @($ArtifactManifest.abis | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($abiNames.Count -eq 0) {
        return
    }

    $unityLibraryRoot = Join-Path $repoRoot 'android\unityLibrary'
    foreach ($abiParent in @(
        (Join-Path $unityLibraryRoot 'src\main\jniLibs'),
        (Join-Path $unityLibraryRoot 'src\main\jniStaticLibs'),
        (Join-Path $unityLibraryRoot 'src\main\libs'),
        (Join-Path $unityLibraryRoot 'symbols')
    )) {
        if (-not (Test-Path -LiteralPath $abiParent)) {
            continue
        }

        Get-ChildItem -LiteralPath $abiParent -Directory |
            Where-Object { $abiNames -notcontains $_.Name } |
            ForEach-Object {
                Remove-Tree -Path $_.FullName
            }
    }

    $il2CppBuildRoot = Join-Path $unityLibraryRoot 'build'
    if (Test-Path -LiteralPath $il2CppBuildRoot) {
        Get-ChildItem -LiteralPath $il2CppBuildRoot -Directory -Filter 'il2cpp_*' |
            Where-Object {
                $abiSegment = $_.Name.Substring('il2cpp_'.Length)
                $abiName = $abiSegment -replace '_[^_]+$',''
                $abiNames -notcontains $abiName
            } |
            ForEach-Object {
                Remove-Tree -Path $_.FullName
            }
    }
}

$artifactManifest = Resolve-ArtifactManifest

$keepFastDebugArtifacts = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
Add-NewestArtifactsToKeepSet -KeepSet $keepFastDebugArtifacts -Root $fastDebugRoot -Filter '*.apk' -Count 2
Add-NewestArtifactsToKeepSet -KeepSet $keepFastDebugArtifacts -Root $fastDebugRoot -Filter '*.aab' -Count 1
if (Test-Path -LiteralPath $fastDebugRoot) {
    Prune-FilesKeepingNewestArtifacts -Root $fastDebugRoot -KeepSet $keepFastDebugArtifacts
}

$outputRoots = @(
    (Join-Path $repoRoot 'android\app\build\outputs'),
    (Join-Path $repoRoot 'android\unityLibrary\build\outputs'),
    (Join-Path $repoRoot 'android\capacitor-cordova-android-plugins\build\outputs')
)

$keepBuildOutputs = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($root in $outputRoots) {
    Add-NewestArtifactsToKeepSet -KeepSet $keepBuildOutputs -Root $root -Filter '*.apk' -Count 2
    Add-NewestArtifactsToKeepSet -KeepSet $keepBuildOutputs -Root $root -Filter '*.aab' -Count 1
    Add-NewestArtifactsToKeepSet -KeepSet $keepBuildOutputs -Root $root -Filter '*.aar' -Count 1
}

foreach ($root in $outputRoots) {
    Prune-FilesKeepingNewestArtifacts -Root $root -KeepSet $keepBuildOutputs
}

foreach ($reportsRoot in @(
    (Join-Path $repoRoot 'android\app\build\reports'),
    (Join-Path $repoRoot 'android\unityLibrary\build\reports')
)) {
    Remove-Tree -Path $reportsRoot
}

Prune-StaleUnityLibraryAbiArtifacts -ArtifactManifest $artifactManifest

Remove-Tree -Path $exportRoot
foreach ($friendlyRuntimePath in $friendlyRuntimePrunePaths) {
    if ($friendlyRuntimePath.EndsWith('.tar', [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-FileSafe -Path $friendlyRuntimePath
        continue
    }

    Remove-Tree -Path $friendlyRuntimePath
}

if ($DeepClean) {
    foreach ($path in @(
        (Join-Path $repoRoot 'android\app\build'),
        (Join-Path $repoRoot 'android\unityLibrary\build'),
        (Join-Path $repoRoot 'android\capacitor-cordova-android-plugins\build'),
        (Join-Path $repoRoot 'android\.gradle'),
        (Join-Path $repoRoot '.gradle'),
        (Join-Path $unityProjectRoot 'Library\Bee\Android'),
        (Join-Path $unityProjectRoot 'Library\Bee\artifacts\Android')
    )) {
        Remove-Tree -Path $path
    }
}

Write-Host "[prune] completed DeepClean=$DeepClean"
