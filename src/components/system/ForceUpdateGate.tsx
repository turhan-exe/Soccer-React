import { App as CapacitorApp } from '@capacitor/app';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  fetchAndroidMobileUpdatePolicyWithTimeout,
  getCachedAndroidMobileUpdatePolicy,
  setCachedAndroidMobileUpdatePolicy,
  shouldForceUpdateForVersion,
  type AndroidMobileUpdatePolicy,
} from '@/services/mobileUpdatePolicy';
import { getInstalledAppVersion, isAndroidNativeApp } from '@/services/appVersion';
import {
  getPlayUpdateState,
  isPlayUpdateSupported,
  openPlayStoreListing,
  startImmediateUpdate,
  type PlayUpdateState,
} from '@/services/playUpdate';

type ForceUpdateGateProps = {
  children: ReactNode;
};

type GatePhase = 'checking' | 'ready' | 'blocked';

type GateState = {
  phase: GatePhase;
  policy: AndroidMobileUpdatePolicy | null;
  installedVersionCode: number | null;
  installedVersionName: string;
  playUpdateState: PlayUpdateState;
};

const FALLBACK_PLAY_STATE: PlayUpdateState = {
  updateAvailable: false,
  immediateAllowed: false,
  inProgress: false,
  source: 'fallback',
};

const INITIAL_STATE: GateState = {
  phase: isAndroidNativeApp() ? 'checking' : 'ready',
  policy: null,
  installedVersionCode: null,
  installedVersionName: '',
  playUpdateState: FALLBACK_PLAY_STATE,
};

