using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Mirror;
using UnityEngine;

[Serializable]
public struct MatchEndPayload
{
    public int homeGoals;
    public int awayGoals;
    public string homeTeamId;
    public string awayTeamId;
    public int endMinute;
    public long serverUnixMs;

    public bool hasStats;
    public int[] possession;
    public int[] passes;
    public int[] successfulPasses;
    public int[] passingPercentage;
    public int[] attempts;
    public int[] attemptsOnTarget;
    public float[] runningDistance;
    public int[] corners;
    public int[] ballWinning;
}

[Serializable]
public struct SetPieceSyncPayload
{
    public int matchFlags;
    public int throwHolderPlayerId;
    public int cornerHolderPlayerId;
    public int goalKickHolderPlayerId;
    public long serverUnixMs;
}

[DisallowMultipleComponent]
public class MatchEndReplicator : NetworkBehaviour
{
    [Header("Observation")]
    [SerializeField] private bool observeMatchManagerOnServer = true;
    [SerializeField] private int finishedFlagBit = 16;
    [SerializeField] private float minServerMinuteForObservedEnd = 89.5f;
    [SerializeField] private int requiredStableEndFrames = 5;
    [SerializeField] private bool debugEndObservation = true;
    [SerializeField] private float defaultEndMinute = 90f;

    [Header("Set-Piece Replication")]
    [SerializeField] private bool enableSetPieceReplication = true;
    [SerializeField] private float setPieceSyncHz = 15f;
    [SerializeField] private bool replicateSetPieceMatchFlags = true;
    [SerializeField] private int throwHolderAnimatorBool = 11;
    [SerializeField] private bool includeStatsInEndPayload = true;
    [SerializeField] private bool debugSetPieceSync = false;
    [SerializeField] private bool debugStatsSync = true;

    [Header("Client Apply")]
    [SerializeField] private bool applyEventsOnClient = true;
    [SerializeField] private bool applyMatchFlagsOnClient = true;
    [SerializeField] private bool applyMinuteOnClient = true;
    [SerializeField] private bool stopActorsOnClient = true;
    [SerializeField] private bool enforceClientMinuteGate = true;
    [SerializeField] private bool debugClientMinuteGate = true;

    [Header("Match Flags")]
    [SerializeField] private int finishedFlagValue = 16;

    [SyncVar] private bool ended;
    [SyncVar(hook = nameof(OnPayloadJsonChanged))] private string payloadJson;
    [SyncVar(hook = nameof(OnSetPieceJsonChanged))] private string setPieceJson;

    private bool _declared;
    private bool _handledLocally;
    private int _stableObservedEndFrames;
    private int _lastObservationLogFrame = -1000;
    private int _lastSetPieceLogFrame = -1000;
    private int _lastStatsLogFrame = -1000;
    private int _lastClientGateLogFrame = -1000;
    private float _nextSetPieceSyncAt;
    private string _lastSetPieceSentSignature = string.Empty;
    private string _lastSetPieceAppliedSignature = string.Empty;
    private static MatchEndReplicator _instance;
    private int _lastServerResetFrame = -1000;

    private const string AssemblyCSharp = "Assembly-CSharp";
    private const string MatchManagerTypeName = "FStudio.MatchEngine.MatchManager";

    private Type _matchManagerType;
    private PropertyInfo _currentProperty;
    private PropertyInfo _minutesProperty;
    private FieldInfo _minutesField;
    private FieldInfo _matchFlagsField;
    private FieldInfo _homeScoreField;
    private FieldInfo _awayScoreField;
    private FieldInfo _gameTeam1Field;
    private FieldInfo _gameTeam2Field;
    private FieldInfo _ballField;
    private PropertyInfo _statisticsProperty;
    private FieldInfo _statisticsField;

    public static MatchEndReplicator Current => _instance;

    private void Awake()
    {
        if (_instance != null && _instance != this)
        {
            Debug.LogWarning("[MatchEndReplicator] Duplicate instance destroyed.");
            Destroy(this);
            return;
        }

        _instance = this;
    }

    public override void OnStartClient()
    {
        base.OnStartClient();
        TryApplySyncedSetPiece();
        TryApplySyncedPayload();
    }

    public override void OnStartServer()
    {
        base.OnStartServer();
        ResetReplicationState("[MatchEndReplicator] server start reset replication state.");
    }

    [Server]
    public void DeclareMatchEnded(int homeGoals, int awayGoals, string homeTeamId, string awayTeamId, int endMinute)
    {
        if (_declared)
        {
            return;
        }

        _declared = true;
        ended = true;

        var payload = new MatchEndPayload
        {
            homeGoals = homeGoals,
            awayGoals = awayGoals,
            homeTeamId = homeTeamId ?? string.Empty,
            awayTeamId = awayTeamId ?? string.Empty,
            endMinute = endMinute,
            serverUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        };

        if (includeStatsInEndPayload)
        {
            object matchManager = GetMatchManagerInstance();
            if (matchManager != null)
            {
                TryCaptureStatsSnapshot(matchManager, ref payload);
            }
            else
            {
                payload.hasStats = false;
                LogStats("[MatchEndReplicator] stats snapshot missing: MatchManager unavailable.");
            }
        }

        payloadJson = JsonUtility.ToJson(payload);
        RpcMatchEnded(payload);
    }

