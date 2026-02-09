using System;
using System.Collections;
using UnityEngine;

public class HeadlessEntry : MonoBehaviour
{
    private string BATCH_URL;
    private string LEAGUE_ID;
    private string EMIT_LIVE_URL;
    private string END_LIVE_URL;
    private string LIVE_SECRET;
    private string RESULTS_CB_URL;  // optional
    private string RESULTS_SECRET;  // optional

    void Start()
    {
        BATCH_URL      = Environment.GetEnvironmentVariable("BATCH_URL");
        LEAGUE_ID      = Environment.GetEnvironmentVariable("LEAGUE_ID");
        EMIT_LIVE_URL  = Environment.GetEnvironmentVariable("EMIT_LIVE_URL");
        END_LIVE_URL   = Environment.GetEnvironmentVariable("END_LIVE_URL");
        LIVE_SECRET    = Environment.GetEnvironmentVariable("LIVE_SECRET");
        RESULTS_CB_URL = Environment.GetEnvironmentVariable("RESULTS_CALLBACK_URL");
        RESULTS_SECRET = Environment.GetEnvironmentVariable("RESULTS_SECRET");

        if (string.IsNullOrEmpty(BATCH_URL))
        {
            Debug.LogError("BATCH_URL missing");
            Application.Quit(1);
            return;
        }

        StartCoroutine(RunAll());
    }

    IEnumerator RunAll()
    {
        string batchJson = null;
        yield return HttpUtil.GetJson(BATCH_URL, ok => batchJson = ok, err => Debug.LogError(err));
        if (string.IsNullOrEmpty(batchJson)) { Application.Quit(2); yield break; }

        var batch = JsonUtility.FromJson<BatchFile>(batchJson);
        Debug.Log($"Batch {batch.meta.day} count={batch.meta.count}");

        int ran = 0;
        foreach (var m in batch.matches)
        {
            if (!string.IsNullOrEmpty(LEAGUE_ID) && !string.Equals(m.leagueId, LEAGUE_ID, StringComparison.Ordinal))
            {
                continue;
            }

            yield return RunOneMatch(m);
            ran++;
        }

        Debug.Log($"All matches done. Ran {ran} of {batch.matches.Count}.");
        Application.Quit(0);
    }

    IEnumerator RunOneMatch(BatchMatch bm)
    {
        Debug.Log($"Sim start {bm.matchId} {bm.homeTeamId} vs {bm.awayTeamId}");
        var sim = new MatchSim(bm.seed, bm.homeTeamId, bm.awayTeamId);

        if (!string.IsNullOrEmpty(EMIT_LIVE_URL) && !string.IsNullOrEmpty(LIVE_SECRET))
        {
            var kick = "{\"matchId\":\"" + bm.matchId + "\",\"type\":\"kickoff\"}";
            yield return HttpUtil.PostJsonBearer(EMIT_LIVE_URL, kick, LIVE_SECRET, () => { }, err => Debug.LogWarning(err));
        }

        sim.Run();

        if (!string.IsNullOrEmpty(EMIT_LIVE_URL) && !string.IsNullOrEmpty(LIVE_SECRET))
        {
            foreach (var e in sim.Timeline)
            {
                if (e.type == "goal")
                {
                    var payload = "{\"matchId\":\"" + bm.matchId + "\",\"type\":\"goal\"}";
                    yield return HttpUtil.PostJsonBearer(EMIT_LIVE_URL, payload, LIVE_SECRET, () => { }, err => Debug.LogWarning(err));
                }
            }
        }

        var replayJson = ReplaySerializer.ToJson(bm.matchId, sim.Timeline);
        var resultJson = ReplaySerializer.ResultToJson(bm.matchId, bm.leagueId, bm.seasonId, bm.requestToken, sim.HomeGoals, sim.AwayGoals);

        bool upOk = true;
        yield return HttpUtil.PutJsonSignedUrl(bm.replayUploadUrl, replayJson, () => { }, err => { Debug.LogError(err); upOk = false; });
        yield return HttpUtil.PutJsonSignedUrl(bm.resultUploadUrl, resultJson, () => { }, err => { Debug.LogError(err); upOk = false; });

        if (upOk && !string.IsNullOrEmpty(RESULTS_CB_URL) && !string.IsNullOrEmpty(RESULTS_SECRET))
        {
            yield return HttpUtil.PostJsonBearer(RESULTS_CB_URL, resultJson, RESULTS_SECRET, () => { }, err => Debug.LogWarning(err));
        }

        if (!string.IsNullOrEmpty(END_LIVE_URL) && !string.IsNullOrEmpty(LIVE_SECRET))
        {
            var endJson = "{\"matchId\":\"" + bm.matchId + "\",\"score\":{\"h\":" + sim.HomeGoals + ",\"a\":" + sim.AwayGoals + "}}";
            yield return HttpUtil.PostJsonBearer(END_LIVE_URL, endJson, LIVE_SECRET, () => { }, err => Debug.LogWarning(err));
        }

        Debug.Log($"Sim end {bm.matchId} score {sim.HomeGoals}-{sim.AwayGoals}");
    }
}
