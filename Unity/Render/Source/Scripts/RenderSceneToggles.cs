using UnityEngine;

public class RenderSceneToggles : MonoBehaviour
{
    public GameObject[] uiRoots;
    public GameObject[] crowdRoots;
    public GameObject[] fastModeRoots;

    private void Awake()
    {
        Apply();
    }

    public void Apply()
    {
        SetActive(uiRoots, RenderJobConfig.RenderUI);
        SetActive(crowdRoots, RenderJobConfig.RenderCrowd);
        SetActive(fastModeRoots, !RenderJobConfig.FastMode);
    }

    private void SetActive(GameObject[] roots, bool enabled)
    {
        if (roots == null) return;
        foreach (var root in roots)
        {
            if (root != null) root.SetActive(enabled);
        }
    }
}
