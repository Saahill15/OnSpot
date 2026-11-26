// Customer app: Help (home → quote → live trip → bill → rating), Activity, Account.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Linking, Platform, Pressable, ScrollView, Share, TextInput, View, useWindowDimensions } from 'react-native';
import * as Location from 'expo-location';
import { CANCEL_REASONS, EVENTS, LatLng, Quote, SERVICES, ServiceCode, SERVICE_BY_CODE } from '@onspot/shared';
import { api, getSession, getSocket } from './api';
import { act, ACTIVE, ChatPanel, confirm, JobView, Stars, Steps, Timeline, toast } from './common';
import Map from './Map';
import type { MapMarker } from './mapTypes';
import { Avatar, BillLines, Button, C, Card, Divider, hhmm, Icon, IconCircle, IconName, Input, Pill, Row, rupee, SERVICE_ICON, T } from './ui';

const DEMO_SPOT = { lat: 18.7546, lng: 73.4062, label: 'Lonavala, Mumbai–Pune Expressway' };
const SYMPTOMS: [string, ServiceCode, IconName][] = [["Won't start", 'battery', 'battery-charging'], ['Flat tyre', 'puncture', 'disc'], ['Out of fuel', 'fuel', 'droplet'], ["Can't drive it", 'tow', 'truck'], ['Noise or smoke', 'mechanic', 'tool'], ['Locked out', 'locksmith', 'key'], ['Water leak', 'plumber', 'droplet'], ['No power', 'electrician', 'zap']];

type Tab = 'help' | 'activity' | 'account';
interface Profile { id: string; name: string; phone: string; contacts: { name: string; phone: string }[]; vehicle: { model: string; plate: string; fuel: string } | null; shield: boolean; shieldUntil: string | null }

export default function Customer({ onSignOut }: { onSignOut: () => void }) {
  const { height } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>('help');
  const [me, setMe] = useState<Profile | null>(null);
  const [spot, setSpot] = useState<LatLng & { label: string }>(DEMO_SPOT);
  const [avail, setAvail] = useState<Record<string, { count: number; etaMin: number | null }>>({});
  const [sel, setSel] = useState<ServiceCode | null>(null);
  const [job, setJob] = useState<JobView | null>(null);

  // boot: profile, any unfinished job, GPS
  useEffect(() => {
    api<Profile>('/me').then(setMe).catch(() => {});
    api<JobView[]>('/jobs').then(list => {
      const j = list.find(x => ACTIVE.includes(x.status) || x.status === 'COMPLETED' || (x.status === 'PAID' && !x.ratings.CUSTOMER));
      if (j) setJob(j);
    }).catch(() => {});
    locate(false);
  }, []);
  const locate = async (explicit: boolean) => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { if (explicit) toast('Location permission denied. Tap the map to set your spot.', 'err'); return; }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setSpot({ lat: p.coords.latitude, lng: p.coords.longitude, label: 'Your current location' });
    } catch { if (explicit) toast('Could not get your location. Tap the map instead.', 'err'); }
  };
  useEffect(() => { api(`/jobs/availability?lat=${spot.lat}&lng=${spot.lng}`).then(setAvail).catch(() => {}); }, [spot.lat, spot.lng]);

  // realtime
  useEffect(() => {
    const s = getSocket(); if (!s) return;
    const onJob = (j: JobView) => setJob(prev => {
      if (prev && prev.id !== j.id) return prev;
      if (prev && prev.status !== j.status) {
        const m: Record<string, string> = { ASSIGNED: `${j.provider?.name} accepted · about ${j.eta} min away`, ARRIVED: `${j.provider?.name} has arrived. Share your start code.`, COMPLETED: 'Job done. Please review the bill.', NO_PROVIDER: 'No provider available right now' };
        if (m[j.status]) toast(m[j.status], j.status === 'NO_PROVIDER' ? 'err' : 'ok');
      }
      const last = j.messages?.[j.messages.length - 1];
      if (prev && last && (prev.messages?.length || 0) < (j.messages?.length || 0) && last.from === 'PROVIDER') toast(`${j.provider?.name}: ${last.text}`);
      return j;
    });
    const onLoc = (l: { jobId: string; lat: number; lng: number; eta: number }) => setJob(prev => prev && prev.id === l.jobId && prev.provider ? { ...prev, eta: l.eta, provider: { ...prev.provider, lat: l.lat, lng: l.lng } } : prev);
    s.on(EVENTS.JOB_UPDATED, onJob); s.on(EVENTS.PROVIDER_LOCATION, onLoc);
    return () => { s.off(EVENTS.JOB_UPDATED, onJob); s.off(EVENTS.PROVIDER_LOCATION, onLoc); };
  }, []);

  const markers = useMemo<MapMarker[]>(() => {
    const at = job ? job.pickup : spot;
    const m: MapMarker[] = [{ id: 'me', lat: at.lat, lng: at.lng, kind: 'me' }];
    if (job?.drop) m.push({ id: 'drop', lat: job.drop.lat, lng: job.drop.lng, kind: 'drop' });
    if (job?.provider?.lat != null && ACTIVE.includes(job.status)) m.push({ id: 'pro', lat: job.provider.lat, lng: job.provider.lng!, kind: 'assigned', service: job.service });
    return m;
  }, [job, spot]);
  const route = job?.status === 'ASSIGNED' && job.provider?.lat != null ? [{ lat: job.provider.lat, lng: job.provider.lng! }, job.pickup] : null;

  let body: React.ReactNode;
  if (tab === 'activity') body = <Activity />;
  else if (tab === 'account') body = <Account me={me} setMe={setMe} onSignOut={onSignOut} />;
  else if (job && job.status === 'SEARCHING') body = <Searching job={job} />;
  else if (job && ACTIVE.includes(job.status)) body = <LiveTrip job={job} setJob={setJob} />;
  else if (job && job.status === 'COMPLETED') body = <Bill job={job} setJob={setJob} />;
  else if (job && job.status === 'PAID' && !job.ratings.CUSTOMER) body = <RateJob job={job} setJob={setJob} />;
  else if (job) body = <Ended job={job} onDone={() => { setJob(null); setSel(null); }} onRetry={() => { setSel(job.service); setJob(null); }} />;
  else if (sel) body = <QuoteScreen service={sel} spot={spot} me={me} onBack={() => setSel(null)} onCreated={setJob} onShield={() => setTab('account')} />;
  else body = <Home spot={spot} setSpot={setSpot} avail={avail} onPick={setSel} onLocate={() => locate(true)} />;

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {tab === 'help' && <Map height={height * 0.36} center={job ? job.pickup : spot} markers={markers} route={route}
        onPress={p => { if (!job && !sel) setSpot({ ...p, label: 'Pinned on map' }); }} />}
      <ScrollView style={{ flex: 1, marginTop: tab === 'help' ? -20 : 0, backgroundColor: '#fff', borderTopLeftRadius: tab === 'help' ? 22 : 0, borderTopRightRadius: tab === 'help' ? 22 : 0 }}
        contentContainerStyle={{ padding: 20, paddingTop: tab === 'help' ? 22 : 56, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
      <TabBar tab={tab} setTab={setTab} />
    </View>
  );
}

