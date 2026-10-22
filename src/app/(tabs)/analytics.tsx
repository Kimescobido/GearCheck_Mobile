import { db } from '../../../firebaseConfig';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useStatusOutbox } from '../../hooks/useStatusOutbox';

type AlertRecord = {
  id: string;
  zone?: string;
  missing_item?: string;
  status?: string;
  timestamp?: any;
  pendingStatus?: { status?: string; error?: string };
};

type PieSlice = { label: string; value: number; color: string };

function PieChartCard({ title, data, total, note }: { title: string; data: PieSlice[]; total: number; note?: string }) {
  const chartSize = 148;
  const center = chartSize / 2;
  const radius = 66;
  let currentAngle = -Math.PI / 2;
  const slices = data.filter((item) => item.value > 0);

  return (
    <View style={styles.chartCard}>
      <Text style={styles.chartTitle}>{title}</Text>
      {total === 0 ? (
        <Text style={styles.chartEmpty}>No data for this period.</Text>
      ) : (
        <View style={styles.chartContent}>
          <Svg width={chartSize} height={chartSize} viewBox={`0 0 ${chartSize} ${chartSize}`}>
            {slices.length === 1 ? (
              <Circle cx={center} cy={center} r={radius} fill={slices[0].color} />
            ) : slices.map((slice) => {
              const startAngle = currentAngle;
              const endAngle = startAngle + (slice.value / total) * Math.PI * 2;
              currentAngle = endAngle;
              const startX = center + radius * Math.cos(startAngle);
              const startY = center + radius * Math.sin(startAngle);
              const endX = center + radius * Math.cos(endAngle);
              const endY = center + radius * Math.sin(endAngle);
              const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
              const path = `M ${center} ${center} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`;
              return <Path key={slice.label} d={path} fill={slice.color} stroke="#FFFFFF" strokeWidth={1.5} />;
            })}
          </Svg>
          <View style={styles.chartLegend}>
            {data.map((item) => (
              <View key={item.label} style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                <Text style={styles.legendLabel} numberOfLines={1}>{item.label}</Text>
                <Text style={styles.legendValue}>{item.value} · {total ? Math.round((item.value / total) * 100) : 0}%</Text>
              </View>
            ))}
          </View>
        </View>
      )}
      {note ? <Text style={styles.chartNote}>{note}</Text> : null}
    </View>
  );
}

