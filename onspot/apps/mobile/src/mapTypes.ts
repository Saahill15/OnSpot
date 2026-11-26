import type { LatLng, ServiceCode } from '@onspot/shared';
export interface MapMarker { id: string; lat: number; lng: number; kind: 'me' | 'provider' | 'assigned' | 'drop'; service?: ServiceCode; }
export interface MapProps { center: LatLng; markers: MapMarker[]; route?: LatLng[] | null; height: number; onPress?: (p: LatLng) => void; }