function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: [Tab, string, IconName][] = [['help', 'Help', 'home'], ['activity', 'Activity', 'list'], ['account', 'Account', 'user']];
  return (
    <Row gap={0} style={{ borderTopWidth: 1, borderTopColor: C.line, backgroundColor: '#fff', paddingBottom: Platform.OS === 'ios' ? 24 : 8, paddingTop: 8 }}>
      {items.map(([k, l, i]) => <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, alignItems: 'center', gap: 3 }} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}>
        <Icon name={i} size={22} color={tab === k ? C.accent : C.muted} /><T s="xs" style={{ color: tab === k ? C.accent : C.muted, fontWeight: '500' }}>{l}</T>
      </Pressable>)}
    </Row>
  );
}

// ---------------------------------------------------------------- home
function Home({ spot, setSpot, avail, onPick, onLocate }: { spot: LatLng & { label: string }; setSpot: (s: any) => void; avail: Record<string, { count: number; etaMin: number | null }>; onPick: (s: ServiceCode) => void; onLocate: () => void }) {
  const [edit, setEdit] = useState(false);
  const total = Object.values(avail).reduce((t, a) => Math.max(t, a.count), 0);
  return (
    <>
      <Pressable onPress={() => setEdit(!edit)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: C.line2, borderRadius: 99, padding: 8, paddingRight: 18, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 }}>
        <IconCircle name="map-pin" size={40} bg={C.accent} color="#fff" />
        <View style={{ flex: 1 }}><T s="h3" numberOfLines={1} style={{ fontSize: 14 }}>{spot.label}</T><T s="xs">{total ? 'Pros available nearby' : 'Looking for pros nearby…'}</T></View>
        <T s="sm" style={{ fontWeight: '600', textDecorationLine: 'underline' }}>{edit ? 'Done' : 'Edit'}</T>
      </Pressable>
      {edit && <View style={{ paddingTop: 14 }}>
        <Input placeholder="Landmark or km stone, e.g. Km 62 near Lonavala exit" onSubmitEditing={e => { setSpot({ ...spot, label: e.nativeEvent.text || spot.label }); setEdit(false); }} />
        <Row><Button small kind="outline" icon="navigation" title="Use my GPS" onPress={onLocate} /><T s="xs" style={{ flex: 1 }}>Or tap the map to drop a pin.</T></Row>
      </View>}

      <T s="h2" style={{ marginTop: 24, marginBottom: 12 }}>What happened?</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 6 }}>
        {SYMPTOMS.map(([t, code, i]) => <Pressable key={t} onPress={() => onPick(code)} style={{ alignItems: 'center', gap: 8, width: 78, paddingVertical: 8 }}>
          <IconCircle name={i} size={52} /><T s="xs" style={{ textAlign: 'center', color: C.ink2 }}>{t}</T>
        </Pressable>)}
      </ScrollView>

      {(['Roadside', 'Home'] as const).map(g => <View key={g}>
        <T s="h3" style={{ fontSize: 18, marginTop: 24, marginBottom: 12 }}>{g === 'Home' ? 'At home' : g}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {SERVICES.filter(s => s.group === g).map(s => { const a = avail[s.code]; return (
            <Pressable key={s.code} onPress={() => onPick(s.code)} style={({ pressed }) => ({ width: '47.5%', borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 16, backgroundColor: pressed ? C.surface2 : '#fff' })}>
              <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}><IconCircle name={SERVICE_ICON[s.code]} /><Pill tone={a?.count ? 'ok' : 'gray'} icon={a?.count ? 'clock' : undefined} text={a?.count ? `~${a.etaMin} min` : 'Unavailable'} /></Row>
              <T s="h3">{s.name}</T><T s="xs">From {rupee(s.base)}</T>
            </Pressable>); })}
        </View>
      </View>)}
      <Card soft style={{ marginTop: 24 }}><Row style={{ alignItems: 'flex-start' }}><Icon name="lock" size={18} /><T s="sm" style={{ flex: 1, color: C.ink2 }}><T s="sm" style={{ fontWeight: '600' }}>Fair Price Lock.</T> The price you see before booking is the most you pay. Extras need your approval.</T></Row></Card>
      <Pressable onPress={() => Linking.openURL('tel:112')}><T s="sm" style={{ textAlign: 'center', color: C.muted, marginTop: 8 }}>Medical emergency? Call <T s="sm" style={{ textDecorationLine: 'underline' }}>112</T></T></Pressable>
    </>
  );
}

