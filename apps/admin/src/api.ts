import { io, Socket } from 'socket.io-client';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4100/v1';
const KEY = 'onspot.ops.session';

export interface OpsSession { token: string; user: { id: string; name: string; phone: string; role: string } }
export function getSession(): OpsSession | null {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
export function setSession(s: OpsSession | null) {
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
}

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const s = getSession();
  const res = await fetch(API_URL + path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: `Bearer ${s.token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { setSession(null); location.reload(); }
  if (!res.ok) throw new Error((Array.isArray(data.message) ? data.message[0] : data.message) || 'Request failed');
  return data as T;
}

let socket: Socket | null = null;
export function opsSocket() {
  const s = getSession();
  if (!s) return null;
  if (!socket) socket = io(API_URL.replace(/\/v1\/?$/, ''), { auth: { token: s.token }, transports: ['websocket'] });
  return socket;
}

export const rupee = (n?: number | null) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
// Ops work in IST regardless of the browser's time zone (IST is always UTC+5:30, no daylight saving).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ist = (d: string | Date | number) => new Date(new Date(d).getTime() + 330 * 60_000); // read with getUTC*()
export const hhmm = (d: string | Date) => { const t = ist(d), h = t.getUTCHours(); return `${h % 12 || 12}:${String(t.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
export const dayMonth = (d: string | Date | number) => { const t = ist(d); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`; };
export const ago = (d: string | Date | number) => {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : dayMonth(d);
};
