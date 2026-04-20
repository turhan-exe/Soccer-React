param(
  [string]$RepoRoot = ".",
  [string]$KeyPath = "",
  [string]$ControlHost = "root@89.167.24.132",
  [string]$UnityBuildRoot = "Unity/LinuxBuild",
  [switch]$SkipUnityBuildGuard,
  [switch]$SkipUnityRuntimeSync,
  [string[]]$LeagueHosts = @(
    "root@89.167.122.255",
    "root@89.167.117.176",
    "root@89.167.127.127",
    "root@89.167.124.123",
    "root@204.168.146.29"
  ),
  [switch]$ContinueOnNodeError,
  [switch]$SkipControl,
  [switch]$SkipNodes
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

function Test-BinaryContainsMarker {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$Marker
  )

  if (!(Test-Path $FilePath)) {
    return $false
  }

  $bytes = [System.IO.File]::ReadAllBytes($FilePath)
  $needleUtf8 = [System.Text.Encoding]::UTF8.GetBytes($Marker)
  $needleUtf16 = [System.Text.Encoding]::Unicode.GetBytes($Marker)

  function Test-Needle([byte[]]$Haystack, [byte[]]$Needle) {
    if ($Needle.Length -eq 0 -or $Haystack.Length -lt $Needle.Length) {
      return $false
    }

    for ($i = 0; $i -le $Haystack.Length - $Needle.Length; $i++) {
      $matched = $true
      for ($j = 0; $j -lt $Needle.Length; $j++) {
        if ($Haystack[$i + $j] -ne $Needle[$j]) {
          $matched = $false
          break
        }
      }
      if ($matched) {
        return $true
      }
    }

    return $false
  }

  return (Test-Needle $bytes $needleUtf8) -or (Test-Needle $bytes $needleUtf16)
}

function Test-TextContainsMarker {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$Marker
  )

  & rg -q --fixed-strings -- $Marker $FilePath 2>$null
  return ($LASTEXITCODE -eq 0)
}

$sshArgs = @()
$scpArgs = @()
$transportOpts = @(
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=accept-new",
  "-o", "ConnectTimeout=15",
  "-o", "ServerAliveInterval=15",
  "-o", "ServerAliveCountMax=3"
)
$sshArgs += $transportOpts
$scpArgs += $transportOpts
if ($KeyPath -ne "") {
  $sshArgs += @("-i", $KeyPath)
  $scpArgs += @("-i", $KeyPath)
}

function Invoke-SafeScp {
  param(
    [string]$SourcePath,
    [string]$TargetPath
  )
  & scp @scpArgs $SourcePath $TargetPath
  if ($LASTEXITCODE -ne 0) {
    throw "scp failed: $SourcePath -> $TargetPath (exit=$LASTEXITCODE)"
  }
}

function Invoke-SafeSsh {
  param(
    [string]$TargetHost,
    [string]$RemoteScript
  )
  $normalizedRemoteScript = $RemoteScript -replace "`r`n", "`n" -replace "`r", "`n"
  $remoteBytes = [System.Text.Encoding]::UTF8.GetBytes($normalizedRemoteScript)
  $remoteB64 = [Convert]::ToBase64String($remoteBytes)
  $remoteCmd = "printf '%s' '$remoteB64' | base64 -d | bash -se"

  $output = & ssh @sshArgs $TargetHost $remoteCmd 2>&1
  $code = $LASTEXITCODE
  if ($output) {
    $output | ForEach-Object { Write-Host $_.ToString() }
  }
  if ($code -ne 0) {
    throw "ssh failed: $TargetHost (exit=$code)"
  }
}

