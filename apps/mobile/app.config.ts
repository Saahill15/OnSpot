// Build-time config on top of app.json. Secrets come from environment variables (EAS environment
// variables or a local .env), never from the repository.
//   GOOGLE_MAPS_ANDROID_API_KEY  Maps SDK for Android key (react-native-maps). Without it the map is blank on Android.
//   GOOGLE_SERVICES_JSON         Path to Firebase google-services.json (FCM). Needed for push on Android.
//                                On EAS, upload it as a "file" environment variable with this name.
//   EAS_PROJECT_ID               Set automatically into app.json by `eas init`; this is a fallback.
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const mapsKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  const googleServices = process.env.GOOGLE_SERVICES_JSON;
  const projectId = config.extra?.eas?.projectId ?? process.env.EAS_PROJECT_ID;
  return {
    ...(config as ExpoConfig),
    android: {
      ...config.android,
      ...(googleServices ? { googleServicesFile: googleServices } : {}),
    },
    plugins: [
      ...(config.plugins ?? []),
      ['react-native-maps', { androidGoogleMapsApiKey: mapsKey }],
    ],
    extra: { ...config.extra, ...(projectId ? { eas: { ...config.extra?.eas, projectId } } : {}) },
  };
};
