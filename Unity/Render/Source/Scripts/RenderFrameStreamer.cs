using System;
using System.IO;
using Unity.Collections;
using UnityEngine;
using UnityEngine.Rendering;

public class RenderFrameStreamer : MonoBehaviour
{
    private FileStream _pipeStream;
    private RenderTexture _captureTexture;
    private RenderTexture _blitTexture;
    private Camera _captureCamera;
    private byte[] _rgbBuffer;
    private byte[] _rgbaBuffer;
    private bool _useRgba;
    private bool _loggedFormatWarning;

    public IEnumerator RenderSequence(MatchReplayPayload payload, ReplayFrameApplier applier)
    {
        if (payload == null || payload.frames == null || payload.frames.Count == 0)
        {
            Debug.LogError("[RenderFrameStreamer] payload missing frames");
            yield break;
        }

        if (!SetupCamera())
        {
            Debug.LogError("[RenderFrameStreamer] camera not found");
            yield break;
        }

        SetupRenderTextures();
        SetupPipe();

        var durationMs = payload.durationMs;
        if (durationMs <= 0 && payload.frames.Count > 0)
        {
            durationMs = payload.frames[payload.frames.Count - 1].t;
        }
        durationMs += RenderJobConfig.EndPaddingMs;

        var fps = Mathf.Max(1, RenderJobConfig.Fps);
        var totalFrames = Mathf.CeilToInt(durationMs / 1000f * fps);
        if (RenderJobConfig.MaxFrames > 0)
        {
            totalFrames = Mathf.Min(totalFrames, RenderJobConfig.MaxFrames);
        }

        Debug.Log($"[RenderFrameStreamer] start totalFrames={totalFrames} fps={fps}");

        for (var i = 0; i < RenderJobConfig.WarmupFrames; i++)
        {
            applier.SeekMs(0);
            yield return new WaitForEndOfFrame();
            CaptureFrame(write: false);
        }

        for (var frame = 0; frame < totalFrames; frame++)
        {
            var targetMs = (long)(frame * (1000f / fps));
            applier.SeekMs(targetMs);
            yield return new WaitForEndOfFrame();
            var shouldWrite = frame >= RenderJobConfig.SkipFrames;
            CaptureFrame(shouldWrite);

            if (RenderJobConfig.DebugFrames && (frame % fps == 0))
            {
                Debug.Log($"[RenderFrameStreamer] frame={frame}/{totalFrames} ms={targetMs}");
            }
        }

        Debug.Log("[RenderFrameStreamer] done");
        ClosePipe();
    }

    private bool SetupCamera()
    {
        if (!string.IsNullOrEmpty(RenderJobConfig.CameraName))
        {
            var named = GameObject.Find(RenderJobConfig.CameraName);
            if (named != null)
            {
                _captureCamera = named.GetComponent<Camera>();
            }
        }

        if (_captureCamera == null)
        {
            _captureCamera = Camera.main != null ? Camera.main : FindObjectOfType<Camera>();
        }

        if (_captureCamera == null) return false;

        _captureCamera.forceIntoRenderTexture = true;
        _captureCamera.allowMSAA = false;
        _captureCamera.allowHDR = false;
        return true;
    }

    private void SetupRenderTextures()
    {
        var width = Mathf.Max(1, RenderJobConfig.Width);
        var height = Mathf.Max(1, RenderJobConfig.Height);
        var desc = new RenderTextureDescriptor(width, height, RenderTextureFormat.ARGB32, 24)
        {
            msaaSamples = 1,
            sRGB = QualitySettings.activeColorSpace == ColorSpace.Linear
        };

        _captureTexture = new RenderTexture(desc);
        _captureTexture.Create();
        _captureCamera.targetTexture = _captureTexture;

        if (RenderJobConfig.FlipX || RenderJobConfig.FlipY)
        {
            _blitTexture = new RenderTexture(desc);
            _blitTexture.Create();
        }

        _useRgba = RenderJobConfig.InputPixelFormat == "rgba" || RenderJobConfig.InputPixelFormat == "rgba32";
        if (_useRgba)
        {
            _rgbaBuffer = new byte[width * height * 4];
        }
        else
        {
            _rgbBuffer = new byte[width * height * 3];
        }
    }

