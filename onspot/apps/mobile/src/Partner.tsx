// Partner (provider) app: earnings, go online, KYC, live offers, active job, live location.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import * as Location from 'expo-location';
import { EVENTS, JobOffer, LatLng, SERVICES, ServiceCode, SERVICE_BY_CODE } from '@onspot/shared';
import { api, getSocket } from './api';
import { act, ACTIVE, ChatPanel, confirm, JobView, Stars, toast } from './common';
import Map from './Map';
import type { MapMarker } from './mapTypes';
import { Avatar, Button, C, Card, Divider, hhmm, Icon, IconCircle, Input, Pill, Row, rupee, SERVICE_ICON, T } from './ui';

interface Me { id: string; name: string; services: ServiceCode[]; vehicleNo: string; online: boolean; lat: number | null; lng: number | null; rating: number; ratingCount: number; kycStatus: 'PENDING' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED'; earnings: number; jobsDone: number; activeJobId: string | null }
type Offer = Omit<JobOffer, 'expiresAt'> & { expiresAt?: string; receivedAt: number };
const OFFER_SEC = 20;
const DEMO = { lat: 18.7546, lng: 73.4062 };

export default function Partner({ onSignOut }: { onSignOut: () => void }) {
  const { height } = useWindowDimensions();
  const [me, setMe] = useState<Me | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [history, setHistory] = useState<JobView[]>([]);
  const [now, setNow] = useState(Date.now());
  const pos = useRef<LatLng | null>(null);

  const refresh = async () => {
    const d = await api<{ provider: Me; activeJob: JobView | null; offers: any[] }>('/provider/me');
    setMe(d.provider); setJob(d.activeJob); setOffers(d.offers.map(o => ({ ...o, receivedAt: Date.now() })));
    if (d.provider.lat != null) pos.current = { lat: d.provider.lat, lng: d.provider.lng! };
    api<JobView[]>('/jobs').then(l => setHistory(l.filter(j => ['COMPLETED', 'PAID'].includes(j.status)))).catch(() => {});
  };
  useEffect(() => { act(refresh); }, []);

  // realtime
  useEffect(() => {
    const s = getSocket(); if (!s) return;
    const onOffer = (o: JobOffer) => { setOffers(l => [...l.filter(x => x.jobId !== o.jobId), { ...o, receivedAt: Date.now() }]); toast(`New ${SERVICE_BY_CODE[o.service].name.toLowerCase()} request · ${o.km} km away`); };
    const onRevoke = ({ jobId }: { jobId: string }) => setOffers(l => l.filter(x => x.jobId !== jobId));
    const onJob = (j: JobView) => setJob(prev => {
      if (prev && prev.id !== j.id && ACTIVE.includes(prev.status)) return prev;
      if (prev && prev.status !== j.status && j.status === 'CANCELLED') toast('The customer cancelled this job', 'err');
      if (prev && prev.status !== j.status && j.status === 'PAID') toast(`Payment received · ${rupee(j.finalAmount)}`, 'ok');
      const pa = prev?.addons.filter(a => a.status !== 'PENDING').length || 0, na = j.addons.filter(a => a.status !== 'PENDING');
      if (prev && na.length > pa) { const a = na[na.length - 1]; toast(`Customer ${a.status === 'APPROVED' ? 'approved' : 'declined'} ${a.label}`, a.status === 'APPROVED' ? 'ok' : 'err'); }
      const last = j.messages?.[j.messages.length - 1];
      if (prev && last && (prev.messages?.length || 0) < (j.messages?.length || 0) && last.from === 'CUSTOMER') toast(`${j.customer.name}: ${last.text}`);
      return j;
    });
    const onKyc = ({ status }: { status: Me['kycStatus'] }) => { setMe(m => m && { ...m, kycStatus: status }); toast(status === 'VERIFIED' ? 'KYC approved. You can go online now.' : 'KYC rejected. Please resubmit.', status === 'VERIFIED' ? 'ok' : 'err'); };
    s.on(EVENTS.JOB_OFFER, onOffer); s.on(EVENTS.JOB_OFFER_REVOKED, onRevoke); s.on(EVENTS.JOB_UPDATED, onJob); s.on(EVENTS.KYC_UPDATED, onKyc);
    return () => { s.off(EVENTS.JOB_OFFER, onOffer); s.off(EVENTS.JOB_OFFER_REVOKED, onRevoke); s.off(EVENTS.JOB_UPDATED, onJob); s.off(EVENTS.KYC_UPDATED, onKyc); };
  }, []);

  // offer countdown + auto-decline
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const expired = offers.filter(o => now - o.receivedAt > OFFER_SEC * 1000);
    if (expired.length) { expired.forEach(o => api(`/jobs/${o.jobId}/decline`, { body: {} }).catch(() => {})); setOffers(l => l.filter(o => !expired.includes(o))); }
  }, [now]);

  // live GPS while online (every ~5 s); the API turns it into ETA for the customer
  useEffect(() => {
    if (!me?.online) return;
    let sub: Location.LocationSubscription | undefined;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 25 }, p => {
        if (simRef.current) return; // the dev "simulate drive" is moving us
        pos.current = { lat: p.coords.latitude, lng: p.coords.longitude };
        api('/provider/location', { body: pos.current }).catch(() => {});
      });
    })();
    return () => sub?.remove();
  }, [me?.online]);

  // dev helper: drive toward the customer so the full flow can be demoed from a desk
  const simRef = useRef<any>(null);
  const simulate = () => {
    if (!job || !pos.current) return;
    clearInterval(simRef.current);
    const start = { ...pos.current }, end = job.pickup; let i = 0;
    simRef.current = setInterval(() => {
      i++; const f = Math.min(1, i / 15);
      pos.current = { lat: start.lat + (end.lat - start.lat) * f, lng: start.lng + (end.lng - start.lng) * f };
      setMe(m => m && { ...m, lat: pos.current!.lat, lng: pos.current!.lng });
      api('/provider/location', { body: pos.current }).catch(() => {});
      if (f >= 1) { clearInterval(simRef.current); simRef.current = null; }
    }, 1000);
  };
  useEffect(() => () => clearInterval(simRef.current), []);

  const getPosition = async (): Promise<LatLng | null> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') { const p = await Location.getCurrentPositionAsync({}); return { lat: p.coords.latitude, lng: p.coords.longitude }; }
    } catch {}
    return pos.current;
  };
  const toggleOnline = async () => {
    if (!me) return;
    const at = me.online ? null : (await getPosition()) || (Platform.OS === 'web' ? DEMO : null);
    if (!me.online && !at) return toast('Allow location access to go online', 'err');
    const r = await act(() => api<Me>('/provider/status', { body: { online: !me.online, ...(at || {}) } }));
    if (r) { setMe(r); if (at) pos.current = at; toast(r.online ? "You're online. Keep the app open to get jobs." : "You're offline", r.online ? 'ok' : 'info'); }
  };

  const active = job && ACTIVE.includes(job.status) ? job : null;
  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    if (me?.lat != null) m.push({ id: 'me', lat: me.lat, lng: me.lng!, kind: 'assigned', service: active?.service || me.services[0] });
    if (active) m.push({ id: 'cust', lat: active.pickup.lat, lng: active.pickup.lng, kind: 'me' });
    else offers.forEach(o => m.push({ id: o.jobId, lat: o.pickup.lat, lng: o.pickup.lng, kind: 'me' }));
    return m;
  }, [me?.lat, me?.lng, active?.id, offers.length]);

  if (!me) return <View style={{ flex: 1, backgroundColor: '#fff' }} />;
  const showJob = job && (ACTIVE.includes(job.status) || ['COMPLETED', 'PAID', 'CANCELLED'].includes(job.status));
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Map height={height * 0.3} center={me.lat != null ? { lat: me.lat, lng: me.lng! } : DEMO} markers={markers}
        route={active?.status === 'ASSIGNED' && me.lat != null ? [{ lat: me.lat, lng: me.lng! }, active.pickup] : null} />
      <ScrollView style={{ flex: 1, marginTop: -20, backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22 }} contentContainerStyle={{ padding: 20, paddingTop: 22, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {!active && offers.map(o => <OfferCard key={o.jobId} o={o} now={now} onAccept={async () => {
          const j = await act(() => api<JobView>(`/jobs/${o.jobId}/accept`, { body: {} }));
          setOffers([]); if (j) { setJob(j); toast('Job accepted. Head to the customer.', 'ok'); } else act(refresh);
        }} onDecline={() => { api(`/jobs/${o.jobId}/decline`, { body: {} }).catch(() => {}); setOffers(l => l.filter(x => x.jobId !== o.jobId)); }} />)}
        {showJob ? <JobPanel job={job!} setJob={setJob} onSimulate={simulate} onDone={() => { setJob(null); act(refresh); }} />
          : <Dashboard me={me} setMe={setMe} history={history} onToggle={toggleOnline} onSignOut={onSignOut} />}
      </ScrollView>
    </View>
  );
}