    private void Update()
    {
        if (isClient && !isServer && ended && !_handledLocally && !string.IsNullOrWhiteSpace(payloadJson))
        {
            TryApplySyncedPayload();
        }

        if (isServer && enableSetPieceReplication && !_declared)
        {
            ObserveSetPieceOnServer();
        }

        if (!isServer || !observeMatchManagerOnServer || _declared)
        {
            return;
        }

        object matchManager = GetMatchManagerInstance();
        if (matchManager == null)
        {
            return;
        }

        TryResetStateForNewMatch(matchManager);

        int flags = ReadMatchFlags(matchManager);
        bool hasFinishedFlag = (flags & finishedFlagBit) != 0;
        bool hasMinute = TryReadMinutes(matchManager, out float minute);
        if (!hasMinute)
        {
            _stableObservedEndFrames = 0;
            LogObservation(
                $"[MatchEndReplicator] suppressed end: minute unreadable flags={flags} frame={Time.frameCount}"
            );
            return;
        }

        bool minuteEligible = minute >= minServerMinuteForObservedEnd;

        if (!hasFinishedFlag || !minuteEligible)
        {
            if (hasFinishedFlag && !minuteEligible)
            {
                LogObservation(
                    $"[MatchEndReplicator] suppressed early end minute={minute:0.00} " +
                    $"threshold={minServerMinuteForObservedEnd:0.00} flags={flags} frame={Time.frameCount}"
                );
            }

            _stableObservedEndFrames = 0;
            return;
        }

        _stableObservedEndFrames++;
        int requiredFrames = Mathf.Max(1, requiredStableEndFrames);
        if (_stableObservedEndFrames < requiredFrames)
        {
            LogObservation(
                $"[MatchEndReplicator] waiting stable end frames={_stableObservedEndFrames}/{requiredFrames} " +
                $"minute={minute:0.00} flags={flags} frame={Time.frameCount}"
            );
            return;
        }

        MatchEndPayload payload = BuildPayloadFromMatchManager(matchManager);
        LogObservation(
            $"[MatchEndReplicator] declare end minute={minute:0.00} flags={flags} " +
            $"stableFrames={_stableObservedEndFrames}/{requiredFrames} " +
            $"score={payload.homeGoals}-{payload.awayGoals} frame={Time.frameCount}"
        );

        DeclareMatchEnded(
            payload.homeGoals,
            payload.awayGoals,
            payload.homeTeamId,
            payload.awayTeamId,
            payload.endMinute
        );
    }

    [ClientRpc]
    private void RpcMatchEnded(MatchEndPayload payload)
    {
        ApplyPayloadOnClient(payload);
    }

    [ClientRpc]
    private void RpcApplySetPiece(string payloadJsonValue)
    {
        ApplySetPieceJsonOnClient(payloadJsonValue);
    }

    private void OnPayloadJsonChanged(string _, string current)
    {
        if (!isClient || isServer || !ended || string.IsNullOrWhiteSpace(current))
        {
            return;
        }

        if (!TryParsePayload(current, out MatchEndPayload payload))
        {
            return;
        }

        ApplyPayloadOnClient(payload);
    }

    private void OnSetPieceJsonChanged(string _, string current)
    {
        if (!isClient || isServer || string.IsNullOrWhiteSpace(current))
        {
            return;
        }

        ApplySetPieceJsonOnClient(current);
    }

    private void TryApplySyncedPayload()
    {
        if (!isClient || isServer || !ended || string.IsNullOrWhiteSpace(payloadJson))
        {
            return;
        }

        if (!TryParsePayload(payloadJson, out MatchEndPayload payload))
        {
            return;
        }

        ApplyPayloadOnClient(payload);
    }

    private void TryApplySyncedSetPiece()
    {
        if (!isClient || isServer || string.IsNullOrWhiteSpace(setPieceJson))
        {
            return;
        }

        ApplySetPieceJsonOnClient(setPieceJson);
    }

    private void ObserveSetPieceOnServer()
    {
        object matchManager = GetMatchManagerInstance();
        if (matchManager == null)
        {
            return;
        }

        SetPieceSyncPayload payload = BuildSetPiecePayload(matchManager);
        string signature = BuildSetPieceSignature(payload);
        float interval = 1f / Mathf.Max(1f, setPieceSyncHz);
        bool intervalElapsed = Time.unscaledTime >= _nextSetPieceSyncAt;

        if (!intervalElapsed && string.Equals(signature, _lastSetPieceSentSignature, StringComparison.Ordinal))
        {
            return;
        }

        string json = JsonUtility.ToJson(payload);
        setPieceJson = json;
        RpcApplySetPiece(json);

        _lastSetPieceSentSignature = signature;
        _nextSetPieceSyncAt = Time.unscaledTime + interval;

        LogSetPiece($"[MatchEndReplicator] set-piece sent signature={signature} frame={Time.frameCount}");
    }

    private void ApplySetPieceJsonOnClient(string json)
    {
        if (!TryParseSetPiecePayload(json, out SetPieceSyncPayload payload))
        {
            return;
        }

        ApplySetPieceOnClient(payload);
    }

