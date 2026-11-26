// Web map: Leaflet + OpenStreetMap, loaded on demand (react-native-maps has no web support).
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { MapProps } from './mapTypes';

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
let loading: Promise<any> | null = null;
function loadLeaflet(): Promise<any> {
  const w = window as any;
  if (w.L) return Promise.resolve(w.L);
  if (!loading) loading = new Promise(res => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LEAFLET_CSS; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = LEAFLET_JS; s.onload = () => res(w.L); document.head.appendChild(s);
  });
  return loading;
}
const pin = (kind: string) => {
  const base = 'position:absolute;transform:translate(-50%,-50%);border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.25);border:3px solid #fff;';
  if (kind === 'me') return `<div style="${base}width:20px;height:20px;background:#FF385C"></div>`;
  if (kind === 'assigned') return `<div style="${base}width:40px;height:40px;background:#222"></div>`;
  if (kind === 'drop') return `<div style="${base}width:26px;height:26px;background:#222;border-radius:8px"></div>`;
  return `<div style="${base}width:22px;height:22px;background:#fff;border:3px solid #222"></div>`;
};

export default function Map({ center, markers, route, height, onPress }: MapProps) {
  const host = useRef<any>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const onPressRef = useRef(onPress); onPressRef.current = onPress;
  const fitted = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then(L => {
      if (cancelled || map.current || !host.current) return;
      map.current = L.map(host.current, { zoomControl: false }).setView([center.lat, center.lng], 14);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map.current);
      (host.current.querySelector('.leaflet-tile-pane') as HTMLElement).style.filter = 'saturate(.3) brightness(1.05) contrast(.92)';
      map.current.on('click', (e: any) => onPressRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
      layer.current = L.layerGroup().addTo(map.current);
      draw();
    });
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, []);

  function draw() {
    const L = (window as any).L; if (!L || !layer.current) return;
    layer.current.clearLayers();
    for (const m of markers) L.marker([m.lat, m.lng], { icon: L.divIcon({ className: '', html: pin(m.kind), iconSize: [0, 0] }), interactive: false }).addTo(layer.current);
    if (route?.length) L.polyline(route.map(p => [p.lat, p.lng]), { color: '#222', weight: 3, dashArray: '6 8' }).addTo(layer.current);
    if (markers.length > 1 && fitted.current !== markers.length) { fitted.current = markers.length; map.current.fitBounds(markers.map(m => [m.lat, m.lng]), { padding: [50, 50], maxZoom: 15 }); }
  }
  useEffect(draw, [JSON.stringify(markers), JSON.stringify(route)]);
  useEffect(() => { if (map.current && markers.length <= 1) map.current.setView([center.lat, center.lng]); }, [center.lat, center.lng]);

  return <View ref={host} style={{ height, backgroundColor: '#EEF0EC' }} />;
}