function OfferCard({ o, now, onAccept, onDecline }: { o: Offer; now: number; onAccept: () => void; onDecline: () => void }) {
  const left = Math.max(0, OFFER_SEC - Math.floor((now - o.receivedAt) / 1000));
  return (
    <View style={{ borderWidth: 1, borderColor: C.line2, borderRadius: 20, padding: 18, marginBottom: 14, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 }}>
      <Row><IconCircle name={SERVICE_ICON[o.service]} /><View style={{ flex: 1 }}><T s="label" style={{ color: C.accent }}>New request · {SERVICE_BY_CODE[o.service].name}</T><T s="h3">{o.customerName} · {o.km} km away</T>{!!o.pickup.label && <T s="xs" numberOfLines={1}>{o.pickup.label}</T>}</View><Pill tone="accent" text={`${left}s`} /></Row>
      <Row style={{ marginTop: 12, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}><T s="xs">You earn</T><T s="h1" style={{ fontSize: 32 }}>{rupee(o.payout)}</T></View>
        <View style={{ alignItems: 'flex-end' }}><T s="xs">Customer pays (locked)</T><T s="h3">{rupee(o.fare)}</T></View>
      </Row>
      <View style={{ height: 3, backgroundColor: C.line, borderRadius: 3, marginVertical: 14, overflow: 'hidden' }}><View style={{ width: `${(left / OFFER_SEC) * 100}%`, height: 3, backgroundColor: C.accent }} /></View>
      <Row><Button title="Accept" kind="dark" onPress={onAccept} style={{ flex: 1 }} /><Button title="Decline" kind="outline" onPress={onDecline} /></Row>
    </View>
  );
}

function Dashboard({ me, setMe, history, onToggle, onSignOut }: { me: Me; setMe: (m: Me) => void; history: JobView[]; onToggle: () => void; onSignOut: () => void }) {
  const [vehicleNo, setVehicleNo] = useState(me.vehicleNo);
  const today = new Date().toDateString();
  const todays = history.filter(j => new Date(j.completedAt || j.createdAt).toDateString() === today);
  const patch = (body: object) => act(() => api<Me>('/provider/me', { method: 'PATCH', body })).then(r => r && setMe({ ...me, ...r }));
  return (
    <>
      <View style={{ backgroundColor: C.ink, borderRadius: 20, padding: 20, marginBottom: 14 }}>
        <T s="label" style={{ color: 'rgba(255,255,255,.7)' }}>Today's earnings</T>
        <T s="h1" style={{ color: '#fff', fontSize: 40, marginBottom: 14 }}>{rupee(todays.reduce((t, j) => t + (j.providerPayout || 0), 0))}</T>
        <Row gap={0} style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.15)', paddingTop: 14 }}>
          {[[String(todays.length), 'jobs today'], [`★ ${me.rating.toFixed(1)}`, 'rating'], [rupee(me.earnings), 'all time']].map(([b, l]) => <View key={l} style={{ flex: 1 }}><T s="h3" style={{ color: '#fff' }}>{b}</T><T s="xs" style={{ color: 'rgba(255,255,255,.65)' }}>{l}</T></View>)}
        </Row>
      </View>
      <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16, borderRadius: 14, backgroundColor: me.online ? C.okSoft : C.accent, marginBottom: 14 }}>
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: me.online ? C.ok : '#fff' }} />
        <T s="h3" style={{ color: me.online ? C.ok : '#fff' }}>{me.online ? "You're online · tap to go offline" : 'Go online'}</T>
      </Pressable>
      {me.kycStatus !== 'VERIFIED' && <Kyc me={me} setMe={setMe} />}
      <T s="h3" style={{ fontSize: 18, marginTop: 12, marginBottom: 10 }}>Recent jobs</T>
      {history.length ? history.slice(0, 5).map(j => <Row key={j.id} gap={12} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <IconCircle name={SERVICE_ICON[j.service]} size={36} /><View style={{ flex: 1 }}><T s="sm" style={{ fontWeight: '600' }}>{j.customer.name}</T><T s="xs">{SERVICE_BY_CODE[j.service].name} · {hhmm(j.completedAt || j.createdAt)}{j.ratings.CUSTOMER ? ` · ★ ${j.ratings.CUSTOMER.stars}` : ''}</T></View><T s="h3" style={{ fontSize: 14 }}>{rupee(j.providerPayout)}</T>
      </Row>) : <Card soft><T s="sm" style={{ color: C.muted, textAlign: 'center' }}>Your completed jobs and payouts will show here.</T></Card>}
      <T s="h3" style={{ fontSize: 18, marginTop: 22, marginBottom: 10 }}>Services I offer</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SERVICES.map(s => { const on = me.services.includes(s.code); return <Pressable key={s.code} onPress={() => patch({ services: on ? me.services.filter(x => x !== s.code) : [...me.services, s.code] })}
          style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: on ? C.ink : C.line2, backgroundColor: on ? C.ink : '#fff' }}><T s="sm" style={{ color: on ? '#fff' : C.ink }}>{s.name}</T></Pressable>; })}
      </View>
      <T s="h3" style={{ fontSize: 18, marginTop: 22, marginBottom: 10 }}>Vehicle or shop</T>
      <Input value={vehicleNo} onChangeText={t => setVehicleNo(t.toUpperCase())} onEndEditing={() => patch({ vehicleNo })} onBlur={() => vehicleNo !== me.vehicleNo && patch({ vehicleNo })} placeholder="Vehicle number, e.g. MH 12 AB 1234" />
      <Divider />
      <Button kind="danger" title="Sign out" onPress={onSignOut} />
    </>
  );
}