    private void ApplySetPieceOnClient(SetPieceSyncPayload payload)
    {
        if (!isClient || isServer)
        {
            return;
        }

        string signature = BuildSetPieceSignature(payload);
        if (string.Equals(signature, _lastSetPieceAppliedSignature, StringComparison.Ordinal))
        {
            return;
        }

        _lastSetPieceAppliedSignature = signature;

        object matchManager = GetMatchManagerInstance();
        if (matchManager == null)
        {
            return;
        }

        if (replicateSetPieceMatchFlags && IsReplicableSetPieceFlag(payload.matchFlags))
        {
            WriteMatchFlags(matchManager, payload.matchFlags);
        }

        List<object> players = CollectMatchPlayers(matchManager);
        for (int i = 0; i < players.Count; i++)
        {
            object player = players[i];
            SetHolderFlags(player, false, false, false);
            SetThrowHolderAnimator(player, false);
        }

        for (int i = 0; i < players.Count; i++)
        {
            object player = players[i];
            int playerId = ReadPlayerId(player);
            if (playerId < 0)
            {
                continue;
            }

            bool isThrow = playerId == payload.throwHolderPlayerId;
            bool isCorner = playerId == payload.cornerHolderPlayerId;
            bool isGoalKick = playerId == payload.goalKickHolderPlayerId;
            if (!isThrow && !isCorner && !isGoalKick)
            {
                continue;
            }

            SetHolderFlags(player, isThrow, isCorner, isGoalKick);
            SetThrowHolderAnimator(player, isThrow);
        }

        LogSetPiece(
            $"[MatchEndReplicator] set-piece applied signature={signature} " +
            $"flags={payload.matchFlags} frame={Time.frameCount}"
        );
    }

    private void ApplyPayloadOnClient(MatchEndPayload payload)
    {
        // Host already executes local final whistle flow via server-side MatchManager path.
        if (!isClient || isServer || _handledLocally)
        {
            return;
        }

        object matchManager = GetMatchManagerInstance();
        if (ShouldSuppressClientPayload(matchManager, payload, out string suppressionReason))
        {
            if (debugClientMinuteGate && Time.frameCount - _lastClientGateLogFrame >= 30)
            {
                _lastClientGateLogFrame = Time.frameCount;
                Debug.LogWarning(
                    "[MatchEndReplicator] suppressed client payload apply. " +
                    $"{suppressionReason} localFrame={Time.frameCount}"
                );
            }
            return;
        }

        _handledLocally = true;
        AllowClientGuards();

        if (matchManager != null)
        {
            if (applyMatchFlagsOnClient)
            {
                int currentFlags = ReadMatchFlags(matchManager);
                WriteMatchFlags(matchManager, currentFlags | finishedFlagValue);
            }

            if (applyMinuteOnClient)
            {
                float minute = payload.endMinute > 0 ? payload.endMinute : defaultEndMinute;
                WriteMinutes(matchManager, minute);
            }

            ApplyStatisticsSnapshotOnClient(matchManager, payload);
        }

        if (applyEventsOnClient)
        {
            TriggerFinalWhistleEvents(matchManager);
        }

        if (stopActorsOnClient)
        {
            StopActors(matchManager);
        }
    }

    private bool ShouldSuppressClientPayload(object matchManager, MatchEndPayload payload, out string reason)
    {
        reason = string.Empty;
        if (!enforceClientMinuteGate)
        {
            return false;
        }

        if (payload.endMinute > 0 && payload.endMinute < minServerMinuteForObservedEnd)
        {
            reason =
                $"payloadMinute={payload.endMinute} threshold={minServerMinuteForObservedEnd:0.00}";
            return true;
        }

        if (payload.endMinute <= 0 && matchManager != null && TryReadMinutes(matchManager, out float localMinute))
        {
            if (localMinute < minServerMinuteForObservedEnd)
            {
                reason =
                    $"localMinute={localMinute:0.00} threshold={minServerMinuteForObservedEnd:0.00}";
                return true;
            }
        }

        return false;
    }

    [Server]
    private void TryResetStateForNewMatch(object matchManager)
    {
        if ((!ended && !_declared) || matchManager == null)
        {
            return;
        }

        if (!TryReadMinutes(matchManager, out float minute))
        {
            return;
        }

        int flags = ReadMatchFlags(matchManager);
        bool hasFinishedFlag = (flags & finishedFlagBit) != 0;
        if (hasFinishedFlag || minute > 5f)
        {
            return;
        }

        if (Time.frameCount - _lastServerResetFrame < 30)
        {
            return;
        }

        _lastServerResetFrame = Time.frameCount;
        ResetReplicationState(
            $"[MatchEndReplicator] new match detected; cleared stale end state minute={minute:0.00} flags={flags}."
        );
    }

    [Server]
    private void ResetReplicationState(string logMessage)
    {
        _declared = false;
        _handledLocally = false;
        _stableObservedEndFrames = 0;
        _nextSetPieceSyncAt = 0f;
        _lastSetPieceSentSignature = string.Empty;
        _lastSetPieceAppliedSignature = string.Empty;
        ended = false;
        payloadJson = string.Empty;
        setPieceJson = string.Empty;

        if (!string.IsNullOrWhiteSpace(logMessage))
        {
            LogObservation(logMessage);
        }
    }

    private MatchEndPayload BuildPayloadFromMatchManager(object matchManager)
    {
        var payload = new MatchEndPayload
        {
            homeGoals = ReadIntField(matchManager, _homeScoreField),
            awayGoals = ReadIntField(matchManager, _awayScoreField),
            homeTeamId = ReadTeamId(matchManager, _gameTeam1Field),
            awayTeamId = ReadTeamId(matchManager, _gameTeam2Field),
            endMinute = Mathf.RoundToInt(ReadMinutes(matchManager)),
            serverUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        };

        TryCaptureStatsSnapshot(matchManager, ref payload);
        return payload;
    }

