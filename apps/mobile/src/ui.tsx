// Design system: Airbnb-style tokens + primitives shared by every screen.
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, TextStyle, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { ServiceCode } from '@onspot/shared';

export const C = {
  bg: '#FFFFFF', surface2: '#F7F7F7', surface3: '#EFEFEF', ink: '#222222', ink2: '#484848', muted: '#717171',
  line: '#EBEBEB', line2: '#DDDDDD', accent: '#FF385C', accentSoft: '#FFF1F3', ok: '#008A05', okSoft: '#F0F8F0',
  warn: '#B35C00', warnSoft: '#FFF6EC', danger: '#C13515', dangerSoft: '#FFF2EF',
};
export const rupee = (n?: number | null) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
export const hhmm = (d: string | Date) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const initials = (n = '?') => n.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();

export const SERVICE_ICON: Record<ServiceCode, keyof typeof Feather.glyphMap> = {
  tow: 'truck', puncture: 'disc', fuel: 'droplet', battery: 'battery-charging', mechanic: 'tool', plumber: 'droplet', electrician: 'zap', locksmith: 'key',
};
export type IconName = keyof typeof Feather.glyphMap;
export const Icon = ({ name, size = 20, color = C.ink }: { name: IconName; size?: number; color?: string }) => <Feather name={name} size={size} color={color} />;

export function T({ children, s, style, numberOfLines }: { children: React.ReactNode; s?: 'h1' | 'h2' | 'h3' | 'body' | 'sm' | 'xs' | 'label'; style?: TextStyle | TextStyle[]; numberOfLines?: number }) {
  return <Text numberOfLines={numberOfLines} style={[st[s || 'body'], style as TextStyle]}>{children}</Text>;
}

export function Button({ title, onPress, kind = 'primary', icon, disabled, loading, style, small }: {
  title: string; onPress?: () => void; kind?: 'primary' | 'dark' | 'outline' | 'ghost' | 'danger'; icon?: IconName; disabled?: boolean; loading?: boolean; style?: ViewStyle; small?: boolean;
}) {
  const bg = { primary: C.accent, dark: C.ink, outline: C.bg, ghost: 'transparent', danger: C.bg }[kind];
  const fg = { primary: '#fff', dark: '#fff', outline: C.ink, ghost: C.ink, danger: C.danger }[kind];
  const border = { primary: C.accent, dark: C.ink, outline: C.ink, ghost: 'transparent', danger: C.line2 }[kind];
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || loading}
      style={({ pressed }) => [st.btn, small && st.btnSm, { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : <>
        {icon && <Icon name={icon} size={small ? 15 : 18} color={fg} />}
        <Text style={[st.btnText, small && { fontSize: 13 }, { color: fg }, kind === 'ghost' && { textDecorationLine: 'underline' }]}>{title}</Text>
      </>}
    </Pressable>
  );
}

export const Input = (p: TextInputProps & { label?: string }) => (
  <View style={{ marginBottom: 14 }}>
    {p.label && <T s="label" style={{ marginBottom: 6 }}>{p.label}</T>}
    <TextInput placeholderTextColor="#A0A0A0" {...p} style={[st.input, p.style as TextStyle]} />
  </View>
);

export const Card = ({ children, style, soft }: { children: React.ReactNode; style?: ViewStyle; soft?: boolean }) =>
  <View style={[st.card, soft && { backgroundColor: C.surface2, borderColor: 'transparent' }, style]}>{children}</View>;

export const Row = ({ children, style, gap = 10 }: { children: React.ReactNode; style?: ViewStyle; gap?: number }) =>
  <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;

export const Pill = ({ text, tone = 'ok', icon }: { text: string; tone?: 'ok' | 'warn' | 'accent' | 'gray'; icon?: IconName }) => {
  const m = { ok: [C.okSoft, C.ok], warn: [C.warnSoft, C.warn], accent: [C.accentSoft, C.accent], gray: [C.surface2, C.muted] }[tone];
  return <View style={[st.pill, { backgroundColor: m[0] }]}>{icon && <Icon name={icon} size={12} color={m[1]} />}<Text style={{ color: m[1], fontSize: 12, fontWeight: '600' }}>{text}</Text></View>;
};

export const Avatar = ({ name, size = 52 }: { name: string; size?: number }) =>
  <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '600', fontSize: size / 3.2 }}>{initials(name)}</Text></View>;

export const IconCircle = ({ name, size = 44, bg = C.surface2, color = C.ink }: { name: IconName; size?: number; bg?: string; color?: string }) =>
  <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}><Icon name={name} size={size * 0.45} color={color} /></View>;

export const Divider = () => <View style={{ height: 1, backgroundColor: C.line, marginVertical: 16 }} />;

export function BillLines({ lines, total, totalLabel = 'Total (INR)' }: { lines: { label: string; amount: number; extra?: boolean }[]; total: number; totalLabel?: string }) {
  return (
    <View style={{ gap: 10 }}>
      {lines.map((l, i) => <Row key={i} style={{ justifyContent: 'space-between' }}><T s="sm" style={{ flex: 1, color: C.ink2 }}>{l.extra ? '+ ' : ''}{l.label}</T><T s="sm" style={{ color: C.ink2 }}>{rupee(l.amount)}</T></Row>)}
      <View style={{ height: 1, backgroundColor: C.line }} />
      <Row style={{ justifyContent: 'space-between' }}><T s="h3">{totalLabel}</T><T s="h3">{rupee(total)}</T></Row>
    </View>
  );
}

export const st = StyleSheet.create({
  h1: { fontSize: 30, fontWeight: '700', color: C.ink, letterSpacing: -0.8 },
  h2: { fontSize: 22, fontWeight: '600', color: C.ink, letterSpacing: -0.4 },
  h3: { fontSize: 16, fontWeight: '600', color: C.ink },
  body: { fontSize: 15, color: C.ink, lineHeight: 21 },
  sm: { fontSize: 13.5, color: C.ink, lineHeight: 19 },
  xs: { fontSize: 12, color: C.muted, lineHeight: 16 },
  label: { fontSize: 13, color: C.muted, fontWeight: '500' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1 },
  btnSm: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9 },
  btnText: { fontSize: 16, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: C.line2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: C.ink, backgroundColor: '#fff' },
  card: { borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 16, backgroundColor: '#fff', marginBottom: 12 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99, alignSelf: 'flex-start' },
});
