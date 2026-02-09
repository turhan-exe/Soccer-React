using UnityEngine;
using System.Collections.Generic;

public static class ReplaySerializer
{
    public static string ToJson(string matchId, List<LiveEvent> timeline)
    {
        var r = new ReplayJson { matchId = matchId, timeline = timeline };
        return JsonUtility.ToJson(r, prettyPrint: false);
    }

    public static string ResultToJson(string matchId, string leagueId, string seasonId, string requestToken, int h, int a)
    {
        var r = new ResultJson
        {
            matchId = matchId,
            leagueId = leagueId,
            seasonId = seasonId,
            requestToken = requestToken,
            score = new Score { h = h, a = a }
        };
        return JsonUtility.ToJson(r, prettyPrint: false);
    }
}
