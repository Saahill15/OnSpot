import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ACTIVE_STATUSES, EVENTS, SERVICE_BY_CODE, ServiceCode } from '@onspot/shared';
import { ago, api, dayMonth, getSession, hhmm, opsSocket, rupee, setSession } from './api';
import LiveMap, { LiveJob, LiveProvider } from './LiveMap';

// ---------------------------------------------------------------- icons (Lucide-style line icons)
const P: Record<string, string> = {
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7"/>',
  out: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  phone: '<path d="M5 3h3l2 5-2.5 1.5a11 11 0 0 0 7 7L16 14l5 2v3a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  tow: '<path d="M14 17V6a1 1 0 0 0-1-1H3v12"/><path d="M14 9h4l3 4v4h-2"/><circle cx="7" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  puncture: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/>',
  fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2M11 9l-2 3h3l-2 3"/>',
  mechanic: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  plumber: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  electrician: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  locksmith: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
};
const Icon = ({ n, s = 18 }: { n: string; s?: number }) =>
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden dangerouslySetInnerHTML={{ __html: P[n] || '' }} />;
const svcName = (c: string) => SERVICE_BY_CODE[c as ServiceCode]?.name ?? c;
const STATUS: Record<string, string> = { SEARCHING: 'Searching', ASSIGNED: 'On the way', ARRIVED: 'Arrived', IN_PROGRESS: 'In progress', COMPLETED: 'Awaiting payment', PAID: 'Paid', CANCELLED: 'Cancelled', NO_PROVIDER: 'No provider' };
const Status = ({ s }: { s: string }) => <span className={`pill ${s}`}>{STATUS[s] ?? s}</span>;

// ---------------------------------------------------------------- types
interface Overview { active: number; completed: number; noProvider: number; matchRate: number; avgMatchSec: number; gmv: number; revenue: number; online: number; providers: number; pendingKyc: number; openDisputes: number; lateNow: number; geoIndex: string }
interface DisputeRow {
  id: string; reason: string; details: string; status: 'OPEN' | 'RESOLVED'; resolution: string | null; refundAmount: number; createdAt: string; resolvedAt: string | null;
  job: { id: string; service: string; status: string; amount: number; maxRefund: number }; customer: { name: string; phone: string }; provider: { id: string; name: string } | null;
}
const REASON: Record<string, string> = { OVERCHARGED: 'Overcharged', NO_SHOW: 'Pro did not show up', BAD_SERVICE: 'Problem not fixed', DAMAGE: 'Damage', SAFETY: 'Safety concern', OTHER: 'Other' };
interface JobRow { id: string; status: string; service: string; total: number; finalAmount: number | null; createdAt: string; customer: { name: string }; provider: { user: { name: string } } | null }
interface ProviderRow { id: string; name: string; phone: string; services: string[]; vehicleNo: string; online: boolean; onJob: boolean; rating: number; ratingCount: number; jobsDone: number; earnings: number; kycStatus: string; kycDocs: any; suspended: boolean; trust?: { score: number | null; onTimePct: number | null; reliabilityPct: number | null; cleanStreak: number; overchargeRefunds: number } }
interface Sos { jobId: string; customer: string; phone: string; at: number }

export default function App() {
  const [session, setS] = useState(getSession());
  if (!session || session.user.role !== 'ADMIN') return <Login onDone={s => { setSession(s); setS(s); }} />;
  return <Console onSignOut={() => { setSession(null); setS(null); }} />;
}

