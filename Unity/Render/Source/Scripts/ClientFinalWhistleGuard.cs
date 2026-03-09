using System;
using System.Reflection;
using UnityEngine;

[DisallowMultipleComponent]
public class ClientFinalWhistleGuard : MonoBehaviour
{
    [Header("Mode")]
    [SerializeField] private bool clientMode = true;
    [SerializeField] private bool onlyPureClient = true;
    [SerializeField] private bool blockLocalFinalWhistle = true;
    [SerializeField] private bool allowFinalWhistleFromServer = false;

    [Header("Match Flags")]
    [SerializeField] private int playingFlagValue = 4;
    [SerializeField] private int finishedFlagBit = 16;

    [Header("Minute Clamp")]
    [SerializeField] private float maxMinuteWhileBlocked = 89.95f;

    [Header("Final UI Safety")]
    [SerializeField] private float minMinuteForClientFinalUi = 89.5f;
    [SerializeField] private bool suppressEarlyFinalUi = true;
    [SerializeField] private bool debugEarlySuppression = true;
    [SerializeField] private bool respectServerAllowOnlyAfterMinMinute = true;

    [Header("Optional UI roots to hide on forced resume")]
    [SerializeField] private string[] uiRootsToHide = { "FinalWhistlePanel", "MatchCompletedPanel" };

    private const string MatchManagerTypeName = "FStudio.MatchEngine.MatchManager, Assembly-CSharp";

    private Type _matchManagerType;
    private PropertyInfo _currentProperty;
    private PropertyInfo _minutesProperty;
    private FieldInfo _minutesField;
    private FieldInfo _matchFlagsField;
    private int _lastRecoveryFrame = -1000;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void EnsureRuntimeGuard()
    {
        ClientFinalWhistleGuard existing = FindObjectOfType<ClientFinalWhistleGuard>(true);
        if (existing != null)
        {
            return;
        }

        var go = new GameObject("__ClientFinalWhistleGuard_Auto");
        DontDestroyOnLoad(go);
        go.AddComponent<ClientFinalWhistleGuard>();
    }

    public void AllowFinalWhistleNow()
    {
        allowFinalWhistleFromServer = true;
    }

    public void SetAllowFinalWhistle(bool allow)
    {
        allowFinalWhistleFromServer = allow;
    }

    private void Update()
    {
        if (!clientMode || !blockLocalFinalWhistle)
        {
            return;
        }

        if (onlyPureClient && !IsPureClient())
        {
            return;
        }

        object matchManager = GetMatchManagerInstance();
        if (matchManager == null)
        {
            return;
        }

        float minute = ReadMinutes(matchManager);
        bool belowFinalMinute = minute < minMinuteForClientFinalUi;

        if (allowFinalWhistleFromServer &&
            (!respectServerAllowOnlyAfterMinMinute || !belowFinalMinute))
        {
            return;
        }

        if (belowFinalMinute && minute >= maxMinuteWhileBlocked)
        {
            WriteMinutes(matchManager, maxMinuteWhileBlocked);
        }

        int flags = ReadMatchFlags(matchManager);
        bool matchEndedLocally = (flags & finishedFlagBit) != 0;
        bool earlyFinalUiVisible = suppressEarlyFinalUi &&
                                   minute < minMinuteForClientFinalUi &&
                                   IsAnyFinalUiVisible();

        // If we're already in valid final-minute region and server did not explicitly allow yet,
        // do not force-reset legitimate end states.
        if (matchEndedLocally && !belowFinalMinute && !earlyFinalUiVisible)
        {
            return;
        }

        if (!matchEndedLocally && !earlyFinalUiVisible)
        {
            return;
        }

        WriteMatchFlags(matchManager, playingFlagValue);
        if (belowFinalMinute)
        {
            WriteMinutes(matchManager, Mathf.Min(ReadMinutes(matchManager), maxMinuteWhileBlocked));
        }
        HideFinalUi();

        // Avoid log spam while still signaling that we corrected an early local final whistle.
        if (Time.frameCount - _lastRecoveryFrame > 30)
        {
#if UNITY_EDITOR || DEVELOPMENT_BUILD
            if (debugEarlySuppression)
            {
                string serverAllowSuffix = allowFinalWhistleFromServer
                    ? " (server allow ignored: early minute gate)"
                    : string.Empty;
                string reason = matchEndedLocally && earlyFinalUiVisible
                    ? "flags+ui"
                    : (matchEndedLocally ? "flags" : "ui");
                Debug.LogWarning(
                    "[ClientFinalWhistleGuard] Local final whistle blocked " +
                    $"({reason}). minute={minute:0.00} threshold={minMinuteForClientFinalUi:0.00}. " +
                    $"Waiting for server-authoritative match end.{serverAllowSuffix}"
                );
            }
#endif
            _lastRecoveryFrame = Time.frameCount;
        }
    }

