param(
  [Parameter(Mandatory = $true)]
  [string]$NodeSecret,
  [string]$RemoteHost = "root@89.167.24.132",
  [string]$LeagueNodeIps = "10.0.0.4,10.0.0.5,10.0.0.6,10.0.0.7,10.0.0.8",
  [string]$KeyPath = "",
  [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"

$apiSrcDir = Join-Path $RepoRoot "services/match-control-api/src"
$apiSrc = Join-Path $apiSrcDir "index.js"
$apiPkg = Join-Path $RepoRoot "services/match-control-api/package.json"
$apiLock = Join-Path $RepoRoot "services/match-control-api/package-lock.json"
$apiService = Join-Path $RepoRoot "services/systemd/match-control-api.service"
$recoverSh = Join-Path $RepoRoot "scripts/live-league-control-recover.sh"

if (!(Test-Path $apiSrcDir)) {
  throw "missing directory: $apiSrcDir"
}
if (!(Test-Path $apiSrc)) {
  throw "missing file: $apiSrc"
}
if (!(Test-Path $apiPkg)) {
  throw "missing file: $apiPkg"
}
if (!(Test-Path $apiLock)) {
  throw "missing file: $apiLock"
}
if (!(Test-Path $apiService)) {
  throw "missing file: $apiService"
}
if (!(Test-Path $recoverSh)) {
  throw "missing file: $recoverSh"
}

$sshArgs = @()
$scpArgs = @()
if ($KeyPath -ne "") {
  $sshArgs += @("-i", $KeyPath)
  $scpArgs += @("-i", $KeyPath)
}

Write-Host "Copying files to $RemoteHost ..."
& ssh @sshArgs $RemoteHost "mkdir -p /opt/football-manager-ui/services/match-control-api/src"
if ($LASTEXITCODE -ne 0) { throw "remote mkdir failed with exit code $LASTEXITCODE" }

$apiSrcFiles = Get-ChildItem -Path $apiSrcDir -Filter "*.js" |
  Where-Object { $_.Name -notlike "*.test.js" }
foreach ($srcFile in $apiSrcFiles) {
  & scp @scpArgs $srcFile.FullName "$RemoteHost`:/opt/football-manager-ui/services/match-control-api/src/$($srcFile.Name)"
  if ($LASTEXITCODE -ne 0) { throw "scp $($srcFile.Name) failed with exit code $LASTEXITCODE" }
}
& scp @scpArgs $apiPkg "$RemoteHost`:/opt/football-manager-ui/services/match-control-api/package.json"
if ($LASTEXITCODE -ne 0) { throw "scp package.json failed with exit code $LASTEXITCODE" }
& scp @scpArgs $apiLock "$RemoteHost`:/opt/football-manager-ui/services/match-control-api/package-lock.json"
if ($LASTEXITCODE -ne 0) { throw "scp package-lock.json failed with exit code $LASTEXITCODE" }
& scp @scpArgs $apiService "$RemoteHost`:/tmp/match-control-api.service"
if ($LASTEXITCODE -ne 0) { throw "scp match-control-api.service failed with exit code $LASTEXITCODE" }
& scp @scpArgs $recoverSh "$RemoteHost`:/tmp/live-league-control-recover.sh"
if ($LASTEXITCODE -ne 0) { throw "scp recover.sh failed with exit code $LASTEXITCODE" }

$remote = "set -euo pipefail; mkdir -p /opt/football-manager-ui/scripts; tr -d '\r' < /tmp/live-league-control-recover.sh > /opt/football-manager-ui/scripts/live-league-control-recover.sh; chmod 755 /opt/football-manager-ui/scripts/live-league-control-recover.sh; LEAGUE_NODE_IPS='$LeagueNodeIps' bash /opt/football-manager-ui/scripts/live-league-control-recover.sh '$NodeSecret'"

Write-Host "Running remote recovery ..."
& ssh @sshArgs $RemoteHost $remote
if ($LASTEXITCODE -ne 0) { throw "remote recovery failed with exit code $LASTEXITCODE" }

Write-Host "Done."