// ---------------------------------------------------------------- login
function Login({ onDone }: { onDone: (s: any) => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<string | null | false>(false);
  const [err, setErr] = useState('');
  const run = (fn: () => Promise<void>) => fn().catch(e => setErr(e.message));
  return (
    <div className="login"><div className="login-card">
      <div className="brand" style={{ padding: 0 }}><span className="logo"><Icon n="pin" s={16} /></span>OnSpot <span className="muted" style={{ fontWeight: 500 }}>Ops</span></div>
      <h1>Sign in to the ops console</h1>
      <p className="muted sm">For OnSpot operations staff only.</p>
      {sent === false ? (
        <form onSubmit={e => { e.preventDefault(); setErr(''); run(async () => { const r = await api('/auth/otp/request', { phone }); setSent(r.devCode ?? null); }); }}>
          <div className="field"><label htmlFor="ph">Mobile number</label><input id="ph" className="input" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit number" inputMode="numeric" autoFocus /></div>
          <button className="btn primary" style={{ width: '100%', padding: 13 }} disabled={phone.length !== 10}>Send code</button>
        </form>
      ) : (
        <form onSubmit={e => { e.preventDefault(); setErr(''); run(async () => { const r = await api('/auth/otp/verify', { phone, code, role: 'ADMIN' }); onDone({ token: r.token, user: r.user }); }); }}>
          <div className="field"><label htmlFor="cd">6-digit code sent to +91 {phone}</label><input id="cd" className="input" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoFocus style={{ letterSpacing: 6, fontSize: 18 }} /></div>
          {sent && <p className="muted xs">Development build: your code is {sent}</p>}
          <button className="btn primary" style={{ width: '100%', padding: 13 }} disabled={code.length !== 6}>Sign in</button>
          <button type="button" className="btn" style={{ width: '100%', marginTop: 8, border: 0 }} onClick={() => { setSent(false); setCode(''); }}>Use a different number</button>
        </form>
      )}
      {err && <p className="sm" style={{ color: 'var(--danger)' }}>{err}</p>}
    </div></div>
  );
}

// ---------------------------------------------------------------- console
type Page = 'overview' | 'jobs' | 'partners' | 'disputes';
function Console({ onSignOut }: { onSignOut: () => void }) {
  const [page, setPage] = useState<Page>('overview');
  const [ov, setOv] = useState<Overview | null>(null);
  const [live, setLive] = useState<{ providers: LiveProvider[]; jobs: LiveJob[] }>({ providers: [], jobs: [] });
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [sos, setSos] = useState<Sos[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [toast, setToast] = useState<{ t: string; err?: boolean } | null>(null);
  const timer = useRef<number>(undefined);

  const flash = (t: string, err = false) => { setToast({ t, err }); window.setTimeout(() => setToast(null), 3500); };
  const load = useCallback(async () => {
    const [o, l, j, p, d] = await Promise.all([api<Overview>('/admin/overview'), api('/admin/live'), api<JobRow[]>('/admin/jobs'), api<ProviderRow[]>('/admin/providers'), api<DisputeRow[]>('/admin/disputes')]);
    setOv(o); setLive(l); setJobs(j); setProviders(p); setDisputes(d);
  }, []);
  const soon = useCallback(() => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => load().catch(() => {}), 250); }, [load]);

  useEffect(() => {
    load().catch(e => flash(e.message, true));
    const s = opsSocket(); if (!s) return;
    const onLoc = (d: { providerId: string; lat: number; lng: number }) =>
      setLive(l => ({ ...l, providers: l.providers.map(p => p.id === d.providerId ? { ...p, lat: d.lat, lng: d.lng } : p) }));
    const onSos = (d: Omit<Sos, 'at'>) => {
      setSos(x => [{ ...d, at: Date.now() }, ...x.filter(y => y.jobId !== d.jobId)]);
      try { const a = new AudioContext(); const o = a.createOscillator(); o.frequency.value = 880; o.connect(a.destination); o.start(); o.stop(a.currentTime + 0.4); } catch { /* autoplay blocked */ }
    };
    const onLate = (d: { provider?: string; minutesLate: number }) => { flash(`${d.provider ?? 'A partner'} is ${d.minutesLate} min late. The customer can switch for free.`, true); soon(); };
    const onDispute = () => { flash('New problem reported. See Disputes.'); soon(); };
    s.on(EVENTS.JOB_UPDATED, soon); s.on('provider.updated', soon); s.on(EVENTS.PROVIDER_LOCATION, onLoc); s.on(EVENTS.SOS, onSos);
    s.on('job.late', onLate); s.on('dispute.created', onDispute); s.io.on('reconnect', soon); // reload whatever was missed while offline
    const poll = window.setInterval(soon, 15000); // safety net if a socket event is missed
    return () => {
      s.off(EVENTS.JOB_UPDATED, soon); s.off('provider.updated', soon); s.off(EVENTS.PROVIDER_LOCATION, onLoc); s.off(EVENTS.SOS, onSos);
      s.off('job.late', onLate); s.off('dispute.created', onDispute); s.io.off('reconnect', soon); window.clearInterval(poll);
    };
  }, [load, soon]);

  const pendingKyc = providers.filter(p => p.kycStatus === 'SUBMITTED').length;
  const openDisputes = disputes.filter(d => d.status === 'OPEN').length;
  const nav: [Page, string, string, number?][] = [['overview', 'Overview', 'grid'], ['jobs', 'Jobs', 'list'], ['partners', 'Partners', 'users', pendingKyc], ['disputes', 'Disputes', 'flag', openDisputes]];
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="logo"><Icon n="pin" s={16} /></span>OnSpot <span className="muted" style={{ fontWeight: 500 }}>Ops</span></div>
        <nav>{nav.map(([k, l, i, c]) => <button key={k} className={`nav ${page === k ? 'on' : ''}`} onClick={() => setPage(k)} title={l} aria-label={c ? `${l} (${c})` : l} aria-current={page === k ? 'page' : undefined}><Icon n={i} /><span className="label">{l}</span>{!!c && <span className="count">{c}</span>}</button>)}</nav>
        <button className="nav signout-compact" onClick={onSignOut} title="Sign out" aria-label="Sign out"><Icon n="out" /></button>
        <div className="foot"><div className="sm" style={{ fontWeight: 600 }}>{getSession()?.user.name}</div><div className="xs muted" style={{ marginBottom: 8 }}>Live · {ov?.geoIndex ?? '…'} geo index</div><button className="nav" style={{ padding: '6px 0' }} onClick={onSignOut}><Icon n="out" />Sign out</button></div>
      </aside>
      <main>
        {sos.map(a => (
          <div key={a.jobId} className="sos" role="alert"><Icon n="alert" s={22} />
            <div className="grow"><b>SOS from {a.customer}</b><div className="sm" style={{ opacity: .9 }}>Raised {ago(a.at)} · call them now and stay on the line</div></div>
            <a className="btn sm" href={`tel:+91${a.phone}`}><Icon n="phone" s={14} />+91 {a.phone}</a>
            <button className="btn sm" onClick={() => setOpen(a.jobId)}>Open job</button>
            <button className="btn sm" aria-label="Dismiss" onClick={() => setSos(x => x.filter(y => y.jobId !== a.jobId))}><Icon n="x" s={14} /></button>
          </div>
        ))}
        {page === 'overview' && <OverviewPage ov={ov} live={live} onOpen={setOpen} />}
        {page === 'jobs' && <JobsPage jobs={jobs} onOpen={setOpen} />}
        {page === 'partners' && <PartnersPage providers={providers} reload={load} flash={flash} />}
        {page === 'disputes' && <DisputesPage disputes={disputes} reload={load} flash={flash} onOpen={setOpen} />}
      </main>
      {open && <JobDrawer id={open} onClose={() => setOpen(null)} />}
      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.t}</div>}
    </div>
  );
}