const ForceUpdateGate = ({ children }: ForceUpdateGateProps) => {
  const [gateState, setGateState] = useState<GateState>(INITIAL_STATE);
  const [isStartingUpdate, setIsStartingUpdate] = useState(false);
  const lastAutoStartKeyRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const targetPlatform = isAndroidNativeApp();

  const applyPolicy = useCallback(
    async (
      installedVersionCode: number | null,
      installedVersionName: string,
      policy: AndroidMobileUpdatePolicy | null,
    ) => {
      if (!targetPlatform) {
        setGateState(INITIAL_STATE);
        return;
      }

      const shouldBlock = shouldForceUpdateForVersion(installedVersionCode, policy);
      if (!shouldBlock) {
        setGateState({
          phase: 'ready',
          policy,
          installedVersionCode,
          installedVersionName,
          playUpdateState: FALLBACK_PLAY_STATE,
        });
        return;
      }

      const playState = isPlayUpdateSupported()
        ? await getPlayUpdateState()
        : FALLBACK_PLAY_STATE;

      setGateState({
        phase: 'blocked',
        policy,
        installedVersionCode,
        installedVersionName,
        playUpdateState: playState,
      });
    },
    [targetPlatform],
  );

  const runUpdateCheck = useCallback(
    async (reason: 'startup' | 'resume') => {
      if (!targetPlatform) {
        return;
      }

      const requestId = ++requestIdRef.current;
      const installedInfo = await getInstalledAppVersion();
      const cachedPolicy = getCachedAndroidMobileUpdatePolicy();
      const cachedBlocks = shouldForceUpdateForVersion(
        installedInfo.versionCode,
        cachedPolicy,
      );

      if (cachedBlocks) {
        await applyPolicy(
          installedInfo.versionCode,
          installedInfo.versionName,
          cachedPolicy,
        );
      } else if (reason === 'startup') {
        setGateState({
          phase: 'checking',
          policy: null,
          installedVersionCode: installedInfo.versionCode,
          installedVersionName: installedInfo.versionName,
          playUpdateState: FALLBACK_PLAY_STATE,
        });
      }

      const remotePolicy = await fetchAndroidMobileUpdatePolicyWithTimeout();
      if (requestId !== requestIdRef.current) {
        return;
      }

      if (remotePolicy) {
        setCachedAndroidMobileUpdatePolicy(remotePolicy);
        await applyPolicy(
          installedInfo.versionCode,
          installedInfo.versionName,
          remotePolicy,
        );
        return;
      }

      if (cachedBlocks) {
        await applyPolicy(
          installedInfo.versionCode,
          installedInfo.versionName,
          cachedPolicy,
        );
        return;
      }

      setGateState({
        phase: 'ready',
        policy: null,
        installedVersionCode: installedInfo.versionCode,
        installedVersionName: installedInfo.versionName,
        playUpdateState: FALLBACK_PLAY_STATE,
      });
    },
    [applyPolicy, targetPlatform],
  );

  useEffect(() => {
    if (!targetPlatform) {
      return;
    }

    void runUpdateCheck('startup');

    const listener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        void runUpdateCheck('resume');
      }
    });

    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [runUpdateCheck, targetPlatform]);

  const handleUpdateAction = useCallback(async () => {
    const policy = gateState.policy;
    if (!policy) {
      return;
    }

    setIsStartingUpdate(true);
    try {
      if (
        policy.forceImmediateUpdate &&
        isPlayUpdateSupported() &&
        (gateState.playUpdateState.immediateAllowed || gateState.playUpdateState.inProgress)
      ) {
        const result = await startImmediateUpdate();
        if (result.started) {
          return;
        }
      }

      await openPlayStoreListing();
    } finally {
      setIsStartingUpdate(false);
    }
  }, [
    gateState.playUpdateState.immediateAllowed,
    gateState.playUpdateState.inProgress,
    gateState.policy,
  ]);

  useEffect(() => {
    if (gateState.phase !== 'blocked' || !gateState.policy?.forceImmediateUpdate) {
      return;
    }

    if (!gateState.playUpdateState.immediateAllowed && !gateState.playUpdateState.inProgress) {
      return;
    }

    const autoStartKey = [
      gateState.installedVersionCode ?? 'unknown',
      gateState.policy.minSupportedVersionCode,
      gateState.playUpdateState.immediateAllowed ? 'immediate' : 'manual',
      gateState.playUpdateState.inProgress ? 'inprogress' : 'idle',
    ].join(':');

    if (lastAutoStartKeyRef.current === autoStartKey) {
      return;
    }

    lastAutoStartKeyRef.current = autoStartKey;
    void handleUpdateAction();
  }, [
    gateState.installedVersionCode,
    gateState.phase,
    gateState.playUpdateState.immediateAllowed,
    gateState.playUpdateState.inProgress,
    gateState.policy,
    handleUpdateAction,
  ]);

  const blockedContent = useMemo(() => {
    if (gateState.phase !== 'blocked' || !gateState.policy) {
      return null;
    }

    return (
      <div className="fixed inset-0 z-[9999] overflow-y-auto bg-slate-950 text-slate-100">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-rose-500/20 blur-3xl" />
          <div className="absolute right-[-15%] top-1/4 h-96 w-96 rounded-full bg-amber-500/10 blur-3xl" />
        </div>

        <div className="relative flex min-h-screen items-center justify-center px-6 py-10">
          <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-900/85 p-8 shadow-2xl backdrop-blur-xl">
            <div className="mb-6 inline-flex rounded-2xl border border-amber-300/20 bg-amber-500/10 p-4 text-amber-200">
              <AlertTriangle className="h-8 w-8" />
            </div>

            <h1 className="text-3xl font-bold tracking-tight">{gateState.policy.blockTitle}</h1>
            <p className="mt-3 max-w-xl text-sm text-slate-300 sm:text-base">
              {gateState.policy.blockMessage}
            </p>

            <div className="mt-8 grid gap-4 rounded-2xl border border-white/10 bg-slate-950/70 p-5 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Mevcut surum</p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {gateState.installedVersionName || 'Bilinmiyor'}
                </p>
                <p className="text-sm text-slate-400">
                  Version code: {gateState.installedVersionCode ?? 'Bilinmiyor'}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Gerekli surum</p>
                <p className="mt-2 text-lg font-semibold text-emerald-200">
                  {gateState.policy.latestVersionName}
                </p>
                <p className="text-sm text-slate-400">
                  Min desteklenen code: {gateState.policy.minSupportedVersionCode}
                </p>
              </div>
            </div>

            <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              {gateState.playUpdateState.inProgress
                ? 'Google Play guncellemesi devam ediyor. Uygulamaya geri dondugunde kontrol tekrar yapilir.'
                : gateState.playUpdateState.immediateAllowed
                  ? 'Google Play zorunlu guncelleme akisi destekleniyor. Butona bastiginda resmi guncelleme ekrani acilir.'
                  : 'Google Play zorunlu guncelleme akisi kullanilamadi. Magaza sayfasi acilarak guncelleme istenir.'}
            </div>

            <div className="mt-8">
              <Button
                onClick={handleUpdateAction}
                disabled={isStartingUpdate}
                className="h-12 w-full bg-emerald-500 text-slate-950 hover:bg-emerald-400"
              >
                {isStartingUpdate ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Google Play'de guncelle
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }, [gateState, handleUpdateAction, isStartingUpdate]);

  if (!targetPlatform) {
    return <>{children}</>;
  }

  if (gateState.phase === 'blocked') {
    return blockedContent;
  }

  if (gateState.phase === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-white/10 bg-slate-900/75 px-8 py-10 text-center shadow-2xl backdrop-blur-xl">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-300" />
          <div>
            <p className="text-lg font-semibold">Surum kontrol ediliyor</p>
            <p className="mt-2 text-sm text-slate-400">
              Uygulama guncelleme gereksinimleri dogrulaniyor.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default ForceUpdateGate;
