using System;
using System.Collections.Generic;

[Serializable]
public class BatchFile {
    public BatchMeta meta;
    public List<BatchMatch> matches;
}

[Serializable]
public class BatchMeta {
    public string day;
    public string tz;
    public int count;
    public int shard;
    public int shards;
}

[Serializable]
public class BatchMatch {
    public string matchId;
    public string leagueId;
    public string seasonId;
    public string homeTeamId;
    public string awayTeamId;
    public long seed;
    public string requestToken;
    public string replayUploadUrl;
    public string resultUploadUrl;
    public string videoUploadUrl;
    public string videoPath;
}

[Serializable]
public class LiveEvent {
    public long ts; // epoch ms
    public string type; // kickoff|goal|...
    public LiveClock matchClock; // optional
    public SerializableDict payload; // optional
}

[Serializable]
public class LiveClock {
    public int min;
    public int sec;
}

[Serializable]
public class SerializableDict {
    public List<string> keys = new List<string>();
    public List<string> values = new List<string>();
    public void Add(string k, string v) { keys.Add(k); values.Add(v); }
}

[Serializable]
public class ReplayJson {
    public string matchId;
    public List<LiveEvent> timeline = new List<LiveEvent>();
}

[Serializable]
public class ResultJson {
    public string matchId;
    public string leagueId;
    public string seasonId;
    public string requestToken;
    public Score score;
}

[Serializable]
public class Score { public int h; public int a; }