export default function AnalyticsScreen() {
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const pendingUpdates = useStatusOutbox();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const [reportDate, setReportDate] = useState(() => new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [webDateText, setWebDateText] = useState('');
  const [zone, setZone] = useState('');
  const [type, setType] = useState('All');

  useEffect(() => {
    const alertsQuery = query(collection(db, 'ppe_alerts'), orderBy('timestamp', 'desc'));
    return onSnapshot(alertsQuery, (snapshot) => {
      setAlerts(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as AlertRecord[]);
      setLoading(false);
    }, (error) => {
      console.error('Unable to load alert analytics:', error);
      setLoading(false);
      Alert.alert('Could not load analytics', error.message);
    });
  }, []);

  const periodRange = useMemo(() => {
    const start = new Date(reportDate);
    const end = new Date(reportDate);
    if (period === 'weekly') {
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(end.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
    }
    return { start, end };
  }, [period, reportDate]);

  const alertsWithPendingStatus = useMemo(() => alerts.map((alert) => {
    const pending = pendingUpdates.find((update) => update.alertId === alert.id);
    return pending ? { ...alert, status: pending.status, pendingStatus: pending } : alert;
  }), [alerts, pendingUpdates]);

  const filtered = useMemo(() => alertsWithPendingStatus.filter((alert) => {
    const timestamp = alert.timestamp?.toDate ? alert.timestamp.toDate() : new Date(alert.timestamp || 0);
    const missing = (alert.missing_item || '').toLowerCase().replace(/[_-]+/g, ' ');
    return timestamp >= periodRange.start
      && timestamp <= periodRange.end
      && (!zone.trim() || (alert.zone || '').toLowerCase().includes(zone.trim().toLowerCase()))
      && (type === 'All' || (type === 'Safety Shoes'
        ? /safety shoes|shoes/i.test(missing)
        : type === 'Helmet' ? /helmet|hard hat/i.test(missing) : missing.includes(type.toLowerCase())));
  }), [alertsWithPendingStatus, periodRange, zone, type]);

  const helmetTotal = filtered.filter((item) => /helmet|hard hat/i.test(item.missing_item || '')).length;
  const vestTotal = filtered.filter((item) => /vest/i.test(item.missing_item || '')).length;
  const pantsTotal = filtered.filter((item) => /pants/i.test(item.missing_item || '')).length;
  const safetyShoesTotal = filtered.filter((item) => /safety[_ -]?shoes/i.test(item.missing_item || '')).length;
  const pendingTotal = filtered.filter((item) => !['acknowledged', 'resolved', 'false alarm'].includes((item.status || '').toLowerCase())).length;
  const statusCount = (status: string) => filtered.filter((item) => (item.status || 'Pending').toLowerCase() === status.toLowerCase()).length;
  const ppeChartData: PieSlice[] = [
    { label: 'Helmet', value: helmetTotal, color: '#8A4FFF' },
    { label: 'Vest', value: vestTotal, color: '#2F9D8F' },
    { label: 'Pants', value: pantsTotal, color: '#E3A52F' },
    { label: 'Safety shoes', value: safetyShoesTotal, color: '#E36B5D' },
  ];
  const statusChartData: PieSlice[] = [
    { label: 'Pending', value: pendingTotal, color: '#E3A52F' },
    { label: 'Acknowledged', value: statusCount('Acknowledged'), color: '#5C91D6' },
    { label: 'Resolved', value: statusCount('Resolved'), color: '#2F9D8F' },
    { label: 'False alarm', value: statusCount('False Alarm'), color: '#A69691' },
  ];

  const zoneTotals = useMemo(() => {
    const totals = new Map<string, number>();
    filtered.forEach((item) => {
      const name = item.zone || 'Zone unavailable';
      totals.set(name, (totals.get(name) || 0) + 1);
    });
    return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4);
  }, [filtered]);

  const dateValue = (date: Date) => `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
  const handleReportDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (event.type !== 'dismissed' && selectedDate) {
      setReportDate(selectedDate);
      setWebDateText(dateValue(selectedDate));
    }
  };
  const periodLabel = period === 'weekly'
    ? `${periodRange.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${periodRange.end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : reportDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Safety Analytics</Text>
        <Text style={styles.subtitle}>Live Firestore summaries · {filtered.length} alerts in this period</Text>

        <View style={styles.periodRow}>
          {(['weekly', 'monthly'] as const).map((item) => (
            <TouchableOpacity key={item} style={[styles.periodButton, period === item && styles.periodButtonActive]} onPress={() => setPeriod(item)}>
              <Text style={[styles.periodText, period === item && styles.periodTextActive]}>{item === 'weekly' ? 'Weekly' : 'Monthly'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.dateSelector} onPress={() => { setWebDateText(dateValue(reportDate)); setShowDatePicker(true); }}>
          <Text style={styles.dateLabel}>{period === 'weekly' ? 'WEEKLY REPORT · LAST 7 DAYS' : 'MONTHLY REPORT'}</Text>
          <View style={styles.dateValueRow}>
            <Text style={styles.dateValue}>{periodLabel}</Text>
            <Text style={styles.changeDate}>Change date ›</Text>
          </View>
        </TouchableOpacity>
        {showDatePicker && Platform.OS !== 'web' && <DateTimePicker value={reportDate} mode="date" display="default" maximumDate={new Date()} onChange={handleReportDateChange} />}
        {showDatePicker && Platform.OS === 'web' && <TextInput value={webDateText} onChangeText={(value) => {
          setWebDateText(value);
          if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const chosen = new Date(`${value}T12:00:00`);
            if (!Number.isNaN(chosen.getTime()) && chosen <= new Date()) setReportDate(chosen);
          }
        }} placeholder="YYYY-MM-DD" placeholderTextColor="#777" style={styles.filterInput} onEndEditing={() => setShowDatePicker(false)} />}

        <View style={styles.filters}>
          <TextInput value={zone} onChangeText={setZone} placeholder="Zone contains..." placeholderTextColor="#777" style={styles.filterInput} />
        </View>
        <View style={styles.typeRow}>{['All', 'Helmet', 'Vest', 'Pants', 'Safety Shoes'].map((item) => (
          <TouchableOpacity key={item} style={[styles.typeButton, type === item && styles.typeButtonActive]} onPress={() => setType(item)}>
            <Text style={[styles.typeText, type === item && styles.typeTextActive]}>{item}</Text>
          </TouchableOpacity>
        ))}</View>

        <Text style={styles.reportHeading}>{period === 'weekly' ? 'WEEKLY REPORT' : 'MONTHLY REPORT'}</Text>
        {loading ? <ActivityIndicator size="large" color="#FFFFFF" style={{ marginTop: 24 }} /> : (
          <>
            <PieChartCard
              title="Missing PPE by type"
              data={ppeChartData}
              total={ppeChartData.reduce((sum, item) => sum + item.value, 0)}
              note="Counts alerts that mention each missing PPE type. An alert can count in more than one category."
            />
            <PieChartCard title="Alert response status" data={statusChartData} total={filtered.length} />

            <View style={styles.summaryRow}>
              <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Total alerts</Text><Text style={styles.summaryValue}>{filtered.length}</Text></View>
              <View style={styles.summaryCard}><Text style={styles.summaryLabel}>Pending</Text><Text style={styles.summaryValue}>{pendingTotal}</Text></View>
            </View>
            {zoneTotals.length > 0 && <View style={styles.zoneSummary}>
              <Text style={styles.sectionHeading}>TOP ALERT ZONES</Text>
              {zoneTotals.map(([name, count]) => <View key={name} style={styles.zoneRow}><Text style={styles.zoneName}>{name}</Text><Text style={styles.zoneCount}>{count}</Text></View>)}
            </View>}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#5C4B4B' },
  content: { padding: 22, paddingTop: 56, paddingBottom: 110 },
  title: { color: '#FFFFFF', fontSize: 26, fontWeight: 'bold' },
  subtitle: { color: '#D3D3D3', fontSize: 12, marginTop: 5, marginBottom: 18 },
  periodRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  periodButton: { flex: 1, alignItems: 'center', backgroundColor: '#4A3B3B', paddingVertical: 10, borderRadius: 12 },
  periodButtonActive: { backgroundColor: '#FFFFFF' },
  periodText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  periodTextActive: { color: '#4A3B3B' },
  dateSelector: { backgroundColor: '#FFFFFF', padding: 13, borderRadius: 12, marginBottom: 12 },
  dateLabel: { color: '#777', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  dateValueRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  dateValue: { color: '#222', fontSize: 14, fontWeight: '700' },
  changeDate: { color: '#6E514E', fontSize: 11, fontWeight: '700' },
  reportHeading: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', letterSpacing: 1, marginTop: 12, marginBottom: 10 },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  summaryCard: { flex: 1, backgroundColor: '#A69691', borderRadius: 14, padding: 16 },
  summaryLabel: { color: '#FFFFFF', fontSize: 11 },
  summaryValue: { color: '#FFFFFF', fontSize: 30, fontWeight: 'bold', marginTop: 6 },
  sectionHeading: { color: '#737B84', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 10 },
  zoneSummary: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginBottom: 12 },
  zoneRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  zoneName: { color: '#535B63', fontSize: 11, flex: 1 },
  zoneCount: { color: '#252A30', fontWeight: '800', fontSize: 11 },
  chartCard: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginBottom: 10 },
  chartTitle: { color: '#30343B', fontSize: 14, fontWeight: '800', marginBottom: 8 },
  chartContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chartLegend: { flex: 1, gap: 9 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendLabel: { color: '#535B63', fontSize: 10, flex: 1 },
  legendValue: { color: '#252A30', fontSize: 10, fontWeight: '800' },
  chartEmpty: { color: '#737B84', fontSize: 12, paddingVertical: 20, textAlign: 'center' },
  chartNote: { color: '#737B84', fontSize: 10, marginTop: 5 },
  filters: { gap: 8 },
  filterInput: { backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#222', fontSize: 13 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  typeButton: { backgroundColor: '#4A3B3B', paddingVertical: 8, paddingHorizontal: 15, borderRadius: 18 },
  typeButtonActive: { backgroundColor: '#FFFFFF' },
  typeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  typeTextActive: { color: '#4A3B3B' },
});
