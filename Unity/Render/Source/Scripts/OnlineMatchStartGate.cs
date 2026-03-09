using System;
using System.Collections;
using System.Reflection;
using System.Threading.Tasks;
using UnityEngine;

[DisallowMultipleComponent]
public class OnlineMatchStartGate : MonoBehaviour
{
    [Header("Gate")]
    [SerializeField] private bool enableGate = true;
    [SerializeField] private bool gateWhenHost = true;
    [SerializeField] private int minRemoteClientsToStart = 1;
    [SerializeField] private float holdMinute = 0f;
    [SerializeField] private float failSafeReleaseSeconds = 180f;
    [SerializeField] private bool debugGateLogs = true;

    [Header("Dedicated Server Fallback")]
    [SerializeField] private bool forceStartEngineOnDedicatedServer = true;
    [SerializeField] private float dedicatedStartAfterSeconds = 3f;
    [SerializeField] private float dedicatedStartRetrySeconds = 2f;
    [SerializeField] private string dedicatedServerRoleValue = "server";

    private const string MatchManagerTypeName = "FStudio.MatchEngine.MatchManager, Assembly-CSharp";
    private const string MatchNetworkManagerTypeName = "FStudio.Networking.MatchNetworkManager, Assembly-CSharp";
    private const string MirrorNetworkManagerType = "Mirror.NetworkManager, Mirror";
    private const string MirrorServerType = "Mirror.NetworkServer, Mirror";
    private const string MirrorClientType = "Mirror.NetworkClient, Mirror";

    private Type _matchManagerType;
    private PropertyInfo _currentProperty;
    private PropertyInfo _minutesProperty;
    private FieldInfo _minutesField;
    private MethodInfo _startMatchEngineMethod;
    private MethodInfo _beginNetworkMatchMethod;
    private Type _networkManagerType;
    private MethodInfo _ensureDedicatedStartMethod;
    private float _serverActivatedAt = -1f;
    private float _nextDedicatedStartAttemptAt = 0f;
    private int _lastLogFrame = -1000;
    private bool _hasReleased;
    private bool _dedicatedStartCompleted;
    private bool _loggedGateContext;

    private void Awake()
    {
        // Force dedicated fallback on runtime even if a scene instance overrides serialized defaults.
        if (Application.isBatchMode)
        {
            enableGate = true;
            debugGateLogs = true;
            forceStartEngineOnDedicatedServer = true;
            // Dedicated league simulation runs without remote gameplay clients.
            minRemoteClientsToStart = 0;
            dedicatedStartAfterSeconds = Mathf.Max(0.5f, dedicatedStartAfterSeconds);
            dedicatedStartRetrySeconds = Mathf.Max(0.25f, dedicatedStartRetrySeconds);
        }
    }

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void EnsureRuntimeGate()
    {
        OnlineMatchStartGate existing = FindObjectOfType<OnlineMatchStartGate>(true);
        if (existing != null)
        {
            return;
        }

        var go = new GameObject("__OnlineMatchStartGate_Auto");
        DontDestroyOnLoad(go);
        go.AddComponent<OnlineMatchStartGate>();
    }