$mcIndex = Join-Path $RepoRoot "services/match-control-api/src/index.js"
$mcService = Join-Path $RepoRoot "services/systemd/match-control-api.service"
$naIndex = Join-Path $RepoRoot "services/node-agent/src/index.js"
$naService = Join-Path $RepoRoot "services/systemd/node-agent.service"
$unityBuildDir = Join-Path $RepoRoot $UnityBuildRoot
$unityRuntimeStagingDir = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot ".tmp/unity-linux-runtime"))
$unityRuntimeArchive = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot ".tmp/unity-linux-runtime.tar"))
$unityBinary = Join-Path $RepoRoot "$UnityBuildRoot/FHS.x86_64"
$unityGameAssembly = Join-Path $RepoRoot "$UnityBuildRoot/GameAssembly.so"
$unityPlayer = Join-Path $RepoRoot "$UnityBuildRoot/UnityPlayer.so"
$unityRuntimeInit = Join-Path $RepoRoot "$UnityBuildRoot/FHS_Data/RuntimeInitializeOnLoads.json"
$unityMetadata = Join-Path $RepoRoot "$UnityBuildRoot/FHS_Data/il2cpp_data/Metadata/global-metadata.dat"
$unityManagedAssembly = Join-Path $RepoRoot "$UnityBuildRoot/FHS_BackUpThisFolder_ButDontShipItWithYourGame/Managed/Assembly-CSharp.dll"

if (-not $SkipUnityBuildGuard) {
  $assemblyPath = $unityManagedAssembly
  $runtimeInitPath = $unityRuntimeInit

  if (!(Test-Path $assemblyPath)) {
    throw "unity build guard failed: missing Assembly-CSharp.dll at $assemblyPath"
  }
  if (!(Test-Path $runtimeInitPath)) {
    throw "unity build guard failed: missing RuntimeInitializeOnLoads.json at $runtimeInitPath"
  }

  $missingMarkers = @()
  if (-not (Test-BinaryContainsMarker -FilePath $assemblyPath -Marker "OnlineMatchStartGate")) {
    $missingMarkers += "OnlineMatchStartGate (class missing in Assembly-CSharp.dll)"
  }
  if (-not (Test-BinaryContainsMarker -FilePath $assemblyPath -Marker "NodeAgentLifecycleBridge")) {
    $missingMarkers += "NodeAgentLifecycleBridge (class missing in Assembly-CSharp.dll)"
  }
  if (-not (Test-BinaryContainsMarker -FilePath $assemblyPath -Marker "forced dedicated BeginNetworkMatch invocation succeeded")) {
    $missingMarkers += "forced dedicated BeginNetworkMatch invocation succeeded (OnlineMatchStartGate begin-network fallback marker missing in Assembly-CSharp.dll)"
  }
  if (-not (Test-BinaryContainsMarker -FilePath $assemblyPath -Marker "ShouldBypassRemoteStartGateForDedicatedServer")) {
    $missingMarkers += "ShouldBypassRemoteStartGateForDedicatedServer (MatchNetworkManager dedicated remote-gate bypass marker missing in Assembly-CSharp.dll)"
  }
  if (-not (Test-BinaryContainsMarker -FilePath $assemblyPath -Marker "Preferred reliable transport selected")) {
    $missingMarkers += "Preferred reliable transport selected (MatchNetworkManager reliable watch transport marker missing in Assembly-CSharp.dll)"
  }

  if (-not (Test-TextContainsMarker -FilePath $runtimeInitPath -Marker 'OnlineMatchStartGate')) {
    $missingMarkers += "RuntimeInitializeOnLoads: OnlineMatchStartGate not registered"
  }
  if (-not (Test-TextContainsMarker -FilePath $runtimeInitPath -Marker 'NodeAgentLifecycleBridge')) {
    $missingMarkers += "RuntimeInitializeOnLoads: NodeAgentLifecycleBridge not registered"
  }

  if ($missingMarkers.Count -gt 0) {
    $details = ($missingMarkers -join "; ")
    throw "unity build guard failed: required dedicated lifecycle hooks are missing. $details"
  }

  Write-Host "Unity build guard passed: lifecycle hooks detected in $UnityBuildRoot"
}

