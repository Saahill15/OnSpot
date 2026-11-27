// Cross-screen pieces: toast, confirm, chat, timeline, star picker, and the JobView type.
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Image, Linking, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import type { Quote, ServiceCode } from '@onspot/shared';
import { Button, C, hhmm, Icon, Pill, Row, T } from './ui';

export interface JobView {
  id: string; status: string; service: ServiceCode; pickup: { lat: number; lng: number; label: string }; drop: { lat: number; lng: number } | null;
  quote: Quote; total: number; platformFee: number; finalAmount: number | null; providerPayout?: number | null; eta: number | null; radiusKm: number; offeredCount: number;
  startCode?: string; notes?: string; vehicle: string;
  customer: { name: string; phone?: string };
  provider: null | { id: string; name: string; phone?: string; rating: number; ratingCount: number; vehicleNo: string; verified: boolean; lat: number | null; lng: number | null; trust: Trust };
  photos?: { id: string; kind: 'BEFORE' | 'AFTER'; at: string; url: string }[];
  arrivedAuto: boolean;
  addons: { id: string; label: string; amount: number; reason: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' }[];
  messages?: { id: string; from: 'CUSTOMER' | 'PROVIDER'; text: string; at: string }[];
  events: { text: string; at: string }[];
  payment: null | { method: string; amount: number; status: string; ref: string };
  ratings: Record<string, { stars: number; comment: string }>;
  cancelReason: string | null; cancelFee: number; createdAt: string; startedAt: string | null; completedAt: string | null;
  tip: number; topRatedOnly: boolean; late: boolean; promisedBy: string | null;
  dispute?: null | { id: string; reason: string; details: string; status: "OPEN" | "RESOLVED"; resolution: string | null; refundAmount: number };
}
export const ACTIVE = ['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS'];
export interface Trust { score: number | null; onTimePct: number | null; reliabilityPct: number | null; cleanStreak: number; overchargeRefunds: number; jobsDone: number }

/** Compact trust line for customers: score + the most reassuring fact, or "New partner" until there's history. */
export function TrustBadge({ t }: { t?: Trust }) {
  if (!t) return null;
  if (t.score == null) return null; // not enough arrivals yet: show nothing rather than a misleading label
  const tone = t.score >= 85 ? 'ok' : t.score >= 70 ? 'warn' : 'gray';
  return <Row gap={6}><Pill tone={tone} icon="shield" text={`Trust ${t.score}`} />{t.onTimePct != null && <T s="xs">{t.onTimePct}% on time</T>}</Row>;
}

/** Proof-of-work thumbnails (before/after). Tapping opens the full photo. */
export function PhotoStrip({ photos, title = 'Proof of work', by = 'by the partner' }: { photos?: JobView['photos']; title?: string; by?: string }) {
  if (!photos?.length) return null;
  return (
    <View style={{ marginVertical: 12 }}>
      <Row style={{ marginBottom: 8 }}><Icon name="camera" size={16} /><T s="h3" style={{ fontSize: 15, flex: 1 }}>{title}</T>{!!by && <T s="xs">{by}</T>}</Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {photos.map(p => (
          <Pressable key={p.id} onPress={() => Linking.openURL(p.url)} accessibilityLabel={`${p.kind === 'BEFORE' ? 'Before' : 'After'} photo`} style={{ marginRight: 8 }}>
            <Image source={{ uri: p.url }} style={{ width: 96, height: 96, borderRadius: 12, backgroundColor: C.surface2 }} />
            <View style={{ position: 'absolute', left: 6, bottom: 6, backgroundColor: 'rgba(0,0,0,.65)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
              <T s="xs" style={{ color: '#fff', fontSize: 10.5 }}>{p.kind === 'BEFORE' ? 'Before' : 'After'} · {hhmm(p.at)}</T></View>
          </Pressable>))}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------- toast
type ToastMsg = { text: string; tone: 'ok' | 'err' | 'info' };
let pushToast: (t: ToastMsg) => void = () => {};
export const toast = (text: string, tone: ToastMsg['tone'] = 'info') => pushToast({ text, tone });
export function ToastHost() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const op = useRef(new Animated.Value(0)).current;
  const timer = useRef<any>(undefined);
  useEffect(() => {
    pushToast = t => {
      setMsg(t); clearTimeout(timer.current);
      Animated.timing(op, { toValue: 1, duration: 160, useNativeDriver: Platform.OS !== 'web' }).start();
      timer.current = setTimeout(() => Animated.timing(op, { toValue: 0, duration: 200, useNativeDriver: Platform.OS !== 'web' }).start(() => setMsg(null)), 3500);
    };
  }, []);
  if (!msg) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 54, left: 16, right: 16, opacity: op, zIndex: 100 }}>
      <View style={{ backgroundColor: msg.tone === 'err' ? C.danger : C.ink, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, elevation: 6 }}>
        <T s="sm" style={{ color: '#fff', fontWeight: '500' }}>{msg.text}</T>
      </View>
    </Animated.View>
  );
}

// ---------------------------------------------------------------- confirm sheet
// In-app bottom sheet instead of the browser/OS alert box, so confirmations look like the rest of OnSpot.
type ConfirmReq = { title: string; message: string; ok: string; danger: boolean; resolve: (v: boolean) => void };
let openConfirm: ((r: ConfirmReq) => void) | null = null;

export function confirm(title: string, message: string, ok = 'OK', danger = false): Promise<boolean> {
  return new Promise(resolve => {
    if (openConfirm) openConfirm({ title, message, ok, danger, resolve });
    else if (Platform.OS === 'web') resolve(window.confirm(`${title}\n\n${message}`)); // host not mounted yet
    else Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }, { text: ok, onPress: () => resolve(true) }]);
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const native = Platform.OS !== 'web';
  useEffect(() => {
    openConfirm = r => { setReq(r); anim.setValue(0); Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: native }).start(); };
    return () => { openConfirm = null; };
  }, []);
  if (!req) return null;
  const close = (v: boolean) => Animated.timing(anim, { toValue: 0, duration: 140, useNativeDriver: native }).start(() => { setReq(null); req.resolve(v); });
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 200, justifyContent: 'flex-end' }}>
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,.4)', opacity: anim }}>
        <Pressable style={{ flex: 1 }} onPress={() => close(false)} accessibilityLabel="Cancel" />
      </Animated.View>
      <Animated.View accessibilityRole="alert" style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 28,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [320, 0] }) }] }}>
        <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: C.line2, marginTop: -10, marginBottom: 18 }} />
        <T s="h2" style={{ fontSize: 20 }}>{req.title}</T>
        <T s="sm" style={{ color: C.muted, marginTop: 6, marginBottom: 22 }}>{req.message}</T>
        <Button kind={req.danger ? 'danger' : 'dark'} title={req.ok} onPress={() => close(true)} />
        <Button kind="ghost" title="Cancel" onPress={() => close(false)} style={{ marginTop: 6 }} />
      </Animated.View>
    </View>
  );
}

