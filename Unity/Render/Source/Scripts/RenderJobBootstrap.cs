using System.Collections;
using System.IO;
using UnityEngine;
using UnityEngine.Networking;

public class RenderJobBootstrap : MonoBehaviour
{
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void AutoCreate()
    {
        var go = new GameObject("RenderJobBootstrap");
        DontDestroyOnLoad(go);
        go.AddComponent<RenderJobBootstrap>();
    }

    private IEnumerator Start()
    {
        RenderJobConfig.LogStartup();
        ApplyRuntimeSettings();

        var applier = FindObjectOfType<ReplayFrameApplier>();
        if (applier == null)
        {
            Debug.LogError("[RenderJobBootstrap] ReplayFrameApplier not found in scene");
            Application.Quit(2);
            yield break;
        }

        var json = string.Empty;
        var error = string.Empty;
        yield return LoadReplayJson(
            ok => json = ok,
            err => error = err
        );

        if (!string.IsNullOrEmpty(error))
        {
            Debug.LogError($"[RenderJobBootstrap] replay load failed: {error}");
            Application.Quit(3);
            yield break;
        }

        var payload = JsonUtility.FromJson<MatchReplayPayload>(json);
        if (payload == null || payload.frames == null || payload.frames.Count == 0)
        {
            Debug.LogError("[RenderJobBootstrap] replay payload invalid or empty");
            Application.Quit(4);
            yield break;
        }

        applier.LoadPayload(payload);

        var streamer = gameObject.AddComponent<RenderFrameStreamer>();
        yield return streamer.RenderSequence(payload, applier);

        Application.Quit(0);
    }

    private void ApplyRuntimeSettings()
    {
        var fps = Mathf.Max(1, RenderJobConfig.Fps);
        QualitySettings.vSyncCount = 0;
        Application.targetFrameRate = fps;
        Time.captureFramerate = fps;
        Time.fixedDeltaTime = 1f / fps;
        Application.runInBackground = true;
        Screen.SetResolution(RenderJobConfig.Width, RenderJobConfig.Height, false);
    }

    private IEnumerator LoadReplayJson(System.Action<string> onOk, System.Action<string> onErr)
    {
        var inline = RenderJobConfig.ReplayJson;
        if (!string.IsNullOrEmpty(inline))
        {
            onOk(inline);
            yield break;
        }

        var path = RenderJobConfig.ReplayPath;
        if (!string.IsNullOrEmpty(path) && File.Exists(path))
        {
            onOk(File.ReadAllText(path));
            yield break;
        }

        var url = RenderJobConfig.ReplayUrl;
        if (string.IsNullOrEmpty(url))
        {
            onErr("REPLAY_URL/REPLAY_PATH/REPLAY_JSON missing");
            yield break;
        }

        using (var req = UnityWebRequest.Get(url))
        {
            req.timeout = 30;
            yield return req.SendWebRequest();

            if (req.result != UnityWebRequest.Result.Success)
            {
                onErr(req.error);
                yield break;
            }

            onOk(req.downloadHandler.text);
        }
    }
}
