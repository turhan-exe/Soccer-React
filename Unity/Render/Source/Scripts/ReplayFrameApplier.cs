using System.Collections.Generic;
using UnityEngine;

public class ReplayFrameApplier : MonoBehaviour
{
    [System.Serializable]
    public class PlayerActor
    {
        public string id;
        public Transform transform;
    }

    public Transform ballTransform;
    public List<PlayerActor> playerActors = new List<PlayerActor>();
    public bool logFrameEvents = false;

    private MatchReplayPayload _payload;
    private int _frameIndex;
    private long _currentMs = -1;
    private readonly Dictionary<string, Transform> _actorLookup = new Dictionary<string, Transform>();

    private void Awake()
    {
        RebuildLookup();
    }

    public void RebuildLookup()
    {
        _actorLookup.Clear();
        foreach (var actor in playerActors)
        {
            if (actor != null && !string.IsNullOrEmpty(actor.id) && actor.transform != null)
            {
                _actorLookup[actor.id] = actor.transform;
            }
        }
    }

    public void LoadPayload(MatchReplayPayload payload)
    {
        _payload = payload;
        _frameIndex = 0;
        _currentMs = -1;
        if (_payload?.frames != null && _payload.frames.Count > 0)
        {
            ApplyFrame(_payload.frames[0]);
        }
    }

    public void SeekMs(long targetMs)
    {
        if (_payload == null || _payload.frames == null || _payload.frames.Count == 0) return;
        if (targetMs < _currentMs)
        {
            _frameIndex = 0;
        }

        while (_frameIndex + 1 < _payload.frames.Count && _payload.frames[_frameIndex + 1].t <= targetMs)
        {
            _frameIndex++;
            ApplyFrame(_payload.frames[_frameIndex]);
        }

        _currentMs = targetMs;
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

        if (logFrameEvents && frame.frameEvent != null)
        {
            Debug.Log($"[ReplayFrameApplier] event {frame.frameEvent.type} at {frame.t}ms");
        }
    }
}
