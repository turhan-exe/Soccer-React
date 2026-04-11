param(
  [string]$RepoRoot = ".",
  [string]$KeyPath = "",
  [string]$ControlHost = "root@89.167.24.132",
  [string]$UnityBuildRoot = "Unity/LinuxBuild",
  [int]$FriendlyNodeLimit = 1
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

function Invoke-SafeScp {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$TargetPath
  )

  $targetHost = Get-HostFromScpTarget -Value $TargetPath
  $transportArgs = Get-TransportArgs -TargetHost $targetHost
  & scp @transportArgs $SourcePath $TargetPath
  if ($LASTEXITCODE -ne 0) {
    throw "scp failed: $SourcePath -> $TargetPath (exit=$LASTEXITCODE)"
  }
}

function Invoke-SafeSshCapture {
  param(
    [Parameter(Mandatory = $true)][string]$TargetHost,
    [Parameter(Mandatory = $true)][string]$RemoteScript
  )

  # Normalize PowerShell CRLF here-strings so remote bash sees clean LF line endings.
  $normalizedRemoteScript = $RemoteScript -replace "`r`n", "`n" -replace "`r", "`n"
  $remoteBytes = [System.Text.Encoding]::UTF8.GetBytes($normalizedRemoteScript)
  $remoteB64 = [Convert]::ToBase64String($remoteBytes)
  $remoteCmd = "printf '%s' '$remoteB64' | base64 -d | bash -se"

  $transportArgs = Get-TransportArgs -TargetHost $TargetHost
  $output = & ssh @transportArgs $TargetHost $remoteCmd 2>&1
  $code = $LASTEXITCODE
  $text = if ($output) { ($output | ForEach-Object { $_.ToString() }) -join "`n" } else { "" }
  if ($code -ne 0) {
    if ($text) {
      $text | Write-Host
    }
    throw "ssh failed: $TargetHost (exit=$code)"
  }

  return $text.Trim()
}

function Compare-RuntimeManifest {
  param(
    [Parameter(Mandatory = $true)]$LocalManifest,
    [Parameter(Mandatory = $false)]$RemoteManifest
  )

  if ($null -eq $RemoteManifest) {
    return $false
  }

  return
    [string]$LocalManifest.buildId -eq [string]$RemoteManifest.buildId -and
    [string]$LocalManifest.assemblyHash -eq [string]$RemoteManifest.assemblyHash -and
    [string]$LocalManifest.gameAssemblyHash -eq [string]$RemoteManifest.gameAssemblyHash
}

function Read-JsonFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    throw "missing file: $Path"
  }

  return Get-Content $Path -Raw | ConvertFrom-Json
}

function Get-HostFromSshTarget {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }

  if ($Value -match '^[^@]+@(.+)$') {
    return $Matches[1]
  }

  return $Value
}

function Get-HostFromScpTarget {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }

  if ($Value -match '^(?:[^@]+@)?([^:]+):') {
    return $Matches[1]
  }

  return Get-HostFromSshTarget -Value $Value
}

function Test-IsPrivateIpv4Host {
  param([string]$HostName)

  $normalizedHost = Get-HostFromSshTarget -Value $HostName
  $ipAddress = $null
  if (-not [System.Net.IPAddress]::TryParse($normalizedHost, [ref]$ipAddress)) {
    return $false
  }

  $bytes = $ipAddress.GetAddressBytes()
  if ($bytes.Length -ne 4) {
    return $false
  }

  if ($bytes[0] -eq 10) {
    return $true
  }

  if ($bytes[0] -eq 192 -and $bytes[1] -eq 168) {
    return $true
  }

  if ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) {
    return $true
  }

  return $false
}

function Quote-ProxySegment {
  param([string]$Value)

  if ($null -eq $Value) {
    return '""'
  }

  if ($Value -match '[\s"]') {
    return '"' + ($Value -replace '"', '\"') + '"'
  }

  return $Value
}

function Get-ProxyCommand {
  param([string]$TargetHost)

  if (-not (Test-IsPrivateIpv4Host -Host $TargetHost)) {
    return $null
  }

  $segments = @("ssh")
  if (-not [string]::IsNullOrWhiteSpace($script:keyPathForProxy)) {
    $segments += @("-i", $script:keyPathForProxy)
  }

  $segments += @(
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=15",
    $ControlHost,
    "-W", "%h:%p"
  )

  return ($segments | ForEach-Object { Quote-ProxySegment -Value $_ }) -join " "
}