function Kyc({ me, setMe }: { me: Me; setMe: (m: Me) => void }) {
  const [f, setF] = useState({ idType: 'AADHAAR', idLast4: '', dlNumber: '', upiId: '' });
  if (me.kycStatus === 'SUBMITTED') return <Card style={{ backgroundColor: C.warnSoft, borderColor: 'transparent' }}><Row style={{ alignItems: 'flex-start' }}><Icon name="clock" size={18} color={C.warn} /><T s="sm" style={{ flex: 1 }}><T s="sm" style={{ fontWeight: '600' }}>KYC under review.</T> Usually within 24 hours. You'll be notified here.</T></Row></Card>;
  return (
    <Card>
      <Row style={{ marginBottom: 14, alignItems: 'flex-start' }}><Icon name="credit-card" size={20} /><View style={{ flex: 1 }}><T s="h3">{me.kycStatus === 'REJECTED' ? 'KYC rejected. Please resubmit.' : 'Verify your identity to go online'}</T><T s="xs">Required before you can receive jobs. Earns you the Verified badge.</T></View></Row>
      <Row style={{ marginBottom: 12 }}>{(['AADHAAR', 'PAN'] as const).map(t => <Pressable key={t} onPress={() => setF({ ...f, idType: t })} style={{ flex: 1, padding: 10, borderRadius: 10, borderWidth: f.idType === t ? 2 : 1, borderColor: f.idType === t ? C.ink : C.line2, alignItems: 'center' }}><T s="sm" style={{ fontWeight: '600' }}>{t === 'AADHAAR' ? 'Aadhaar' : 'PAN'}</T></Pressable>)}</Row>
      <Input label="Last 4 digits of ID" value={f.idLast4} onChangeText={t => setF({ ...f, idLast4: t.replace(/\D/g, '').slice(0, 4) })} keyboardType="number-pad" placeholder="1234" />
      <Input label="Driving licence number" value={f.dlNumber} onChangeText={t => setF({ ...f, dlNumber: t.toUpperCase() })} placeholder="MH12 20190001234" autoCapitalize="characters" />
      <Input label="UPI ID for payouts" value={f.upiId} onChangeText={t => setF({ ...f, upiId: t.trim() })} placeholder="name@okbank" autoCapitalize="none" />
      <Button kind="dark" title="Submit for verification" onPress={() => act(() => api<Me>('/provider/kyc', { body: f })).then(r => { if (r) { setMe({ ...me, ...r }); toast('KYC submitted for review', 'ok'); } })} />
    </Card>
  );
}

