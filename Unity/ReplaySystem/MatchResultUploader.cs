using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

public class MatchResultUploader : MonoBehaviour
{
    [Tooltip("Cloud Function endpoint URL for reportMatchResultWithReplay")]
    public string endpointUrl = "https://<REGION>-<PROJECT>.cloudfunctions.net/reportMatchResultWithReplay";

    public void Send(MatchReplayPayload payload)
    {
        var json = JsonUtility.ToJson(payload);
        StartCoroutine(PostReplayToBackend(json));
    }

    public IEnumerator PostReplayToBackend(string json)
    {
        var request = new UnityWebRequest(endpointUrl, "POST");
        byte[] bodyRaw = Encoding.UTF8.GetBytes(json);
        request.uploadHandler = new UploadHandlerRaw(bodyRaw);
        request.downloadHandler = new DownloadHandlerBuffer();
        request.SetRequestHeader("Content-Type", "application/json");

        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            Debug.LogError("Failed to send replay: " + request.error);
        }
        else
        {
            Debug.Log("Replay sent successfully: " + request.downloadHandler.text);
        }
    }
}
