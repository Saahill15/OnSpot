import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { closeSocket, getSocket, loadSession, saveSession, Session } from './src/api';
import Auth from './src/Auth';
import { ConfirmHost, ToastHost } from './src/common';
import Customer from './src/Customer';
import Partner from './src/Partner';
import { onNotificationTap, registerForPush, unregisterPush } from './src/push';
import { stopBackgroundLocation } from './src/backgroundLocation';
import { Button, C, T } from './src/ui';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Bumped when a notification is tapped: remounting the role screen reloads the job / offers from the API.
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { loadSession().then(s => setSession(s)); }, []);
  useEffect(() => {
    if (!session) return;
    getSocket();
    registerForPush().catch(e => console.warn('push registration failed', e));
    return onNotificationTap(() => setRefreshKey(k => k + 1));
  }, [session?.token]);

  // Stop background location before clearing the session, so a signed-out phone never keeps reporting.
  const signOut = async () => { await stopBackgroundLocation(); await unregisterPush(); closeSocket(); await saveSession(null); setSession(null); };

  let screen: React.ReactNode;
  if (session === undefined) screen = <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.accent} /></View>;
  else if (!session) screen = <Auth onDone={setSession} />;
  else if (session.user.role === 'CUSTOMER') screen = <Customer key={refreshKey} onSignOut={signOut} />;
  else if (session.user.role === 'PROVIDER') screen = <Partner key={refreshKey} onSignOut={signOut} />;
  else screen = <View style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 16 }}><T s="h2">Ops accounts use the web console.</T><Button title="Sign out" onPress={signOut} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {screen}
      <ToastHost />
      <ConfirmHost />
      <StatusBar style="dark" />
    </View>
  );
}
