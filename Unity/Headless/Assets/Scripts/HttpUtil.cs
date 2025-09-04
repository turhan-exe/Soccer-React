using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

public static class HttpUtil
{
    public static IEnumerator GetJson(string url, Action<string> onOk, Action<string> onErr)
    {
        using (var req = UnityWebRequest.Get(url))
        {
            yield return req.SendWebRequest();
            if (req.result != UnityWebRequest.Result.Success)
                onErr?.Invoke(req.error);
            else
                onOk?.Invoke(req.downloadHandler.text);
        }
    }

    public static IEnumerator PutJsonSignedUrl(string signedUrl, string json, Action onOk, Action<string> onErr)
    {
        byte[] bodyRaw = Encoding.UTF8.GetBytes(json);
        using (var req = new UnityWebRequest(signedUrl, "PUT"))
        {
            req.uploadHandler = new UploadHandlerRaw(bodyRaw);
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            yield return req.SendWebRequest();
            if (req.result != UnityWebRequest.Result.Success)
                onErr?.Invoke(req.error);
            else
                onOk?.Invoke();
        }
    }

    public static IEnumerator PostJsonBearer(string url, string json, string bearer, Action onOk, Action<string> onErr)
    {
        using (var req = new UnityWebRequest(url, "POST"))
        {
            byte[] bodyRaw = Encoding.UTF8.GetBytes(json);
            req.uploadHandler = new UploadHandlerRaw(bodyRaw);
            req.downloadHandler = new DownloadHandlerBuffer();
            req.SetRequestHeader("Content-Type", "application/json");
            if (!string.IsNullOrEmpty(bearer)) req.SetRequestHeader("Authorization", "Bearer " + bearer);
            yield return req.SendWebRequest();
            if (req.result != UnityWebRequest.Result.Success)
                onErr?.Invoke(req.error);
            else
                onOk?.Invoke();
        }
    }
}

