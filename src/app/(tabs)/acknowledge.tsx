import { FontAwesome6, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { auth, db } from '../../../firebaseConfig';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { enqueueStatusUpdate, retryStatusUpdate } from '../../services/statusOutbox';
import { useStatusOutbox } from '../../hooks/useStatusOutbox';

type AlertRecord = {
  id: string;
  worker_id?: string;
  missing_item?: string;
  zone?: string;
  timestamp?: any;
  status?: string;
  image_data?: string;
  pendingStatus?: { error?: string };
};

const TYPES = ['All', 'Helmet', 'Vest', 'Pants', 'Safety Shoes'];
const STATUS_FILTERS = ['All', 'Pending', 'Acknowledged', 'Resolved', 'False Alarm'];
const CLOSING_STATUSES = ['Resolved', 'False Alarm'];

const dateValue = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateValue = (value: string) => new Date(`${value}T12:00:00`);

const displayDate = (value: string) => {
  const date = parseDateValue(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function AcknowledgeScreen() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const pendingUpdates = useStatusOutbox();
  const [loading, setLoading] = useState(true);
  const [activeType, setActiveType] = useState('All');
  const [activeStatus, setActiveStatus] = useState('All');
  const [zoneFilter, setZoneFilter] = useState('');
  const [fromDate, setFromDate] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    return dateValue(start);
  });
  const [toDate, setToDate] = useState(() => dateValue(new Date()));
  const [datePickerTarget, setDatePickerTarget] = useState<'from' | 'to' | null>(null);
  const [pickerDate, setPickerDate] = useState(() => new Date());

  useEffect(() => {
    const alertsQuery = query(collection(db, 'ppe_alerts'), orderBy('timestamp', 'desc'));
    return onSnapshot(alertsQuery, (snapshot) => {
      setAlerts(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as AlertRecord[]);
      setLoading(false);
    }, (error) => {
      console.error('Unable to load violations:', error);
      setLoading(false);
      Alert.alert('Could not load violations', error.message);
    });
  }, []);

  const alertsWithPendingStatus = useMemo(() => alerts.map((alert) => {
    const pending = pendingUpdates.find((update) => update.alertId === alert.id);
    return pending ? { ...alert, status: pending.status, pendingStatus: pending } : alert;
  }), [alerts, pendingUpdates]);

  const filteredAlerts = useMemo(() => alertsWithPendingStatus.filter((alert) => {
    const status = (alert.status || '').toLowerCase();
    const isPending = status !== 'acknowledged' && status !== 'resolved' && status !== 'false alarm';
    const matchesStatus = activeStatus === 'All'
      || (activeStatus === 'Pending' && isPending)
      || status === activeStatus.toLowerCase();
    const item = (alert.missing_item || '').toLowerCase().replace(/[_-]+/g, ' ');
    const matchesType = activeType === 'All' || item.includes(activeType.toLowerCase());
    const matchesZone = !zoneFilter.trim() || (alert.zone || '').toLowerCase().includes(zoneFilter.trim().toLowerCase());
    const date = alert.timestamp?.toDate ? alert.timestamp.toDate() : new Date(alert.timestamp || 0);
    const from = parseDateValue(fromDate);
    from.setHours(0, 0, 0, 0);
    const to = parseDateValue(toDate);
    to.setHours(23, 59, 59, 999);
    const matchesDates = (!from || date >= from) && (!to || date <= to);
    return matchesType && matchesZone && matchesDates && matchesStatus;
  }), [alertsWithPendingStatus, activeType, activeStatus, zoneFilter, fromDate, toDate]);

  const openDatePicker = (target: 'from' | 'to') => {
    setPickerDate(parseDateValue(target === 'from' ? fromDate : toDate));
    setDatePickerTarget(target);
  };

  const handleDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (event.type === 'dismissed' || !selectedDate || !datePickerTarget) {
      setDatePickerTarget(null);
      return;
    }

    const selected = dateValue(selectedDate);
    if (datePickerTarget === 'from') {
      setFromDate(selected);
      const end = parseDateValue(toDate);
      const start = parseDateValue(selected);
      if (end.getTime() - start.getTime() > 7 * 24 * 60 * 60 * 1000) {
        const maxEnd = new Date(start);
        maxEnd.setDate(maxEnd.getDate() + 7);
        setToDate(dateValue(maxEnd));
      }
    } else {
      setToDate(selected);
      const start = parseDateValue(fromDate);
      const end = parseDateValue(selected);
      if (end.getTime() - start.getTime() > 7 * 24 * 60 * 60 * 1000) {
        const minStart = new Date(end);
        minStart.setDate(minStart.getDate() - 7);
        setFromDate(dateValue(minStart));
      }
    }
    setPickerDate(selectedDate);
    setDatePickerTarget(null);
  };

  const handleWebDateInput = (target: 'from' | 'to', value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      (target === 'from' ? setFromDate : setToDate)(value);
      return;
    }
    const selected = parseDateValue(value);
    const other = parseDateValue(target === 'from' ? toDate : fromDate);
    if (Number.isNaN(selected.getTime())) return;
    if (target === 'from') {
      setFromDate(value);
      if (selected > other) setToDate(value);
      else if (other.getTime() - selected.getTime() > 7 * 24 * 60 * 60 * 1000) {
        const maxEnd = new Date(selected);
        maxEnd.setDate(maxEnd.getDate() + 7);
        setToDate(dateValue(maxEnd));
      }
    } else {
      setToDate(value);
      if (selected < other) setFromDate(value);
      else if (selected.getTime() - other.getTime() > 7 * 24 * 60 * 60 * 1000) {
        const minStart = new Date(selected);
        minStart.setDate(minStart.getDate() - 7);
        setFromDate(dateValue(minStart));
      }
    }
  };

  const updateStatus = async (alertId: string, status: string) => {
    const officer = auth.currentUser;
    if (!officer) {
      Alert.alert('Sign in required', 'Please sign in again to update this violation.');
      return;
    }
    try {
      await enqueueStatusUpdate(alertId, status as 'Acknowledged' | 'Resolved' | 'False Alarm', officer.uid);
    } catch (error: any) {
      Alert.alert('Could not save status', error.message || 'The status could not be saved on this device.');
    }
  };

  return (
      <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headingRow}>
          <View>
            <Text style={styles.eyebrow}>SAFETY MONITORING</Text>
            <Text style={styles.pageTitle}>Acknowledge Queue</Text>
            <View style={styles.liveRow}><View style={styles.liveDot} /><Text style={styles.pageSubtitle}>Filter and manage safety alerts</Text></View>
          </View>
          <View style={styles.countBadge}><Text style={styles.countValue}>{filteredAlerts.length}</Text><Text style={styles.countLabel}>MATCHING</Text></View>
        </View>

        <View style={styles.filters}>
          <Text style={styles.filterHeading}>FILTER BY</Text>
          <View style={styles.dateRow}>
            {(['from', 'to'] as const).map((target) => (
              <View key={target} style={styles.dateField}>
                <Ionicons name="calendar-outline" size={15} color="#777" />
                {Platform.OS === 'web' ? (
                  <TextInput
                    value={target === 'from' ? fromDate : toDate}
                    onChangeText={(value) => handleWebDateInput(target, value)}
                    placeholder={target === 'from' ? 'From (YYYY-MM-DD)' : 'To (YYYY-MM-DD)'}
                    placeholderTextColor="#888"
                    style={styles.filterInput}
                    keyboardType="numbers-and-punctuation"
                  />
                ) : (
                  <TouchableOpacity style={styles.dateTouchable} onPress={() => openDatePicker(target)}>
                    <Text style={styles.dateValueText}>{displayDate(target === 'from' ? fromDate : toDate)}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
          <View style={styles.inputWrap}><Ionicons name="location-outline" size={16} color="#777" /><TextInput value={zoneFilter} onChangeText={setZoneFilter} placeholder="Search camera zone" placeholderTextColor="#888" style={styles.filterInput} /></View>
          <View style={styles.ppeTypeRow}>
            {TYPES.map((type) => (
              <TouchableOpacity key={type} onPress={() => setActiveType(type)} style={[styles.typeTab, activeType === type && styles.typeTabActive]}>
                {type === 'Helmet' && <MaterialCommunityIcons name="hard-hat" size={14} color={activeType === type ? '#FFFFFF' : '#5C626B'} />}
                {type === 'Vest' && <FontAwesome6 name="vest" size={14} color={activeType === type ? '#FFFFFF' : '#5C626B'} />}
                <Text style={[styles.typeTabText, activeType === type && styles.typeTabTextActive]}>{type}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusTabs}>
          {STATUS_FILTERS.map((status) => (
            <TouchableOpacity key={status} onPress={() => setActiveStatus(status)} style={[styles.statusTab, activeStatus === status && styles.statusTabActive]}>
              <Text style={[styles.statusTabText, activeStatus === status && styles.statusTabTextActive]}>{status}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {datePickerTarget && Platform.OS !== 'web' && (
          <DateTimePicker
            value={pickerDate}
            mode="date"
            display="default"
            minimumDate={datePickerTarget === 'from' ? new Date(parseDateValue(toDate).getTime() - 7 * 24 * 60 * 60 * 1000) : parseDateValue(fromDate)}
            maximumDate={datePickerTarget === 'from' ? parseDateValue(toDate) : new Date(parseDateValue(fromDate).getTime() + 7 * 24 * 60 * 60 * 1000)}
            onChange={handleDateChange}
          />
        )}

        {loading ? <ActivityIndicator size="large" color="#FFFFFF" style={{ marginTop: 28 }} /> : filteredAlerts.length === 0 ? (
          <View style={styles.emptyCard}><Ionicons name="checkmark-circle-outline" size={28} color="#39856A" /><Text style={styles.emptyTitle}>No {activeStatus === 'All' ? '' : `${activeStatus.toLowerCase()} `}alerts</Text><Text style={styles.emptyText}>Try another status or date range.</Text></View>
        ) : filteredAlerts.map((item) => {
          const timestamp = item.timestamp?.toDate ? item.timestamp.toDate() : new Date(item.timestamp || 0);
          const missing = item.missing_item || 'PPE';
          const status = item.status || 'Unsafe';
          return (
            <View key={item.id} style={styles.violationCard}>
              <TouchableOpacity
                style={styles.alertCardContent}
                activeOpacity={0.82}
                accessibilityRole="button"
                accessibilityLabel={`View details for ${item.worker_id || 'unknown worker'}, missing ${missing}`}
                onPress={() => router.push({ pathname: '/alert', params: { alertId: item.id } })}
              >
                {item.image_data ? <Image source={{ uri: `data:image/jpeg;base64,${item.image_data}` }} style={styles.thumbnail} /> : (
                  <View style={styles.iconWrapper}><MaterialCommunityIcons name="alert-circle-outline" size={26} color="#8B5B35" /></View>
                )}
                <View style={styles.details}>
                  <View style={styles.cardTopRow}><Text style={styles.workerName}>{item.worker_id || 'Unknown worker'}</Text><View style={[styles.statusPill, status === 'Resolved' && styles.statusResolved, status === 'False Alarm' && styles.statusFalse]}><Text style={styles.statusPillText}>{status === 'UNSAFE' || status === 'Unsafe' ? 'Needs review' : status}</Text></View></View>
                  <Text style={styles.violationText}>Missing {missing}</Text>
                  <View style={styles.metaRow}><Ionicons name="location-outline" size={13} color="#777" /><Text style={styles.metaText}>{item.zone || 'Zone unavailable'}</Text></View>
                  <View style={styles.metaRow}><Ionicons name="time-outline" size={13} color="#777" /><Text style={styles.metaText}>{timestamp.toLocaleString()}</Text></View>
                  {item.pendingStatus && <View style={styles.syncNotice}>
                    <Text style={styles.syncNoticeText}>{item.pendingStatus.error ? 'Sync failed' : 'Pending sync'}</Text>
                    {item.pendingStatus.error && <TouchableOpacity onPress={() => void retryStatusUpdate(item.id)}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>}
                  </View>}
                  <View style={styles.detailsHint}><Text style={styles.detailsHintText}>Tap for details</Text><Ionicons name="chevron-forward" size={12} color="#8B929A" /></View>
                </View>
              </TouchableOpacity>
              {!['resolved', 'false alarm'].includes(status.toLowerCase()) && <View style={styles.actions}>
                  {(status.toLowerCase() === 'acknowledged' ? CLOSING_STATUSES : ['Acknowledged']).map((actionStatus) => (
                    <TouchableOpacity key={actionStatus} onPress={() => updateStatus(item.id, actionStatus)} style={[styles.actionButton, status === actionStatus && styles.actionButtonSelected]}>
                      <Text style={[styles.actionText, status === actionStatus && styles.actionTextSelected]}>{actionStatus}</Text>
                    </TouchableOpacity>
                  ))}
              </View>}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#5C4B4B' },
  content: { paddingHorizontal: 20, paddingTop: 42, paddingBottom: 112 },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  eyebrow: { color: '#E4B28F', fontSize: 10, fontWeight: '800', letterSpacing: 1.3, marginBottom: 5 },
  pageTitle: { color: '#FFFFFF', fontSize: 25, fontWeight: '800', letterSpacing: -0.4 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#35A47C' },
  pageSubtitle: { color: '#E2D9D6', fontSize: 11 },
  countBadge: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderRadius: 15, width: 55, height: 55, borderWidth: 1, borderColor: '#E8EBEF' },
  countValue: { color: '#20252B', fontSize: 18, fontWeight: '800' },
  countLabel: { color: '#838B94', fontSize: 8, fontWeight: '700', letterSpacing: 0.6, marginTop: 1 },
  filters: { gap: 9, marginBottom: 13, padding: 13, backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E8EBEF' },
  filterHeading: { color: '#737B84', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 1 },
  dateRow: { flexDirection: 'row', gap: 8 },
  dateField: { flex: 1, minHeight: 39, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#F5F6F8', borderRadius: 10, paddingHorizontal: 10 },
  dateTouchable: { flex: 1, justifyContent: 'center', minHeight: 39 },
  dateValueText: { color: '#252A30', fontSize: 10 },
  inputWrap: { flex: 1, minHeight: 39, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#F5F6F8', borderRadius: 10, paddingHorizontal: 10 },
  filterInput: { flex: 1, paddingVertical: 8, color: '#252A30', fontSize: 11 },
  ppeTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 1 },
  typeTab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E8EC' },
  typeTabActive: { backgroundColor: '#29343D', borderColor: '#29343D' },
  typeTabText: { color: '#5C626B', fontSize: 11, fontWeight: '700' },
  typeTabTextActive: { color: '#FFFFFF' },
  statusTabs: { flexDirection: 'row', gap: 8, paddingBottom: 13 },
  statusTab: { paddingVertical: 8, paddingHorizontal: 13, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E8EC' },
  statusTabActive: { backgroundColor: '#29343D', borderColor: '#29343D' },
  statusTabText: { color: '#5C626B', fontSize: 11, fontWeight: '700' },
  statusTabTextActive: { color: '#FFFFFF' },
  emptyCard: { marginTop: 24, backgroundColor: '#FFFFFF', alignItems: 'center', padding: 24, borderRadius: 16, borderWidth: 1, borderColor: '#E8EBEF' },
  emptyTitle: { color: '#20252B', fontWeight: '800', fontSize: 15, marginTop: 8 },
  emptyText: { color: '#7A828B', textAlign: 'center', marginTop: 5, fontSize: 12 },
  violationCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#E8EBEF', shadowColor: '#25313D', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  alertCardContent: { flexDirection: 'row', alignItems: 'flex-start' },
  thumbnail: { width: 66, height: 72, borderRadius: 11, marginRight: 11, backgroundColor: '#E6E9ED' },
  iconWrapper: { width: 66, height: 72, borderRadius: 11, backgroundColor: '#F4EEE9', marginRight: 11, alignItems: 'center', justifyContent: 'center' },
  details: { flex: 1 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 },
  workerName: { flex: 1, color: '#222A31', fontWeight: '800', fontSize: 13 },
  statusPill: { backgroundColor: '#FFF2D8', paddingVertical: 4, paddingHorizontal: 7, borderRadius: 12 },
  statusResolved: { backgroundColor: '#E4F4EC' },
  statusFalse: { backgroundColor: '#ECEFF3' },
  statusPillText: { color: '#81551E', fontSize: 8, fontWeight: '800' },
  violationText: { color: '#B34B3E', fontSize: 11, fontWeight: '700', marginTop: 5, marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaText: { color: '#737B84', fontSize: 9 },
  detailsHint: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 5 },
  detailsHintText: { color: '#8B929A', fontSize: 9, fontWeight: '600' },
  syncNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  syncNoticeText: { color: '#9A641D', fontSize: 9, fontWeight: '800' },
  retryText: { color: '#8D3B32', fontSize: 9, fontWeight: '800', textDecorationLine: 'underline' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  actionButton: { backgroundColor: '#FFFFFF', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5, borderWidth: 1, borderColor: '#DCE1E6' },
  actionButtonSelected: { backgroundColor: '#29343D', borderColor: '#29343D' },
  actionText: { color: '#59636D', fontSize: 8, fontWeight: '700' },
  actionTextSelected: { color: '#FFFFFF' },
});
