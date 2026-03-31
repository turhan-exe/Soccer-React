param(
  [string]$ServiceAccount = "",
  [int]$DelayHours = 2,
  [string]$TaskName = "",
  [int]$LatestVersionCode = 0,
  [string]$LatestVersionName = "",
  [int]$MinSupportedVersionCode = 0,
  [ValidateSet("observe", "enforce")]
  [string]$GateMode = "enforce",
  [bool]$RunAsSystem = $true
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$appVersionPath = Join-Path $repoRoot "app.version.json"
$applyScriptPath = Join-Path $repoRoot "scripts\\apply-mobile-update-policy.mjs"
$tmpDir = Join-Path $repoRoot "tmp"

if (-not (Test-Path -LiteralPath $appVersionPath)) {
  throw "app.version.json bulunamadi: $appVersionPath"
}

if (-not (Test-Path -LiteralPath $applyScriptPath)) {
  throw "apply-mobile-update-policy.mjs bulunamadi: $applyScriptPath"
}

if ([string]::IsNullOrWhiteSpace($ServiceAccount)) {
  $ServiceAccount = $env:GOOGLE_APPLICATION_CREDENTIALS
}

if ([string]::IsNullOrWhiteSpace($ServiceAccount)) {
  throw "Service account gerekli. -ServiceAccount ver veya GOOGLE_APPLICATION_CREDENTIALS ayarla."
}

$resolvedServiceAccount = (Resolve-Path $ServiceAccount).Path
$appVersion = Get-Content -LiteralPath $appVersionPath -Raw | ConvertFrom-Json

if ($LatestVersionCode -le 0) {
  $LatestVersionCode = [int]$appVersion.versionCode
}
if ([string]::IsNullOrWhiteSpace($LatestVersionName)) {
  $LatestVersionName = [string]$appVersion.versionName
}
if ($MinSupportedVersionCode -le 0) {
  $MinSupportedVersionCode = $LatestVersionCode
}

$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$startAt = (Get-Date).AddHours($DelayHours)
$startTime = $startAt.ToString("HH:mm")

if ([string]::IsNullOrWhiteSpace($TaskName)) {
  $safeVersionName = $LatestVersionName.Replace(".", "_")
  $TaskName = "FHS-MobileUpdate-$safeVersionName-$($startAt.ToString('yyyyMMddHHmm'))"
}

New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$wrapperPath = Join-Path $tmpDir "$TaskName.cmd"
$wrapperLines = @(
  '@echo off',
  "cd /d `"$repoRoot`"",
  "`"$nodeCommand`" `"$applyScriptPath`" --service-account `"$resolvedServiceAccount`" --apply --latest-version-code $LatestVersionCode --latest-version-name $LatestVersionName --min-supported-version-code $MinSupportedVersionCode --gate-mode $GateMode"
)
Set-Content -LiteralPath $wrapperPath -Value $wrapperLines -Encoding ASCII
$taskCommand = "`"$wrapperPath`""

Write-Host "Zamanlanan policy gorevi olusturuluyor..."
Write-Host "TaskName: $TaskName"
Write-Host "RunAt   : $startAt"
Write-Host "Command : $taskCommand"
Write-Host "Wrapper : $wrapperPath"

if ($RunAsSystem) {
  schtasks.exe /Create /SC ONCE /TN $TaskName /TR $taskCommand /ST $startTime /RU SYSTEM /F | Out-Host
} else {
  schtasks.exe /Create /SC ONCE /TN $TaskName /TR $taskCommand /ST $startTime /F | Out-Host
}
schtasks.exe /Query /TN $TaskName /V /FO LIST | Out-Host