    private void SetupPipe()
    {
        var path = RenderJobConfig.PipePath;
        _pipeStream = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.Read);
        Debug.Log($"[RenderFrameStreamer] pipe opened {path}");
    }

    private void CaptureFrame(bool write)
    {
        var source = _captureTexture;
        if (_blitTexture != null)
        {
            var scale = new Vector2(RenderJobConfig.FlipX ? -1f : 1f, RenderJobConfig.FlipY ? -1f : 1f);
            var offset = new Vector2(RenderJobConfig.FlipX ? 1f : 0f, RenderJobConfig.FlipY ? 1f : 0f);
            Graphics.Blit(_captureTexture, _blitTexture, scale, offset);
            source = _blitTexture;
        }

        if (_useRgba)
        {
            WriteFromReadback(source, TextureFormat.RGBA32, _rgbaBuffer, 4, write);
            return;
        }

        var rgbWritten = WriteFromReadback(source, TextureFormat.RGB24, _rgbBuffer, 3, write, allowFallback: true);
        if (!rgbWritten && !_loggedFormatWarning)
        {
            _loggedFormatWarning = true;
            Debug.LogWarning("[RenderFrameStreamer] RGB24 readback failed, falling back to RGBA32 conversion");
        }
    }

    private bool WriteFromReadback(
        RenderTexture source,
        TextureFormat format,
        byte[] buffer,
        int bytesPerPixel,
        bool write,
        bool allowFallback = false
    )
    {
        var request = AsyncGPUReadback.Request(source, 0, format);
        request.WaitForCompletion();
        if (request.hasError)
        {
            Debug.LogError("[RenderFrameStreamer] GPU readback error");
            return false;
        }

        var data = request.GetData<byte>();
        var expected = source.width * source.height * bytesPerPixel;
        if (data.Length != expected)
        {
            if (allowFallback)
            {
                ConvertFromRgba(source, write);
                return false;
            }
            Debug.LogError($"[RenderFrameStreamer] readback size mismatch {data.Length} != {expected}");
            return false;
        }

        if (!write) return true;

        data.CopyTo(buffer);
        _pipeStream.Write(buffer, 0, buffer.Length);
        return true;
    }

    private void ConvertFromRgba(RenderTexture source, bool write)
    {
        var request = AsyncGPUReadback.Request(source, 0, TextureFormat.RGBA32);
        request.WaitForCompletion();
        if (request.hasError)
        {
            Debug.LogError("[RenderFrameStreamer] RGBA readback error");
            return;
        }

        var data = request.GetData<byte>();
        var expected = source.width * source.height * 4;
        if (data.Length != expected)
        {
            Debug.LogError($"[RenderFrameStreamer] RGBA size mismatch {data.Length} != {expected}");
            return;
        }

        if (!write) return;

        EnsureRgbBuffer(source.width, source.height);
        var src = data;
        var dst = _rgbBuffer;
        var di = 0;
        for (var si = 0; si < src.Length; si += 4)
        {
            dst[di++] = src[si];
            dst[di++] = src[si + 1];
            dst[di++] = src[si + 2];
        }

        _pipeStream.Write(dst, 0, dst.Length);
    }

    private void EnsureRgbBuffer(int width, int height)
    {
        var expected = width * height * 3;
        if (_rgbBuffer == null || _rgbBuffer.Length != expected)
        {
            _rgbBuffer = new byte[expected];
        }
    }

    private void ClosePipe()
    {
        if (_pipeStream == null) return;
        _pipeStream.Flush();
        _pipeStream.Close();
        _pipeStream = null;
    }

    private void OnDestroy()
    {
        ClosePipe();
        if (_captureTexture != null)
        {
            _captureTexture.Release();
            _captureTexture = null;
        }
        if (_blitTexture != null)
        {
            _blitTexture.Release();
            _blitTexture = null;
        }
    }
}
