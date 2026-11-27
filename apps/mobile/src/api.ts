// API client + realtime socket. Base URL: EXPO_PUBLIC_API_URL (Android emulator: http://10.0.2.2:4100/v1,
// physical phone: http://<your-PC-LAN-IP>:4100/v1).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';
import type { Role } from '@onspot/shared';

export const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4100/v1';
const SOCKET_URL = API_URL.replace(/\/v1\/?$/, '');
/** Base for public share links (family tracking page at /t/:id). Defaults to the API's own origin. */
export const PUBLIC_URL = (process.env.EXPO_PUBLIC_WEB_URL || SOCKET_URL).replace(/\/$/, '');

export interface Session { token: string; user: { id: string; name: string; phone: string; role: Role } }

let session: Session | null = null;
export const getSession = () => session;
export async function loadSession() {
  try { session = JSON.parse((await AsyncStorage.getItem('onspot.session')) || 'null'); } catch { session = null; }
  return session;
}
export async function saveSession(s: Session | null) {
  session = s;
  try { s ? await AsyncStorage.setItem('onspot.session', JSON.stringify(s)) : await AsyncStorage.removeItem('onspot.session'); } catch {}
}

export class ApiError extends Error { constructor(msg: string, public status: number) { super(msg); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(API_URL + path, {
    method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message[0] : data.message;
    throw new ApiError(msg || 'Something went wrong', res.status);
  }
  return data as T;
}

let socket: Socket | null = null;
export function getSocket() {
  if (!session) return null;
  if (!socket) socket = io(SOCKET_URL, { auth: { token: session.token }, transports: ['websocket'] });
  return socket;
}
export function closeSocket() { socket?.close(); socket = null; }