function Get-TransportArgs {
  param([string]$TargetHost)

  $args = @($script:baseTransportArgs)
  $proxyCommand = Get-ProxyCommand -TargetHost $TargetHost
  if (-not [string]::IsNullOrWhiteSpace($proxyCommand)) {
    $args += @("-o", "ProxyCommand=$proxyCommand")
  }

  return $args
}

$transportOpts = @(
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=accept-new",
  "-o", "ConnectTimeout=15",
  "-o", "ServerAliveInterval=15",
  "-o", "ServerAliveCountMax=3"
)

$script:baseTransportArgs = @($transportOpts)
$script:keyPathForProxy = ""
if ($KeyPath -ne "") {
  $script:baseTransportArgs += @("-i", $KeyPath)
  $script:keyPathForProxy = ($KeyPath -replace '\\', '/')
}

$unityBuildDir = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $UnityBuildRoot))
$runtimeManifestPath = Join-Path $unityBuildDir "runtime-manifest.json"
$unityBinary = Join-Path $unityBuildDir "FHS.x86_64"
$unityGameAssembly = Join-Path $unityBuildDir "GameAssembly.so"
$unityPlayer = Join-Path $unityBuildDir "UnityPlayer.so"
$unityDataDir = Join-Path $unityBuildDir "FHS_Data"
$unityManagedAssembly = Join-Path $unityBuildDir "FHS_BackUpThisFolder_ButDontShipItWithYourGame/Managed/Assembly-CSharp.dll"
$unityRuntimeStagingDir = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot ".tmp/unity-linux-runtime-friendly"))
$unityRuntimeArchive = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot ".tmp/unity-linux-runtime-friendly.tar"))

if ([string]::Equals($unityBuildDir, $unityRuntimeStagingDir, [System.StringComparison]::OrdinalIgnoreCase)) {
  $unityRuntimeStagingDir = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot ".tmp/unity-linux-runtime-friendly-staging"))
}

$requiredPaths = @(
  $unityBinary,
  $unityGameAssembly,
  $unityPlayer,
  $unityDataDir,
  $unityManagedAssembly,
  $runtimeManifestPath
)
foreach ($path in $requiredPaths) {
  if (-not (Test-Path $path)) {
    throw "missing unity runtime artifact: $path"
  }
}

$localManifest = Read-JsonFile -Path $runtimeManifestPath

$resolveFriendlyHostsRemote = @'
set -euo pipefail
ENV_FILE=/opt/football-manager-ui/services/match-control-api/.env
python3 - "$ENV_FILE" <<'PY'
import json
import re
import sys
from urllib.parse import urlparse

env_path = sys.argv[1]
env = {}
with open(env_path, "r", encoding="utf-8") as handle:
    for raw_line in handle:
        line = raw_line.strip()
        match = re.match(r"^([A-Z0-9_]+)=(.*)$", line)
        if not match:
            continue
        key, value = match.group(1), match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        env[key] = value

def parse_pool(name):
    raw = env.get(name, "[]")
    try:
        return json.loads(raw)
    except Exception:
        return []

pool = parse_pool("NODE_AGENTS_FRIENDLY")
if not pool:
    pool = parse_pool("NODE_AGENTS")

seen = set()
for item in pool:
    if not isinstance(item, dict):
        continue
    url = str(item.get("url", "")).strip()
    host = urlparse(url).hostname or ""
    if not host or host in seen:
        continue
    seen.add(host)
    print(f"root@{host}")
PY
'@

$friendlyHostsRaw = Invoke-SafeSshCapture -TargetHost $ControlHost -RemoteScript $resolveFriendlyHostsRemote
$friendlyHosts = @(
  $friendlyHostsRaw -split "`r?`n" |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -ne "" }
)

if ($friendlyHosts.Count -eq 0) {
  throw "no friendly node hosts resolved from $ControlHost"
}

if ($FriendlyNodeLimit -gt 0 -and $friendlyHosts.Count -gt $FriendlyNodeLimit) {
  $friendlyHosts = $friendlyHosts | Select-Object -First $FriendlyNodeLimit
}

$targetsNeedingUpdate = @()
foreach ($targetHost in $friendlyHosts) {
  $remoteManifestRaw = Invoke-SafeSshCapture -TargetHost $targetHost -RemoteScript @'
set -euo pipefail
MANIFEST=/opt/fhs-server/runtime-manifest.json
if [ -f "$MANIFEST" ]; then
  cat "$MANIFEST"
fi
'@

  $remoteManifest = $null
  if ($remoteManifestRaw) {
    try {
      $remoteManifest = $remoteManifestRaw | ConvertFrom-Json
    } catch {
      $remoteManifest = $null
    }
  }

  if (Compare-RuntimeManifest -LocalManifest $localManifest -RemoteManifest $remoteManifest) {
    Write-Host "[$targetHost] runtime manifest already current; skipping upload."
    continue
  }

  $targetsNeedingUpdate += $targetHost
}

