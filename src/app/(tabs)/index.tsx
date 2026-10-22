import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, onSnapshot, orderBy, query, where, getCountFromServer, doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View, Pressable } from 'react-native';
import { auth, db } from '../../../firebaseConfig';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { enqueueStatusUpdate, retryStatusUpdate } from '../../services/statusOutbox';
import { useStatusOutbox } from '../../hooks/useStatusOutbox';

export default function DashboardScreen() {
  const router = useRouter();
  const { alertId } = useLocalSearchParams<{ alertId?: string }>();
  const [alerts, setAlerts] = useState<any[]>([]);
  const pendingUpdates = useStatusOutbox();
  const [loading, setLoading] = useState(true);
  const [monthTotal, setMonthTotal] = useState<number | string>('...');

  // State for the System Status Heartbeat
  const [systemStatus, setSystemStatus] = useState({ isOnline: false, cameraCount: 0 });

  // State for the popup modal
  const [selectedAlert, setSelectedAlert] = useState<any>(null);
  const [isModalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    // 1. Calculate the start of today (Midnight local time)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // 2. Query only alerts that happened today, keeping newest at the top
    const qToday = query(
      collection(db, 'ppe_alerts'),
      where('timestamp', '>=', startOfToday),
      orderBy('timestamp', 'desc')
    );

    // 3. Real-time listener for Today's feed
    const unsubscribe = onSnapshot(qToday, (snapshot) => {
      const fetchedAlerts = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAlerts(fetchedAlerts);
      setLoading(false);
    });

    // 4. Fetch the 1-Month total securely without downloading heavy images
    const fetchMonthTotal = async () => {
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const qMonth = query(
          collection(db, 'ppe_alerts'),
          where('timestamp', '>=', thirtyDaysAgo)
        );

        const snapshot = await getCountFromServer(qMonth);
        setMonthTotal(snapshot.data().count);
      } catch (error) {
        console.error("Error fetching monthly total: ", error);
        setMonthTotal(0); // Fallback on error
      }
    };

    fetchMonthTotal();

    // 5. System Status Heartbeat Listener
    const statusDoc = doc(db, 'system_status', 'cameras');
    const unsubscribeStatus = onSnapshot(statusDoc, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const lastHeartbeat = data.last_heartbeat?.toDate ? data.last_heartbeat.toDate() : null;
        const now = new Date();

        // If the last heartbeat was less than 2 minutes ago (120,000 ms), we are online
        const isCurrentlyOnline = lastHeartbeat && (now.getTime() - lastHeartbeat.getTime() < 120000);

        setSystemStatus({
          isOnline: isCurrentlyOnline && data.status !== 'offline',
          cameraCount: data.active_cameras || 0
        });
      }
    });

    return () => {
      unsubscribe();
      unsubscribeStatus();
    };
  }, []);

  useEffect(() => {
    if (!alertId || Array.isArray(alertId)) return;
    let active = true;
    getDoc(doc(db, 'ppe_alerts', alertId)).then((snapshot) => {
      if (active && snapshot.exists()) {
        const data = snapshot.data();
        const timestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp || 0);
        setSelectedAlert({
          id: snapshot.id,
          ...data,
          workerName: data.worker_id || 'Unknown worker',
          date: timestamp.toLocaleDateString(),
          time: timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
        setModalVisible(true);
      }
    }).catch((error) => console.error('Could not open notification alert:', error));
    return () => { active = false; };
  }, [alertId]);

  const updateAlertStatus = async (status: string) => {
    const currentAlert = selectedAlert;
    if (!currentAlert?.id || !auth.currentUser) return;
    try {
      await enqueueStatusUpdate(currentAlert.id, status as 'Acknowledged' | 'Resolved' | 'False Alarm', auth.currentUser.uid);
      setSelectedAlert({ ...currentAlert, status });
      if (status === 'Acknowledged') {
        setModalVisible(false);
        router.push('/acknowledge');
      } else {
        Alert.alert('Status saved', `Alert marked ${status.toLowerCase()}. It will sync with Firestore when the connection is available.`);
      }
    } catch (error: any) {
      Alert.alert('Could not save status', error.message || 'The status could not be saved on this device.');
    }
  };

  const selectedPendingUpdate = selectedAlert
    ? pendingUpdates.find((update) => update.alertId === selectedAlert.id)
    : undefined;

  const formatTimestamp = (timestamp: any) => {
    if (!timestamp) return { time: 'N/A', date: 'N/A' };
    const dateObj = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const time = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const date = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    return { time, date };
  };

  const getIconName = (item: string) => {
    const lowerItem = item.toLowerCase();
    if (lowerItem.includes('helmet') || lowerItem.includes('hard hat')) return 'hard-hat';
    if (lowerItem.includes('vest')) return 'vest';
    return 'alert-circle-outline';
  };

  const openDetails = (alertData: any, workerName: string, time: string, date: string) => {
    setSelectedAlert({ ...alertData, workerName, time, date });
    setModalVisible(true);
  };

  const activeAlerts = alerts.filter((alert) => !['acknowledged', 'resolved', 'false alarm'].includes((alert.status || '').toLowerCase()));

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.contentPadding} showsVerticalScrollIndicator={false}>

        {/* Header Section */}
        <View style={styles.header}>
          <View style={styles.profileSection}>
            <Image
              source={{ uri: 'https://cdn-icons-png.flaticon.com/512/4140/4140048.png' }}
              style={styles.avatar}
            />
            <Text style={styles.headerTitle}>Safety Officer</Text>
          </View>
          <TouchableOpacity style={styles.bellButton}>
            <Ionicons name="notifications-outline" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Top Stats Section */}
        <View style={styles.statsContainer}>
          <LinearGradient
            colors={['#E5D9C5', '#6D5353']}
            style={styles.mainCard}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={styles.cardLabel}>Violations Today</Text>
            <Text style={styles.largeNumber}>{loading ? '...' : activeAlerts.length}</Text>
            <Text style={styles.cardSubLabel}>1 Month Total of Violations</Text>
            <Text style={styles.largeNumber}>{monthTotal}</Text>
          </LinearGradient>

          <View style={styles.systemStatus}>
            <View style={[
              styles.cctvIconContainer,
              !systemStatus.isOnline && { backgroundColor: '#888888' } // Turns gray if offline
            ]}>
              <MaterialCommunityIcons name="cctv" size={24} color="#FFFFFF" />
            </View>
            <Text style={styles.statusTitle}>System Status</Text>
            <Text style={[
              styles.statusOnline,
              !systemStatus.isOnline && { color: '#ef4444' } // Turns red if offline
            ]}>
              {systemStatus.isOnline ? `Online (${systemStatus.cameraCount} Cam)` : 'Offline'}
            </Text>
          </View>
        </View>

        {/* Non-Compliance List */}
        <Text style={styles.sectionTitle}>Non-Compliance Today</Text>

        {loading ? (
          <ActivityIndicator size="large" color="#FFFFFF" style={{ marginTop: 20 }} />
        ) : activeAlerts.length === 0 ? (
          <Text style={{ color: '#FFFFFF', textAlign: 'center', marginTop: 20 }}>No new violations. Check the Acknowledge List for incidents in progress.</Text>
        ) : (
          activeAlerts.map((alert, index) => {
            const { time, date } = formatTimestamp(alert.timestamp);
            const missingItem = alert.missing_item || 'Unknown Item';
            const workerName = alert.worker_id || `Worker #${activeAlerts.length - index}`;

            return (
              <TouchableOpacity
                key={alert.id}
                style={styles.timelineItem}
                activeOpacity={0.8}
                onPress={() => openDetails(alert, workerName, time, date)}
              >
                <Text style={styles.timeText}>{time}</Text>
                <View style={styles.violationCard}>
                  {alert.image_data ? <Image source={{ uri: `data:image/jpeg;base64,${alert.image_data}` }} style={styles.alertThumbnail} /> : null}
                  <View style={styles.violationInfo}>
                    <Text style={styles.workerName}>{workerName}</Text>
                    <Text style={styles.violationDetail}>Violation:{'\n'}Missing {missingItem}</Text>
                    <View style={styles.dateRow}>
                      <Text style={styles.violationDetailSmall}>Time Caught:{'\n'}{time}</Text>
                      <Text style={styles.violationDetailSmall}>Date Caught:{'\n'}{date}</Text>
                    </View>
                  </View>
                  <MaterialCommunityIcons
                    name={getIconName(missingItem) as any}
                    size={48}
                    color="#FFFFFF"
                  />
                </View>
              </TouchableOpacity>
            );
          })
        )}

        <View style={{ height: 60 }} />
      </ScrollView>

      {/* Detail Modal */}
      <Modal
        visible={isModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setModalVisible(false)}
        >
          <Pressable style={styles.modalSheet} onPress={() => { }}>

            {/* Top Drag Handle */}
            <TouchableOpacity style={{ paddingVertical: 10 }} onPress={() => setModalVisible(false)}>
              <View style={styles.dragHandle} />
            </TouchableOpacity>

            <Text style={styles.modalTitle}>Non-Compliance Details</Text>

            {/* Dynamically Render the Edge AI Base64 Image */}
            <View style={styles.imagePlaceholder}>
              {selectedAlert?.image_data ? (
                <Image
                  source={{ uri: `data:image/jpeg;base64,${selectedAlert.image_data}` }}
                  style={{ width: '100%', height: '100%', borderRadius: 12 }}
                  resizeMode="cover"
                />
              ) : (
                <Text style={{ textAlign: 'center', marginTop: 80, color: '#888' }}>Image Unavailable</Text>
              )}
            </View>

            {/* Details Card */}
            <View style={styles.detailsCard}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Detected:</Text>
                <Text style={styles.detailValue}>{selectedAlert?.workerName}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Violation:</Text>
                <Text style={styles.detailValue}>Missing {selectedAlert?.missing_item}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Zone:</Text>
                <Text style={styles.detailValue}>{selectedAlert?.zone || 'N/A'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Date Caught:</Text>
                <Text style={styles.detailValue}>{selectedAlert?.date}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Time Caught:</Text>
                <Text style={styles.detailValue}>{selectedAlert?.time}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>AI Confidence:</Text>
                <Text style={styles.detailValue}>{selectedAlert?.confidence}%</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Status:</Text>
                <Text style={styles.detailValue}>{selectedPendingUpdate?.status || selectedAlert?.status || 'Unsafe'}</Text>
              </View>
              {selectedPendingUpdate && <View style={styles.pendingSyncRow}>
                <Text style={styles.pendingSyncText}>{selectedPendingUpdate.error ? 'Status not synced' : 'Status pending sync'}</Text>
                {selectedPendingUpdate.error && <TouchableOpacity onPress={() => void retryStatusUpdate(selectedPendingUpdate.alertId)}><Text style={styles.retrySyncText}>Retry</Text></TouchableOpacity>}
              </View>}
            </View>

            <View style={styles.statusActions}>
              {['Acknowledged'].map((status) => (
                <TouchableOpacity key={status} style={styles.acknowledgeButton} onPress={() => updateAlertStatus(status)}>
                  <Text style={styles.acknowledgeButtonText}>Acknowledge & Review</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeViolation}>
              <Text style={styles.closeViolationText}>Close Details</Text>
            </TouchableOpacity>

          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#5C4B4B' },
  contentPadding: { padding: 24, paddingTop: 50, paddingBottom: 110 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  profileSection: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 45, height: 45, borderRadius: 22.5, marginRight: 12 },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' },
  bellButton: { backgroundColor: '#4A3B3B', padding: 10, borderRadius: 20 },
  statsContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 35 },
  mainCard: { width: '60%', padding: 20, borderRadius: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 8 },
  cardLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', marginBottom: 4 },
  largeNumber: { color: '#FFFFFF', fontSize: 32, fontWeight: 'bold', marginBottom: 16 },
  cardSubLabel: { color: '#FFFFFF', fontSize: 10, marginBottom: 4 },
  systemStatus: { width: '35%', alignItems: 'flex-end', paddingTop: 10 },
  cctvIconContainer: { backgroundColor: '#4A3B3B', padding: 12, borderRadius: 25, marginBottom: 8 },
  statusTitle: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', marginTop: 4 },
  statusOnline: { color: '#4ADE80', fontSize: 12, fontWeight: 'bold' },
  sectionTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: 'bold', marginBottom: 20 },
  timelineItem: { marginBottom: 20 },
  timeText: { color: '#FFFFFF', fontSize: 12, marginBottom: 8 },
  violationCard: { backgroundColor: '#A3816A', borderRadius: 16, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 5 },
  alertThumbnail: { width: 56, height: 56, borderRadius: 8, marginRight: 10, backgroundColor: '#DDD' },
  violationInfo: { flex: 1, paddingRight: 10 },
  workerName: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  violationDetail: { color: '#FFFFFF', fontSize: 12, marginBottom: 12, lineHeight: 18 },
  dateRow: { flexDirection: 'row', justifyContent: 'space-between' },
  violationDetailSmall: { color: '#E0E0E0', fontSize: 10, lineHeight: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 24, minHeight: '75%', shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 10 },
  dragHandle: { width: 60, height: 4, backgroundColor: '#D3D3D3', borderRadius: 2, alignSelf: 'center', marginBottom: 24 },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: '#333333', marginBottom: 16 },
  imagePlaceholder: { width: '100%', height: 200, backgroundColor: '#E0E0E0', borderRadius: 12, marginBottom: 20 },
  detailsCard: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, marginBottom: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2, borderWidth: 1, borderColor: '#F0F0F0' },
  detailRow: { flexDirection: 'row', marginBottom: 12 },
  detailLabel: { width: 100, fontSize: 12, fontWeight: 'bold', color: '#333333' },
  detailValue: { flex: 1, fontSize: 12, color: '#555555' },
  pendingSyncRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: -12, marginBottom: 20, paddingHorizontal: 16 },
  pendingSyncText: { color: '#9A641D', fontSize: 11, fontWeight: '700' },
  retrySyncText: { color: '#8D3B32', fontSize: 11, fontWeight: '800', textDecorationLine: 'underline' },
  acknowledgeButton: { backgroundColor: '#5C4B4B', borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  acknowledgeButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  statusActions: { gap: 8 },
  closeViolation: { paddingVertical: 12, alignItems: 'center' },
  closeViolationText: { color: '#5C4B4B', fontWeight: '600' },
});