    private bool IsPureClient()
    {
        try
        {
            Type networkServerType = Type.GetType("Mirror.NetworkServer, Mirror");
            Type networkClientType = Type.GetType("Mirror.NetworkClient, Mirror");

            bool serverActive = ReadStaticBool(networkServerType, "active");
            bool clientActive = ReadStaticBool(networkClientType, "active");
            return clientActive && !serverActive;
        }
        catch
        {
            return true;
        }
    }

    private static bool ReadStaticBool(Type t, string memberName)
    {
        if (t == null || string.IsNullOrWhiteSpace(memberName))
        {
            return false;
        }

        const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static;
        PropertyInfo p = t.GetProperty(memberName, flags);
        if (p != null)
        {
            object val = p.GetValue(null);
            return val != null && Convert.ToBoolean(val);
        }

        FieldInfo f = t.GetField(memberName, flags);
        if (f != null)
        {
            object val = f.GetValue(null);
            return val != null && Convert.ToBoolean(val);
        }

        return false;
    }

    private object GetMatchManagerInstance()
    {
        if (!EnsureReflectionCached())
        {
            return null;
        }

        object instance = null;
        if (_currentProperty != null)
        {
            instance = _currentProperty.GetValue(null);
        }

        if (instance != null)
        {
            return instance;
        }

        // Fallback path if static Current is unavailable.
        return UnityEngine.Object.FindObjectOfType(_matchManagerType);
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
        _matchFlagsField = _matchManagerType.GetField("MatchFlags", instanceFlags) ??
                           _matchManagerType.GetField("matchFlags", instanceFlags);

        return true;
    }

    private float ReadMinutes(object matchManager)
    {
        try
        {
            if (_minutesProperty != null)
            {
                object value = _minutesProperty.GetValue(matchManager);
                if (value != null) return Convert.ToSingle(value);
            }

            if (_minutesField != null)
            {
                object value = _minutesField.GetValue(matchManager);
                if (value != null) return Convert.ToSingle(value);
            }
        }
        catch
        {
            // Guard script should fail silently rather than break the match loop.
        }

        return 0f;
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

            if (_minutesField != null)
            {
                _minutesField.SetValue(matchManager, value);
            }
        }
        catch
        {
        }
    }

    private int ReadMatchFlags(object matchManager)
    {
        try
        {
            if (_matchFlagsField != null)
            {
                object value = _matchFlagsField.GetValue(matchManager);
                if (value != null) return Convert.ToInt32(value);
            }
        }
        catch
        {
        }

        return 0;
    }

    private void WriteMatchFlags(object matchManager, int value)
    {
        try
        {
            if (_matchFlagsField != null)
            {
                Type fieldType = _matchFlagsField.FieldType;
                object boxedValue = fieldType.IsEnum
                    ? Enum.ToObject(fieldType, value)
                    : Convert.ChangeType(value, fieldType);
                _matchFlagsField.SetValue(matchManager, boxedValue);
            }
        }
        catch
        {
        }
    }

    private void HideFinalUi()
    {
        if (uiRootsToHide == null)
        {
            return;
        }

        for (int i = 0; i < uiRootsToHide.Length; i++)
        {
            string rootName = uiRootsToHide[i];
            if (string.IsNullOrWhiteSpace(rootName))
            {
                continue;
            }

            GameObject go = GameObject.Find(rootName);
            if (go != null && go.activeSelf)
            {
                go.SetActive(false);
            }
        }
    }

    private bool IsAnyFinalUiVisible()
    {
        if (uiRootsToHide == null)
        {
            return false;
        }

        for (int i = 0; i < uiRootsToHide.Length; i++)
        {
            string rootName = uiRootsToHide[i];
            if (string.IsNullOrWhiteSpace(rootName))
            {
                continue;
            }

            GameObject go = GameObject.Find(rootName);
            if (go != null && go.activeInHierarchy)
            {
                return true;
            }
        }

        return false;
    }
}
