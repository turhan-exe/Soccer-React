using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using UnityEngine;

public class MatchRecorder : MonoBehaviour
{
    private const string MatchManagerTypeName = "FStudio.MatchEngine.MatchManager";
    private const string AssemblyCSharp = "Assembly-CSharp";

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
    private static Type _matchManagerType;
    private static PropertyInfo _matchManagerCurrentProperty;
    private static PropertyInfo _matchManagerStatisticsProperty;
    private static PropertyInfo _summaryEventsProperty;
    private static FieldInfo _homeScoreField;
    private static FieldInfo _awayScoreField;

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
                events = _events,
                stats = new MatchSummaryStats()
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
        SyncSummaryFromMatchManager();
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

    private void SyncSummaryFromMatchManager()
    {
        if (_payload?.summary == null)
        {
            return;
        }

        var matchManager = GetMatchManagerInstance();
        if (matchManager == null)
        {
            return;
        }

        _events.Clear();
        foreach (var summaryEvent in ReadSummaryEvents(matchManager))
        {
            if (summaryEvent == null)
            {
                continue;
            }

            var type = ReadStringMember(summaryEvent, "type");
            if (string.IsNullOrWhiteSpace(type))
            {
                continue;
            }

            _events.Add(new MatchEvent
            {
                minute = ReadIntMember(summaryEvent, "minute"),
                type = type,
                club = ReadStringMember(summaryEvent, "club"),
                playerId = ReadStringMember(summaryEvent, "playerId"),
                description = ReadStringMember(summaryEvent, "description")
            });
        }

        _payload.summary.homeGoals = ReadIntField(matchManager, _homeScoreField);
        _payload.summary.awayGoals = ReadIntField(matchManager, _awayScoreField);
        _payload.summary.stats = BuildStatsSnapshot(matchManager);
    }

    private static MatchSummaryStats BuildStatsSnapshot(object matchManager)
    {
        var stats = GetStatisticsObject(matchManager);
        if (stats == null)
        {
            return new MatchSummaryStats
            {
                possessionHome = 50,
                possessionAway = 50
            };
        }

        int ReadInt(int[] source, int index) => source != null && source.Length > index ? source[index] : 0;

        return new MatchSummaryStats
        {
            shotsHome = ReadInt(ReadIntArray(stats, "Attempts", "shooting"), 0),
            shotsAway = ReadInt(ReadIntArray(stats, "Attempts", "shooting"), 1),
            possessionHome = ReadInt(ReadIntArray(stats, "TeamPositioning", "possesioning", "possessioning"), 0),
            possessionAway = ReadInt(ReadIntArray(stats, "TeamPositioning", "possesioning", "possessioning"), 1),
            cornersHome = ReadInt(ReadIntArray(stats, "CornerCount", "corners"), 0),
            cornersAway = ReadInt(ReadIntArray(stats, "CornerCount", "corners"), 1),
            foulsHome = ReadInt(ReadIntArray(stats, "FoulCount", "fouls"), 0),
            foulsAway = ReadInt(ReadIntArray(stats, "FoulCount", "fouls"), 1),
            offsidesHome = ReadInt(ReadIntArray(stats, "OffsideCount", "offsides"), 0),
            offsidesAway = ReadInt(ReadIntArray(stats, "OffsideCount", "offsides"), 1),
            penaltiesHome = ReadInt(ReadIntArray(stats, "PenaltyCount", "penalties"), 0),
            penaltiesAway = ReadInt(ReadIntArray(stats, "PenaltyCount", "penalties"), 1),
        };
    }

    private static object GetMatchManagerInstance()
    {
        EnsureMatchManagerReflection();
        return _matchManagerCurrentProperty?.GetValue(null);
    }

    private static IEnumerable<object> ReadSummaryEvents(object matchManager)
    {
        EnsureMatchManagerReflection();
        if (_summaryEventsProperty?.GetValue(matchManager) is IEnumerable enumerable)
        {
            foreach (var item in enumerable)
            {
                if (item != null)
                {
                    yield return item;
                }
            }
        }
    }

    private static object GetStatisticsObject(object matchManager)
    {
        EnsureMatchManagerReflection();
        return _matchManagerStatisticsProperty?.GetValue(null);
    }

    private static void EnsureMatchManagerReflection()
    {
        if (_matchManagerType != null)
        {
            return;
        }

        _matchManagerType = Type.GetType($"{MatchManagerTypeName}, {AssemblyCSharp}") ??
            AppDomain.CurrentDomain.GetAssemblies()
                .Select(assembly => assembly.GetType(MatchManagerTypeName))
                .FirstOrDefault(type => type != null);

        if (_matchManagerType == null)
        {
            return;
        }

        _matchManagerCurrentProperty = _matchManagerType.GetProperty("Current", BindingFlags.Public | BindingFlags.Static);
        _matchManagerStatisticsProperty = _matchManagerType.GetProperty("Statistics", BindingFlags.Public | BindingFlags.Static);
        _summaryEventsProperty = _matchManagerType.GetProperty("SummaryEvents", BindingFlags.Public | BindingFlags.Instance);
        _homeScoreField = _matchManagerType.GetField("homeTeamScore", BindingFlags.Public | BindingFlags.Instance);
        _awayScoreField = _matchManagerType.GetField("awayTeamScore", BindingFlags.Public | BindingFlags.Instance);
    }

    private static object GetMemberValue(object target, params string[] memberNames)
    {
        object current = target;
        if (current == null || memberNames == null)
        {
            return null;
        }

        foreach (var memberName in memberNames)
        {
            if (current == null || string.IsNullOrWhiteSpace(memberName))
            {
                return null;
            }

            var type = current.GetType();
            var property = type.GetProperty(memberName, BindingFlags.Public | BindingFlags.Instance);
            if (property != null)
            {
                current = property.GetValue(current);
                continue;
            }

            var field = type.GetField(memberName, BindingFlags.Public | BindingFlags.Instance);
            if (field != null)
            {
                current = field.GetValue(current);
                continue;
            }

            return null;
        }

        return current;
    }

    private static int[] ReadIntArray(object root, string arrayMemberName, params string[] path)
    {
        if (root == null || string.IsNullOrWhiteSpace(arrayMemberName))
        {
            return null;
        }

        if (path != null)
        {
            foreach (var step in path)
            {
                var nested = GetMemberValue(root, step);
                if (nested == null)
                {
                    continue;
                }

                if (GetMemberValue(nested, arrayMemberName) is int[] nestedArray)
                {
                    return nestedArray;
                }
            }
        }

        return GetMemberValue(root, arrayMemberName) as int[];
    }

    private static int ReadIntField(object target, FieldInfo field)
    {
        return target != null && field != null && field.GetValue(target) is int value ? value : 0;
    }

    private static int ReadIntMember(object target, string memberName)
    {
        return GetMemberValue(target, memberName) is int value ? value : 0;
    }

    private static string ReadStringMember(object target, string memberName)
    {
        return GetMemberValue(target, memberName)?.ToString();
    }
}