if ($targetsNeedingUpdate.Count -eq 0) {
  Write-Host "Friendly runtime deploy noop: selected nodes already match buildId=$($localManifest.buildId)"
  exit 0
}

if (Test-Path $unityRuntimeStagingDir) {
  Remove-Item -LiteralPath $unityRuntimeStagingDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $unityRuntimeStagingDir | Out-Null
if (Test-Path $unityRuntimeArchive) {
  Remove-Item -LiteralPath $unityRuntimeArchive -Force
}

Copy-Item -Force $unityBinary (Join-Path $unityRuntimeStagingDir "FHS.x86_64")
Copy-Item -Force $unityGameAssembly (Join-Path $unityRuntimeStagingDir "GameAssembly.so")
Copy-Item -Force $unityPlayer (Join-Path $unityRuntimeStagingDir "UnityPlayer.so")
Copy-Item -Force $runtimeManifestPath (Join-Path $unityRuntimeStagingDir "runtime-manifest.json")
Copy-Item -Recurse -Force $unityDataDir (Join-Path $unityRuntimeStagingDir "FHS_Data")
$stagedManagedDir = Join-Path $unityRuntimeStagingDir "FHS_BackUpThisFolder_ButDontShipItWithYourGame/Managed"
New-Item -ItemType Directory -Force -Path $stagedManagedDir | Out-Null
Copy-Item -Force $unityManagedAssembly (Join-Path $stagedManagedDir "Assembly-CSharp.dll")

Push-Location $unityRuntimeStagingDir
try {
  & tar -cf $unityRuntimeArchive .
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $unityRuntimeArchive)) {
    throw "failed to create friendly runtime archive: $unityRuntimeArchive"
  }
} finally {
  Pop-Location
}

foreach ($targetHost in $targetsNeedingUpdate) {
  Write-Host "== Friendly runtime deploy to $targetHost =="
  Invoke-SafeScp -SourcePath $unityRuntimeArchive -TargetPath "$($targetHost):/tmp/unity-linux-runtime-friendly.tar"

  $remoteDeploy = @'
set -euo pipefail
APP=/opt/football-manager-ui/services/node-agent
ENV_FILE="$APP/.env"
LOG=/var/log/node-agent.log
MANIFEST=/opt/fhs-server/runtime-manifest.json

rm -rf /tmp/fhs-runtime-sync
mkdir -p /tmp/fhs-runtime-sync
tar -xf /tmp/unity-linux-runtime-friendly.tar -C /tmp/fhs-runtime-sync
test -f /tmp/fhs-runtime-sync/FHS.x86_64
test -f /tmp/fhs-runtime-sync/runtime-manifest.json

if [ -f "$MANIFEST" ] && cmp -s /tmp/fhs-runtime-sync/runtime-manifest.json "$MANIFEST"; then
  rm -rf /tmp/fhs-runtime-sync /tmp/unity-linux-runtime-friendly.tar
  echo "runtime_unchanged"
  exit 0
fi

pkill -f "/opt/fhs-server" >/dev/null 2>&1 || true
pkill -f "FHS.x86_64" >/dev/null 2>&1 || true
rm -rf /opt/fhs-server
mkdir -p /opt/fhs-server
cp -a /tmp/fhs-runtime-sync/. /opt/fhs-server/
chmod +x /opt/fhs-server/FHS.x86_64
rm -rf /tmp/fhs-runtime-sync /tmp/unity-linux-runtime-friendly.tar

if [ -f "$ENV_FILE" ]; then
  AGENT_SECRET="$(sed -n 's/^NODE_AGENT_SECRET=//p' "$ENV_FILE" | head -n1 | tr -d '\r')"
  if [ -n "$AGENT_SECRET" ]; then
    systemctl restart node-agent.service
    sleep 3
    systemctl is-active --quiet node-agent.service
    curl -fsS -H "Authorization: Bearer ${AGENT_SECRET}" http://127.0.0.1:9090/agent/v1/capacity >/dev/null
  fi
fi

echo "runtime_updated"
'@

  $deployOutput = Invoke-SafeSshCapture -TargetHost $targetHost -RemoteScript $remoteDeploy
  if ($deployOutput) {
    $deployOutput | Write-Host
  }
}

Write-Host "Friendly runtime deployment completed for buildId=$($localManifest.buildId)"