    private void Update()
    {
        if (!enableGate)
        {
            return;
        }

        if (_dedicatedStartCompleted && _hasReleased)
        {
            return;
        }

        bool serverActive = ReadNetworkActive(MirrorServerType);
        if (!serverActive)
        {
            _serverActivatedAt = -1f;
            _nextDedicatedStartAttemptAt = 0f;
            _hasReleased = false;
            _dedicatedStartCompleted = false;
            _loggedGateContext = false;
            return;
        }

        bool clientActive = ReadNetworkActive(MirrorClientType);
        if (!gateWhenHost && clientActive)
        {
            return;
        }

        if (_serverActivatedAt < 0f)
        {
            _serverActivatedAt = Time.unscaledTime;
        }

        int remoteClients = GetRemoteClientCount();
        int requiredRemoteClients = Mathf.Max(0, minRemoteClientsToStart);
        if (Application.isBatchMode && !clientActive)
        {
            requiredRemoteClients = 0;
        }

        float elapsed = Time.unscaledTime - _serverActivatedAt;

        if (requiredRemoteClients <= 0)
        {
            if (!_hasReleased)
            {
                Log(
                    "[OnlineMatchStartGate] dedicated batch mode detected; " +
                    "bypassing remote client gate."
                );
                _hasReleased = true;
            }

            object dedicatedManager = GetMatchManagerInstance();
            if (dedicatedManager == null)
            {
                TryRequestDedicatedServerBootstrap(clientActive, remoteClients, elapsed);
            }
            else
            {
                TryForceDedicatedServerStart(
                    dedicatedManager,
                    clientActive,
                    remoteClients,
                    elapsed
                );
            }
            return;
        }

        if (remoteClients >= requiredRemoteClients)
        {
            if (!_hasReleased)
            {
                Log($"[OnlineMatchStartGate] released; remoteClients={remoteClients}.");
                _hasReleased = true;
            }
            return;
        }

        if (!_loggedGateContext)
        {
            _loggedGateContext = true;
            Log(
                "[OnlineMatchStartGate] active " +
                $"batch={Application.isBatchMode} role={ReadMatchRole()} " +
                $"gateWhenHost={gateWhenHost} minRemoteClientsToStart={minRemoteClientsToStart}"
            );
        }

        if (failSafeReleaseSeconds > 0f && elapsed >= failSafeReleaseSeconds)
        {
            if (!_hasReleased)
            {
                Log(
                    $"[OnlineMatchStartGate] fail-safe release after {elapsed:0.0}s " +
                    $"without remote client."
                );
                _hasReleased = true;
            }
            return;
        }

        object matchManager = GetMatchManagerInstance();
        if (matchManager == null)
        {
            TryRequestDedicatedServerBootstrap(clientActive, remoteClients, elapsed);
            return;
        }

        if (
            TryForceDedicatedServerStart(matchManager, clientActive, remoteClients, elapsed)
        )
        {
            if (!_hasReleased)
            {
                Log("[OnlineMatchStartGate] dedicated server auto-start fallback released gate.");
                _hasReleased = true;
            }
            return;
        }

        if (TryReadMinutes(matchManager, out float minute) && minute > holdMinute)
        {
            WriteMinutes(matchManager, holdMinute);
        }

        Log(
            $"[OnlineMatchStartGate] holding kickoff minute={minute:0.00} " +
            $"remoteClients={remoteClients} elapsed={elapsed:0.0}s"
        );
    }

    private object GetMatchManagerInstance()
    {
        if (!EnsureReflectionCached())
        {
            return null;
        }

        object instance = null;
        try
        {
            instance = _currentProperty?.GetValue(null);
        }
        catch
        {
        }

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

        _matchManagerType = Type.GetType(MatchManagerTypeName);
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
        _beginNetworkMatchMethod =
            _matchManagerType.GetMethod("BeginNetworkMatch", instanceFlags);
        _startMatchEngineMethod =
            _matchManagerType.GetMethod("StartMatchEngine", instanceFlags) ??
            _matchManagerType.GetMethod("CreateMatch", instanceFlags);
        return true;
    }