// ---------------------------------------------------------------- quote / booking
function garages(at: LatLng) {
  const off = (km: number, deg: number) => { const b = (deg * Math.PI) / 180; return { lat: at.lat + (km / 111) * Math.cos(b), lng: at.lng + (km / (111 * Math.cos((at.lat * Math.PI) / 180))) * Math.sin(b) }; };
  return [{ name: 'OnSpot partner garage', ...off(4, 40), km: 5.4 }, { name: 'Highway Motors (24×7)', ...off(7.5, 160), km: 10.1 }, { name: 'Authorised service centre', ...off(12, 290), km: 16.2 }];
}
function QuoteScreen({ service, spot, me, onBack, onCreated, onShield }: { service: ServiceCode; spot: LatLng & { label: string }; me: Profile | null; onBack: () => void; onCreated: (j: JobView) => void; onShield: () => void }) {
  const s = SERVICE_BY_CODE[service];
  const gs = useMemo(() => garages(spot), [spot.lat, spot.lng]);
  const [dropIdx, setDropIdx] = useState(0);
  const [q, setQ] = useState<{ quote: Quote; nearby: number } | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const drop = service === 'tow' ? gs[dropIdx] : null;
  useEffect(() => { setQ(null); act(() => api('/jobs/quote', { body: { service, pickup: spot, drop: drop && { lat: drop.lat, lng: drop.lng } } })).then(r => r && setQ(r)); }, [service, spot.lat, spot.lng, dropIdx]);
  const request = async () => {
    setBusy(true);
    const v = me?.vehicle;
    const j = await act(() => api<JobView>('/jobs', { body: { service, pickup: { lat: spot.lat, lng: spot.lng, label: spot.label }, drop: drop && { lat: drop.lat, lng: drop.lng }, notes, vehicle: v ? `${v.model} ${v.plate}`.trim() : '' } }));
    setBusy(false); if (j) onCreated(j);
  };
  return (
    <>
      <Row gap={14} style={{ marginBottom: 18 }}>
        <Pressable onPress={onBack} accessibilityLabel="Back" style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: C.line2, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={18} /></Pressable>
        <IconCircle name={SERVICE_ICON[service]} /><View style={{ flex: 1 }}><T s="h2">{s.name}</T><T s="xs">{s.desc}</T></View>
      </Row>
      {service === 'tow' && <>
        <T s="h3" style={{ marginBottom: 10 }}>Tow to</T>
        {gs.map((g, i) => <Pressable key={i} onPress={() => setDropIdx(i)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: dropIdx === i ? 2 : 1, borderColor: dropIdx === i ? C.ink : C.line2, marginBottom: 8 }}>
          <Icon name={dropIdx === i ? 'check-circle' : 'circle'} size={18} color={dropIdx === i ? C.ink : C.muted} /><View style={{ flex: 1 }}><T s="sm" style={{ fontWeight: '600' }}>{g.name}</T><T s="xs">{g.km.toFixed(1)} km away</T></View>
        </Pressable>)}
      </>}
      {!q ? <View style={{ height: 180, borderRadius: 14, backgroundColor: C.surface2, marginVertical: 12 }} /> : <>
        <Row gap={0} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 14, marginVertical: 14 }}>
          {[[`${q.quote.etaMin} min`, 'arrival'], [String(q.nearby), 'pros nearby'], [q.quote.night ? 'Night' : 'Day', 'rates']].map(([b, l], i) =>
            <View key={l} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderLeftWidth: i ? 1 : 0, borderLeftColor: C.line }}><T s="h3" style={{ fontSize: 18 }}>{b}</T><T s="xs">{l}</T></View>)}
        </Row>
        <T s="h3" style={{ fontSize: 18, marginBottom: 12 }}>Price details</T>
        <BillLines lines={q.quote.lines} total={q.quote.total} />
        <Card soft style={{ marginTop: 14 }}><Row style={{ alignItems: 'flex-start' }}><Icon name="lock" size={18} /><T s="sm" style={{ flex: 1, color: C.ink2 }}><T s="sm" style={{ fontWeight: '600' }}>This price is locked.</T> The provider can't charge more. Any parts or tolls appear here for you to approve or decline.</T></Row></Card>
        {!q.quote.shield && <Button kind="ghost" small title={`Save ${rupee(19)} on every request with Shield`} onPress={onShield} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />}
      </>}
      {me?.vehicle?.model ? <Row style={{ marginVertical: 8 }}><Icon name="truck" size={16} color={C.muted} /><T s="sm" style={{ color: C.muted }}>{me.vehicle.model} · {me.vehicle.plate}</T></Row> : null}
      <Input placeholder="Anything the provider should know? e.g. white Swift, front-left tyre" value={notes} onChangeText={setNotes} multiline style={{ minHeight: 64, textAlignVertical: 'top' }} />
      <Divider />
      <Row>
        <View style={{ flex: 1 }}><T s="h2" style={{ fontSize: 20 }}>{q ? rupee(q.quote.total) : '—'} <T s="sm" style={{ color: C.muted }}>total</T></T><Row gap={4}><Icon name="lock" size={12} color={C.ink2} /><T s="xs" style={{ color: C.ink2, textDecorationLine: 'underline' }}>Price locked</T></Row></View>
        <Button title={q && !q.nearby ? 'No pros nearby' : 'Request'} onPress={request} disabled={!q || !q.nearby} loading={busy} style={{ minWidth: 140 }} />
      </Row>
    </>
  );
}

