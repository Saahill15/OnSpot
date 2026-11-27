// Partner (provider) app: earnings, go online, KYC, live offers, active job, live location.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import * as Location from 'expo-location';
import { EVENTS, JobOffer, LatLng, SERVICES, ServiceCode, SERVICE_BY_CODE } from '@onspot/shared';
import { api, getSocket } from './api';
import { act, ACTIVE, ChatPanel, confirm, JobView, PhotoStrip, Stars, toast, Trust } from './common';
import { takeJobPhoto } from './photos';
import { hasBackgroundPermission, startBackgroundLocation, stopBackgroundLocation } from './backgroundLocation';
import Map from './Map';
import type { MapMarker } from './mapTypes';
import { Avatar, BottomCTA, Button, C, Card, dayMonth, Divider, hhmm, Icon, IconCircle, Input, ListGroup, ListRow, Pill, Row, rupee, SERVICE_ICON, SubHeader, T } from './ui';

interface Me { id: string; name: string; services: ServiceCode[]; vehicleNo: string; online: boolean; lat: number | null; lng: number | null; rating: number; ratingCount: number; kycStatus: 'PENDING' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED'; earnings: number; jobsDone: number; activeJobId: string | null; trust?: Trust }
type Offer = Omit<JobOffer, 'expiresAt'> & { expiresAt?: string; receivedAt: number; ttl: number }; // ttl: seconds left when received (server clock)
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
    setMe(d.provider); setJob(d.activeJob); setOffers(d.offers.map(o => ({ ...o, receivedAt: Date.now(), ttl: o.expiresInSec ?? OFFER_SEC })));
    if (d.provider.lat != null) pos.current = { lat: d.provider.lat, lng: d.provider.lng! };
    api<JobView[]>('/jobs').then(l => setHistory(l.filter(j => ['COMPLETED', 'PAID'].includes(j.status)))).catch(() => {});
  };
  useEffect(() => { act(refresh); }, []);

  // realtime
  useEffect(() => {
    const s = getSocket(); if (!s) return;
    const onOffer = (o: JobOffer) => { setOffers(l => [...l.filter(x => x.jobId !== o.jobId), { ...o, receivedAt: Date.now(), ttl: OFFER_SEC }]); toast(`New ${SERVICE_BY_CODE[o.service].name.toLowerCase()} request · ${o.km} km away`); };
    const onRevoke = ({ jobId }: { jobId: string }) => setOffers(l => l.filter(x => x.jobId !== jobId));
    const onJob = (j: JobView) => setJob(prev => {
      if (prev && prev.id !== j.id && ACTIVE.includes(prev.status)) return prev;
      if (prev && prev.status !== j.status && j.status === 'CANCELLED') toast('The customer cancelled this job', 'err');
      if (prev && prev.status !== j.status && j.status === 'PAID') toast(`Payment received · ${rupee(j.finalAmount)}`, 'ok');
      if (prev && prev.payment?.status !== 'PENDING_CASH' && j.payment?.status === 'PENDING_CASH') toast(`Collect ${rupee(j.finalAmount)} in cash, then confirm`, 'ok');
      if (prev && !prev.tip && j.tip) toast(`${j.customer.name} tipped you ${rupee(j.tip)}!`, 'ok');
      if (prev && !prev.late && j.late) toast("You're running late. The customer can now switch pros.", 'err');
      if (prev && prev.status === 'ASSIGNED' && j.status === 'SEARCHING') toast('The customer switched to another pro', 'err');
      const pa = prev?.addons.filter(a => a.status !== 'PENDING').length || 0, na = j.addons.filter(a => a.status !== 'PENDING');
      if (prev && na.length > pa) { const a = na[na.length - 1]; toast(`Customer ${a.status === 'APPROVED' ? 'approved' : 'declined'} ${a.label}`, a.status === 'APPROVED' ? 'ok' : 'err'); }
      const last = j.messages?.[j.messages.length - 1];
      if (prev && last && (prev.messages?.length || 0) < (j.messages?.length || 0) && last.from === 'CUSTOMER') toast(`${j.customer.name}: ${last.text}`);
      return j;
    });
    const onKyc = ({ status }: { status: Me['kycStatus'] }) => { setMe(m => m && { ...m, kycStatus: status }); toast(status === 'VERIFIED' ? 'KYC approved. You can go online now.' : 'KYC rejected. Please resubmit.', status === 'VERIFIED' ? 'ok' : 'err'); };
    // After a network drop, re-read offers and the active job so nothing is missed.
    const onReconnect = () => { act(refresh); };
    s.on(EVENTS.JOB_OFFER, onOffer); s.on(EVENTS.JOB_OFFER_REVOKED, onRevoke); s.on(EVENTS.JOB_UPDATED, onJob); s.on(EVENTS.KYC_UPDATED, onKyc); s.io.on('reconnect', onReconnect);
    return () => { s.off(EVENTS.JOB_OFFER, onOffer); s.off(EVENTS.JOB_OFFER_REVOKED, onRevoke); s.off(EVENTS.JOB_UPDATED, onJob); s.off(EVENTS.KYC_UPDATED, onKyc); s.io.off('reconnect', onReconnect); };
  }, []);

  // offer countdown + auto-decline
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const expired = offers.filter(o => now - o.receivedAt > o.ttl * 1000);
    if (expired.length) { expired.forEach(o => api(`/jobs/${o.jobId}/decline`, { body: {} }).catch(() => {})); setOffers(l => l.filter(o => !expired.includes(o))); }
  }, [now]);

  // Live GPS while online; the API turns it into the customer's ETA.
  // Phones: a background task keeps sharing when the app is closed or the screen is off (high accuracy only during a job).
  // Web, or if the partner declines background access: foreground-only updates while the app is open.
  const [bgActive, setBgActive] = useState(false);
  const onJob = !!job && ACTIVE.includes(job.status);
  useEffect(() => {
    if (!me?.online) { stopBackgroundLocation(); setBgActive(false); return; }
    let cancelled = false;
    (async () => {
      if (Platform.OS === 'web') return;
      // Google Play policy: explain background location in-app before the system prompt.
      if (!(await hasBackgroundPermission()) && !(await confirm('Share location in the background?',
        "While you're online, OnSpot uses your location even when the app is closed or the screen is off, so you get nearby jobs and customers see your live ETA. It stops as soon as you go offline.", 'Continue'))) return;
      const r = await startBackgroundLocation(onJob ? 'job' : 'idle').catch(() => 'unsupported' as const);
      if (!cancelled) setBgActive(r === 'started');
      if (r === 'denied-background') toast('Background location is off: you only get jobs while the app is open.', 'err');
    })();
    return () => { cancelled = true; };
  }, [me?.online, onJob]);
  useEffect(() => {
    if (!me?.online || bgActive) return; // the background task already reports location
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
  }, [me?.online, bgActive]);

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
    if (r) { setMe(r); if (at) pos.current = at; toast(r.online ? (Platform.OS === 'web' ? "You're online. Keep this page open to get jobs." : "You're online. You'll get jobs even with the app closed.") : "You're offline", r.online ? 'ok' : 'info'); }
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
      <ScrollView style={{ flex: 1, marginTop: -20, backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22 }} contentContainerStyle={{ flexGrow: 1, padding: 20, paddingTop: 22, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
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
  const left = Math.max(0, o.ttl - Math.floor((now - o.receivedAt) / 1000));
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

function JobLine({ j }: { j: JobView }) {
  return (
    <Row gap={12} style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
      <IconCircle name={SERVICE_ICON[j.service]} size={36} />
      <View style={{ flex: 1 }}><T s="sm" style={{ fontWeight: '600' }}>{j.customer.name}</T><T s="xs">{SERVICE_BY_CODE[j.service].name} · {dayMonth(j.completedAt || j.createdAt)}, {hhmm(j.completedAt || j.createdAt)}{j.ratings.CUSTOMER ? ` · ★ ${j.ratings.CUSTOMER.stars}` : ''}{j.tip ? ` · ${rupee(j.tip)} tip` : ''}</T></View>
      <T s="h3" style={{ fontSize: 14 }}>{rupee((j.providerPayout || 0) + (j.tip || 0))}</T>
    </Row>
  );
}

function Dashboard({ me, setMe, history, onToggle, onSignOut }: { me: Me; setMe: (m: Me) => void; history: JobView[]; onToggle: () => void; onSignOut: () => void }) {
  const [page, setPage] = useState<'home' | 'trust' | 'hotspots' | 'jobs' | 'services' | 'vehicle'>('home');
  const [vehicleNo, setVehicleNo] = useState(me.vehicleNo);
  const today = dayMonth(new Date());
  const todays = history.filter(j => dayMonth(j.completedAt || j.createdAt) === today);
  const patch = (body: object, msg?: string) => act(() => api<Me>('/provider/me', { method: 'PATCH', body })).then(r => { if (r) { setMe({ ...me, ...r }); if (msg) toast(msg, 'ok'); } return r; });
  const home = () => setPage('home');
  const t = me.trust;

  if (page === 'trust') return <><SubHeader title="Trust score" sub="How reliable customers can expect you to be." onBack={home} /><TrustCard t={t} /></>;
  if (page === 'hotspots') return <><SubHeader title="Where jobs happen" sub="Requests for your services nearby, last 30 days." onBack={home} /><Hotspots services={me.services.join(',')} /></>;
  if (page === 'jobs') return <><SubHeader title="Job history" sub={`${history.length} jobs · ${rupee(me.earnings)} earned in all`} onBack={home} />
    {history.length ? <ListGroup>{history.map(j => <JobLine key={j.id} j={j} />)}</ListGroup> : <Card soft><T s="sm" style={{ color: C.muted, textAlign: 'center' }}>Your completed jobs and payouts will show here.</T></Card>}</>;
  if (page === 'services') return <><SubHeader title="Services I offer" sub="You only get requests for the services you pick." onBack={home} />
    <ListGroup>{SERVICES.map(sv => { const on = me.services.includes(sv.code); return (
      <Pressable key={sv.code} onPress={() => patch({ services: on ? me.services.filter(x => x !== sv.code) : [...me.services, sv.code] })} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 }}>
        <Icon name={SERVICE_ICON[sv.code]} size={19} /><T s="body" style={{ flex: 1, fontWeight: '500' }}>{sv.name}</T>
        <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: on ? 0 : 1.5, borderColor: C.line2, backgroundColor: on ? C.ink : '#fff', alignItems: 'center', justifyContent: 'center' }}>{on && <Icon name="check" size={14} color="#fff" />}</View>
      </Pressable>); })}</ListGroup></>;
  if (page === 'vehicle') return <><SubHeader title="Vehicle or shop" sub="Customers see this number on your card so they can recognise you." onBack={home} />
    <Input label="Vehicle number" value={vehicleNo} onChangeText={x => setVehicleNo(x.toUpperCase())} placeholder="MH 12 AB 1234" autoCapitalize="characters" />
    <BottomCTA><Button kind="dark" title="Save" disabled={!vehicleNo.trim() || vehicleNo === me.vehicleNo} onPress={() => patch({ vehicleNo }, 'Vehicle saved').then(r => { if (r) home(); })} /></BottomCTA></>;

  return (
    <>
      <View style={{ backgroundColor: C.ink, borderRadius: 20, padding: 20, marginBottom: 14 }}>
        <T s="label" style={{ color: 'rgba(255,255,255,.7)' }}>Today's earnings</T>
        <T s="h1" style={{ color: '#fff', fontSize: 40, marginBottom: 14 }}>{rupee(todays.reduce((x, j) => x + (j.providerPayout || 0) + (j.tip || 0), 0))}</T>
        <Row gap={0} style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.15)', paddingTop: 14 }}>
          {[[String(todays.length), 'jobs today'], [`★ ${me.rating.toFixed(1)}`, 'rating'], [rupee(me.earnings), 'all time']].map(([v, l]) => <View key={l} style={{ flex: 1 }}><T s="h3" style={{ color: '#fff' }}>{v}</T><T s="xs" style={{ color: 'rgba(255,255,255,.65)' }}>{l}</T></View>)}
        </Row>
      </View>
      <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 16, borderRadius: 14, backgroundColor: me.online ? C.okSoft : C.accent, marginBottom: 20 }}>
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: me.online ? C.ok : '#fff' }} />
        <T s="h3" style={{ color: me.online ? C.ok : '#fff' }}>{me.online ? "You're online · tap to go offline" : 'Go online'}</T>
      </Pressable>
      {me.kycStatus !== 'VERIFIED' && <Kyc me={me} setMe={setMe} />}
      {me.kycStatus === 'VERIFIED' && <ListGroup title="Performance">
        <ListRow icon="shield" title="Trust score" value={t?.score == null ? 'New · shows after 3 arrivals' : `${t.score} · ${t.onTimePct}% on time`} onPress={() => setPage('trust')} />
        <ListRow icon="trending-up" title="Where jobs happen" value="Busiest places and hours near you" onPress={() => setPage('hotspots')} />
      </ListGroup>}
      <ListGroup title="Recent jobs">
        {history.length ? history.slice(0, 3).map(j => <JobLine key={j.id} j={j} />) : <T s="sm" style={{ color: C.muted, textAlign: 'center', padding: 16 }}>Your completed jobs and payouts will show here.</T>}
        {history.length > 3 && <ListRow icon="list" title="See all jobs" value={`${history.length} jobs`} onPress={() => setPage('jobs')} />}
      </ListGroup>
      <ListGroup title="Settings">
        <ListRow icon="tool" title="Services I offer" value={me.services.length ? me.services.map(c => SERVICE_BY_CODE[c].name).join(', ') : 'None selected'} onPress={() => setPage('services')} />
        <ListRow icon="truck" title="Vehicle or shop" value={me.vehicleNo || 'Add your vehicle number'} onPress={() => setPage('vehicle')} />
      </ListGroup>
      <ListGroup>
        <ListRow icon="log-out" title="Sign out" danger onPress={async () => { if (await confirm('Sign out?', 'You will go offline and stop getting jobs.', 'Sign out', true)) onSignOut(); }} />
      </ListGroup>
    </>
  );
}