    private bool TryForceDedicatedServerStart(
        object matchManager,
        bool clientActive,
        int remoteClients,
        float elapsed
    )
    {
        if (!forceStartEngineOnDedicatedServer)
        {
            return false;
        }

        if (_dedicatedStartCompleted)
        {
            return true;
        }

        if (!Application.isBatchMode)
        {
            return false;
        }

        if (clientActive)
        {
            return false;
        }

        if (remoteClients > 0)
        {
            return false;
        }

        string role = ReadMatchRole();
        if (!string.Equals(role, dedicatedServerRoleValue, StringComparison.OrdinalIgnoreCase))
        {
            Log(
                "[OnlineMatchStartGate] role mismatch ignored for dedicated start fallback. " +
                $"role={role} expected={dedicatedServerRoleValue}"
            );
        }

        if (elapsed < Mathf.Max(0.1f, dedicatedStartAfterSeconds))
        {
            return false;
        }

        if (Time.unscaledTime < _nextDedicatedStartAttemptAt)
        {
            return false;
        }

        _nextDedicatedStartAttemptAt =
            Time.unscaledTime + Mathf.Max(0.25f, dedicatedStartRetrySeconds);

        if (
            _beginNetworkMatchMethod != null &&
            _beginNetworkMatchMethod.GetParameters().Length == 0
        )
        {
            try
            {
                _beginNetworkMatchMethod.Invoke(matchManager, null);
                _dedicatedStartCompleted = true;
                Log(
                    "[OnlineMatchStartGate] forced dedicated BeginNetworkMatch invocation succeeded. " +
                    $"elapsed={elapsed:0.0}s"
                );
                return true;
            }
            catch (Exception ex)
            {
                Log(
                    "[OnlineMatchStartGate] dedicated BeginNetworkMatch invocation failed. " +
                    $"elapsed={elapsed:0.0}s error={ex.GetType().Name}:{ex.Message}"
                );
            }
        }

        if (_startMatchEngineMethod == null)
        {
            Log("[OnlineMatchStartGate] StartMatchEngine method not found on MatchManager.");
            TryRequestDedicatedServerBootstrap(clientActive, remoteClients, elapsed);
            return false;
        }

        try
        {
            ParameterInfo[] parameters = _startMatchEngineMethod.GetParameters();
            if (parameters.Length == 0)
            {
                _startMatchEngineMethod.Invoke(matchManager, null);
            }
            else if (parameters.Length == 1 && parameters[0].ParameterType == typeof(bool))
            {
                _startMatchEngineMethod.Invoke(matchManager, new object[] { true });
            }
            else
            {
                Log(
                    "[OnlineMatchStartGate] unsupported StartMatchEngine signature. " +
                    $"paramCount={parameters.Length}"
                );
                return false;
            }

            _dedicatedStartCompleted = true;
            Log(
                "[OnlineMatchStartGate] forced dedicated StartMatchEngine invocation succeeded. " +
                $"elapsed={elapsed:0.0}s"
            );
            return true;
        }
        catch (Exception ex)
        {
            Log(
                "[OnlineMatchStartGate] dedicated StartMatchEngine invocation failed. " +
                $"elapsed={elapsed:0.0}s error={ex.GetType().Name}:{ex.Message}"
            );
            TryRequestDedicatedServerBootstrap(clientActive, remoteClients, elapsed);
            return false;
        }
    }

    private bool TryRequestDedicatedServerBootstrap(
        bool clientActive,
        int remoteClients,
        float elapsed
    )
    {
        if (!forceStartEngineOnDedicatedServer || _dedicatedStartCompleted)
        {
            return false;
        }

        if (!Application.isBatchMode || clientActive || remoteClients > 0)
        {
            return false;
        }

        string role = ReadMatchRole();
        if (!string.Equals(role, dedicatedServerRoleValue, StringComparison.OrdinalIgnoreCase))
        {
            Log(
                "[OnlineMatchStartGate] role mismatch ignored for dedicated bootstrap fallback. " +
                $"role={role} expected={dedicatedServerRoleValue}"
            );
        }

        if (elapsed < Mathf.Max(0.1f, dedicatedStartAfterSeconds))
        {
            return false;
        }

        if (Time.unscaledTime < _nextDedicatedStartAttemptAt)
        {
            return false;
        }

        _nextDedicatedStartAttemptAt =
            Time.unscaledTime + Mathf.Max(0.25f, dedicatedStartRetrySeconds);

        if (!EnsureNetworkBootstrapCached())
        {
            Log("[OnlineMatchStartGate] MatchNetworkManager bootstrap method not found.");
            return false;
        }

        try
        {
            const BindingFlags staticFlags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.FlattenHierarchy;
            Type mirrorNetworkManager = Type.GetType(MirrorNetworkManagerType);
            object singleton = mirrorNetworkManager?.GetProperty("singleton", staticFlags)?.GetValue(null);
            if (singleton == null)
            {
                Log("[OnlineMatchStartGate] NetworkManager.singleton not ready for dedicated bootstrap.");
                return false;
            }

            object taskObj = _ensureDedicatedStartMethod.Invoke(singleton, null);
            if (taskObj is Task task)
            {
                _ = ObserveBootstrapTask(task);
            }

            Log(
                "[OnlineMatchStartGate] requested dedicated network bootstrap. " +
                $"elapsed={elapsed:0.0}s"
            );
            return true;
        }
        catch (Exception ex)
        {
            Log(
                "[OnlineMatchStartGate] dedicated network bootstrap invoke failed. " +
                $"elapsed={elapsed:0.0}s error={ex.GetType().Name}:{ex.Message}"
            );
            return false;
        }
    }

