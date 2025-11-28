using System.Collections.Generic;
using UnityEngine;

public class MatchReplayManager : MonoBehaviour
{
    [System.Serializable]
    public class PlayerActor
    {
        public string id;
        public Transform transform;
    }

    public Transform ballTransform;
    public List<PlayerActor> playerActors = new List<PlayerActor>();
    public float playbackSpeed = 1f;

    private MatchReplayPayload _payload;
    private int _frameIndex;
    private float _timeMs;
    private bool _isPlaying;
    private readonly Dictionary<string, Transform> _actorLookup = new Dictionary<string, Transform>();

    private void Awake()
    {
        foreach (var actor in playerActors)
        {
            if (actor != null && !string.IsNullOrEmpty(actor.id) && actor.transform != null)
            {
                _actorLookup[actor.id] = actor.transform;
            }
        }
    }

    private void Update()
    {
        if (!_isPlaying || _payload == null) return;
        _timeMs += Time.deltaTime * 1000f * playbackSpeed;
        StepToTime(_timeMs);
    }

    public void LoadReplayFromJson(string json)
    {
        _payload = JsonUtility.FromJson<MatchReplayPayload>(json);
        _frameIndex = 0;
        _timeMs = 0f;
        _isPlaying = false;
    }

    public void Play()
    {
        _isPlaying = true;
    }

    public void Pause()
    {
        _isPlaying = false;
    }

    public void SeekMs(float t)
    {
        _timeMs = Mathf.Clamp(t, 0f, _payload?.durationMs ?? 0f);
        _frameIndex = 0;
        StepToTime(_timeMs);
    }

    public void SetSpeed(float speed)
    {
        playbackSpeed = Mathf.Max(0.1f, speed);
    }

    private void StepToTime(float targetMs)
    {
        if (_payload == null || _payload.frames == null || _payload.frames.Count == 0) return;
        while (_frameIndex + 1 < _payload.frames.Count && _payload.frames[_frameIndex + 1].t <= targetMs)
        {
            _frameIndex++;
            ApplyFrame(_payload.frames[_frameIndex]);
        }
    }

    private void ApplyFrame(ReplayFrame frame)
    {
        if (ballTransform != null && frame.ball != null)
        {
            ballTransform.position = new Vector3(frame.ball.x, frame.ball.y, frame.ball.z);
        }
        if (frame.players != null)
        {
            foreach (var p in frame.players)
            {
                if (p == null || string.IsNullOrEmpty(p.id)) continue;
                if (_actorLookup.TryGetValue(p.id, out var tr) && tr != null)
                {
                    tr.position = new Vector3(p.x, p.y, p.z);
                }
            }
        }

        if (frame.frameEvent != null)
        {
            Debug.Log($"Replay event {frame.frameEvent.type} at {frame.t}ms");
        }
    }
}
