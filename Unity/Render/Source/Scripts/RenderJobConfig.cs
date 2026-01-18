using System;
using UnityEngine;

public static class RenderJobConfig
{
    public static string ReplayUrl => GetEnv("REPLAY_URL", "");
    public static string ReplayPath => GetEnv("REPLAY_PATH", "");
    public static string ReplayJson => GetEnv("REPLAY_JSON", "");
    public static string PipePath => GetEnv("RENDER_PIPE_PATH", "/tmp/render.pipe");
    public static string InputPixelFormat => GetEnv("RENDER_PIX_FMT", "rgb24").ToLowerInvariant();
    public static string CameraName => GetEnv("RENDER_CAMERA_NAME", "");

    public static int Width => GetEnvInt("RENDER_WIDTH", 1920);
    public static int Height => GetEnvInt("RENDER_HEIGHT", 1080);
    public static int Fps => GetEnvInt("RENDER_FPS", 20);
    public static int WarmupFrames => GetEnvInt("RENDER_WARMUP_FRAMES", 2);
    public static int SkipFrames => GetEnvInt("RENDER_SKIP_FRAMES", 0);
    public static int MaxFrames => GetEnvInt("RENDER_MAX_FRAMES", 0);
    public static int EndPaddingMs => GetEnvInt("RENDER_END_PADDING_MS", 0);

    public static bool FlipX => GetEnvBool("RENDER_FLIP_X", false);
    public static bool FlipY => GetEnvBool("RENDER_FLIP_Y", false);
    public static bool FastMode => GetEnvBool("RENDER_FAST", true);
    public static bool RenderCrowd => GetEnvBool("RENDER_CROWD", false);
    public static bool RenderUI => GetEnvBool("RENDER_UI", false);
    public static bool DebugFrames => GetEnvBool("RENDER_DEBUG_FRAMES", false);

    public static void LogStartup()
    {
        Debug.Log(
            "[RenderJobConfig] " +
            $"url={(string.IsNullOrEmpty(ReplayUrl) ? "empty" : "set")} " +
            $"path={(string.IsNullOrEmpty(ReplayPath) ? "empty" : "set")} " +
            $"pipe={PipePath} fps={Fps} size={Width}x{Height} pixFmt={InputPixelFormat} " +
            $"flipX={FlipX} flipY={FlipY} ui={RenderUI} crowd={RenderCrowd} fast={FastMode}"
        );
    }

    private static string GetEnv(string name, string defaultValue)
    {
        var value = Environment.GetEnvironmentVariable(name);
        return string.IsNullOrEmpty(value) ? defaultValue : value;
    }

    private static int GetEnvInt(string name, int defaultValue)
    {
        var raw = Environment.GetEnvironmentVariable(name);
        return int.TryParse(raw, out var value) ? value : defaultValue;
    }

    private static bool GetEnvBool(string name, bool defaultValue)
    {
        var raw = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrEmpty(raw)) return defaultValue;
        raw = raw.Trim().ToLowerInvariant();
        return raw == "1" || raw == "true" || raw == "yes" || raw == "y" || raw == "on";
    }
}
