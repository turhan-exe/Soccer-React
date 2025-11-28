using System;
using System.Collections.Generic;

[Serializable]
public class MatchReplayPayload
{
    public int version;
    public string matchId;
    public string seasonId;
    public long durationMs;
    public long startedAtUnixMs;
    public RuntimeTeamState home;
    public RuntimeTeamState away;
    public List<ReplayFrame> frames;
    public MatchResultSummary summary;
}

[Serializable]
public class RuntimeTeamState
{
    public string clubId;
    public string clubName;
    public string formation;
    public List<RuntimePlayerState> players;
}

[Serializable]
public class RuntimePlayerState
{
    public string id;
    public string name;
    public string position;
    public float rating;
}

[Serializable]
public class ReplayFrame
{
    public long t;
    public BallState ball;
    public List<PlayerFrameState> players;
    public FrameEvent frameEvent;
}

[Serializable]
public class BallState
{
    public float x;
    public float y;
    public float z;
}

[Serializable]
public class PlayerFrameState
{
    public string id;
    public float x;
    public float y;
    public float z;
}

[Serializable]
public class FrameEvent
{
    public string type;
    public string club;
    public string playerId;
    public string extra;
}

[Serializable]
public class MatchResultSummary
{
    public int homeGoals;
    public int awayGoals;
    public List<MatchEvent> events;
}

[Serializable]
public class MatchEvent
{
    public int minute;
    public string type;
    public string club;
    public string playerId;
    public string description;
}
