// Native map (iOS/Android) via react-native-maps. Web uses Map.web.tsx (Leaflet).
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { C, Icon, SERVICE_ICON } from './ui';
import type { MapProps } from './mapTypes';

export default function Map({ center, markers, route, height, onPress }: MapProps) {
  const ref = useRef<MapView>(null);
  useEffect(() => {
    const pts = markers.map(m => ({ latitude: m.lat, longitude: m.lng }));
    if (pts.length > 1) ref.current?.fitToCoordinates(pts, { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true });
  }, [markers.length]);
  return (
    <MapView ref={ref} style={{ height }} initialRegion={{ latitude: center.lat, longitude: center.lng, latitudeDelta: 0.04, longitudeDelta: 0.04 }}
      onPress={e => onPress?.({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })} showsUserLocation={false}>
      {route && <Polyline coordinates={route.map(p => ({ latitude: p.lat, longitude: p.lng }))} strokeColor={C.ink} strokeWidth={3} lineDashPattern={[6, 8]} />}
      {markers.map(m => (
        <Marker key={m.id} coordinate={{ latitude: m.lat, longitude: m.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          {m.kind === 'me' ? <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: C.accent, borderWidth: 3, borderColor: '#fff' }} />
            : <View style={{ width: m.kind === 'assigned' ? 40 : 30, height: m.kind === 'assigned' ? 40 : 30, borderRadius: 20, backgroundColor: m.kind === 'assigned' ? C.ink : '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' }}>
                <Icon name={m.kind === 'drop' ? 'flag' : SERVICE_ICON[m.service || 'mechanic']} size={15} color={m.kind === 'assigned' ? '#fff' : C.ink} />
              </View>}
        </Marker>
      ))}
    </MapView>
  );
}