/** The partner's own trust score with what feeds it, so they know how to raise it. Customers see the score on the pro card. */
function TrustCard({ t }: { t?: Trust }) {
  if (!t) return null;
  const rows: [string, string][] = [['On time', t.onTimePct == null ? '—' : `${t.onTimePct}%`], ['Kept jobs', t.reliabilityPct == null ? '—' : `${t.reliabilityPct}%`], ['Clean streak', String(t.cleanStreak)]];
  return (
    <Card>
      <Row style={{ marginBottom: 4 }}><Icon name="shield" size={18} /><T s="h3" style={{ flex: 1 }}>Trust score</T><T s="h3" style={{ color: t.score == null ? C.muted : t.score >= 85 ? C.ok : t.score >= 70 ? C.warn : C.ink }}>{t.score ?? 'New'}</T></Row>
      <T s="xs" style={{ marginBottom: 12 }}>{t.score == null ? 'Shows to customers after your first 3 arrivals.' : 'Customers see this on your card. Arrive on time, keep the jobs you accept, and bill only the locked fare.'}</T>
      <Row gap={0}>{rows.map(([l, v]) => <View key={l} style={{ flex: 1 }}><T s="h3" style={{ fontSize: 16 }}>{v}</T><T s="xs">{l}</T></View>)}</Row>
      {t.overchargeRefunds > 0 && <T s="xs" style={{ color: C.danger, marginTop: 10 }}>{t.overchargeRefunds} overcharge refund{t.overchargeRefunds > 1 ? 's' : ''} lowered your score.</T>}
    </Card>
  );
}