/** Runs an async action and surfaces errors as a toast. */
export async function act<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); } catch (e: any) { toast(e.message || 'Something went wrong', 'err'); return undefined; }
}

// ---------------------------------------------------------------- chat
export function ChatPanel({ job, me, onSend }: { job: JobView; me: 'CUSTOMER' | 'PROVIDER'; onSend: (t: string) => Promise<unknown> }) {
  const [text, setText] = useState('');
  const ref = useRef<any>(null); // RN 0.88 ScrollView instance type is not exported
  const quick = me === 'CUSTOMER' ? ['Where are you now?', "I'm next to the signboard", 'Please call me'] : ['On my way', 'Reached, where exactly?', '5 more minutes'];
  const send = async (t: string) => { if (!t.trim()) return; setText(''); await act(() => onSend(t.trim())); };
  const msgs = job.messages || [];
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 14, marginBottom: 12 }}>
      <Row style={{ marginBottom: 8 }}><T s="h3" style={{ flex: 1 }}>Messages</T><Icon name="lock" size={12} color={C.muted} /><T s="xs">Numbers stay private</T></Row>
      <ScrollView ref={ref} style={{ maxHeight: 220 }} onContentSizeChange={() => ref.current?.scrollToEnd({ animated: true })}>
        {msgs.length === 0 && <T s="xs" style={{ textAlign: 'center', paddingVertical: 10 }}>No messages yet</T>}
        {msgs.map(m => (
          <View key={m.id} style={{ alignSelf: m.from === me ? 'flex-end' : 'flex-start', maxWidth: '80%', backgroundColor: m.from === me ? C.ink : C.surface2, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9, marginBottom: 6 }}>
            <T s="sm" style={{ color: m.from === me ? '#fff' : C.ink }}>{m.text}</T>
            <T s="xs" style={{ color: m.from === me ? 'rgba(255,255,255,.6)' : C.muted, fontSize: 10.5 }}>{hhmm(m.at)}</T>
          </View>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
        {quick.map(q => <Pressable key={q} onPress={() => send(q)} style={{ borderWidth: 1, borderColor: C.line2, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7, marginRight: 6 }}><T s="xs" style={{ color: C.ink }}>{q}</T></Pressable>)}
      </ScrollView>
      <Row gap={8}>
        <TextInput value={text} onChangeText={setText} placeholder="Message" placeholderTextColor="#A0A0A0" onSubmitEditing={() => send(text)} returnKeyType="send"
          style={{ flex: 1, borderWidth: 1, borderColor: C.line2, borderRadius: 99, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: C.ink }} />
        <Pressable onPress={() => send(text)} accessibilityLabel="Send" style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name="send" size={17} color="#fff" /></Pressable>
      </Row>
    </View>
  );
}

export function Timeline({ job }: { job: JobView }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: C.line, paddingTop: 14, marginTop: 4 }}>
      <Pressable onPress={() => setOpen(!open)}><Row style={{ justifyContent: 'space-between' }}><T s="h3">Trip details</T><T s="sm" style={{ textDecorationLine: 'underline' }}>{open ? 'Hide' : 'Show'}</T></Row></Pressable>
      {open && <View style={{ marginTop: 14, borderLeftWidth: 1, borderLeftColor: C.line, paddingLeft: 14, gap: 12 }}>
        {[...job.events].reverse().map((e, i) => <View key={i}><T s="xs">{hhmm(e.at)}</T><T s="sm" style={{ color: C.ink2 }}>{e.text}</T></View>)}
      </View>}
    </View>
  );
}

export function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return <Row gap={6} style={{ justifyContent: 'center', marginVertical: 14 }}>{[1, 2, 3, 4, 5].map(i =>
    <Pressable key={i} onPress={() => onChange(i)} accessibilityLabel={`${i} stars`}><T style={{ fontSize: 36, color: i <= value ? C.ink : C.line2 }}>★</T></Pressable>)}</Row>;
}

export function Steps({ status }: { status: string }) {
  const n = ({ SEARCHING: 1, ASSIGNED: 2, ARRIVED: 3, IN_PROGRESS: 4, COMPLETED: 5, PAID: 5 } as Record<string, number>)[status] || 0;
  return <Row gap={4} style={{ marginBottom: 16 }}>{[1, 2, 3, 4, 5].map(i => <View key={i} style={{ flex: 1, height: 3, borderRadius: 3, backgroundColor: i <= n ? C.ink : C.line }} />)}</Row>;
}
