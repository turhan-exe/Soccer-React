param(
  [string]$RepoRoot = ".",
  [string]$UnityBuildRoot = "Unity/LinuxBuild",
  [string]$ManifestPath = "",
  [string]$RuntimeType = "IL2CPP",
  [string]$UnityProjectRoot = "C:\UnityProject\FHS",
  [string]$BuildId = ""
)

$ErrorActionPreference = "Stop"

function Get-FileSha256 {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "missing file: $Path"
  }

  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-GitSha {
  param([string]$Root)

  try {
    return (& git -C $Root rev-parse HEAD 2>$null).Trim()
  } catch {
    return ""
  }
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
  $json = $Value | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

$unityBuildDir = Join-Path $RepoRoot $UnityBuildRoot
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
  $ManifestPath = Join-Path $unityBuildDir "runtime-manifest.json"
}

$unityBinary = Join-Path $unityBuildDir "FHS.x86_64"
$unityGameAssembly = Join-Path $unityBuildDir "GameAssembly.so"
$unityPlayer = Join-Path $unityBuildDir "UnityPlayer.so"
$unityManagedAssembly = Join-Path $unityBuildDir "FHS_BackUpThisFolder_ButDontShipItWithYourGame\Managed\Assembly-CSharp.dll"

$buildTimestampUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$gitSha = Get-GitSha -Root $UnityProjectRoot
$shortGitSha = if ([string]::IsNullOrWhiteSpace($gitSha)) { "nogit" } else { $gitSha.Substring(0, [Math]::Min(7, $gitSha.Length)) }
if ([string]::IsNullOrWhiteSpace($BuildId)) {
  $BuildId = ("{0}-{1}-{2}" -f ((Get-Date).ToUniversalTime().ToString("yyyyMMddHHmmss")), $RuntimeType.ToLowerInvariant(), $shortGitSha)
}

$manifest = [ordered]@{
  buildId = $BuildId
  buildTimestampUtc = $buildTimestampUtc
  runtimeType = $RuntimeType
  unityBinaryName = "FHS.x86_64"
  assemblyHash = Get-FileSha256 -Path $unityManagedAssembly
  gameAssemblyHash = Get-FileSha256 -Path $unityGameAssembly
  unityBinaryHash = Get-FileSha256 -Path $unityBinary
  unityPlayerHash = Get-FileSha256 -Path $unityPlayer
  gitSha = $gitSha
}

Write-Utf8Json -Path $ManifestPath -Value $manifest
Write-Host "Wrote Linux runtime manifest: $ManifestPath"
Write-Host ("buildId={0}" -f $manifest.buildId)