function JobPanel({ job, setJob, onSimulate, onDone }: { job: JobView; setJob: (j: JobView) => void; onSimulate: () => void; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [addon, setAddon] = useState<{ label: string; amount: string; reason: string } | null>(null);
  const [stars, setStars] = useState(5);
  const call = (path: string, body: object = {}) => act(() => api<JobView>(`/jobs/${job.id}/${path}`, { body })).then(r => { if (r && (r as any).id) setJob(r); return r; });
  const pending = job.addons.some(a => a.status === 'PENDING');
  const head = (
    <Row gap={12} style={{ marginBottom: 16 }}>
      <IconCircle name={SERVICE_ICON[job.service]} />
      <View style={{ flex: 1 }}><T s="label">{SERVICE_BY_CODE[job.service].name}</T><T s="h3">{job.customer.name} <T s="xs">{job.customer.phone}</T></T>{!!job.pickup.label && <T s="xs" numberOfLines={1}>{job.pickup.label}{job.notes ? ` · "${job.notes}"` : ''}</T>}</View>
      <Pressable onPress={() => Linking.openURL('tel:0000000000')} accessibilityLabel="Call customer"><IconCircle name="phone" size={40} /></Pressable>
    </Row>
  );
  const chat = ACTIVE.includes(job.status) && <ChatPanel job={job} me="PROVIDER" onSend={t => api(`/jobs/${job.id}/messages`, { body: { text: t } }).then(setJob)} />;
  if (job.status === 'ASSIGNED') return <>{head}
    <Row style={{ marginBottom: 12 }}><T s="h2" style={{ flex: 1 }}>Head to customer</T><T s="h3" style={{ color: C.accent }}>{job.eta ?? '—'} min</T></Row>
    <Card soft><Row><T s="sm" style={{ flex: 1 }}>Locked fare</T><T s="h3">{rupee(job.total)}</T></Row>{job.drop && <T s="xs" style={{ marginTop: 4 }}>Tow {job.quote.towKm} km to the drop point</T>}</Card>
    <View style={{ gap: 10 }}>
      <Button kind="dark" icon="navigation" title="Navigate in Google Maps" onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${job.pickup.lat},${job.pickup.lng}`)} />
      {__DEV__ && <Button kind="outline" title="Simulate drive (dev)" onPress={onSimulate} />}
      <Button title="I've arrived" onPress={() => call('arrived')} />
      <Button kind="ghost" title="Can't make it? Release job" onPress={async () => { if (await confirm('Release this job?', 'It will go to another provider. Frequent releases lower your score.', 'Release')) { await call('cancel'); onDone(); } }} />
    </View>{chat}</>;
  if (job.status === 'ARRIVED') return <>{head}
    <T s="h2">Ask for the 4-digit start code</T>
    <T s="sm" style={{ color: C.muted, marginVertical: 8 }}>The job starts only once you enter the code shown in the customer's app.</T>
    <Input value={code} onChangeText={t => setCode(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" placeholder="• • • •" style={{ fontSize: 28, textAlign: 'center', letterSpacing: 12, fontWeight: '700' }} />
    <Button title="Verify and start" disabled={code.length !== 4} onPress={() => call('start', { code })} />{chat}</>;
  if (job.status === 'IN_PROGRESS') return <>{head}
    <Row style={{ marginBottom: 12 }}><T s="h2" style={{ flex: 1 }}>Job in progress</T><Pill text={`since ${hhmm(job.startedAt!)}`} /></Row>
    {job.addons.length > 0 && <Card>{job.addons.map(a => <Row key={a.id} style={{ justifyContent: 'space-between', paddingVertical: 4 }}><T s="sm" style={{ flex: 1 }}>{a.label}</T><Pill tone={a.status === 'APPROVED' ? 'ok' : a.status === 'REJECTED' ? 'gray' : 'warn'} text={a.status.toLowerCase()} /><T s="sm" style={{ width: 60, textAlign: 'right' }}>{rupee(a.amount)}</T></Row>)}</Card>}
    <Card soft>
      <Row><View style={{ flex: 1 }}><T s="sm" style={{ fontWeight: '600' }}>Parts, tolls or extra work?</T><T s="xs">The customer approves in their app before it's billed.</T></View><Button small kind="outline" title={addon ? 'Close' : 'Add item'} onPress={() => setAddon(addon ? null : { label: '', amount: '', reason: '' })} /></Row>
      {addon && <View style={{ marginTop: 12 }}>
        <Input placeholder="Item, e.g. New tube" value={addon.label} onChangeText={t => setAddon({ ...addon, label: t })} />
        <Input placeholder="Amount ₹" keyboardType="number-pad" value={addon.amount} onChangeText={t => setAddon({ ...addon, amount: t.replace(/\D/g, '') })} />
        <Input placeholder="Reason (optional)" value={addon.reason} onChangeText={t => setAddon({ ...addon, reason: t })} />
        <Button kind="dark" title="Send for approval" disabled={!addon.label || !addon.amount} onPress={() => call('addons', { label: addon.label, amount: +addon.amount, reason: addon.reason }).then(r => { if (r) { setAddon(null); toast('Sent to the customer for approval'); } })} />
      </View>}
    </Card>
    <Button kind="dark" title={pending ? 'Waiting for customer approval…' : 'Mark job complete'} disabled={pending} onPress={() => call('complete')} />{chat}</>;
  if (job.status === 'COMPLETED' || job.status === 'PAID') return <>{head}
    <View style={{ alignSelf: 'center' }}><IconCircle name="check" size={64} bg={C.okSoft} color={C.ok} /></View>
    <T s="h2" style={{ textAlign: 'center', marginTop: 12 }}>{job.status === 'PAID' ? 'Payment received' : 'Job complete'}</T>
    <T s="sm" style={{ textAlign: 'center', color: C.muted, marginVertical: 8 }}>{job.status === 'PAID' ? `${rupee(job.finalAmount)} via ${job.payment?.method.toUpperCase()}. Payout to your UPI tomorrow.` : `The customer is paying ${rupee(job.finalAmount)} in the app.`}</T>
    <Card><Row style={{ justifyContent: 'space-between' }}><T s="sm">Customer total</T><T s="sm">{rupee(job.finalAmount)}</T></Row><Row style={{ justifyContent: 'space-between', marginTop: 8 }}><T s="sm">Platform fee + 10% commission</T><T s="sm">− {rupee((job.finalAmount || 0) - (job.providerPayout || 0))}</T></Row><Divider /><Row style={{ justifyContent: 'space-between' }}><T s="h3">You earn</T><T s="h3">{rupee(job.providerPayout)}</T></Row></Card>
    {job.status === 'PAID' && !job.ratings.PROVIDER && <><T s="h3" style={{ textAlign: 'center' }}>Rate {job.customer.name}</T><Stars value={stars} onChange={setStars} /></>}
    <Button title="Back to dashboard" onPress={async () => { if (job.status === 'PAID' && !job.ratings.PROVIDER) await call('rate', { stars }); onDone(); }} /></>;
  return <>{head}
    <View style={{ alignSelf: 'center' }}><IconCircle name="x" size={64} bg={C.dangerSoft} color={C.danger} /></View>
    <T s="h2" style={{ textAlign: 'center', marginTop: 12 }}>Job cancelled</T>
    <T s="sm" style={{ textAlign: 'center', color: C.muted, marginVertical: 8 }}>{job.cancelFee ? `The customer cancelled after you arrived, so they're charged a ${rupee(job.cancelFee)} visit fee.` : 'No action needed.'}</T>
    <Button title="Back to dashboard" onPress={onDone} /></>;
}