    private bool EnsureNetworkBootstrapCached()
    {
        if (_ensureDedicatedStartMethod != null)
        {
            return true;
        }

        const BindingFlags instanceFlags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
        _networkManagerType = Type.GetType(MatchNetworkManagerTypeName);
        if (_networkManagerType == null)
        {
            return false;
        }

        _ensureDedicatedStartMethod = _networkManagerType.GetMethod(
            "EnsureDedicatedServerMatchEngineStartedAsync",
            instanceFlags
        );
        return _ensureDedicatedStartMethod != null;
    }

    private async Task ObserveBootstrapTask(Task task)
    {
        try
        {
            await task;
            Log("[OnlineMatchStartGate] dedicated network bootstrap task completed.");
        }
        catch (Exception ex)
        {
            Log(
                "[OnlineMatchStartGate] dedicated network bootstrap task failed. " +
                $"error={ex.GetType().Name}:{ex.Message}"
            );
        }
    }

    private static string ReadMatchRole()
    {
        return (
            Environment.GetEnvironmentVariable("UNITY_MATCH_ROLE") ??
            Environment.GetEnvironmentVariable("MATCH_ROLE") ??
            string.Empty
        ).Trim().ToLowerInvariant();
    }

    private bool TryReadMinutes(object matchManager, out float minute)
    {
        minute = 0f;
        if (matchManager == null)
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
            return !float.IsNaN(minute) && !float.IsInfinity(minute);
        }
        catch
        {
            return false;
        }
    }

    private void WriteMinutes(object matchManager, float minute)
    {
        try
        {
            if (_minutesProperty != null && _minutesProperty.CanWrite)
            {
                _minutesProperty.SetValue(matchManager, minute);
                return;
            }

            _minutesField?.SetValue(matchManager, minute);
        }
        catch
        {
        }
    }

    private static bool ReadNetworkActive(string typeName)
    {
        Type t = Type.GetType(typeName);
        if (t == null)
        {
            return false;
        }

        const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;
        try
        {
            PropertyInfo p = t.GetProperty("active", flags);
            if (p != null)
            {
                object val = p.GetValue(null);
                return val != null && Convert.ToBoolean(val);
            }

            FieldInfo f = t.GetField("active", flags);
            if (f != null)
            {
                object val = f.GetValue(null);
                return val != null && Convert.ToBoolean(val);
            }
        }
        catch
        {
        }

        return false;
    }

    private int GetRemoteClientCount()
    {
        try
        {
            Type networkServerType = Type.GetType(MirrorServerType);
            if (networkServerType == null)
            {
                return 0;
            }

            const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;
            object connectionsObj =
                networkServerType.GetProperty("connections", flags)?.GetValue(null) ??
                networkServerType.GetField("connections", flags)?.GetValue(null);

            if (!(connectionsObj is IDictionary dict))
            {
                return 0;
            }

            int count = 0;
            foreach (DictionaryEntry pair in dict)
            {
                object conn = pair.Value;
                if (conn == null)
                {
                    continue;
                }

                bool isAuthenticated = ReadInstanceBool(conn, "isAuthenticated", defaultValue: true);
                bool isLocal = conn.GetType().Name.IndexOf("LocalConnection", StringComparison.OrdinalIgnoreCase) >= 0 ||
                               ReadInstanceBool(conn, "isLocalClient", defaultValue: false);
                if (isAuthenticated && !isLocal)
                {
                    count++;
                }
            }

            return count;
        }
        catch
        {
            return 0;
        }
    }

    private static bool ReadInstanceBool(object instance, string memberName, bool defaultValue)
    {
        if (instance == null || string.IsNullOrWhiteSpace(memberName))
        {
            return defaultValue;
        }

        try
        {
            const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance;
            Type t = instance.GetType();
            PropertyInfo p = t.GetProperty(memberName, flags);
            if (p != null)
            {
                object val = p.GetValue(instance);
                return val != null ? Convert.ToBoolean(val) : defaultValue;
            }

            FieldInfo f = t.GetField(memberName, flags);
            if (f != null)
            {
                object val = f.GetValue(instance);
                return val != null ? Convert.ToBoolean(val) : defaultValue;
            }
        }
        catch
        {
        }

        return defaultValue;
    }

    private void Log(string message)
    {
        if (!debugGateLogs)
        {
            return;
        }

        if (Time.frameCount - _lastLogFrame < 30)
        {
            return;
        }

        _lastLogFrame = Time.frameCount;
        Debug.Log(message);
    }
}