    private void TryCaptureStatsSnapshot(object matchManager, ref MatchEndPayload payload)
    {
        payload.hasStats = false;
        if (!includeStatsInEndPayload)
        {
            return;
        }

        object stats = GetStatisticsObject(matchManager);
        if (stats == null)
        {
            LogStats("[MatchEndReplicator] stats snapshot missing: Statistics object not found.");
            return;
        }

        payload.possession = ReadIntArray(stats, "TeamPositioning", "possesioning", "possessioning");
        payload.passes = ReadIntArray(stats, "Passes", "passing");
        payload.successfulPasses = ReadIntArray(stats, "SuccesfulPasses", "passing");
        payload.passingPercentage = ReadIntArray(stats, "PassingPercentage", "passing");
        payload.attempts = ReadIntArray(stats, "Attempts", "shooting");
        payload.attemptsOnTarget = ReadIntArray(stats, "AttemptsOnTarget", "shooting");
        payload.runningDistance = ReadFloatArray(stats, "TeamDistances", "runningDistance");
        payload.corners = ReadIntArray(stats, "CornerCount", "corners");
        payload.ballWinning = ReadIntArray(stats, "Winnings", "ballWinning");

        bool complete =
            HasLength(payload.possession, 2) &&
            HasLength(payload.passes, 2) &&
            HasLength(payload.successfulPasses, 2) &&
            HasLength(payload.passingPercentage, 2) &&
            HasLength(payload.attempts, 2) &&
            HasLength(payload.attemptsOnTarget, 2) &&
            HasLength(payload.runningDistance, 2) &&
            HasLength(payload.corners, 2) &&
            HasLength(payload.ballWinning, 2);

        payload.hasStats = complete;
        if (complete)
        {
            LogStats(
                $"[MatchEndReplicator] stats snapshot captured " +
                $"pos={payload.possession[0]}/{payload.possession[1]} " +
                $"att={payload.attempts[0]}/{payload.attempts[1]}"
            );
        }
        else
        {
            LogStats("[MatchEndReplicator] stats snapshot incomplete; payload will skip stats apply.");
        }
    }

    private void ApplyStatisticsSnapshotOnClient(object matchManager, MatchEndPayload payload)
    {
        if (!payload.hasStats)
        {
            LogStats("[MatchEndReplicator] stats snapshot missing in payload; skipping apply.");
            return;
        }

        object stats = GetStatisticsObject(matchManager);
        if (stats == null)
        {
            LogStats("[MatchEndReplicator] stats apply failed: Statistics object not found on client.");
            return;
        }

        bool applied = false;
        applied |= WriteIntArray(stats, payload.possession, 2, "TeamPositioning", "possesioning", "possessioning");
        applied |= WriteIntArray(stats, payload.passes, 2, "Passes", "passing");
        applied |= WriteIntArray(stats, payload.successfulPasses, 2, "SuccesfulPasses", "passing");
        applied |= WriteIntArray(stats, payload.passingPercentage, 2, "PassingPercentage", "passing");
        applied |= WriteIntArray(stats, payload.attempts, 2, "Attempts", "shooting");
        applied |= WriteIntArray(stats, payload.attemptsOnTarget, 2, "AttemptsOnTarget", "shooting");
        applied |= WriteFloatArray(stats, payload.runningDistance, 2, "TeamDistances", "runningDistance");
        applied |= WriteIntArray(stats, payload.corners, 2, "CornerCount", "corners");
        applied |= WriteIntArray(stats, payload.ballWinning, 2, "Winnings", "ballWinning");

        if (applied)
        {
            LogStats(
                $"[MatchEndReplicator] stats snapshot applied " +
                $"pos={payload.possession[0]}/{payload.possession[1]} " +
                $"att={payload.attempts[0]}/{payload.attempts[1]}"
            );
        }
        else
        {
            LogStats("[MatchEndReplicator] stats apply skipped: destination members unavailable.");
        }
    }