if (!(Test-Path $mcIndex)) {
  throw "missing file: $mcIndex"
}
if (!(Test-Path $mcService)) {
  throw "missing file: $mcService"
}
if (!(Test-Path $naIndex)) {
  throw "missing file: $naIndex"
}
if (!(Test-Path $naService)) {
  throw "missing file: $naService"
}
if (-not $SkipUnityRuntimeSync) {
  $unityRequired = @(
    $unityBuildDir,
    $unityBinary,
    $unityGameAssembly,
    $unityPlayer,
    $unityRuntimeInit,
    $unityMetadata,
    $unityManagedAssembly,
    (Join-Path $RepoRoot "$UnityBuildRoot/FHS_Data/globalgamemanagers"),
    (Join-Path $RepoRoot "$UnityBuildRoot/FHS_Data/level0"),
    (Join-Path $RepoRoot "$UnityBuildRoot/FHS_Data/level1"),
    (Join-Path $RepoRoot "$UnityBuildRoot/FHS_Data/level2")
  )
  foreach ($p in $unityRequired) {
    if (!(Test-Path $p)) {
      throw "missing unity runtime artifact: $p"
    }
  }

  $unityRuntimeArchiveDir = Split-Path -Parent $unityRuntimeArchive
  if (!(Test-Path $unityRuntimeArchiveDir)) {
    New-Item -ItemType Directory -Force -Path $unityRuntimeArchiveDir | Out-Null
  }
  if (Test-Path $unityRuntimeStagingDir) {
    Remove-Item -Recurse -Force $unityRuntimeStagingDir
  }
  New-Item -ItemType Directory -Force -Path $unityRuntimeStagingDir | Out-Null
  if (Test-Path $unityRuntimeArchive) {
    Remove-Item -Force $unityRuntimeArchive
  }

  Copy-Item -Force $unityBinary (Join-Path $unityRuntimeStagingDir "FHS.x86_64")
  Copy-Item -Force $unityGameAssembly (Join-Path $unityRuntimeStagingDir "GameAssembly.so")
  Copy-Item -Force $unityPlayer (Join-Path $unityRuntimeStagingDir "UnityPlayer.so")
  Copy-Item -Recurse -Force (Join-Path $unityBuildDir "FHS_Data") (Join-Path $unityRuntimeStagingDir "FHS_Data")
  $stagedManagedDir = Join-Path $unityRuntimeStagingDir "FHS_BackUpThisFolder_ButDontShipItWithYourGame/Managed"
  New-Item -ItemType Directory -Force -Path $stagedManagedDir | Out-Null
  Copy-Item -Force $unityManagedAssembly (Join-Path $stagedManagedDir "Assembly-CSharp.dll")

  Push-Location $unityRuntimeStagingDir
  try {
    & tar -cf $unityRuntimeArchive .
    if ($LASTEXITCODE -ne 0 -or !(Test-Path $unityRuntimeArchive)) {
      throw "failed to create unity runtime archive: $unityRuntimeArchive"
    }
  } finally {
    Pop-Location
  }
}

if (-not $SkipControl) {
  Write-Host "== Deploy match-control-api to $ControlHost =="
  Invoke-SafeScp $mcIndex "$ControlHost`:/opt/football-manager-ui/services/match-control-api/src/index.js"
  Invoke-SafeScp $mcService "$ControlHost`:/tmp/match-control-api.service"

  $controlRemote = @'
set -euo pipefail
APP=/opt/football-manager-ui/services/match-control-api
LOG=/var/log/match-control-api.log
UNIT=/etc/systemd/system/match-control-api.service

test -f "$APP/src/index.js"
test -f /tmp/match-control-api.service

install -m 644 /tmp/match-control-api.service "$UNIT"
systemctl daemon-reload
systemctl enable match-control-api.service >/dev/null 2>&1 || true
systemctl restart match-control-api.service
sleep 3

systemctl is-active --quiet match-control-api.service || { systemctl status match-control-api.service --no-pager; tail -n 80 "$LOG"; exit 1; }
APP_PORT="$(awk -F= '/^PORT=/{print $2; exit}' "$APP/.env")"
[ -n "$APP_PORT" ] || APP_PORT=8080
ss -ltnp | grep ":$APP_PORT" || { systemctl status match-control-api.service --no-pager; tail -n 80 "$LOG"; exit 1; }
curl -fsS "http://127.0.0.1:$APP_PORT/health"
'@

  Invoke-SafeSsh -TargetHost $ControlHost -RemoteScript $controlRemote
}

