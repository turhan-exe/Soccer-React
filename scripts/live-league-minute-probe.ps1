param(
  [string]$BaseUrl = "http://89.167.24.132:8080",
  [string]$MatchControlSecret = "",
  [string]$CallbackToken = "",
  [string]$NodeSecret = "",
  [int]$PollCount = 18,
  [int]$PollIntervalSeconds = 20,
  [string]$OutFile = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($MatchControlSecret)) {
  throw "MatchControlSecret is required"
}
if ([string]::IsNullOrWhiteSpace($CallbackToken)) {
  throw "CallbackToken is required"
}
if ([string]::IsNullOrWhiteSpace($NodeSecret)) {
  throw "NodeSecret is required"
}
if ($PollCount -lt 1) {
  throw "PollCount must be >= 1"
}
if ($PollIntervalSeconds -lt 1) {
  throw "PollIntervalSeconds must be >= 1"
}

$stamp = Get-Date -Format "yyyyMMddHHmmss"
$fixture = "probe-fixture-$stamp"
$league = "probe-league"
$season = "probe-season-$stamp"

$preparePayload = @{
  leagueId = $league
  fixtureId = $fixture
  seasonId = $season
  kickoffAt = (Get-Date).ToUniversalTime().ToString("o")
  homeTeamId = "$fixture-home"
  awayTeamId = "$fixture-away"
  homeUserId = "$fixture-home-user"
  awayUserId = "$fixture-away-user"
  homeTeamPayload = @{
    teamName = "Home"
    formation = "4-2-3-1"
    lineup = @()
  }
  awayTeamPayload = @{
    teamName = "Away"
    formation = "4-2-3-1"
    lineup = @()
  }
  resultUploadUrl = "https://example.invalid/results/$fixture.json"
  replayUploadUrl = "https://example.invalid/replays/$fixture.json"
  videoUploadUrl = "https://example.invalid/videos/$fixture.mp4"
  requestToken = [guid]::NewGuid().ToString()
} | ConvertTo-Json -Depth 8

$headers = @{
  Authorization = "Bearer $MatchControlSecret"
  "Content-Type" = "application/json"
}

$prepare = Invoke-RestMethod -Method Post -Uri "$BaseUrl/v1/league/prepare-slot" -Headers $headers -Body $preparePayload -TimeoutSec 25
$matchId = $prepare.matchId
$nodeIp = $prepare.serverIp

Invoke-RestMethod -Method Post -Uri "$BaseUrl/v1/league/kickoff-slot" -Headers $headers -Body (@{ matchId = $matchId } | ConvertTo-Json) -TimeoutSec 25 | Out-Null

$timeline = @()
for ($step = 1; $step -le $PollCount; $step++) {
  try {
    $match = Invoke-RestMethod -Method Get -Uri "$BaseUrl/v1/internal/matches/$matchId" -Headers @{ Authorization = "Bearer $MatchControlSecret" } -TimeoutSec 25
    $alloc = Invoke-RestMethod -Method Get -Uri "http://${nodeIp}:9090/agent/v1/allocations/$matchId" -Headers @{ Authorization = "Bearer $NodeSecret" } -TimeoutSec 25

    $row = [PSCustomObject]@{
      at = (Get-Date).ToString("o")
      step = $step
      matchState = $match.match.status
      matchMinute = $match.match.liveMinute
      matchMinuteAt = $match.match.liveMinuteAt
      allocationState = $alloc.state
      allocationMinute = $alloc.liveMinute
      allocationMinuteAt = $alloc.liveMinuteAt
      error = $null
    }
    $timeline += $row
    Write-Host ("step={0}/{1} match={2} matchMinute={3} alloc={4} allocMinute={5}" -f $step, $PollCount, $row.matchState, $row.matchMinute, $row.allocationState, $row.allocationMinute)

    if ($match.match.status -in @("ended", "failed", "released")) {
      break
    }
  }
  catch {
    $timeline += [PSCustomObject]@{
      at = (Get-Date).ToString("o")
      step = $step
      matchState = $null
      matchMinute = $null
      matchMinuteAt = $null
      allocationState = $null
      allocationMinute = $null
      allocationMinuteAt = $null
      error = $_.Exception.Message
    }
    Write-Warning ("step={0}/{1} probe_failed: {2}" -f $step, $PollCount, $_.Exception.Message)
  }

  Start-Sleep -Seconds $PollIntervalSeconds
}

try {
  Invoke-RestMethod -Method Post -Uri "$BaseUrl/v1/internal/matches/$matchId/lifecycle" -Headers @{ Authorization = "Bearer $CallbackToken"; "Content-Type" = "application/json" } -Body (@{
      matchId = $matchId
      fixtureId = $fixture
      leagueId = $league
      state = "failed"
      reason = "manual_probe_cleanup"
    } | ConvertTo-Json) | Out-Null
}
catch {
  Write-Warning "cleanup failed for matchId=$matchId : $($_.Exception.Message)"
}

if ([string]::IsNullOrWhiteSpace($OutFile)) {
  New-Item -ItemType Directory -Force -Path "docs/benchmark-reports" | Out-Null
  $OutFile = "docs/benchmark-reports/live-league-minute-probe-$stamp.json"
}

$result = @{
  matchId = $matchId
  nodeIp = $nodeIp
  pollCount = $PollCount
  pollIntervalSeconds = $PollIntervalSeconds
  prepare = $prepare
  timeline = $timeline
}

$result | ConvertTo-Json -Depth 8 | Set-Content -Path $OutFile -Encoding UTF8
Write-Output "WROTE=$OutFile MATCH_ID=$matchId NODE=$nodeIp"
