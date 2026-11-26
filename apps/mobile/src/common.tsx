// Cross-screen pieces: toast, confirm, chat, timeline, star picker, and the JobView type.
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import type { Quote, ServiceCode } from '@onspot/shared';
import { C, hhmm, Icon, Row, T } from './ui';

export interface JobView {
  id: string; status: string; service: ServiceCode; pickup: { lat: number; lng: number; label: string }; drop: { lat: number; lng: number } | null;
  quote: Quote; total: number; platformFee: number; finalAmount: number | null; providerPayout?: number | null; eta: number | null; radiusKm: number; offeredCount: number;
  startCode?: string; notes?: string; vehicle: string;
  customer: { name: string; phone?: string };
  provider: null | { id: string; name: string; phone?: string; rating: number; ratingCount: number; vehicleNo: string; verified: boolean; lat: number | null; lng: number | null };
  addons: { id: string; label: string; amount: number; reason: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' }[];
  messages?: { id: string; from: 'CUSTOMER' | 'PROVIDER'; text: string; at: string }[];
  events: { text: string; at: string }[];
  payment: null | { method: string; amount: number; status: string; ref: string };
  ratings: Record<string, { stars: number; comment: string }>;
  cancelReason: string | null; cancelFee: number; createdAt: string; startedAt: string | null; completedAt: string | null;
}
export const ACTIVE = ['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS'];

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

export async function confirm(title: string, message: string, ok = 'OK'): Promise<boolean> {
  if (Platform.OS === 'web') return window.confirm(`${title}\n\n${message}`);
  return new Promise(res => Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel', onPress: () => res(false) }, { text: ok, style: 'destructive', onPress: () => res(true) }]));
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