if (-not $SkipNodes) {
  $nodeFailures = @()
  foreach ($nodeHost in $LeagueHosts) {
    try {
      Write-Host "== Deploy node-agent to $nodeHost =="
      if (-not $SkipUnityRuntimeSync) {
        Invoke-SafeSsh -TargetHost $nodeHost -RemoteScript @'
set -euo pipefail
rm -rf /tmp/fhs-runtime-sync
mkdir -p /tmp/fhs-runtime-sync
'@
        Invoke-SafeScp $unityRuntimeArchive "$($nodeHost):/tmp/unity-linux-runtime.tar"
      }
      Invoke-SafeScp $naIndex "$($nodeHost):/opt/football-manager-ui/services/node-agent/src/index.js"
      Invoke-SafeScp $naService "$($nodeHost):/tmp/node-agent.service"

      $nodeRemote = @'
set -euo pipefail
APP=/opt/football-manager-ui/services/node-agent
LOG=/var/log/node-agent.log
UNIT=/etc/systemd/system/node-agent.service

test -f "$APP/src/index.js"
test -f "$APP/.env"
test -f /tmp/node-agent.service
if [ -f /tmp/unity-linux-runtime.tar ]; then
  rm -rf /tmp/fhs-runtime-sync
  mkdir -p /tmp/fhs-runtime-sync
  tar -xf /tmp/unity-linux-runtime.tar -C /tmp/fhs-runtime-sync
  test -f /tmp/fhs-runtime-sync/FHS.x86_64
  test -f /tmp/fhs-runtime-sync/FHS_Data/level0
  test -f /tmp/fhs-runtime-sync/FHS_Data/globalgamemanagers
  test -f /tmp/fhs-runtime-sync/FHS_BackUpThisFolder_ButDontShipItWithYourGame/Managed/Assembly-CSharp.dll

  rm -rf /opt/fhs-server
  mkdir -p /opt/fhs-server
  cp -a /tmp/fhs-runtime-sync/. /opt/fhs-server/
  chmod +x /opt/fhs-server/FHS.x86_64
  rm -rf /tmp/fhs-runtime-sync /tmp/unity-linux-runtime.tar
fi
test -f /opt/fhs-server/FHS.x86_64
test -f /opt/fhs-server/FHS_Data/level0
test -f /opt/fhs-server/FHS_Data/globalgamemanagers

fuser -k 9090/tcp >/dev/null 2>&1 || true
pkill -f "/opt/fhs-server" || true
pkill -f "Unity" || true

install -m 644 /tmp/node-agent.service "$UNIT"
systemctl daemon-reload
systemctl enable node-agent.service >/dev/null 2>&1 || true
systemctl restart node-agent.service
sleep 3

systemctl is-active --quiet node-agent.service || { systemctl status node-agent.service --no-pager; tail -n 80 "$LOG"; exit 1; }
ss -ltnp | grep ':9090' || { systemctl status node-agent.service --no-pager; tail -n 80 "$LOG"; exit 1; }
'@
      Invoke-SafeSsh -TargetHost $nodeHost -RemoteScript $nodeRemote

      $probeRemote = @'
set -euo pipefail
APP=/opt/football-manager-ui/services/node-agent
ENV_FILE="$APP/.env"
test -f "$ENV_FILE"
AGENT_SECRET="$(sed -n 's/^NODE_AGENT_SECRET=//p' "$ENV_FILE" | head -n1 | tr -d '\r')"
[ -n "$AGENT_SECRET" ] || { echo "NODE_AGENT_SECRET missing"; exit 1; }
curl -fsS -H "Authorization: Bearer ${AGENT_SECRET}" http://127.0.0.1:9090/agent/v1/capacity
'@
      Invoke-SafeSsh -TargetHost $nodeHost -RemoteScript $probeRemote
    } catch {
      $msg = "node deploy failed: $nodeHost :: $($_.Exception.Message)"
      if ($ContinueOnNodeError) {
        Write-Warning $msg
        $nodeFailures += $msg
        continue
      }
      throw
    }
  }

  if ($nodeFailures.Count -gt 0 -and -not $ContinueOnNodeError) {
    throw ("one_or_more_node_deploys_failed`n" + ($nodeFailures -join "`n"))
  } elseif ($nodeFailures.Count -gt 0) {
    Write-Warning ("node_deploy_completed_with_failures`n" + ($nodeFailures -join "`n"))
  }
}

Write-Host "Deployment flow completed."
