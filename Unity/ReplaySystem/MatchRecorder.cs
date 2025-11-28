using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class MatchRecorder : MonoBehaviour
{
    [Serializable]
    public class TrackedPlayer
    {
        public string id;
        public Transform transform;
    }

    public string seasonId;
    public string matchId;
    public RuntimeTeamState homeTeam;
    public RuntimeTeamState awayTeam;
    public Transform ballTransform;
    public List<TrackedPlayer> trackedPlayers = new List<TrackedPlayer>();
    public float sampleIntervalSeconds = 0.35f;

    private MatchReplayPayload _payload;
    private Coroutine _loop;
    private readonly List<ReplayFrame> _frames = new List<ReplayFrame>();
    private readonly List<MatchEvent> _events = new List<MatchEvent>();
    private float _startTime;
    private bool _recording;

    public MatchReplayPayload Payload => _payload;

    public void StartRecording()
    {
        _payload = new MatchReplayPayload
        {
            version = 1,
            matchId = matchId,
            seasonId = seasonId,
            startedAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            home = homeTeam,
            away = awayTeam,
            frames = _frames,
            summary = new MatchResultSummary
            {
                homeGoals = 0,
                awayGoals = 0,
                events = _events
            }
        };

        _startTime = Time.time;
        _recording = true;
        _loop = StartCoroutine(CaptureLoop());
    }

    public void StopRecording()
    {
        _recording = false;
        if (_loop != null)
        {
            StopCoroutine(_loop);
        }
        _payload.durationMs = (long)((Time.time - _startTime) * 1000f);
        RecalculateScore();
    }

    public string SerializePayload()
    {
        return JsonUtility.ToJson(_payload);
    }

    public void RecordEvent(FrameEvent frameEvent, int minute)
    {
        if (_frames.Count == 0)
        {
            _frames.Add(CaptureFrame());
        }
        var lastFrame = _frames[_frames.Count - 1];
        lastFrame.frameEvent = frameEvent;
        _events.Add(new MatchEvent
        {
            minute = minute,
            type = frameEvent.type,
            club = frameEvent.club,
            playerId = frameEvent.playerId,
            description = frameEvent.extra
        });
    }

    private IEnumerator CaptureLoop()
    {
        while (_recording)
        {
            _frames.Add(CaptureFrame());
            yield return new WaitForSeconds(sampleIntervalSeconds);
        }
    }

    private ReplayFrame CaptureFrame()
    {
        var frame = new ReplayFrame
        {
            t = (long)((Time.time - _startTime) * 1000f),
            ball = CaptureBall(),
            players = CapturePlayers(),
            frameEvent = null
        };
        return frame;
    }

    private BallState CaptureBall()
    {
        if (ballTransform == null) return new BallState();
        var p = ballTransform.position;
        return new BallState { x = p.x, y = p.y, z = p.z };
    }

    private List<PlayerFrameState> CapturePlayers()
    {
        var list = new List<PlayerFrameState>(trackedPlayers.Count);
        foreach (var p in trackedPlayers)
        {
            if (p?.transform == null) continue;
            var pos = p.transform.position;
            list.Add(new PlayerFrameState
            {
                id = p.id,
                x = pos.x,
                y = pos.y,
                z = pos.z
            });
        }
        return list;
    }

    private void RecalculateScore()
    {
        int home = 0;
        int away = 0;
        foreach (var ev in _events)
        {
            if (ev.type == "goal")
            {
                if (ev.club == "home") home++;
                if (ev.club == "away") away++;
            }
        }
        _payload.summary.homeGoals = home;
        _payload.summary.awayGoals = away;
    }
}