// ---------------------------------------------------------------- searching
function Searching({ job }: { job: JobView }) {
  const pulse = useMemo(() => new Animated.Value(0), []);
  const [cancelOpen, setCancelOpen] = useState(false);
  useEffect(() => { Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' })).start(); }, []);
  return (
    <>
      <View style={{ alignItems: 'center', justifyContent: 'center', height: 170 }}>
        <Animated.View style={{ position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: C.accent, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }} />
        <IconCircle name={SERVICE_ICON[job.service]} size={58} bg={C.accent} color="#fff" />
      </View>
      <T s="h2" style={{ textAlign: 'center' }}>Finding your {SERVICE_BY_CODE[job.service].name.toLowerCase()} pro</T>
      <T s="sm" style={{ textAlign: 'center', color: C.muted, marginTop: 6 }}>Searching within {job.radiusKm || 8} km · sent to {job.offeredCount} nearby pro{job.offeredCount === 1 ? '' : 's'}</T>
      <Card soft style={{ marginTop: 18 }}><Row><Icon name="lock" size={16} /><T s="sm" style={{ flex: 1 }}>Fare locked</T><T s="h3">{rupee(job.total)}</T></Row></Card>
      {cancelOpen ? <CancelPanel job={job} onClose={() => setCancelOpen(false)} /> : <Button kind="ghost" title="Cancel request · free" onPress={() => setCancelOpen(true)} />}
    </>
  );
}

function CancelPanel({ job, onClose }: { job: JobView; onClose: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <Card>
      <T s="h3">Why are you cancelling?</T>
      <T s="xs" style={{ marginTop: 4 }}>{job.status === 'ARRIVED' ? 'The provider has arrived, so a ₹99 visit fee applies.' : 'There is no charge.'}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 14 }}>
        {CANCEL_REASONS.map(r => <Pressable key={r} onPress={() => setReason(r)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: reason === r ? C.ink : C.line2, backgroundColor: reason === r ? C.ink : '#fff' }}><T s="xs" style={{ color: reason === r ? '#fff' : C.ink }}>{r}</T></Pressable>)}
      </View>
      <Row><Button kind="dark" title="Cancel request" disabled={!reason} onPress={() => act(() => api(`/jobs/${job.id}/cancel`, { body: { reason } }))} style={{ flex: 1 }} /><Button kind="outline" title="Keep it" onPress={onClose} style={{ flex: 1 }} /></Row>
    </Card>
  );
}