    private bool TryParsePayload(string json, out MatchEndPayload payload)
    {
        payload = default;
        try
        {
            payload = JsonUtility.FromJson<MatchEndPayload>(json);
            return true;
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"[MatchEndReplicator] payload parse failed: {ex.Message}");
            return false;
        }
    }

    private bool TryParseSetPiecePayload(string json, out SetPieceSyncPayload payload)
    {
        payload = default;
        try
        {
            payload = JsonUtility.FromJson<SetPieceSyncPayload>(json);
            return true;
        }
        catch (Exception ex)
        {
            if (debugSetPieceSync)
            {
                Debug.LogWarning($"[MatchEndReplicator] set-piece parse failed: {ex.Message}");
            }
            return false;
        }
    }

    private void AllowClientGuards()
    {
        var guards = FindObjectsOfType<ClientFinalWhistleGuard>(true);
        foreach (var guard in guards)
        {
            guard.SetAllowFinalWhistle(true);
        }
    }

    private void TriggerFinalWhistleEvents(object matchManager)
    {
        Type eventManagerType = ResolveAssemblyTypeBySimpleName("EventManager");
        if (eventManagerType == null)
        {
            return;
        }

        MethodInfo triggerMethod = eventManagerType
            .GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)
            .FirstOrDefault(m => m.Name == "Trigger" && m.IsGenericMethodDefinition && m.GetParameters().Length == 1);

        if (triggerMethod == null)
        {
            return;
        }

        Type whistleType = ResolveAssemblyTypeBySimpleName("RefereeLastWhistleEvent");
        if (whistleType != null)
        {
            object whistleEvent = CreateEventInstance(whistleType, Array.Empty<object>());
            if (whistleEvent != null)
            {
                triggerMethod.MakeGenericMethod(whistleType).Invoke(null, new[] { whistleEvent });
            }
        }

        Type finalType = ResolveAssemblyTypeBySimpleName("FinalWhistleEvent");
        if (finalType == null)
        {
            return;
        }

        object homeEntry = ResolveTeamEntry(matchManager, _gameTeam1Field);
        object awayEntry = ResolveTeamEntry(matchManager, _gameTeam2Field);
        object finalEventObj = CreateEventInstance(finalType, new[] { homeEntry, awayEntry });

        if (finalEventObj != null)
        {
            triggerMethod.MakeGenericMethod(finalType).Invoke(null, new[] { finalEventObj });
        }
    }

    private object CreateEventInstance(Type eventType, object[] ctorArgs)
    {
        try
        {
            if (ctorArgs != null)
            {
                ConstructorInfo[] ctors = eventType.GetConstructors(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                foreach (ConstructorInfo ctor in ctors)
                {
                    ParameterInfo[] ps = ctor.GetParameters();
                    if (ps.Length != ctorArgs.Length)
                    {
                        continue;
                    }

                    bool compatible = true;
                    for (int i = 0; i < ps.Length; i++)
                    {
                        object arg = ctorArgs[i];
                        if (arg == null && ps[i].ParameterType.IsValueType)
                        {
                            compatible = false;
                            break;
                        }

                        if (arg != null && !ps[i].ParameterType.IsAssignableFrom(arg.GetType()))
                        {
                            compatible = false;
                            break;
                        }
                    }

                    if (!compatible)
                    {
                        continue;
                    }

                    return ctor.Invoke(ctorArgs);
                }
            }

            return Activator.CreateInstance(eventType, true);
        }
        catch
        {
            return null;
        }
    }

    private void StopActors(object matchManager)
    {
        // Best-effort freeze: stop ball rigidbody and all non-kinematic scene rigidbodies.
        if (matchManager != null && _ballField != null)
        {
            object ball = _ballField.GetValue(matchManager);
            if (ball is Component ballComponent)
            {
                Rigidbody ballRb = ballComponent.GetComponent<Rigidbody>();
                if (ballRb != null)
                {
                    ballRb.velocity = Vector3.zero;
                    ballRb.angularVelocity = Vector3.zero;
                }
            }
        }

        Rigidbody[] rigidbodies = FindObjectsOfType<Rigidbody>(true);
        foreach (var rb in rigidbodies)
        {
            if (!rb.isKinematic)
            {
                rb.velocity = Vector3.zero;
                rb.angularVelocity = Vector3.zero;
            }
        }
    }

    private object GetMatchManagerInstance()
    {
        if (!EnsureReflectionCached())
        {
            return null;
        }

        object instance = _currentProperty?.GetValue(null);
        if (instance != null)
        {
            return instance;
        }

        return FindObjectOfType(_matchManagerType);
    }

    private bool EnsureReflectionCached()
    {
        if (_matchManagerType != null)
        {
            return true;
        }

        _matchManagerType = Type.GetType($"{MatchManagerTypeName}, {AssemblyCSharp}") ??
                            ResolveAssemblyTypeBySimpleName("MatchManager");
        if (_matchManagerType == null)
        {
            return false;
        }

        const BindingFlags staticFlags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.FlattenHierarchy;
        const BindingFlags instanceFlags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;

        _currentProperty = _matchManagerType.GetProperty("Current", staticFlags);
        _minutesProperty = _matchManagerType.GetProperty("minutes", instanceFlags) ??
                           _matchManagerType.GetProperty("Minutes", instanceFlags);
        _minutesField = _matchManagerType.GetField("m_minutes", instanceFlags) ??
                        _matchManagerType.GetField("minutes", instanceFlags);
        _matchFlagsField = _matchManagerType.GetField("MatchFlags", instanceFlags) ??
                           _matchManagerType.GetField("matchFlags", instanceFlags);
        _homeScoreField = _matchManagerType.GetField("homeTeamScore", instanceFlags);
        _awayScoreField = _matchManagerType.GetField("awayTeamScore", instanceFlags);
        _gameTeam1Field = _matchManagerType.GetField("GameTeam1", instanceFlags);
        _gameTeam2Field = _matchManagerType.GetField("GameTeam2", instanceFlags);
        _ballField = _matchManagerType.GetField("ball", instanceFlags);

        _statisticsProperty = _matchManagerType.GetProperty("Statistics", instanceFlags) ??
                              _matchManagerType.GetProperty("Statistics", staticFlags);
        _statisticsField = _matchManagerType.GetField("<Statistics>k__BackingField", instanceFlags) ??
                           _matchManagerType.GetField("<Statistics>k__BackingField", staticFlags) ??
                           _matchManagerType.GetField("U3CStatisticsU3Ek__BackingField", instanceFlags) ??
                           _matchManagerType.GetField("U3CStatisticsU3Ek__BackingField", staticFlags) ??
                           _matchManagerType.GetField("statistics", instanceFlags);

        return true;
    }

    private float ReadMinutes(object matchManager)
    {
        return TryReadMinutes(matchManager, out float minute) ? minute : defaultEndMinute;
    }

    private bool TryReadMinutes(object matchManager, out float minute)
    {
        minute = default;
        try
        {
            object val = _minutesProperty?.GetValue(matchManager) ?? _minutesField?.GetValue(matchManager);
            if (val == null)
            {
                return false;
            }

            minute = Convert.ToSingle(val);
            if (float.IsNaN(minute) || float.IsInfinity(minute))
            {
                return false;
            }

            if (minute < 0f || minute > 200f)
            {
                return false;
            }

            return true;
        }
        catch
        {
            return false;
        }
    }

    private void WriteMinutes(object matchManager, float value)
    {
        try
        {
            if (_minutesProperty != null && _minutesProperty.CanWrite)
            {
                _minutesProperty.SetValue(matchManager, value);
                return;
            }

            _minutesField?.SetValue(matchManager, value);
        }
        catch
        {
        }
    }

    private int ReadMatchFlags(object matchManager)
    {
        try
        {
            object val = _matchFlagsField?.GetValue(matchManager);
            return val == null ? 0 : Convert.ToInt32(val);
        }
        catch
        {
            return 0;
        }
    }

    private void WriteMatchFlags(object matchManager, int value)
    {
        if (_matchFlagsField == null)
        {
            return;
        }

        try
        {
            Type fieldType = _matchFlagsField.FieldType;
            object boxedValue = fieldType.IsEnum ? Enum.ToObject(fieldType, value) : Convert.ChangeType(value, fieldType);
            _matchFlagsField.SetValue(matchManager, boxedValue);
        }
        catch
        {
        }
    }

    private int ReadIntField(object owner, FieldInfo field)
    {
        try
        {
            object val = field?.GetValue(owner);
            return val == null ? 0 : Convert.ToInt32(val);
        }
        catch
        {
            return 0;
        }
    }

    private string ReadTeamId(object matchManager, FieldInfo teamField)
    {
        object teamEntry = ResolveTeamEntry(matchManager, teamField);
        if (teamEntry == null)
        {
            return string.Empty;
        }

        object uniqueId = GetMemberValue(teamEntry, "UniqueId");
        if (uniqueId != null)
        {
            return uniqueId.ToString();
        }

        object id = GetMemberValue(teamEntry, "id");
        return id?.ToString() ?? string.Empty;
    }

    private object ResolveTeamEntry(object matchManager, FieldInfo gameTeamField)
    {
        if (matchManager == null || gameTeamField == null)
        {
            return null;
        }

        object gameTeam = gameTeamField.GetValue(matchManager);
        if (gameTeam == null)
        {
            return null;
        }

        object matchTeam = GetMemberValue(gameTeam, "Team");
        if (matchTeam == null)
        {
            return null;
        }

        return GetMemberValue(matchTeam, "Team");
    }

    private object GetStatisticsObject(object matchManager)
    {
        try
        {
            if (_statisticsProperty != null)
            {
                object propertyOwner = _statisticsProperty.GetMethod != null && _statisticsProperty.GetMethod.IsStatic
                    ? null
                    : matchManager;
                object val = _statisticsProperty.GetValue(propertyOwner);
                if (val != null)
                {
                    return val;
                }
            }
        }
        catch
        {
        }

        try
        {
            if (_statisticsField != null)
            {
                object fieldOwner = _statisticsField.IsStatic ? null : matchManager;
                object val = _statisticsField.GetValue(fieldOwner);
                if (val != null)
                {
                    return val;
                }
            }
        }
        catch
        {
        }

        return null;
    }

    private SetPieceSyncPayload BuildSetPiecePayload(object matchManager)
    {
        int throwHolderPlayerId = -1;
        int cornerHolderPlayerId = -1;
        int goalKickHolderPlayerId = -1;

        List<object> players = CollectMatchPlayers(matchManager);
        for (int i = 0; i < players.Count; i++)
        {
            object player = players[i];
            int id = ReadPlayerId(player);
            if (id < 0)
            {
                continue;
            }

            if (throwHolderPlayerId < 0 && ReadBoolMember(player, "IsThrowHolder"))
            {
                throwHolderPlayerId = id;
            }

            if (cornerHolderPlayerId < 0 && ReadBoolMember(player, "IsCornerHolder"))
            {
                cornerHolderPlayerId = id;
            }

            if (goalKickHolderPlayerId < 0 && ReadBoolMember(player, "IsGoalKickHolder"))
            {
                goalKickHolderPlayerId = id;
            }
        }

        return new SetPieceSyncPayload
        {
            matchFlags = ReadMatchFlags(matchManager),
            throwHolderPlayerId = throwHolderPlayerId,
            cornerHolderPlayerId = cornerHolderPlayerId,
            goalKickHolderPlayerId = goalKickHolderPlayerId,
            serverUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        };
    }

    private List<object> CollectMatchPlayers(object matchManager)
    {
        var players = new List<object>(64);
        AppendTeamPlayers(matchManager, _gameTeam1Field, players);
        AppendTeamPlayers(matchManager, _gameTeam2Field, players);
        return players;
    }

    private void AppendTeamPlayers(object matchManager, FieldInfo teamField, List<object> outPlayers)
    {
        if (matchManager == null || teamField == null || outPlayers == null)
        {
            return;
        }

        object gameTeam = teamField.GetValue(matchManager);
        if (gameTeam == null)
        {
            return;
        }

        object gamePlayersObj = GetMemberValue(gameTeam, "GamePlayers");
        if (!(gamePlayersObj is IEnumerable enumerable))
        {
            return;
        }

        foreach (object player in enumerable)
        {
            if (player != null)
            {
                outPlayers.Add(player);
            }
        }
    }

    private int ReadPlayerId(object player)
    {
        if (player == null)
        {
            return -1;
        }

        try
        {
            object matchPlayer = GetMemberValue(player, "MatchPlayer");
            object playerEntry = matchPlayer != null ? GetMemberValue(matchPlayer, "Player") : null;
            object idObj = playerEntry != null
                ? (GetMemberValue(playerEntry, "id") ?? GetMemberValue(playerEntry, "Id"))
                : null;

            if (idObj == null && matchPlayer != null)
            {
                idObj = GetMemberValue(matchPlayer, "Id");
            }

            if (idObj == null)
            {
                return -1;
            }

            return Convert.ToInt32(idObj);
        }
        catch
        {
            return -1;
        }
    }

    private bool ReadBoolMember(object owner, string memberName)
    {
        try
        {
            object val = GetMemberValue(owner, memberName);
            return val != null && Convert.ToBoolean(val);
        }
        catch
        {
            return false;
        }
    }

    private void SetHolderFlags(object player, bool isThrowHolder, bool isCornerHolder, bool isGoalKickHolder)
    {
        SetMemberValue(player, "IsThrowHolder", isThrowHolder);
        SetMemberValue(player, "IsCornerHolder", isCornerHolder);
        SetMemberValue(player, "IsGoalKickHolder", isGoalKickHolder);
    }

    private void SetThrowHolderAnimator(object player, bool isThrowHolder)
    {
        if (throwHolderAnimatorBool < 0 || player == null)
        {
            return;
        }

        try
        {
            object playerController = GetMemberValue(player, "PlayerController");
            if (playerController == null)
            {
                return;
            }

            object animatorOwner = GetMemberValue(playerController, "Animator") ?? playerController;
            if (animatorOwner == null)
            {
                return;
            }

            MethodInfo setBoolMethod = animatorOwner.GetType().GetMethod(
                "SetBool",
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance,
                null,
                new[] { typeof(int), typeof(bool) },
                null
            );

            setBoolMethod?.Invoke(animatorOwner, new object[] { throwHolderAnimatorBool, isThrowHolder });
        }
        catch
        {
        }
    }

    private int[] ReadIntArray(object root, string memberName, params string[] moduleNames)
    {
        object owner = ResolveModuleOrRoot(root, moduleNames);
        if (owner == null)
        {
            return null;
        }

        object value = GetMemberValue(owner, memberName);
        if (!(value is Array array))
        {
            return null;
        }

        var copy = new int[array.Length];
        for (int i = 0; i < array.Length; i++)
        {
            try
            {
                copy[i] = Convert.ToInt32(array.GetValue(i));
            }
            catch
            {
                copy[i] = 0;
            }
        }

        return copy;
    }

    private float[] ReadFloatArray(object root, string memberName, params string[] moduleNames)
    {
        object owner = ResolveModuleOrRoot(root, moduleNames);
        if (owner == null)
        {
            return null;
        }

        object value = GetMemberValue(owner, memberName);
        if (!(value is Array array))
        {
            return null;
        }

        var copy = new float[array.Length];
        for (int i = 0; i < array.Length; i++)
        {
            try
            {
                copy[i] = Convert.ToSingle(array.GetValue(i));
            }
            catch
            {
                copy[i] = 0f;
            }
        }

        return copy;
    }

    private bool WriteIntArray(object root, int[] values, int minLen, string memberName, params string[] moduleNames)
    {
        if (!HasLength(values, minLen))
        {
            return false;
        }

        object owner = ResolveModuleOrRoot(root, moduleNames);
        return WriteArrayMember(owner, memberName, values);
    }

    private bool WriteFloatArray(object root, float[] values, int minLen, string memberName, params string[] moduleNames)
    {
        if (!HasLength(values, minLen))
        {
            return false;
        }

        object owner = ResolveModuleOrRoot(root, moduleNames);
        return WriteArrayMember(owner, memberName, values);
    }

    private object ResolveModuleOrRoot(object root, params string[] moduleNames)
    {
        if (root == null)
        {
            return null;
        }

        object module = GetNestedModule(root, moduleNames);
        return module ?? root;
    }

    private bool WriteArrayMember(object owner, string memberName, Array source)
    {
        if (owner == null || source == null)
        {
            return false;
        }

        const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
        Type t = owner.GetType();
        PropertyInfo p = t.GetProperty(memberName, flags);
        if (p != null)
        {
            object current = null;
            try
            {
                current = p.GetValue(owner);
            }
            catch
            {
            }

            if (current is Array currentArray)
            {
                CopyArrayValues(source, currentArray);
                return true;
            }

            if (p.CanWrite)
            {
                Array converted = CloneArrayForType(source, p.PropertyType);
                p.SetValue(owner, converted);
                return true;
            }

            return false;
        }

        FieldInfo f = t.GetField(memberName, flags);
        if (f == null)
        {
            return false;
        }

        object fieldVal = f.GetValue(owner);
        if (fieldVal is Array fieldArray)
        {
            CopyArrayValues(source, fieldArray);
            return true;
        }

        Array cloned = CloneArrayForType(source, f.FieldType);
        f.SetValue(owner, cloned);
        return true;
    }

    private static void CopyArrayValues(Array source, Array destination)
    {
        if (source == null || destination == null)
        {
            return;
        }

        int count = Mathf.Min(source.Length, destination.Length);
        Type elementType = destination.GetType().GetElementType() ?? typeof(object);
        for (int i = 0; i < count; i++)
        {
            try
            {
                object src = source.GetValue(i);
                object converted = ConvertValueForType(src, elementType);
                destination.SetValue(converted, i);
            }
            catch
            {
            }
        }
    }

    private static Array CloneArrayForType(Array source, Type arrayType)
    {
        if (source == null)
        {
            return null;
        }

        Type elementType = arrayType != null && arrayType.IsArray
            ? (arrayType.GetElementType() ?? typeof(object))
            : (source.GetType().GetElementType() ?? typeof(object));

        Array clone = Array.CreateInstance(elementType, source.Length);
        CopyArrayValues(source, clone);
        return clone;
    }

    private static object ConvertValueForType(object value, Type targetType)
    {
        if (targetType == null)
        {
            return value;
        }

        if (value == null)
        {
            return targetType.IsValueType ? Activator.CreateInstance(targetType) : null;
        }

        Type srcType = value.GetType();
        if (targetType.IsAssignableFrom(srcType))
        {
            return value;
        }

        if (targetType.IsEnum)
        {
            return Enum.ToObject(targetType, value);
        }

        return Convert.ChangeType(value, targetType);
    }

    private static bool HasLength(Array array, int minLen)
    {
        return array != null && array.Length >= minLen;
    }

    private static bool IsReplicableSetPieceFlag(int flags)
    {
        return flags == 0 || flags == 1 || flags == 2 || flags == 4 || flags == 8;
    }

    private static string BuildSetPieceSignature(SetPieceSyncPayload payload)
    {
        return $"{payload.matchFlags}|{payload.throwHolderPlayerId}|{payload.cornerHolderPlayerId}|{payload.goalKickHolderPlayerId}";
    }

    private object GetNestedModule(object root, params string[] moduleNames)
    {
        if (root == null || moduleNames == null)
        {
            return null;
        }

        for (int i = 0; i < moduleNames.Length; i++)
        {
            string name = moduleNames[i];
            if (string.IsNullOrWhiteSpace(name))
            {
                continue;
            }

            object module = GetMemberValue(root, name);
            if (module != null)
            {
                return module;
            }
        }

        return null;
    }

    private bool SetMemberValue(object owner, string memberName, object value)
    {
        if (owner == null)
        {
            return false;
        }

        const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
        Type t = owner.GetType();

        PropertyInfo p = t.GetProperty(memberName, flags);
        if (p != null && p.CanWrite)
        {
            try
            {
                object converted = ConvertValueForType(value, p.PropertyType);
                p.SetValue(owner, converted);
                return true;
            }
            catch
            {
                return false;
            }
        }

        FieldInfo f = t.GetField(memberName, flags);
        if (f != null)
        {
            try
            {
                object converted = ConvertValueForType(value, f.FieldType);
                f.SetValue(owner, converted);
                return true;
            }
            catch
            {
                return false;
            }
        }

        return false;
    }

    private object GetMemberValue(object owner, string memberName)
    {
        if (owner == null)
        {
            return null;
        }

        const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
        Type t = owner.GetType();

        PropertyInfo p = t.GetProperty(memberName, flags);
        if (p != null)
        {
            return p.GetValue(owner);
        }

        FieldInfo f = t.GetField(memberName, flags);
        if (f != null)
        {
            return f.GetValue(owner);
        }

        return null;
    }

    private static Type ResolveAssemblyTypeBySimpleName(string simpleName)
    {
        try
        {
            Assembly asm = AppDomain.CurrentDomain
                .GetAssemblies()
                .FirstOrDefault(a => string.Equals(a.GetName().Name, AssemblyCSharp, StringComparison.Ordinal));

            if (asm == null)
            {
                return null;
            }

            return asm.GetTypes().FirstOrDefault(t => string.Equals(t.Name, simpleName, StringComparison.Ordinal));
        }
        catch
        {
            return null;
        }
    }

    private void LogObservation(string message)
    {
        if (!debugEndObservation)
        {
            return;
        }

        if (Time.frameCount - _lastObservationLogFrame < 10)
        {
            return;
        }

        _lastObservationLogFrame = Time.frameCount;
        Debug.Log(message);
    }

    private void LogSetPiece(string message)
    {
        if (!debugSetPieceSync)
        {
            return;
        }

        if (Time.frameCount - _lastSetPieceLogFrame < 10)
        {
            return;
        }

        _lastSetPieceLogFrame = Time.frameCount;
        Debug.Log(message);
    }

    private void LogStats(string message)
    {
        if (!debugStatsSync)
        {
            return;
        }

        if (Time.frameCount - _lastStatsLogFrame < 10)
        {
            return;
        }

        _lastStatsLogFrame = Time.frameCount;
        Debug.Log(message);
    }
}