function OverviewPage({ ov, live, onOpen }: { ov: Overview | null; live: { providers: LiveProvider[]; jobs: LiveJob[] }; onOpen: (id: string) => void }) {
  const k: [string, string, boolean?][] = ov ? [
    ['Partners online', `${ov.online} / ${ov.providers}`], ['Active jobs', String(ov.active)], ['Completed', String(ov.completed)],
    ['Match rate', `${ov.matchRate}%`], ['Avg. time to match', `${ov.avgMatchSec}s`], ['GMV', rupee(ov.gmv)], ['Platform revenue', rupee(ov.revenue)],
    ['KYC to review', String(ov.pendingKyc), ov.pendingKyc > 0], ['Open disputes', String(ov.openDisputes), ov.openDisputes > 0],
    ['Partners running late', String(ov.lateNow), ov.lateNow > 0],
  ] : [];
  return (
    <>
      <div className="page-head"><div><h1>Overview</h1><div className="muted">Live view of requests and partners. Updates in real time.</div></div></div>
      <div className="kpis">{k.map(([l, v, alert]) => <div key={l} className={`kpi ${alert ? 'alert' : ''}`}><span>{l}</span><b>{v}</b></div>)}</div>
      <div className="grid2">
        <div className="panel"><h2>Live map</h2><LiveMap providers={live.providers} jobs={live.jobs} onJob={onOpen} /></div>
        <div className="panel"><h2>Active requests <span className="pill">{live.jobs.length}</span></h2>
          <div className="list">
            {live.jobs.length === 0 && <div className="empty">No active requests right now.</div>}
            {live.jobs.map(j => (
              <div key={j.id} className="item" onClick={() => onOpen(j.id)}>
                <span className="ic"><Icon n={j.service} /></span>
                <div style={{ minWidth: 0 }}><b>{j.customer}</b> <span className="muted">· {svcName(j.service)}</span>
                  <div className="xs muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.provider ? `${j.provider}${j.eta ? ` · ${j.eta} min away` : ''}` : 'Looking for a partner'} · {ago(j.createdAt)}</div></div>
                <div style={{ textAlign: 'right' }}><Status s={j.status} /><div className="xs muted" style={{ marginTop: 4 }}>{rupee(j.total)}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function JobsPage({ jobs, onOpen }: { jobs: JobRow[]; onOpen: (id: string) => void }) {
  const [f, setF] = useState<'all' | 'active' | 'done' | 'failed'>('all');
  const rows = useMemo(() => jobs.filter(j => f === 'all' || (f === 'active' ? ACTIVE_STATUSES.includes(j.status as any) : f === 'done' ? ['COMPLETED', 'PAID'].includes(j.status) : ['CANCELLED', 'NO_PROVIDER'].includes(j.status))), [jobs, f]);
  return (
    <>
      <div className="page-head"><div><h1>Jobs</h1><div className="muted">Latest 50 requests. Click a row for the full trip.</div></div>
        <div className="seg">{([['all', 'All'], ['active', 'Active'], ['done', 'Completed'], ['failed', 'Cancelled / failed']] as const).map(([k, l]) => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}</button>)}</div></div>
      <div className="panel tbl">
        <table><thead><tr><th>Time</th><th>Service</th><th>Customer</th><th>Partner</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>{rows.map(j => <tr key={j.id} onClick={() => onOpen(j.id)}>
            <td>{hhmm(j.createdAt)} <span className="muted xs">{dayMonth(j.createdAt)}</span></td>
            <td><span className="row"><Icon n={j.service} s={16} />{svcName(j.service)}</span></td>
            <td>{j.customer.name}</td><td>{j.provider?.user.name ?? <span className="muted">—</span>}</td>
            <td><Status s={j.status} /></td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rupee(j.finalAmount ?? j.total)}</td>
          </tr>)}</tbody></table>
        {rows.length === 0 && <div className="empty">No jobs in this view.</div>}
      </div>
    </>
  );
}

function PartnersPage({ providers, reload, flash }: { providers: ProviderRow[]; reload: () => Promise<void>; flash: (t: string, err?: boolean) => void }) {
  const queue = providers.filter(p => p.kycStatus === 'SUBMITTED');
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); flash(msg); await reload(); } catch (e: any) { flash(e.message, true); } };
  const [suspending, setSuspending] = useState<ProviderRow | null>(null);
  const [reason, setReason] = useState('');
  return (
    <>
      {suspending && <>
        <div className="scrim" onClick={() => setSuspending(null)} />
        <div className="dialog" role="dialog" aria-label={`Suspend ${suspending.name}`}>
          <h2>Suspend {suspending.name}?</h2>
          <p className="muted sm">They go offline straight away and get no new jobs until you reinstate them.</p>
          <label className="xs muted" htmlFor="suspend-reason">Reason (sent to the partner)</label>
          <textarea id="suspend-reason" autoFocus rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Repeated overcharging complaints" />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" onClick={() => setSuspending(null)}>Cancel</button>
            <button className="btn dark" onClick={() => { const p = suspending; setSuspending(null); act(() => api(`/admin/providers/${p.id}/suspend`, { suspended: true, reason }), `${p.name} suspended`); }}>Suspend</button>
          </div>
        </div>
      </>}
      <div className="page-head"><div><h1>Partners</h1><div className="muted">Verify new partners and manage who can receive jobs.</div></div></div>
      <div className="panel" style={{ marginBottom: 20 }}>
        <h2>KYC queue {queue.length > 0 && <span className="pill accent">{queue.length} to review</span>}</h2>
        {queue.length === 0 ? <div className="empty">Nothing to review. New submissions appear here instantly.</div> : queue.map(p => (
          <div key={p.id} className="row" style={{ padding: '14px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
            <div className="grow" style={{ minWidth: 240 }}><b>{p.name}</b> <span className="muted sm">+91 {p.phone}</span>
              <div className="sm muted">{p.kycDocs?.idType} ••••{p.kycDocs?.idLast4} · DL {p.kycDocs?.dlNumber} · UPI {p.kycDocs?.upiId}</div>
              <div className="xs muted">Offers: {p.services.map(svcName).join(', ') || 'none yet'}{p.vehicleNo ? ` · ${p.vehicleNo}` : ''} · submitted {p.kycDocs?.submittedAt ? ago(p.kycDocs.submittedAt) : ''}</div></div>
            <button className="btn dark sm" onClick={() => act(() => api(`/admin/providers/${p.id}/kyc`, { approve: true }), `${p.name} is verified`)}>Approve</button>
            <button className="btn sm" onClick={() => act(() => api(`/admin/providers/${p.id}/kyc`, { approve: false }), `KYC rejected for ${p.name}`)}>Reject</button>
          </div>
        ))}
      </div>
      <div className="panel tbl">
        <h2>All partners</h2>
        <table><thead><tr><th>Partner</th><th>Status</th><th>Services</th><th>Rating</th><th title="60% on-time arrivals + 25% kept jobs + up to 15 for no overcharge refunds. Shown after 3 arrivals.">Trust</th><th>Jobs</th><th>Earnings</th><th>KYC</th><th></th></tr></thead>
          <tbody>{providers.map(p => <tr key={p.id} style={{ cursor: 'default' }}>
            <td><b>{p.name}</b><div className="xs muted">+91 {p.phone}{p.vehicleNo ? ` · ${p.vehicleNo}` : ''}</div></td>
            <td>{p.suspended ? <span className="pill bad">Suspended</span> : p.onJob ? <span className="pill accent">On a job</span> : p.online ? <span className="pill ok"><span className="dot" />Online</span> : <span className="pill">Offline</span>}</td>
            <td className="sm">{p.services.map(svcName).join(', ') || <span className="muted">—</span>}</td>
            <td>★ {p.rating.toFixed(1)} <span className="xs muted">({p.ratingCount})</span></td>
            <td>{p.trust?.score == null ? <span className="muted">New</span> : <><span className={`pill ${p.trust.score >= 85 ? 'ok' : p.trust.score >= 70 ? 'warn' : 'bad'}`}>{p.trust.score}</span><div className="xs muted">{p.trust.onTimePct}% on time{p.trust.overchargeRefunds ? ` · ${p.trust.overchargeRefunds} refund${p.trust.overchargeRefunds > 1 ? 's' : ''}` : ''}</div></>}</td><td>{p.jobsDone}</td><td>{rupee(p.earnings)}</td>
            <td><span className={`pill ${p.kycStatus === 'VERIFIED' ? 'ok' : p.kycStatus === 'SUBMITTED' ? 'warn' : p.kycStatus === 'REJECTED' ? 'bad' : ''}`}>{p.kycStatus.toLowerCase()}</span></td>
            <td>{p.suspended
              ? <button className="btn sm" onClick={() => act(() => api(`/admin/providers/${p.id}/suspend`, { suspended: false }), `${p.name} reinstated`)}>Reinstate</button>
              : <button className="btn sm danger" onClick={() => { setReason(''); setSuspending(p); }}>Suspend</button>}</td>
          </tr>)}</tbody></table>
      </div>
    </>
  );
}

function DisputesPage({ disputes, reload, flash, onOpen }: { disputes: DisputeRow[]; reload: () => Promise<void>; flash: (t: string, err?: boolean) => void; onOpen: (id: string) => void }) {
  const [f, setF] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [draft, setDraft] = useState<Record<string, { resolution: string; refund: string }>>({});
  const rows = disputes.filter(d => d.status === f);
  const set = (id: string, patch: Partial<{ resolution: string; refund: string }>) => setDraft(x => ({ ...x, [id]: { ...{ resolution: '', refund: '0' }, ...x[id], ...patch } }));
  const resolve = async (d: DisputeRow) => {
    const v = draft[d.id] ?? { resolution: '', refund: '0' };
    try {
      await api(`/admin/disputes/${d.id}/resolve`, { resolution: v.resolution.trim(), refundAmount: Math.round(+v.refund || 0) });
      flash(+v.refund ? `Resolved with ${rupee(+v.refund)} refund. Customer notified.` : 'Resolved. Customer notified.');
      await reload();
    } catch (e: any) { flash(e.message, true); }
  };
  return (
    <>
      <div className="page-head"><div><h1>Disputes</h1><div className="muted">Problems customers reported. Refunds are capped at what they paid.</div></div>
        <div className="seg">{(['OPEN', 'RESOLVED'] as const).map(k => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{k === 'OPEN' ? `Open (${disputes.filter(d => d.status === 'OPEN').length})` : 'Resolved'}</button>)}</div></div>
      {rows.length === 0 && <div className="panel empty">{f === 'OPEN' ? 'No open disputes. Nice.' : 'Nothing resolved yet.'}</div>}
      <div style={{ display: 'grid', gap: 14 }}>
        {rows.map(d => {
          const v = draft[d.id] ?? { resolution: '', refund: '0' };
          return (
            <div key={d.id} className="panel">
              <div className="row" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
                <span className={`pill ${d.reason === 'SAFETY' ? 'bad' : 'warn'}`}>{REASON[d.reason] ?? d.reason}</span>
                <b className="grow">{d.customer.name} <span className="muted sm" style={{ fontWeight: 400 }}>vs {d.provider?.name ?? 'partner'} · {svcName(d.job.service)} · paid {rupee(d.job.amount)}</span></b>
                <span className="muted xs">{ago(d.createdAt)}</span>
                <button className="btn sm" onClick={() => onOpen(d.job.id)}>Open job</button>
              </div>
              {d.details ? <p className="sm" style={{ margin: '4px 0 12px', color: 'var(--ink-2)' }}>“{d.details}”</p> : <p className="muted sm" style={{ margin: '4px 0 12px' }}>No details given.</p>}
              {d.status === 'RESOLVED' ? (
                <div className="sm"><span className="pill ok">Resolved {d.resolvedAt ? ago(d.resolvedAt) : ''}</span> {d.refundAmount ? <b> · {rupee(d.refundAmount)} refunded</b> : null}<div className="muted" style={{ marginTop: 6 }}>{d.resolution}</div></div>
              ) : (
                <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div className="grow" style={{ minWidth: 240 }}><label className="xs muted">Resolution (sent to the customer)</label><input className="input" value={v.resolution} onChange={e => set(d.id, { resolution: e.target.value })} placeholder="e.g. Partner warned; refunding the extra charge" /></div>
                  <div style={{ width: 140 }}><label className="xs muted">Refund ₹ (max {d.job.maxRefund})</label><input className="input" inputMode="numeric" value={v.refund} onChange={e => set(d.id, { refund: e.target.value.replace(/\D/g, '') })} /></div>
                  <button className="btn dark" disabled={v.resolution.trim().length < 3 || +v.refund > d.job.maxRefund} onClick={() => resolve(d)}>Resolve</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function JobDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [j, setJ] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    const get = () => api(`/admin/jobs/${id}`).then(d => alive && setJ(d)).catch(() => {});
    get();
    const s = opsSocket(); const h = (d: any) => { if (d.id === id) setJ(d); }; s?.on(EVENTS.JOB_UPDATED, h);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k);
    return () => { alive = false; s?.off(EVENTS.JOB_UPDATED, h); window.removeEventListener('keydown', k); };
  }, [id]);
  const approved = j?.addons.filter((a: any) => a.status === 'APPROVED') ?? [];
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Job details">
        <div className="row" style={{ marginBottom: 16 }}><h2 className="grow" style={{ fontSize: 20 }}>{j ? svcName(j.service) : 'Loading…'}</h2><button className="btn sm" onClick={onClose} aria-label="Close"><Icon n="x" s={14} /></button></div>
        {j && <>
          <div className="row" style={{ flexWrap: 'wrap' }}><Status s={j.status} /><span className="muted xs">{j.id}</span></div>
          <div className="sec">People</div>
          <div className="row sm" style={{ marginBottom: 6 }}><span className="grow"><b>Customer</b> · {j.customer.name}</span><span className="muted">{j.customer.phone}</span></div>
          <div className="row sm"><span className="grow"><b>Partner</b> · {j.provider ? `${j.provider.name}${j.provider.verified ? ' ✓' : ''} · ★ ${j.provider.rating}${j.provider.trust?.score != null ? ` · trust ${j.provider.trust.score}` : ''}` : 'not assigned'}</span><span className="muted">{j.provider?.vehicleNo}</span></div>
          <div className="sec">Location</div>
          <div className="sm">{j.pickup.label || `${j.pickup.lat.toFixed(5)}, ${j.pickup.lng.toFixed(5)}`} · <a href={`https://www.google.com/maps?q=${j.pickup.lat},${j.pickup.lng}`} target="_blank" rel="noreferrer">Open in Maps</a></div>
          {j.notes && <div className="sm muted" style={{ marginTop: 4 }}>“{j.notes}”</div>}
          <div className="sec">Bill (Fair Price Lock)</div>
          <div className="bill">
            {j.quote.lines.map((l: any, i: number) => <div key={i} className="li"><span>{l.label}</span><span>{rupee(l.amount)}</span></div>)}
            {j.addons.map((a: any) => <div key={a.id} className="li"><span>+ {a.label} <span className={`pill ${a.status === 'APPROVED' ? 'ok' : a.status === 'REJECTED' ? 'bad' : 'warn'}`}>{a.status.toLowerCase()}</span></span><span>{a.status === 'APPROVED' ? rupee(a.amount) : '—'}</span></div>)}
            <div className="li total"><span>{j.finalAmount != null ? 'Final' : 'Locked'} total</span><span>{rupee(j.finalAmount ?? j.total + approved.reduce((t: number, a: any) => t + a.amount, 0))}</span></div>
            {j.providerPayout != null && <div className="li xs"><span>Partner payout</span><span>{rupee(j.providerPayout)}</span></div>}
            {j.payment && <div className="li xs"><span>Payment</span><span>{j.payment.method.toUpperCase()} · {j.payment.ref}</span></div>}
            {j.cancelReason && <div className="li xs"><span>Cancel reason</span><span>{j.cancelReason}{j.cancelFee ? ` · ₹${j.cancelFee} fee` : ''}</span></div>}
            {j.tip > 0 && <div className="li xs"><span>Tip to partner</span><span>{rupee(j.tip)}</span></div>}
          </div>
          {(j.late || j.arrivedAuto || j.topRatedOnly || j.payment?.status === 'PENDING_CASH' || j.dispute) && <div className="row" style={{ flexWrap: 'wrap', marginTop: 12 }}>
            {j.late && <span className="pill warn">Partner running late</span>}
            {j.arrivedAuto && <span className="pill ok">Arrival confirmed by location</span>}
            {j.topRatedOnly && <span className="pill">Top-rated pros only</span>}
            {j.payment?.status === 'PENDING_CASH' && <span className="pill warn">Cash, awaiting partner confirmation</span>}
            {j.dispute && <span className={`pill ${j.dispute.status === 'OPEN' ? 'bad' : 'ok'}`}>Dispute: {REASON[j.dispute.reason] ?? j.dispute.reason} · {j.dispute.status.toLowerCase()}</span>}
          </div>}
          {j.photos?.length > 0 && <><div className="sec">Proof of work</div><div className="photos">{j.photos.map((p: any) => <a key={p.id} href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={`${p.kind.toLowerCase()} photo`} /><span>{p.kind === 'BEFORE' ? 'Before' : 'After'} · {hhmm(p.at)}</span></a>)}</div></>}
          {j.messages?.length > 0 && <><div className="sec">Chat</div>{j.messages.map((m: any) => <div key={m.id} className={`msg ${m.from}`}>{m.text}<div className="xs" style={{ opacity: .6 }}>{m.from === 'PROVIDER' ? 'Partner' : 'Customer'} · {hhmm(m.at)}</div></div>)}</>}
          {Object.keys(j.ratings).length > 0 && <><div className="sec">Ratings</div>{Object.entries(j.ratings).map(([by, r]: any) => <div key={by} className="sm">{by === 'CUSTOMER' ? 'Customer → partner' : 'Partner → customer'}: ★ {r.stars}{r.comment ? ` · “${r.comment}”` : ''}</div>)}</>}
          <div className="sec">Timeline</div>
          <ul className="timeline">{[...j.events].reverse().map((e: any, i: number) => <li key={i}><time>{hhmm(e.at)}</time>{e.text}</li>)}</ul>
        </>}
      </aside>
    </>
  );
}
