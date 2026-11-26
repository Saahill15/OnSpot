// Push notifications via Expo (relays to FCM on Android, APNs on iOS).
// Works in development builds and store builds. Not in Expo Go on Android, and not on web.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from './api';

// Show banners even while the app is open (the in-app UI also updates over Socket.IO).
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let registered: string | null = null;

/** Ask permission, get this device's Expo push token and register it with the API. Returns the token or null. */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  if (Platform.OS === 'android') {
    // Channels must exist before the first notification arrives; ids match the API's channelId.
    await Notifications.setNotificationChannelAsync('offers', { name: 'Job offers', importance: Notifications.AndroidImportance.MAX, sound: 'default', vibrationPattern: [0, 400, 200, 400] });
    await Notifications.setNotificationChannelAsync('jobs', { name: 'Your requests', importance: Notifications.AndroidImportance.HIGH, sound: 'default' });
    await Notifications.setNotificationChannelAsync('default', { name: 'General', importance: Notifications.AndroidImportance.DEFAULT });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) { console.warn('Push disabled: run `npx eas-cli@latest init` to set an EAS projectId'); return null; }
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api('/me/push-tokens', { body: { token, platform: Platform.OS } });
  registered = token;
  return token;
}

/** Call before signing out so this device stops getting the previous user's notifications. */
export async function unregisterPush() {
  if (!registered) return;
  await api('/me/push-tokens/remove', { body: { token: registered } }).catch(() => {});
  registered = null;
}

/** Fires when the user taps a notification (also for the tap that launched the app). */
export function onNotificationTap(cb: (data: Record<string, unknown>) => void) {
  if (Platform.OS === 'web') return () => {};
  const last = Notifications.getLastNotificationResponse();
  if (last) cb(last.notification.request.content.data ?? {});
  const sub = Notifications.addNotificationResponseReceivedListener(r => cb(r.notification.request.content.data ?? {}));
  return () => sub.remove();
}
