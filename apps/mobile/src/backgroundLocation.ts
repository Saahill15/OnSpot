// Partner location while the app is in the background or the screen is off (native only).
// The task must be defined at module load (imported from index.ts) so the OS can wake the JS runtime to run it.
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { API_URL, loadSession } from './api';

export const BG_LOCATION_TASK = 'onspot-partner-location';
type Mode = 'idle' | 'job';
let currentMode: Mode | null = null;

if (Platform.OS !== 'web') {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(BG_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const last = data.locations[data.locations.length - 1]; // batched updates: only the newest matters
    const s = await loadSession();
    if (!s || s.user.role !== 'PROVIDER') return;
    await fetch(`${API_URL}/provider/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}` },
      body: JSON.stringify({ lat: last.coords.latitude, lng: last.coords.longitude }),
    }).catch(() => { /* offline: the next update will go through */ });
  });
}

export type BgResult = 'started' | 'denied-foreground' | 'denied-background' | 'unsupported';

/** Start (or switch the accuracy of) background updates. `job` = high accuracy for a live ETA; `idle` = battery-friendly. */
export async function startBackgroundLocation(mode: Mode): Promise<BgResult> {
  if (Platform.OS === 'web') return 'unsupported';
  if (!(await TaskManager.isAvailableAsync())) return 'unsupported';
  if ((await Location.requestForegroundPermissionsAsync()).status !== 'granted') return 'denied-foreground';
  if ((await Location.requestBackgroundPermissionsAsync()).status !== 'granted') return 'denied-background';
  const running = await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK);
  if (running && currentMode === mode) return 'started';
  if (running) await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
  await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
    accuracy: mode === 'job' ? Location.Accuracy.High : Location.Accuracy.Balanced,
    timeInterval: mode === 'job' ? 5_000 : 15_000,
    distanceInterval: mode === 'job' ? 25 : 75,
    deferredUpdatesInterval: mode === 'job' ? 5_000 : 15_000,
    activityType: Location.LocationActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    // Android requires a visible notification while location is used in the background.
    foregroundService: {
      notificationTitle: mode === 'job' ? 'On a job · sharing your location' : "You're online on OnSpot",
      notificationBody: mode === 'job' ? 'The customer sees your live ETA.' : 'Sharing your location so nearby customers can find you. Go offline to stop.',
      notificationColor: '#FF385C',
      killServiceOnDestroy: false,
    },
  });
  currentMode = mode;
  return 'started';
}

export async function stopBackgroundLocation() {
  currentMode = null;
  if (Platform.OS === 'web') return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
  } catch { /* task not registered yet: nothing to stop */ }
}

/** Has the partner already granted "Allow all the time"? (Used to decide whether to show the disclosure first.) */
export async function hasBackgroundPermission() {
  if (Platform.OS === 'web') return false;
  return (await Location.getBackgroundPermissionsAsync()).status === 'granted';
}
