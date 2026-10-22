import { auth, db } from '../../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { enqueueStatusUpdate, retryStatusUpdate } from '../services/statusOutbox';
import { useStatusOutbox } from '../hooks/useStatusOutbox';

export default function AlertDetailScreen() {
  const router = useRouter();
  const { alertId } = useLocalSearchParams<{ alertId?: string }>();
  const [alertData, setAlertData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const pendingUpdates = useStatusOutbox();
  const pendingUpdate = typeof alertId === 'string'
    ? pendingUpdates.find((update) => update.alertId === alertId)
    : undefined;
  const currentStatus = pendingUpdate?.status || alertData?.status || 'Unsafe';

  useEffect(() => {
    let active = true;
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.replace('/login');
        if (active) setLoading(false);
        return;
      }
      if (!alertId || Array.isArray(alertId)) {
        if (active) setLoading(false);
        return;
      }
      try {
        const result = await getDoc(doc(db, 'ppe_alerts', alertId));
        if (active && result.exists()) setAlertData({ id: result.id, ...result.data() });
      } catch (error: any) {
        if (active) Alert.alert('Could not load alert', error.message);
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; unsubscribeAuth(); };
  }, [alertId, router]);

  const updateStatus = async (status: string) => {
    if (!alertId || Array.isArray(alertId) || !auth.currentUser) return;
    try {
      await enqueueStatusUpdate(alertId, status as 'Acknowledged' | 'Resolved' | 'False Alarm', auth.currentUser.uid);
      setAlertData((current: any) => ({ ...current, status }));
      router.replace(status === 'Acknowledged' ? '/acknowledge' : '/logs');
    } catch (error: any) {
      Alert.alert('Could not save status', error.message || 'The status could not be saved on this device.');
    }
  };

  return <View style={styles.container}>
    <ScrollView contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>‹  Back</Text></TouchableOpacity>
      <Text style={styles.title}>Violation Details</Text>
      {loading ? <ActivityIndicator color="#FFFFFF" style={{ marginTop: 30 }} /> : !alertData ? (
        <Text style={styles.info}>Alert unavailable. The notification must include a valid alert ID.</Text>
      ) : <>
        {alertData.image_data ? <Image source={{ uri: `data:image/jpeg;base64,${alertData.image_data}` }} style={styles.image} resizeMode="cover" /> : null}
        <View style={styles.card}>
          <Detail label="Worker" value={alertData.worker_id || 'Unknown'} />
          <Detail label="Missing PPE" value={alertData.missing_item || 'Unknown'} />
          <Detail label="Zone" value={alertData.zone || 'Unavailable'} />
          <Detail label="Timestamp" value={alertData.timestamp?.toDate ? alertData.timestamp.toDate().toLocaleString() : 'Unavailable'} />
          <Detail label="Status" value={currentStatus} />
        </View>
        {pendingUpdate && <View style={styles.pendingSync}>
          <Text style={styles.pendingSyncText}>{pendingUpdate.error ? 'Status not synced' : 'Status pending sync'}</Text>
          {pendingUpdate.error && <TouchableOpacity onPress={() => void retryStatusUpdate(pendingUpdate.alertId)}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>}
        </View>}
        <View style={styles.actions}>
          {(currentStatus === 'Acknowledged' ? ['Resolved', 'False Alarm'] : ['Acknowledged']).map((status) => <TouchableOpacity key={status} style={styles.button} onPress={() => updateStatus(status)}>
            <Text style={styles.buttonText}>{status}</Text>
          </TouchableOpacity>)}
        </View>
      </>}
    </ScrollView>
  </View>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <View style={styles.detail}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#5C4B4B' },
  content: { padding: 22, paddingTop: 58, paddingBottom: 50 },
  back: { color: '#FFFFFF', fontSize: 15, marginBottom: 20 },
  title: { color: '#FFFFFF', fontSize: 25, fontWeight: 'bold', marginBottom: 18 },
  info: { color: '#FFFFFF', marginTop: 24 },
  image: { width: '100%', height: 240, borderRadius: 14, marginBottom: 16, backgroundColor: '#DDD' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16 },
  pendingSync: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 10 },
  pendingSyncText: { color: '#F6D08C', fontSize: 12, fontWeight: '700' },
  retryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' },
  detail: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EEE' },
  label: { color: '#666', fontSize: 12 },
  value: { flex: 1, color: '#222', fontSize: 13, fontWeight: '600', textAlign: 'right' },
  actions: { gap: 9, marginTop: 16 },
  button: { borderRadius: 10, backgroundColor: '#A69691', padding: 13, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
});
