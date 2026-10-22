import { db } from '../../../firebaseConfig';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { retryStatusUpdate } from '../../services/statusOutbox';
import { useStatusOutbox } from '../../hooks/useStatusOutbox';

type AlertRecord = {
  id: string;
  worker_id?: string;
  zone?: string;
  missing_item?: string;
  status?: string;
  timestamp?: any;
  confidence?: number | string;
  image_data?: string;
  responding_officer_id?: string;
  responded_at?: any;
  pendingStatus?: { error?: string };
};

const PPE_FILTERS = ['All', 'Helmet', 'Vest', 'Pants', 'Safety shoes'];

const toDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateInput = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
};

export default function LogsScreen() {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const pendingUpdates = useStatusOutbox();
  const [loading, setLoading] = useState(true);
  const [zone, setZone] = useState('');
  const [type, setType] = useState('All');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [datePickerTarget, setDatePickerTarget] = useState<'from' | 'to' | null>(null);

  useEffect(() => {
    const alertsQuery = query(collection(db, 'ppe_alerts'), orderBy('timestamp', 'desc'));
    return onSnapshot(alertsQuery, (snapshot) => {
      setAlerts(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as AlertRecord[]);
      setLoading(false);
    }, (error) => {
      console.error('Unable to load violation logs:', error);
      setLoading(false);
      Alert.alert('Could not load logs', error.message);
    });
  }, []);

  const alertsWithPendingStatus = useMemo(() => alerts.map((alert) => {
    const pending = pendingUpdates.find((update) => update.alertId === alert.id);
    return pending ? { ...alert, status: pending.status, pendingStatus: pending } : alert;
  }), [alerts, pendingUpdates]);

  const filtered = useMemo(() => alertsWithPendingStatus.filter((alert) => {
    const missing = (alert.missing_item || '').toLowerCase().replace(/[_-]+/g, ' ');
    const matchesType = type === 'All' || (type === 'Safety shoes'
      ? /safety shoes|shoes/i.test(missing)
      : type === 'Helmet' ? /helmet|hard hat/i.test(missing) : missing.includes(type.toLowerCase()));
    const timestamp = alert.timestamp?.toDate ? alert.timestamp.toDate() : new Date(alert.timestamp || 0);
    const dateKey = Number.isNaN(timestamp.getTime()) ? '' : toDateInput(timestamp);
    const matchesFrom = !fromDate || !parseDateInput(fromDate) || dateKey >= fromDate;
    const matchesTo = !toDate || !parseDateInput(toDate) || dateKey <= toDate;
    return (!zone.trim() || (alert.zone || '').toLowerCase().includes(zone.trim().toLowerCase())) && matchesType && matchesFrom && matchesTo;
  }), [alertsWithPendingStatus, zone, type, fromDate, toDate]);

  const handleDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    const target = datePickerTarget;
    setDatePickerTarget(null);
    if (event.type === 'set' && selectedDate && target) {
      if (target === 'from') setFromDate(toDateInput(selectedDate));
      else setToDate(toDateInput(selectedDate));
    }
  };

  const openDatePicker = (target: 'from' | 'to') => {
    setDatePickerTarget(target);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Alert Logs</Text>
        <Text style={styles.subtitle}>Individual PPE alerts · {filtered.length} shown</Text>

        <TextInput
          style={styles.filterInput}
          placeholder="Filter by zone"
          placeholderTextColor="#8A8A8A"
          value={zone}
          onChangeText={setZone}
        />
        <View style={styles.dateRow}>
          {(['from', 'to'] as const).map((target) => {
            const value = target === 'from' ? fromDate : toDate;
            const label = target === 'from' ? 'From' : 'To';
            return Platform.OS === 'web' ? (
              <View key={target} style={styles.dateField}>
                <Text style={styles.dateLabel}>{label}</Text>
                <TextInput
                  style={styles.dateInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#8A8A8A"
                  value={value}
                  onChangeText={(text) => target === 'from' ? setFromDate(text) : setToDate(text)}
                  autoCapitalize="none"
                />
              </View>
            ) : (
              <TouchableOpacity key={target} style={styles.dateButton} onPress={() => openDatePicker(target)}>
                <Text style={styles.dateLabel}>{label}</Text>
                <Text style={styles.dateValue}>{value || 'Select date'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {(fromDate || toDate) && <TouchableOpacity style={styles.clearDates} onPress={() => { setFromDate(''); setToDate(''); }}>
          <Text style={styles.clearDatesText}>Clear date filter</Text>
        </TouchableOpacity>}
        {datePickerTarget && Platform.OS !== 'web' && <DateTimePicker
          value={parseDateInput(datePickerTarget === 'from' ? fromDate : toDate) || new Date()}
          mode="date"
          display="default"
          maximumDate={new Date()}
          onChange={handleDateChange}
        />}
        <View style={styles.typeRow}>
          {PPE_FILTERS.map((item) => (
            <TouchableOpacity key={item} style={[styles.typeButton, type === item && styles.typeButtonActive]} onPress={() => setType(item)}>
              <Text style={[styles.typeText, type === item && styles.typeTextActive]}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? <ActivityIndicator size="large" color="#FFFFFF" style={{ marginTop: 28 }} /> : filtered.length === 0 ? (
          <Text style={styles.empty}>No alerts match these filters.</Text>
        ) : filtered.map((item) => {
          const timestamp = item.timestamp?.toDate ? item.timestamp.toDate() : new Date(item.timestamp || 0);
          return (
            <View key={item.id} style={styles.logCard}>
              <View style={styles.cardHeading}>
                <Text style={styles.worker}>{item.worker_id || 'Unknown worker'}</Text>
                <Text style={styles.status}>{item.status || 'Unsafe'}</Text>
              </View>
              <Text style={styles.violation}>{item.missing_item || 'PPE violation'}</Text>
              <Text style={styles.logMeta}>{item.zone || 'Zone unavailable'} · {timestamp.toLocaleString()}</Text>
              {item.pendingStatus && <View style={styles.pendingRow}>
                <Text style={styles.pendingText}>{item.pendingStatus.error ? 'Status not synced' : 'Status pending sync'}</Text>
                {item.pendingStatus.error && <TouchableOpacity onPress={() => void retryStatusUpdate(item.id)}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>}
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
  content: { padding: 22, paddingTop: 56, paddingBottom: 110 },
  title: { color: '#FFFFFF', fontSize: 26, fontWeight: 'bold' },
  subtitle: { color: '#D3D3D3', fontSize: 12, marginTop: 5, marginBottom: 18 },
  filterInput: { backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#222', fontSize: 13 },
  dateRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  dateField: { flex: 1 },
  dateButton: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  dateInput: { backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, color: '#222', fontSize: 13, marginTop: 4 },
  dateLabel: { color: '#666', fontSize: 10, fontWeight: '700' },
  dateValue: { color: '#222', fontSize: 12, marginTop: 3 },
  clearDates: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 2 },
  clearDatesText: { color: '#FFFFFF', fontSize: 11, textDecorationLine: 'underline' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 8 },
  typeButton: { backgroundColor: '#4A3B3B', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 18 },
  typeButtonActive: { backgroundColor: '#FFFFFF' },
  typeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  typeTextActive: { color: '#4A3B3B' },
  empty: { color: '#FFFFFF', textAlign: 'center', marginTop: 26 },
  logCard: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, marginTop: 10 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  worker: { color: '#222', fontWeight: '700', fontSize: 14, flex: 1 },
  status: { color: '#6A514E', fontWeight: '700', fontSize: 10, textTransform: 'uppercase' },
  violation: { color: '#8D3B32', fontWeight: '700', fontSize: 13, marginTop: 7 },
  logMeta: { color: '#666', fontSize: 11, marginTop: 5 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 7 },
  pendingText: { color: '#9A641D', fontSize: 11, fontWeight: '700' },
  retryText: { color: '#8D3B32', fontSize: 11, fontWeight: '800', textDecorationLine: 'underline' },
});
