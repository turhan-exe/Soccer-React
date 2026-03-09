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
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ['google.com', 'apple.com'],
    },
  },
  server: {
    // Domainsiz/HTTP API ile Android testinde WebView mixed-content blokunu önler.
    androidScheme: 'http',
  },
};

export default config;
