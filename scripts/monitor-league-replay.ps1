param(
  [int]$IntervalMinutes = 30,
  [int]$DurationHours = 3,
  [string]$RepoRoot = "C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui",
  [string]$CredentialsPath = "C:\Users\TURHAN\Desktop\MGX\secrets\live-league\osm-react-firebase-adminsdk-fbsvc-fb46fd719a.json",
  [string]$KeyPath = "C:\Users\TURHAN\.ssh\hetzner_fhs_ed25519"
)

$ErrorActionPreference = "Stop"

$tmpDir = Join-Path $RepoRoot "tmp"
$runnerOut = Join-Path $tmpDir "league-replay-run.out.log"
$runnerErr = Join-Path $tmpDir "league-replay-run.err.log"
$statusLog = Join-Path $tmpDir "league-replay-monitor.status.log"
$stateFile = Join-Path $tmpDir "league-replay-monitor.state.json"
$nodeIps = @(
  "89.167.122.255",
  "89.167.117.176",
  "89.167.127.127",
  "89.167.124.123",
  "204.168.146.29"
)

New-Item -ItemType Directory -Force $tmpDir | Out-Null
if (-not (Test-Path $runnerOut)) { New-Item -ItemType File $runnerOut | Out-Null }
if (-not (Test-Path $runnerErr)) { New-Item -ItemType File $runnerErr | Out-Null }
if (-not (Test-Path $statusLog)) { New-Item -ItemType File $statusLog | Out-Null }

function Write-StatusLog {
  param(
    [string]$Level,
    [string]$Message,
    [object]$Data
  )

  $payload = [ordered]@{
    ts = (Get-Date).ToString("o")
    level = $Level
    message = $Message
    data = $Data
  }

  Add-Content -Path $statusLog -Value ($payload | ConvertTo-Json -Compress -Depth 8)
}

function Get-RunnerProcess {
  $selfPid = $PID
  return Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $selfPid -and
      $_.CommandLine -like "*replay-league-backlog.mjs*" -and
      $_.CommandLine -like "*--run*" -and
      $_.CommandLine -notlike "*monitor-league-replay.ps1*"
    } |
    Sort-Object CreationDate |
    Select-Object -First 1
}

function Start-ReplayRunner {
  $env:GOOGLE_APPLICATION_CREDENTIALS = $CredentialsPath
  $process = Start-Process node `
    -WorkingDirectory $RepoRoot `
    -ArgumentList ".\src\functions\scripts\replay-league-backlog.mjs","--run","--batch-size=40","--poll-seconds=30" `
    -RedirectStandardOutput $runnerOut `
    -RedirectStandardError $runnerErr `
    -PassThru

  Write-StatusLog -Level "info" -Message "runner_started" -Data @{
    pid = $process.Id
  }

  return $process
}

function Get-BacklogSnapshot {
  $env:GOOGLE_APPLICATION_CREDENTIALS = $CredentialsPath
  $output = & node .\src\functions\scripts\replay-league-backlog.mjs --list --batch-size=40 2>&1
  $joined = ($output -join "`n")
  $count = 0
  $match = [regex]::Match($joined, "Actionable backlog:\s*(\d+)\s+mac")
  if ($match.Success) {
    $count = [int]$match.Groups[1].Value
  }

  return @{
    count = $count
    summary = $joined
  }
}

function Get-NodeCapacities {
  $rows = @()
  foreach ($ip in $nodeIps) {
    try {
      $json = & ssh -i $KeyPath -o StrictHostKeyChecking=no "root@$ip" "curl -fsS http://127.0.0.1:9090/health" 2>$null
      if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($json)) {
        throw "ssh_or_health_failed"
      }
      $obj = $json | ConvertFrom-Json
      $rows += [PSCustomObject]@{
        ip = $ip
        ok = [bool]$obj.ok
        nodeId = [string]$obj.nodeId
        freeSlots = [int]$obj.capacity.freeSlots
        usedSlots = [int]$obj.capacity.usedSlots
        runningSlots = [int]$obj.capacity.runningSlots
      }
    } catch {
      $rows += [PSCustomObject]@{
        ip = $ip
        ok = $false
        nodeId = ""
        freeSlots = -1
        usedSlots = -1
        runningSlots = -1
        error = $_.Exception.Message
      }
    }
  }

  return $rows
}

