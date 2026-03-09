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

  & rg -a -q --fixed-strings -- $Marker $FilePath 2>$null
  return ($LASTEXITCODE -eq 0)
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
  $remoteBytes = [System.Text.Encoding]::UTF8.GetBytes($RemoteScript)
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
$naIndex = Join-Path $RepoRoot "services/node-agent/src/index.js"
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
if (!(Test-Path $naIndex)) {
  throw "missing file: $naIndex"
}
if (-not $SkipUnityRuntimeSync) {
  $unityRequired = @(
    $unityBinary,
    $unityGameAssembly,
    $unityPlayer,
    $unityRuntimeInit,
    $unityMetadata,
    $unityManagedAssembly
  )
  foreach ($p in $unityRequired) {
    if (!(Test-Path $p)) {
      throw "missing unity runtime artifact: $p"
    }
  }
}

if (-not $SkipControl) {
  Write-Host "== Deploy match-control-api to $ControlHost =="
  Invoke-SafeScp $mcIndex "$ControlHost`:/opt/football-manager-ui/services/match-control-api/src/index.js"

  $controlRemote = @'
set -euo pipefail
APP=/opt/football-manager-ui/services/match-control-api
LOG=/var/log/match-control-api.log

test -f "$APP/src/index.js"

fuser -k 8080/tcp >/dev/null 2>&1 || true
cd "$APP"
nohup node src/index.js >"$LOG" 2>&1 &
sleep 2

ss -ltnp | grep ':8080' || { tail -n 80 "$LOG"; exit 1; }
curl -fsS http://127.0.0.1:8080/health
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
mkdir -p /opt/fhs-server/FHS_BackUpThisFolder_ButDontShipItWithYourGame/Managed
mkdir -p /opt/fhs-server/FHS_Data/il2cpp_data/Metadata
'@
        Invoke-SafeScp $unityBinary "$($nodeHost):/opt/fhs-server/FHS.x86_64"
        Invoke-SafeScp $unityGameAssembly "$($nodeHost):/opt/fhs-server/GameAssembly.so"
        Invoke-SafeScp $unityPlayer "$($nodeHost):/opt/fhs-server/UnityPlayer.so"
        Invoke-SafeScp $unityRuntimeInit "$($nodeHost):/opt/fhs-server/FHS_Data/RuntimeInitializeOnLoads.json"
        Invoke-SafeScp $unityMetadata "$($nodeHost):/opt/fhs-server/FHS_Data/il2cpp_data/Metadata/global-metadata.dat"
        Invoke-SafeScp $unityManagedAssembly "$($nodeHost):/opt/fhs-server/FHS_BackUpThisFolder_ButDontShipItWithYourGame/Managed/Assembly-CSharp.dll"
      }
      Invoke-SafeScp $naIndex "$($nodeHost):/opt/football-manager-ui/services/node-agent/src/index.js"

      $nodeRemote = @'
set -euo pipefail
APP=/opt/football-manager-ui/services/node-agent
LOG=/var/log/node-agent.log

test -f "$APP/src/index.js"
test -f "$APP/.env"
test -f /opt/fhs-server/FHS.x86_64
chmod +x /opt/fhs-server/FHS.x86_64

fuser -k 9090/tcp >/dev/null 2>&1 || true
pkill -f "/opt/fhs-server" || true
pkill -f "Unity" || true

cd "$APP"
nohup node src/index.js >"$LOG" 2>&1 &
sleep 2

ss -ltnp | grep ':9090' || { tail -n 80 "$LOG"; exit 1; }
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