// ---------------------------------------------------------------- live trip
function LiveTrip({ job, setJob }: { job: JobView; setJob: (j: JobView) => void }) {
  const p = job.provider!;
  const [chat, setChat] = useState(false);
  const [seen, setSeen] = useState(job.messages?.length || 0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const msgs = job.messages?.length || 0;
  useEffect(() => { if (chat) setSeen(msgs); }, [chat, msgs]);
  const pending = job.addons.filter(a => a.status === 'PENDING');
  const extras = job.addons.filter(a => a.status === 'APPROVED').reduce((t, a) => t + a.amount, 0);
  const title = ({ ASSIGNED: 'Your pro is on the way', ARRIVED: 'Your pro has arrived', IN_PROGRESS: 'Work in progress' } as Record<string, string>)[job.status];
  const big = job.status === 'ASSIGNED' ? `${job.eta ?? '—'} min` : job.status === 'ARRIVED' ? 'Share your code' : `Since ${hhmm(job.startedAt!)}`;
  const share = async () => {
    const url = `${process.env.EXPO_PUBLIC_WEB_URL || 'https://onspot.app'}/track/${job.id}`;
    await Share.share({ message: `I'm getting ${SERVICE_BY_CODE[job.service].name} help via OnSpot from ${p.name} (${p.vehicleNo || 'verified provider'}). Track live: ${url}` }).catch(() => {});
  };
  const sos = async () => {
    if (!(await confirm('Send SOS?', 'Our ops team and your emergency contacts will get your live location.', 'Send SOS'))) return;
    const r = await act(() => api(`/jobs/${job.id}/sos`, { body: {} }));
    if (r) toast(r.notified ? `SOS sent. ${r.notified} contact(s) notified.` : 'SOS sent. Add emergency contacts in Account.', 'err');
  };
  const actions: [string, IconName, () => void, boolean?][] = [['Message', 'message-circle', () => setChat(!chat)], ['Call', 'phone', () => Linking.openURL('tel:0000000000')], ['Share trip', 'share', share], ['SOS', 'alert-triangle', sos, true]];
  return (
    <>
      <Row style={{ marginBottom: 14 }}><View style={{ flex: 1 }}><T s="label">{title}</T><T s="h1" style={{ fontSize: 30 }}>{big}</T></View><IconCircle name={SERVICE_ICON[job.service]} size={54} /></Row>
      <Steps status={job.status} />
      {pending.map(a => (
        <View key={a.id} style={{ borderWidth: 1, borderColor: C.ink, borderRadius: 16, padding: 16, marginBottom: 14 }}>
          <T s="label">Approval needed</T>
          <Row style={{ marginVertical: 8 }}><View style={{ flex: 1 }}><T s="h3">{a.label}</T>{!!a.reason && <T s="xs">{a.reason}</T>}</View><T s="h2">{rupee(a.amount)}</T></Row>
          <Row><Button kind="dark" title="Approve" style={{ flex: 1 }} onPress={() => act(() => api(`/jobs/${job.id}/addons/${a.id}/decision`, { body: { approve: true } }))} /><Button kind="outline" title="Decline" style={{ flex: 1 }} onPress={() => act(() => api(`/jobs/${job.id}/addons/${a.id}/decision`, { body: { approve: false } }))} /></Row>
          <T s="xs" style={{ marginTop: 10 }}>If you decline, you are not charged. New total if approved: {rupee(job.total + extras + a.amount)}</T>
        </View>
      ))}
      <Row gap={14} style={{ paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line }}>
        <Avatar name={p.name} />
        <View style={{ flex: 1 }}><T s="h3" numberOfLines={1}>{p.name}</T><Row gap={6} style={{ marginTop: 3 }}>{p.verified && <Pill tone="gray" icon="check" text="Verified" />}<T s="xs">★ {p.rating.toFixed(1)} · {p.ratingCount} jobs</T></Row></View>
        {!!p.vehicleNo && <View style={{ borderWidth: 1, borderColor: C.line2, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}><T s="xs" style={{ color: C.ink2, fontWeight: '600' }}>{p.vehicleNo}</T></View>}
      </Row>
      {job.status !== 'IN_PROGRESS' && job.startCode && <Row style={{ paddingVertical: 16, borderBottomWidth: 1, borderColor: C.line }}>
        <View style={{ flex: 1 }}><T s="h3">Start code</T><T s="xs">Share only when your pro is with you</T></View>
        <Row gap={6}>{job.startCode.split('').map((d, i) => <View key={i} style={{ width: 38, height: 46, borderRadius: 10, borderWidth: 1, borderColor: C.line2, alignItems: 'center', justifyContent: 'center' }}><T s="h2" style={{ fontSize: 20 }}>{d}</T></View>)}</Row>
      </Row>}
      <Row gap={6} style={{ paddingVertical: 16 }}>
        {actions.map(([l, i, fn, danger]) => <Pressable key={l} onPress={fn} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
          <View><IconCircle name={i} size={52} bg={danger ? C.dangerSoft : l === 'Message' && chat ? C.ink : C.surface2} color={danger ? C.danger : l === 'Message' && chat ? '#fff' : C.ink} />
            {l === 'Message' && !chat && msgs > seen && <View style={{ position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}><T s="xs" style={{ color: '#fff', fontWeight: '700', fontSize: 11 }}>{msgs - seen}</T></View>}</View>
          <T s="xs" style={{ color: C.ink2, fontWeight: '500' }}>{l}</T>
        </Pressable>)}
      </Row>
      {chat && <ChatPanel job={job} me="CUSTOMER" onSend={t => api(`/jobs/${job.id}/messages`, { body: { text: t } }).then(setJob)} />}
      {cancelOpen && <CancelPanel job={job} onClose={() => setCancelOpen(false)} />}
      <Card soft><Row><Icon name="lock" size={16} /><T s="sm" style={{ flex: 1 }}>Locked fare{extras ? ' + approved extras' : ''}</T><T s="h3">{rupee(job.total + extras)}</T></Row></Card>
      <Timeline job={job} />
      {job.status !== 'IN_PROGRESS' && !cancelOpen && <Button kind="ghost" title="Cancel request" onPress={() => setCancelOpen(true)} style={{ marginTop: 8 }} />}
    </>
  );
}

// ---------------------------------------------------------------- bill, rating, end states
function Bill({ job, setJob }: { job: JobView; setJob: (j: JobView) => void }) {
  const [method, setMethod] = useState<'upi' | 'card' | 'cash'>('upi');
  const [busy, setBusy] = useState(false);
  const approved = job.addons.filter(a => a.status === 'APPROVED');
  const pay = async () => {
    setBusy(true);
    const r = await act(() => api(`/jobs/${job.id}/pay`, { body: { method } }));
    setBusy(false);
    if (r?.checkout) toast('Opening Razorpay checkout…'); // production: react-native-razorpay with r.checkout, then /payments/razorpay/verify
    else if (r) setJob(r);
  };
  return (
    <>
      <Steps status="COMPLETED" />
      <T s="h2">Job done. Review and pay.</T>
      <T s="sm" style={{ color: C.muted, marginTop: 4, marginBottom: 16 }}>{job.provider?.name} finished at {hhmm(job.completedAt!)}.</T>
      <BillLines lines={[...job.quote.lines, ...approved.map(a => ({ label: `${a.label} (approved)`, amount: a.amount, extra: true }))]} total={job.finalAmount!} totalLabel="Total payable" />
      <Card soft style={{ marginTop: 14 }}><Row style={{ alignItems: 'flex-start' }}><Icon name="check-circle" size={18} color={C.ok} /><T s="sm" style={{ flex: 1, color: C.ink2 }}>{job.finalAmount! > job.total ? `Locked fare ${rupee(job.total)} + ${rupee(job.finalAmount! - job.total)} in extras you approved.` : 'Exactly your locked fare.'} Nothing else can be added.</T></Row></Card>
      <T s="h3" style={{ marginTop: 8, marginBottom: 10 }}>Pay with</T>
      {([['upi', 'UPI', 'smartphone'], ['card', 'Debit or credit card', 'credit-card'], ['cash', 'Cash to provider', 'dollar-sign']] as const).map(([v, l, i]) =>
        <Pressable key={v} onPress={() => setMethod(v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: method === v ? 2 : 1, borderColor: method === v ? C.ink : C.line2, marginBottom: 8 }}>
          <Icon name={i} size={18} /><T s="sm" style={{ flex: 1, fontWeight: '600' }}>{l}</T><Icon name={method === v ? 'check-circle' : 'circle'} size={18} color={method === v ? C.ink : C.line2} />
        </Pressable>)}
      <Button title={`Pay ${rupee(job.finalAmount)}`} onPress={pay} loading={busy} style={{ marginTop: 8 }} />
    </>
  );
}

function RateJob({ job, setJob }: { job: JobView; setJob: (j: JobView) => void }) {
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  return (
    <View style={{ alignItems: 'stretch' }}>
      <View style={{ alignSelf: 'center' }}><IconCircle name="check" size={64} bg={C.okSoft} color={C.ok} /></View>
      <T s="h2" style={{ textAlign: 'center', marginTop: 14 }}>Paid {rupee(job.payment?.amount)}</T>
      <T s="xs" style={{ textAlign: 'center', marginTop: 4 }}>Ref {job.payment?.ref} · {job.payment?.method.toUpperCase()}</T>
      <Card style={{ marginTop: 20 }}>
        <T s="h3" style={{ textAlign: 'center' }}>How was {job.provider?.name}?</T>
        <Stars value={stars} onChange={setStars} />
        <TextInput value={comment} onChangeText={setComment} placeholder="Anything to share? (optional)" placeholderTextColor="#A0A0A0" multiline style={{ borderWidth: 1, borderColor: C.line2, borderRadius: 10, padding: 12, minHeight: 60, color: C.ink }} />
      </Card>
      <Button title="Submit rating" onPress={() => act(() => api(`/jobs/${job.id}/rate`, { body: { stars, comment } })).then(r => r && setJob(r))} />
    </View>
  );
}

function Ended({ job, onDone, onRetry }: { job: JobView; onDone: () => void; onRetry: () => void }) {
  const paid = job.status === 'PAID';
  const np = job.status === 'NO_PROVIDER';
  return (
    <View>
      <View style={{ alignSelf: 'center' }}><IconCircle name={paid ? 'check' : 'x'} size={64} bg={paid ? C.okSoft : C.dangerSoft} color={paid ? C.ok : C.danger} /></View>
      <T s="h2" style={{ textAlign: 'center', marginTop: 14 }}>{paid ? "Thanks. You're good to go!" : np ? 'No provider available right now' : 'Request cancelled'}</T>
      <T s="sm" style={{ textAlign: 'center', color: C.muted, marginTop: 6, marginBottom: 18 }}>
        {paid ? `Receipt ${job.payment?.ref}` : np ? 'We searched up to 50 km. Try again in a minute, or call a helpline.' : job.cancelFee ? `A ₹${job.cancelFee} visit fee applies as the provider had arrived.` : 'No charge was applied.'}
      </T>
      {np && <Card><Row style={{ justifyContent: 'space-between' }}><T s="sm">National emergency</T><Pressable onPress={() => Linking.openURL('tel:112')}><T s="h3">112</T></Pressable></Row><Divider /><Row style={{ justifyContent: 'space-between' }}><T s="sm">NHAI highway helpline</T><Pressable onPress={() => Linking.openURL('tel:1033')}><T s="h3">1033</T></Pressable></Row></Card>}
      <Row>{!paid && <Button title="Try again" onPress={onRetry} style={{ flex: 1 }} />}<Button kind={paid ? 'primary' : 'outline'} title="Done" onPress={onDone} style={{ flex: 1 }} /></Row>
    </View>
  );
}

// ---------------------------------------------------------------- activity + account
function Activity() {
  const [list, setList] = useState<JobView[] | null>(null);
  useEffect(() => { api<JobView[]>('/jobs').then(setList).catch(() => setList([])); }, []);
  const label: Record<string, string> = { SEARCHING: 'Searching', ASSIGNED: 'On the way', ARRIVED: 'Arrived', IN_PROGRESS: 'In progress', COMPLETED: 'Awaiting payment', PAID: 'Completed', CANCELLED: 'Cancelled', NO_PROVIDER: 'No provider' };
  return (
    <>
      <T s="h1">Activity</T><T s="sm" style={{ color: C.muted, marginBottom: 16 }}>Your requests and receipts.</T>
      {list === null ? null : list.length === 0 ? <Card soft><T s="sm" style={{ color: C.muted, textAlign: 'center' }}>No requests yet. We hope you never need us, but we're here.</T></Card> :
        list.map(j => <Row key={j.id} gap={12} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <IconCircle name={SERVICE_ICON[j.service]} size={38} />
          <View style={{ flex: 1 }}><T s="h3" style={{ fontSize: 15 }}>{SERVICE_BY_CODE[j.service].name}</T><T s="xs">{new Date(j.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {hhmm(j.createdAt)}{j.provider ? ` · ${j.provider.name}` : ''}</T></View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}><T s="h3" style={{ fontSize: 14 }}>{rupee(j.finalAmount ?? j.total)}</T><Pill tone={j.status === 'PAID' ? 'ok' : ['CANCELLED', 'NO_PROVIDER'].includes(j.status) ? 'gray' : 'accent'} text={label[j.status]} /></View>
        </Row>)}
    </>
  );
}

function Account({ me, setMe, onSignOut }: { me: Profile | null; setMe: (p: Profile) => void; onSignOut: () => void }) {
  const [model, setModel] = useState(me?.vehicle?.model || '');
  const [plate, setPlate] = useState(me?.vehicle?.plate || '');
  const [contacts, setContacts] = useState(() => [0, 1, 2].map(i => me?.contacts?.[i] || { name: '', phone: '' }));
  const save = (body: object, msg: string) => act(() => api<Profile>('/me', { method: 'PATCH', body })).then(r => { if (r) { setMe(r); toast(msg, 'ok'); } });
  if (!me) return null;
  return (
    <>
      <Row gap={14} style={{ marginBottom: 22 }}><Avatar name={me.name} size={60} /><View><T s="h2">{me.name}</T><T s="sm" style={{ color: C.muted }}>+91 {me.phone}</T></View></Row>
      <View style={{ backgroundColor: C.ink, borderRadius: 20, padding: 20, marginBottom: 8 }}>
        <Row><Icon name="shield" size={22} color="#fff" /><T s="h3" style={{ color: '#fff', flex: 1 }}>OnSpot Shield{me.shield ? ' · Active' : ''}</T>{!me.shield && <T s="h3" style={{ color: '#fff' }}>₹99<T s="xs" style={{ color: 'rgba(255,255,255,.7)' }}> / month</T></T>}</Row>
        <T s="sm" style={{ color: 'rgba(255,255,255,.75)', marginVertical: 10 }}>{me.shield ? `No platform fee and priority dispatch. Renews ${new Date(me.shieldUntil!).toLocaleDateString()}.` : 'No platform fee on any request, and priority dispatch with a wider search from the first second.'}</T>
        <Button small kind={me.shield ? 'ghost' : 'outline'} title={me.shield ? 'Cancel plan' : 'Activate (demo, no charge)'} onPress={() => save({ shield: !me.shield }, me.shield ? 'Shield cancelled' : 'Shield is active')} style={me.shield ? {} : { alignSelf: 'flex-start' }} />
      </View>
      <T s="h3" style={{ fontSize: 18, marginTop: 22, marginBottom: 12 }}>My vehicle</T>
      <Input label="Make and model" value={model} onChangeText={setModel} placeholder="Maruti Swift" />
      <Input label="Number plate" value={plate} onChangeText={t => setPlate(t.toUpperCase())} placeholder="MH 12 AB 1234" autoCapitalize="characters" />
      <Button kind="outline" title="Save vehicle" onPress={() => save({ vehicle: { model, plate, fuel: me.vehicle?.fuel || 'petrol' } }, 'Vehicle saved')} />
      <T s="h3" style={{ fontSize: 18, marginTop: 26, marginBottom: 4 }}>Emergency contacts</T>
      <T s="xs" style={{ marginBottom: 12 }}>They receive your live location when you press SOS.</T>
      {contacts.map((c, i) => <Row key={i} style={{ marginBottom: -6 }}>
        <View style={{ flex: 1 }}><Input placeholder="Name" value={c.name} onChangeText={t => setContacts(cs => cs.map((x, j) => j === i ? { ...x, name: t } : x))} /></View>
        <View style={{ flex: 1 }}><Input placeholder="Phone" keyboardType="phone-pad" value={c.phone} onChangeText={t => setContacts(cs => cs.map((x, j) => j === i ? { ...x, phone: t.replace(/\D/g, '').slice(0, 10) } : x))} /></View>
      </Row>)}
      <Button kind="outline" title="Save contacts" onPress={() => save({ contacts: contacts.filter(c => c.name.trim() && c.phone) }, 'Emergency contacts saved')} style={{ marginTop: 6 }} />
      <Divider />
      <Button kind="danger" title="Sign out" onPress={onSignOut} />
    </>
  );
}
