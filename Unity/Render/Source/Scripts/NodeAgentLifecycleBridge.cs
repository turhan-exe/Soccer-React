using System;
using System.Reflection;
using UnityEngine;

[DisallowMultipleComponent]
public sealed class NodeAgentLifecycleBridge : MonoBehaviour
{
    [Header("Minute Heartbeat")]
    [SerializeField] private bool emitMinuteHeartbeatLogs = true;
    [SerializeField] private float pollIntervalSeconds = 0.25f;

    [Header("Result Bridge")]
    [SerializeField] private bool emitResultFromMatchEndReplicator = true;
    [SerializeField] private int fallbackEndMinuteThreshold = 91;
    [SerializeField] private float fallbackEndGraceSeconds = 60f;

    [Header("Debug")]
    [SerializeField] private bool debugLogs = true;

    private const string MatchManagerTypeName = "FStudio.MatchEngine.MatchManager, Assembly-CSharp";
    private const string MatchEndReplicatorTypeName = "MatchEndReplicator, Assembly-CSharp";

    private Type _matchManagerType;
    private Type _matchEndReplicatorType;
    private PropertyInfo _matchManagerCurrentProperty;
    private PropertyInfo _minutesProperty;
    private FieldInfo _minutesField;

    private PropertyInfo _replicatorCurrentProperty;
    private FieldInfo _replicatorEndedField;
    private FieldInfo _replicatorPayloadJsonField;

    private float _nextPollAt;
    private int _lastLoggedMinute = -1;
    private float _lastMinuteSeenAt = -1f;
    private bool _resultLogged;

    [Serializable]
    private sealed class ReplicatorPayload
    {
        public int homeGoals;
        public int awayGoals;
        public string homeTeamId;
        public string awayTeamId;
        public int endMinute;
    }

    [Serializable]
    private sealed class NodeAgentResultPayload
    {
        public string source;
        public int homeGoals;
        public int awayGoals;
        public string homeTeamId;
        public string awayTeamId;
        public int endMinute;
    }

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void EnsureRuntimeBridge()
    {
        var existing = FindObjectOfType<NodeAgentLifecycleBridge>();
        if (existing != null)
        {
            return;
        }

        var go = new GameObject("__NodeAgentLifecycleBridge_Auto");
        DontDestroyOnLoad(go);
        go.AddComponent<NodeAgentLifecycleBridge>();
    }

    private void Update()
    {
        if (Time.unscaledTime < _nextPollAt)
        {
            return;
        }

        _nextPollAt = Time.unscaledTime + Mathf.Max(0.05f, pollIntervalSeconds);

        object matchManager = GetMatchManagerInstance();
        if (emitMinuteHeartbeatLogs && TryReadMinutes(matchManager, out float minute))
        {
            int rounded = Mathf.Clamp(Mathf.FloorToInt(minute), 0, 240);
            if (rounded > _lastLoggedMinute)
            {
                _lastLoggedMinute = rounded;
                _lastMinuteSeenAt = Time.unscaledTime;
                Debug.Log($"[NodeAgentLifecycleBridge] Minutes: {minute:0.00}");
            }
        }

        if (_resultLogged)
        {
            return;
        }

        if (emitResultFromMatchEndReplicator && TryEmitResultFromReplicator())
        {
            _resultLogged = true;
            return;
        }

        if (
            _lastLoggedMinute >= Mathf.Max(1, fallbackEndMinuteThreshold) &&
            _lastMinuteSeenAt >= 0f &&
            fallbackEndGraceSeconds >= 0f &&
            Time.unscaledTime - _lastMinuteSeenAt >= fallbackEndGraceSeconds
        )
        {
            EmitResultLog(
                new NodeAgentResultPayload
                {
                    source = "minute_fallback_guard",
                    homeGoals = 0,
                    awayGoals = 0,
                    homeTeamId = string.Empty,
                    awayTeamId = string.Empty,
                    endMinute = _lastLoggedMinute,
                }
            );
            _resultLogged = true;
        }
    }

    private bool TryEmitResultFromReplicator()
    {
        object replicator = GetMatchEndReplicatorInstance();
        if (replicator == null)
        {
            return false;
        }

        EnsureReplicatorReflectionCached();
        if (_replicatorEndedField == null || _replicatorPayloadJsonField == null)
        {
            return false;
        }

        bool ended;
        string payloadJson;
        try
        {
            ended = Convert.ToBoolean(_replicatorEndedField.GetValue(replicator));
            payloadJson = _replicatorPayloadJsonField.GetValue(replicator) as string;
        }
        catch
        {
            return false;
        }

        if (!ended || string.IsNullOrWhiteSpace(payloadJson))
        {
            return false;
        }

        ReplicatorPayload parsed;
        try
        {
            parsed = JsonUtility.FromJson<ReplicatorPayload>(payloadJson);
        }
        catch
        {
            return false;
        }

        if (parsed == null)
        {
            return false;
        }

        var nodePayload = new NodeAgentResultPayload
        {
            source = "match_end_replicator",
            homeGoals = parsed.homeGoals,
            awayGoals = parsed.awayGoals,
            homeTeamId = parsed.homeTeamId ?? string.Empty,
            awayTeamId = parsed.awayTeamId ?? string.Empty,
            endMinute = parsed.endMinute > 0 ? parsed.endMinute : Mathf.Max(0, _lastLoggedMinute),
        };

        EmitResultLog(nodePayload);
        return true;
    }

