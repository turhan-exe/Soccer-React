import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nerbuss.fhsmanager',
  appName: 'FHS MANAGER GAME',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      splashFullScreen: true,
      splashImmersive: true,
      backgroundColor: '#0f172a',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
  },
  server: {
    /**
     * Use the default http scheme so the Android WebView can load the local
     * Capacitor server. Using `https` without provisioning certificates causes
     * the WebView to fail to resolve `/assets/...` which results in a blank
     * screen after the splash screen.
     */
    androidScheme: 'http',
  },
};

export default config;
