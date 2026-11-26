import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface LiveProvider { id: string; name: string; lat: number; lng: number; services: string[]; onJob: boolean }
export interface LiveJob { id: string; status: string; service: string; total: number; pickup: { lat: number; lng: number; label: string }; customer: string; provider: string | null; createdAt: string; eta: number | null }

const icon = (cls: string) => L.divIcon({ className: '', html: `<div class="mk ${cls}"></div>`, iconSize: [0, 0] });

/** Live ops map: partners (white = free, black = on a job) and open requests (amber = searching, pink = in progress). */
export default function LiveMap({ providers, jobs, onJob }: { providers: LiveProvider[]; jobs: LiveJob[]; onJob: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{ pro: Map<string, L.Marker>; job: L.LayerGroup } | null>(null);
  const fitted = useRef(false);
  const onJobRef = useRef(onJob); onJobRef.current = onJob;

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: true }).setView([18.7546, 73.4062], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    map.current = m;
    layers.current = { pro: new Map(), job: L.layerGroup().addTo(m) };
    return () => { m.remove(); map.current = null; };
  }, []);

  // Partners: move existing markers instead of recreating them, so live GPS updates animate smoothly.
  useEffect(() => {
    const l = layers.current, m = map.current; if (!l || !m) return;
    const seen = new Set<string>();
    for (const p of providers) {
      seen.add(p.id);
      const existing = l.pro.get(p.id);
      if (existing) { existing.setLatLng([p.lat, p.lng]); existing.setIcon(icon(`pro${p.onJob ? ' busy' : ''}`)); }
      else l.pro.set(p.id, L.marker([p.lat, p.lng], { icon: icon(`pro${p.onJob ? ' busy' : ''}`) }).bindTooltip(`${p.name}${p.onJob ? ' · on a job' : ' · available'}`).addTo(m));
    }
    for (const [id, mk] of l.pro) if (!seen.has(id)) { mk.remove(); l.pro.delete(id); }
  }, [providers]);

  useEffect(() => {
    const l = layers.current, m = map.current; if (!l || !m) return;
    l.job.clearLayers();
    for (const j of jobs) L.marker([j.pickup.lat, j.pickup.lng], { icon: icon(`job ${j.status}`) })
      .bindTooltip(`${j.customer} · ${j.service} · ${j.status.replace('_', ' ').toLowerCase()}`).on('click', () => onJobRef.current(j.id)).addTo(l.job);
    const pts = [...providers.map(p => [p.lat, p.lng]), ...jobs.map(j => [j.pickup.lat, j.pickup.lng])] as [number, number][];
    if (!fitted.current && pts.length) { fitted.current = true; m.fitBounds(pts, { padding: [40, 40], maxZoom: 14 }); }
  }, [jobs, providers.length]);

  return (
    <>
      <div ref={el} className="map" />
      <div className="legend">
        <span><i style={{ background: '#fff', border: '3px solid #222' }} />Partner available</span>
        <span><i style={{ background: '#222' }} />Partner on a job</span>
        <span><i style={{ background: 'var(--warn)' }} />Searching</span>
        <span><i style={{ background: 'var(--accent)' }} />In progress</span>
      </div>
    </>
  );
}
