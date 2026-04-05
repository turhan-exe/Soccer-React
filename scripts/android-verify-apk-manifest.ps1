param(
    [string]$ManifestPath = '',
    [string]$ApkPath = '',
    [string]$Abi = 'arm64-v8a',
    [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $repoRoot '.tmp\current-android-artifact-manifest.json'
}
if ([string]::IsNullOrWhiteSpace($ApkPath)) {
    $ApkPath = Join-Path $repoRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
}

$readElfPath = Join-Path $repoRoot '.tmp\unity-tools\ndk\toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-readelf.exe'

function Get-FileSha256 {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-ElfBuildId {
    param([string]$Path)

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

function Compare-Artifact {
    param(
        [string]$Name,
        [object]$Expected,
        [object]$Actual
    )

    $shaMatches = $Expected.sha256 -eq $Actual.sha256
    $buildIdMatches = $true
    if ($null -ne $Expected.buildId -and -not [string]::IsNullOrWhiteSpace([string]$Expected.buildId)) {
        $buildIdMatches = $Expected.buildId -eq $Actual.buildId
    }

    return [ordered]@{
        name = $Name
        expectedSha256 = $Expected.sha256
        actualSha256 = $Actual.sha256
        expectedBuildId = $Expected.buildId
        actualBuildId = $Actual.buildId
        matches = ($shaMatches -and $buildIdMatches)
    }
}

function Get-ObjectPropertyValue {
    param(
        [object]$Source,
        [string]$Name
    )

    if ($null -eq $Source) {
        return $null
    }

    if ($Source -is [System.Collections.IDictionary]) {
        return $Source[$Name]
    }

    $property = $Source.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

if (-not (Test-Path -LiteralPath $ManifestPath)) {
    throw "Manifest file not found: $ManifestPath"
}
if (-not (Test-Path -LiteralPath $ApkPath)) {
    throw "APK not found: $ApkPath"
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$exportArtifacts = Get-ObjectPropertyValue -Source $manifest.artifacts -Name 'export'
$expectedAbi = Get-ObjectPropertyValue -Source $exportArtifacts -Name $Abi
if ($null -eq $expectedAbi) {
    throw "Manifest does not contain expected ABI artifacts for $Abi"
}
$expectedShared = Get-ObjectPropertyValue -Source $exportArtifacts -Name 'shared'

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('fhs-apk-verify-' + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
    $zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ApkPath).ProviderPath)
    try {
        $actualAbi = [ordered]@{
            libil2cpp = Get-ApkEntryArtifact -Zip $zip -EntryPath "lib/$Abi/libil2cpp.so" -TempRoot $tempRoot -IncludeBuildId
            libunity = Get-ApkEntryArtifact -Zip $zip -EntryPath "lib/$Abi/libunity.so" -TempRoot $tempRoot -IncludeBuildId
        }
        $actualShared = [ordered]@{
            globalMetadata = Get-ApkEntryArtifact -Zip $zip -EntryPath 'assets/bin/Data/Managed/Metadata/global-metadata.dat' -TempRoot $tempRoot
            globalGameManagers = Get-ApkEntryArtifact -Zip $zip -EntryPath 'assets/bin/Data/globalgamemanagers' -TempRoot $tempRoot
        }
    } finally {
        $zip.Dispose()
    }
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$comparisons = @(
    (Compare-Artifact -Name 'libil2cpp' -Expected $expectedAbi.libil2cpp -Actual $actualAbi.libil2cpp),
    (Compare-Artifact -Name 'libunity' -Expected $expectedAbi.libunity -Actual $actualAbi.libunity),
    (Compare-Artifact -Name 'globalMetadata' -Expected $expectedShared.globalMetadata -Actual $actualShared.globalMetadata),
    (Compare-Artifact -Name 'globalGameManagers' -Expected $expectedShared.globalGameManagers -Actual $actualShared.globalGameManagers)
)

$apkSha256 = Get-FileSha256 -Path (Resolve-Path -LiteralPath $ApkPath).ProviderPath
$apkMatches = $true
if ($null -ne $manifest.apk -and -not [string]::IsNullOrWhiteSpace([string]$manifest.apk.sha256)) {
    $apkMatches = ([string]$manifest.apk.sha256 -eq $apkSha256)
}

$result = [ordered]@{
    ok = (($comparisons | Where-Object { -not $_.matches }).Count -eq 0 -and $apkMatches)
    abi = $Abi
    manifestPath = (Resolve-Path -LiteralPath $ManifestPath).ProviderPath
    apkPath = (Resolve-Path -LiteralPath $ApkPath).ProviderPath
    apkSha256 = $apkSha256
    expectedApkSha256 = if ($null -ne $manifest.apk) { $manifest.apk.sha256 } else { $null }
    apkMatches = $apkMatches
    comparisons = $comparisons
}

if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
    $directory = Split-Path -Parent $OutputPath
    if (-not [string]::IsNullOrWhiteSpace($directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($OutputPath, ($result | ConvertTo-Json -Depth 8), $utf8NoBom)
    Write-Host "[verify] wrote $OutputPath"
} else {
    $result | ConvertTo-Json -Depth 8
}

if (-not $result.ok) {
    throw "APK verification failed for $ApkPath"
}
