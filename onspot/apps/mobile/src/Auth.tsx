// Sign in: choose role → phone → 6-digit OTP → (first time) name.
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import type { Role } from '@onspot/shared';
import { api, saveSession, Session } from './api';
import { Button, C, Icon, IconCircle, Input, Row, T } from './ui';

export default function Auth({ onDone }: { onDone: (s: Session) => void }) {
  const [role, setRole] = useState<Role | null>(null);
  const [step, setStep] = useState<'phone' | 'code' | 'name'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => { setErr(''); setBusy(true); try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const requestCode = () => run(async () => { const r = await api('/auth/otp/request', { body: { phone } }); setDevCode(r.devCode ?? null); setCode(''); setStep('code'); });
  const verify = (withName?: string) => run(async () => {
    const r = await api('/auth/otp/verify', { body: { phone, code, role, name: withName } });
    if (r.needsName) { setStep('name'); await api('/auth/otp/request', { body: { phone } }).then(x => { setDevCode(x.devCode ?? null); setCode(x.devCode ?? ''); }); return; }
    const s: Session = { token: r.token, user: r.user }; await saveSession(s); onDone(s);
  });

  if (!role) return (
    <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 72, flexGrow: 1 }}>
      <Row gap={8}><View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}><Icon name="map-pin" size={16} color="#fff" /></View><T s="h3" style={{ fontSize: 20, fontWeight: '700' }}>OnSpot</T></Row>
      <T s="h1" style={{ fontSize: 38, marginTop: 40, lineHeight: 42 }}>Stuck? Help is{'\n'}<T s="h1" style={{ fontSize: 38, color: C.accent }}>on the spot.</T></T>
      <T style={{ color: C.muted, marginTop: 14, fontSize: 16 }}>Verified pros near you, at a price that's locked before they leave.</T>
      <View style={{ flex: 1 }} />
      {([['CUSTOMER', 'I need help', 'Towing, flat tyre, fuel, plumber and more', 'life-buoy'], ['PROVIDER', "I'm a service partner", 'Get jobs near you, on your schedule', 'tool']] as const).map(([r, t, d, i]) => (
        <Pressable key={r} onPress={() => setRole(r)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 16, borderWidth: 1, borderColor: C.line2, marginBottom: 12, backgroundColor: pressed ? C.surface2 : '#fff' })}>
          <IconCircle name={i} bg={r === 'CUSTOMER' ? C.accentSoft : C.surface2} color={r === 'CUSTOMER' ? C.accent : C.ink} />
          <View style={{ flex: 1 }}><T s="h3">{t}</T><T s="xs">{d}</T></View><Icon name="chevron-right" color={C.muted} />
        </Pressable>
      ))}
    </ScrollView>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 60 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => { setRole(null); setStep('phone'); setErr(''); }} style={{ marginBottom: 28 }}><Icon name="arrow-left" size={22} /></Pressable>
        {step === 'phone' && <>
          <T s="h2" style={{ fontSize: 26 }}>{role === 'CUSTOMER' ? 'Get help in minutes' : 'Earn on your schedule'}</T>
          <T style={{ color: C.muted, marginTop: 8, marginBottom: 24 }}>Enter your mobile number. We'll text you a 6-digit code.</T>
          <Input label="Mobile number" value={phone} onChangeText={t => setPhone(t.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" placeholder="98765 43210" autoFocus />
          <Button title="Continue" onPress={requestCode} disabled={phone.length !== 10} loading={busy} />
        </>}
        {step === 'code' && <>
          <T s="h2" style={{ fontSize: 26 }}>Enter the code</T>
          <T style={{ color: C.muted, marginTop: 8, marginBottom: 24 }}>Sent to +91 {phone}</T>
          <Input label="6-digit code" value={code} onChangeText={t => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" placeholder="••••••" autoFocus style={{ fontSize: 22, letterSpacing: 8, textAlign: 'center' }} />
          {devCode && <T s="xs" style={{ marginBottom: 12 }}>Development build: your code is {devCode}</T>}
          <Button title="Verify" onPress={() => verify()} disabled={code.length !== 6} loading={busy} />
          <Button title="Resend code" kind="ghost" onPress={requestCode} style={{ marginTop: 8 }} />
        </>}
        {step === 'name' && <>
          <T s="h2" style={{ fontSize: 26 }}>What's your name?</T>
          <T style={{ color: C.muted, marginTop: 8, marginBottom: 24 }}>{role === 'PROVIDER' ? 'Customers see this when you accept a job.' : 'Your provider sees this when they accept.'}</T>
          <Input label="Full name" value={name} onChangeText={setName} placeholder={role === 'PROVIDER' ? 'Sanjay Patil' : 'Rahul Sharma'} autoFocus />
          <Button title="Create account" onPress={() => verify(name.trim())} disabled={name.trim().length < 2 || code.length !== 6} loading={busy} />
        </>}
        {!!err && <T s="sm" style={{ color: C.danger, marginTop: 14 }}>{err}</T>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