function Read-MonitorState {
  if (-not (Test-Path $stateFile)) {
    return @{}
  }

  try {
    return (Get-Content $stateFile -Raw | ConvertFrom-Json -AsHashtable)
  } catch {
    return @{}
  }
}

function Write-MonitorState {
  param([hashtable]$State)
  $State | ConvertTo-Json -Depth 8 | Set-Content $stateFile
}

function Get-FileTimestamp {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    return ""
  }
  return (Get-Item $Path).LastWriteTimeUtc.ToString("o")
}

$cycles = [Math]::Max(1, [int][Math]::Ceiling(($DurationHours * 60) / $IntervalMinutes))

Write-StatusLog -Level "info" -Message "monitor_started" -Data @{
  intervalMinutes = $IntervalMinutes
  durationHours = $DurationHours
  cycles = $cycles
}

for ($cycle = 1; $cycle -le $cycles; $cycle++) {
  $runner = Get-RunnerProcess
  $backlog = Get-BacklogSnapshot
  $caps = Get-NodeCapacities
  $freeSlotsTotal = ($caps | Where-Object { $_.freeSlots -ge 0 } | Measure-Object -Property freeSlots -Sum).Sum
  if ($null -eq $freeSlotsTotal) { $freeSlotsTotal = 0 }

  $runnerOutTs = Get-FileTimestamp -Path $runnerOut
  $runnerErrTs = Get-FileTimestamp -Path $runnerErr
  $state = Read-MonitorState
  $action = "none"

  if ($backlog.count -gt 0 -and -not $runner) {
    $runner = Start-ReplayRunner
    $action = "runner_started_missing"
    Start-Sleep -Seconds 3
  } elseif (
    $backlog.count -gt 0 -and
    $runner -and
    $freeSlotsTotal -gt 0 -and
    ($state.backlogCount -as [int]) -eq $backlog.count -and
    [string]$state.runnerOutTs -eq $runnerOutTs -and
    [string]$state.runnerErrTs -eq $runnerErrTs
  ) {
    try {
      Stop-Process -Id $runner.ProcessId -Force -ErrorAction Stop
      Write-StatusLog -Level "warn" -Message "runner_restarted_no_progress_with_free_slots" -Data @{
        pid = $runner.ProcessId
        backlog = $backlog.count
        freeSlotsTotal = $freeSlotsTotal
      }
    } catch {
      Write-StatusLog -Level "warn" -Message "runner_restart_failed" -Data @{
        pid = $runner.ProcessId
        error = $_.Exception.Message
      }
    }
    Start-Sleep -Seconds 2
    $runner = Start-ReplayRunner
    $action = "runner_restarted_no_progress"
    Start-Sleep -Seconds 3
  }

  $snapshot = @{
    cycle = $cycle
    backlogCount = $backlog.count
    runnerAlive = [bool]$runner
    runnerPid = if ($runner) { [int]$runner.ProcessId } else { $null }
    freeSlotsTotal = [int]$freeSlotsTotal
    action = $action
    nodeCapacities = $caps
    runnerOutTs = (Get-FileTimestamp -Path $runnerOut)
    runnerErrTs = (Get-FileTimestamp -Path $runnerErr)
  }

  Write-StatusLog -Level "info" -Message "monitor_cycle" -Data $snapshot
  Write-MonitorState -State $snapshot

  if ($backlog.count -le 0) {
    Write-StatusLog -Level "info" -Message "backlog_completed" -Data @{
      cycle = $cycle
    }
    break
  }

  if ($cycle -lt $cycles) {
    Start-Sleep -Seconds ($IntervalMinutes * 60)
  }
}

Write-StatusLog -Level "info" -Message "monitor_finished" -Data @{
  finishedAt = (Get-Date).ToString("o")
}