    private void EmitResultLog(NodeAgentResultPayload payload)
    {
        string json = JsonUtility.ToJson(payload);
        Debug.Log($"unityMatchFinished => {json}");

        if (debugLogs)
        {
            Debug.Log($"[NodeAgentLifecycleBridge] emitted result source={payload.source} minute={payload.endMinute}");
        }
    }

    private object GetMatchManagerInstance()
    {
        EnsureMatchManagerReflectionCached();
        if (_matchManagerType == null)
        {
            return null;
        }

        try
        {
            object current = _matchManagerCurrentProperty?.GetValue(null);
            if (current != null)
            {
                return current;
            }
        }
        catch
        {
        }

        return FindObjectOfType(_matchManagerType);
    }

    private object GetMatchEndReplicatorInstance()
    {
        EnsureReplicatorReflectionCached();
        if (_matchEndReplicatorType == null)
        {
            return null;
        }

        try
        {
            object current = _replicatorCurrentProperty?.GetValue(null);
            if (current != null)
            {
                return current;
            }
        }
        catch
        {
        }

        return FindObjectOfType(_matchEndReplicatorType);
    }

    private void EnsureMatchManagerReflectionCached()
    {
        if (_matchManagerType != null)
        {
            return;
        }

        _matchManagerType = Type.GetType(MatchManagerTypeName) ?? ResolveAssemblyTypeBySimpleName("MatchManager");
        if (_matchManagerType == null)
        {
            return;
        }

        const BindingFlags staticFlags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.FlattenHierarchy;
        const BindingFlags instanceFlags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;

        _matchManagerCurrentProperty = _matchManagerType.GetProperty("Current", staticFlags);
        _minutesProperty = _matchManagerType.GetProperty("minutes", instanceFlags) ??
                           _matchManagerType.GetProperty("Minutes", instanceFlags);
        _minutesField = _matchManagerType.GetField("m_minutes", instanceFlags) ??
                        _matchManagerType.GetField("minutes", instanceFlags);
    }

    private void EnsureReplicatorReflectionCached()
    {
        if (_matchEndReplicatorType != null)
        {
            return;
        }

        _matchEndReplicatorType =
            Type.GetType(MatchEndReplicatorTypeName) ??
            ResolveAssemblyTypeBySimpleName("MatchEndReplicator");
        if (_matchEndReplicatorType == null)
        {
            return;
        }

        const BindingFlags staticFlags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.FlattenHierarchy;
        const BindingFlags instanceFlags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;

        _replicatorCurrentProperty = _matchEndReplicatorType.GetProperty("Current", staticFlags);
        _replicatorEndedField = _matchEndReplicatorType.GetField("ended", instanceFlags);
        _replicatorPayloadJsonField = _matchEndReplicatorType.GetField("payloadJson", instanceFlags);
    }

    private bool TryReadMinutes(object matchManager, out float minute)
    {
        minute = 0f;
        if (matchManager == null)
        {
            return false;
        }

        EnsureMatchManagerReflectionCached();
        if (_minutesProperty == null && _minutesField == null)
        {
            return false;
        }

        try
        {
            object value = _minutesProperty?.GetValue(matchManager) ?? _minutesField?.GetValue(matchManager);
            if (value == null)
            {
                return false;
            }

            minute = Convert.ToSingle(value);
            if (float.IsNaN(minute) || float.IsInfinity(minute))
            {
                return false;
            }

            return minute >= 0f && minute <= 300f;
        }
        catch
        {
            return false;
        }
    }

    private static Type ResolveAssemblyTypeBySimpleName(string simpleName)
    {
        if (string.IsNullOrWhiteSpace(simpleName))
        {
            return null;
        }

        foreach (Assembly asm in AppDomain.CurrentDomain.GetAssemblies())
        {
            Type type = asm.GetType(simpleName);
            if (type != null)
            {
                return type;
            }

            foreach (Type candidate in asm.GetTypes())
            {
                if (string.Equals(candidate.Name, simpleName, StringComparison.Ordinal))
                {
                    return candidate;
                }
            }
        }

        return null;
    }
}
