// Proof-of-work photos: take one with the camera (file chooser on web) and upload it to the job.
import * as ImagePicker from 'expo-image-picker';
import { api } from './api';
import type { JobView } from './common';

/** Returns the updated job, or null if the partner cancelled or denied the camera. Throws on upload errors. */
export async function takeJobPhoto(jobId: string, kind: 'BEFORE' | 'AFTER'): Promise<JobView | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Allow camera access to add proof-of-work photos');
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5, base64: true, allowsEditing: false });
  if (r.canceled || !r.assets?.[0]?.base64) return null;
  const a = r.assets[0];
  return api<JobView>(`/jobs/${jobId}/photos`, { body: { kind, mime: a.mimeType || 'image/jpeg', data: a.base64 } });
}
