using System;
using System.Collections.Generic;

public class MatchSim
{
    private readonly Random _rng;
    private readonly string _home;
    private readonly string _away;

    public int HomeGoals { get; private set; }
    public int AwayGoals { get; private set; }
    public List<LiveEvent> Timeline { get; } = new List<LiveEvent>();

    public MatchSim(long seed, string homeTeamId, string awayTeamId)
    {
        _rng = new Random(unchecked((int)seed));
        _home = homeTeamId;
        _away = awayTeamId;
    }

    public void Run()
    {
        PushEvent("kickoff", 0, 0, null);

        for (int min = 1; min <= 90; min++)
        {
            if (_rng.NextDouble() < 0.05) // chance
            {
                bool homeAttack = _rng.NextDouble() < 0.5;
                var payload = new SerializableDict();
                payload.Add("team", homeAttack ? "home" : "away");
                PushEvent("chance", min, _rng.Next(0, 60), payload);

                if (_rng.NextDouble() < 0.4) // goal
                {
                    if (homeAttack) HomeGoals++; else AwayGoals++;
                    var p2 = new SerializableDict();
                    p2.Add("team", homeAttack ? "home" : "away");
                    p2.Add("scorerId", homeAttack ? "H9" : "A10");
                    PushEvent("goal", min, _rng.Next(0, 60), p2);
                }
            }
        }

        var finalP = new SerializableDict();
        finalP.Add("h", HomeGoals.ToString());
        finalP.Add("a", AwayGoals.ToString());
        PushEvent("full_time", 90, 0, finalP);
    }

    private void PushEvent(string type, int min, int sec, SerializableDict payload)
    {
        var e = new LiveEvent
        {
            ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            type = type,
            matchClock = new LiveClock { min = min, sec = sec },
            payload = payload
        };
        Timeline.Add(e);
    }
}