/** Before/after photo buttons + thumbnails. Photos protect the partner in disputes and reassure the customer. */
function ProofPhotos({ job, setJob, kinds }: { job: JobView; setJob: (j: JobView) => void; kinds: ('BEFORE' | 'AFTER')[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const count = (k: string) => (job.photos || []).filter(p => p.kind === k).length;
  const take = async (k: 'BEFORE' | 'AFTER') => { setBusy(k); const r = await act(() => takeJobPhoto(job.id, k)); setBusy(null); if (r) { setJob(r); toast('Photo added', 'ok'); } };
  return (
    <View style={{ marginBottom: 12 }}>
      <Row gap={8}>{kinds.map(k => <Button key={k} small kind="outline" icon="camera" loading={busy === k} disabled={count(k) >= 3} style={{ flex: 1 }}
        title={`${k === 'BEFORE' ? 'Before' : 'After'} photo${count(k) ? ` (${count(k)}/3)` : ''}`} onPress={() => take(k)} />)}</Row>
      <PhotoStrip photos={job.photos} title="Your photos" by="" />
    </View>
  );
}

interface HotspotData { total: number; peakHour: number | null; hours: number[]; hotspots: { lat: number; lng: number; label: string; requests: number; avgFare: number; km: number }[] }
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? ' am' : ' pm'}`;

/** Where and when requests for this partner's services happen nearby (last 30 days). Helps them wait in the right place. */
function Hotspots({ services }: { services: string }) {
  const [d, setD] = useState<HotspotData | null>(null);
  useEffect(() => { api<HotspotData>('/provider/hotspots').then(setD).catch(() => {}); }, [services]);
  if (!d) return null;
  const max = Math.max(1, ...d.hours);
  return (
    <Card>
      <Row style={{ marginBottom: 4 }}><Icon name="trending-up" size={18} /><T s="h3" style={{ flex: 1 }}>Where jobs happen near you</T></Row>
      {d.total === 0 ? <T s="xs">No requests nearby in the last 30 days yet. Hotspots will show up as jobs come in.</T> : <>
        <T s="xs" style={{ marginBottom: 12 }}>{d.total} requests for your services in the last 30 days{d.peakHour != null ? ` · busiest around ${hourLabel(d.peakHour)}` : ''}</T>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 48, gap: 2, marginBottom: 4 }} accessibilityLabel="Requests by hour of day">
          {d.hours.map((n, h) => <View key={h} style={{ flex: 1, height: Math.max(2, (n / max) * 48), borderRadius: 2, backgroundColor: h === d.peakHour ? C.accent : C.line2 }} />)}
        </View>
        <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>{[0, 6, 12, 18].map(h => <T key={h} s="xs">{hourLabel(h)}</T>)}</Row>
        {d.hotspots.slice(0, 3).map((s, i) => (
          <Pressable key={i} onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: i === 0 ? C.accent : C.surface2, alignItems: 'center', justifyContent: 'center' }}><T s="xs" style={{ color: i === 0 ? '#fff' : C.ink, fontWeight: '700' }}>{i + 1}</T></View>
            <View style={{ flex: 1 }}><T s="sm" style={{ fontWeight: '600' }} numberOfLines={1}>{s.label}</T><T s="xs">{s.requests} requests · avg {rupee(s.avgFare)} · {s.km} km away</T></View>
            <Icon name="navigation" size={16} color={C.muted} />
          </Pressable>))}
      </>}
    </Card>
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
  const [chatOpen, setChatOpen] = useState(false);
  const [seen, setSeen] = useState(job.messages?.length || 0);
  const call = (path: string, body: object = {}) => act(() => api<JobView>(`/jobs/${job.id}/${path}`, { body })).then(r => { if (r && (r as any).id) setJob(r); return r; });
  const pending = job.addons.some(a => a.status === 'PENDING');
  const head = (
    <Row gap={12} style={{ marginBottom: 16 }}>
      <IconCircle name={SERVICE_ICON[job.service]} />
      <View style={{ flex: 1 }}><T s="label">{SERVICE_BY_CODE[job.service].name}</T><T s="h3">{job.customer.name} <T s="xs">{job.customer.phone}</T></T>{!!job.pickup.label && <T s="xs" numberOfLines={1}>{job.pickup.label}{job.notes ? ` · "${job.notes}"` : ''}</T>}</View>
      <Pressable onPress={() => Linking.openURL('tel:0000000000')} accessibilityLabel="Call customer"><IconCircle name="phone" size={40} /></Pressable>
    </Row>
  );
  const msgs = job.messages?.length || 0;
  const unread = msgs - seen;
  const chat = ACTIVE.includes(job.status) && <View style={{ marginTop: 14 }}>{chatOpen
    ? <ChatPanel job={job} me="PROVIDER" onSend={t => api(`/jobs/${job.id}/messages`, { body: { text: t } }).then(setJob)} />
    : <ListGroup><ListRow icon="message-circle" title={unread > 0 ? `Messages · ${unread} new` : 'Message customer'} value={msgs ? job.messages![msgs - 1].text : 'Numbers stay private'} onPress={() => { setChatOpen(true); setSeen(msgs); }} /></ListGroup>}</View>;
  if (job.status === 'ASSIGNED') return <>{head}
    <Row style={{ marginBottom: 12 }}><T s="h2" style={{ flex: 1 }}>Head to customer</T><T s="h3" style={{ color: C.accent }}>{job.eta ?? '—'} min</T></Row>
    {job.late && <Card style={{ backgroundColor: C.warnSoft, borderColor: 'transparent' }}><Row style={{ alignItems: 'flex-start' }}><Icon name="clock" size={18} color={C.warn} /><T s="sm" style={{ flex: 1 }}><T s="sm" style={{ fontWeight: '600' }}>You're past your promised arrival time.</T> The customer can now switch to another pro for free. Message them with an update.</T></Row></Card>}
    <Card soft><Row><T s="sm" style={{ flex: 1 }}>Locked fare</T><T s="h3">{rupee(job.total)}</T></Row>{job.drop && <T s="xs" style={{ marginTop: 4 }}>Tow {job.quote.towKm} km to the drop point</T>}</Card>
    <View style={{ gap: 10 }}>
      <Button kind="dark" icon="navigation" title="Navigate in Google Maps" onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${job.pickup.lat},${job.pickup.lng}`)} />
      {__DEV__ && <Button kind="outline" title="Simulate drive (dev)" onPress={onSimulate} />}
      <Row style={{ alignItems: 'flex-start' }}><Icon name="map-pin" size={14} color={C.muted} /><T s="xs" style={{ flex: 1 }}>We mark you arrived automatically when you're within 150 m of the customer.</T></Row>
      <Button title="I've arrived" onPress={() => call('arrived')} />
      <Button kind="ghost" title="Can't make it? Release job" onPress={async () => { if (await confirm('Release this job?', 'It will go to another provider. Frequent releases lower your score.', 'Release', true)) { await call('cancel'); onDone(); } }} />
    </View>{chat}</>;
  if (job.status === 'ARRIVED') return <>{head}
    <T s="h2">Ask for the 4-digit start code</T>
    <T s="sm" style={{ color: C.muted, marginVertical: 8 }}>The job starts only once you enter the code shown in the customer's app.</T>
    <ProofPhotos job={job} setJob={setJob} kinds={['BEFORE']} />
    <Input value={code} onChangeText={t => setCode(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" placeholder="• • • •" style={{ fontSize: 28, textAlign: 'center', letterSpacing: 12, fontWeight: '700' }} />
    <Button title="Verify and start" disabled={code.length !== 4} onPress={() => call('start', { code })} />{chat}</>;
  if (job.status === 'IN_PROGRESS') return <>{head}
    <Row style={{ marginBottom: 12 }}><T s="h2" style={{ flex: 1 }}>Job in progress</T><Pill text={`since ${hhmm(job.startedAt!)}`} /></Row>
    <ProofPhotos job={job} setJob={setJob} kinds={['BEFORE', 'AFTER']} />
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
    <Button kind="dark" title={pending ? 'Waiting for customer approval…' : 'Mark job complete'} disabled={pending} onPress={async () => { if (!(job.photos || []).some(p => p.kind === 'AFTER') && !(await confirm('Complete without an after photo?', 'An after photo protects you if the customer reports a problem later.', 'Complete anyway'))) return; await call('complete'); }} />{chat}</>;
  if (job.status === 'COMPLETED' && job.payment?.status === 'PENDING_CASH') return <>{head}
    <View style={{ alignSelf: 'center' }}><IconCircle name="dollar-sign" size={64} bg={C.warnSoft} color={C.warn} /></View>
    <T s="h2" style={{ textAlign: 'center', marginTop: 12 }}>Collect {rupee(job.finalAmount)} in cash</T>
    <T s="sm" style={{ textAlign: 'center', color: C.muted, marginVertical: 8 }}>{job.customer.name} chose to pay cash. Confirm only once the money is in your hand. The job isn't paid until you do.</T>
    <BottomCTA><Button kind="dark" icon="check" title={`I've received ${rupee(job.finalAmount)}`} onPress={async () => { if (await confirm('Confirm cash received?', `Only confirm if ${job.customer.name} has paid you ${rupee(job.finalAmount)}.`, 'Confirm')) await call('cash-received'); }} /></BottomCTA></>;
  if (job.status === 'COMPLETED' || job.status === 'PAID') return <>{head}
    <View style={{ alignSelf: 'center' }}><IconCircle name="check" size={64} bg={C.okSoft} color={C.ok} /></View>
    <T s="h2" style={{ textAlign: 'center', marginTop: 12 }}>{job.status === 'PAID' ? 'Payment received' : 'Job complete'}</T>
    <T s="sm" style={{ textAlign: 'center', color: C.muted, marginVertical: 8 }}>{job.status === 'PAID' ? `${rupee(job.finalAmount)} via ${job.payment?.method.toUpperCase()}. Payout to your UPI tomorrow.` : `Waiting for ${job.customer.name} to pay ${rupee(job.finalAmount)}.`}</T>
    <Card><Row style={{ justifyContent: 'space-between' }}><T s="sm">Customer total</T><T s="sm">{rupee(job.finalAmount)}</T></Row><Row style={{ justifyContent: 'space-between', marginTop: 8 }}><T s="sm">Platform fee + 10% commission</T><T s="sm">− {rupee((job.finalAmount || 0) - (job.providerPayout || 0))}</T></Row>
      {job.tip > 0 && <Row style={{ justifyContent: 'space-between', marginTop: 8 }}><T s="sm" style={{ color: C.ok }}>Tip (100% yours)</T><T s="sm" style={{ color: C.ok }}>+ {rupee(job.tip)}</T></Row>}
      <Divider /><Row style={{ justifyContent: 'space-between' }}><T s="h3">You earn</T><T s="h3">{rupee((job.providerPayout || 0) + job.tip)}</T></Row></Card>
    {job.status === 'PAID' && !job.ratings.PROVIDER && <><T s="h3" style={{ textAlign: 'center' }}>Rate {job.customer.name}</T><Stars value={stars} onChange={setStars} /></>}
    <BottomCTA><Button title="Back to dashboard" onPress={async () => { if (job.status === 'PAID' && !job.ratings.PROVIDER) await call('rate', { stars }); onDone(); }} /></BottomCTA></>;
  return <>{head}
    <View style={{ alignSelf: 'center' }}><IconCircle name="x" size={64} bg={C.dangerSoft} color={C.danger} /></View>
    <T s="h2" style={{ textAlign: 'center', marginTop: 12 }}>Job cancelled</T>
    <T s="sm" style={{ textAlign: 'center', color: C.muted, marginVertical: 8 }}>{job.cancelFee ? `The customer cancelled after you arrived, so they're charged a ${rupee(job.cancelFee)} visit fee.` : 'No action needed.'}</T>
    <BottomCTA><Button title="Back to dashboard" onPress={onDone} /></BottomCTA></>;
}
