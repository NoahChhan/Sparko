import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { facilitiesForSearch } from '../data/inventory';
import { getAllOccupancy } from '../data/occupancy';
import { computeAllETAs } from '../engine/eta';
import { rankOptions, RankingInput } from '../engine/ranking';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Home'> };

type Mode = 'leave_now' | 'arrive_by';

// 5-min increment time slots for Arrive By picker (next 3 hours)
function generateTimeSlots(): Date[] {
  const slots: Date[] = [];
  const now = new Date();
  // Round up to next 5-min mark
  const ms = 5 * 60 * 1000;
  let t = new Date(Math.ceil(now.getTime() / ms) * ms);
  for (let i = 0; i < 36; i++) {  // 36 × 5min = 3 hours
    slots.push(new Date(t));
    t = new Date(t.getTime() + ms);
  }
  return slots;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function HomeScreen({ navigation }: Props) {
  const [mode, setMode] = useState<Mode>('leave_now');
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);
  const [timeSlots] = useState(generateTimeSlots);
  const [loading, setLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [includeDowntownPublic, setIncludeDowntownPublic] = useState(false);

  // Pre-select the first time slot when switching to arrive_by
  useEffect(() => {
    if (mode === 'arrive_by' && !selectedSlot) {
      setSelectedSlot(timeSlots[3]); // default ~15 min from now
    }
  }, [mode]);

  async function handleGo() {
    setLoading(true);
    setLocationError(null);

    try {
      // 1. Get location
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Location permission denied. Enable it in Settings.');
        setLoading(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;

      const facilities = facilitiesForSearch(includeDowntownPublic);

      // 2. Fetch occupancy + ETAs in parallel
      const [occupancyMap, etas] = await Promise.all([
        getAllOccupancy(facilities.map(f => f.id)),
        computeAllETAs(facilities, latitude, longitude),
      ]);

      // 3. Build ranking inputs
      const inputs: RankingInput[] = facilities.map((facility, i) => ({
        facility,
        eta: etas[i],
        occupancy: occupancyMap[facility.id],
      }));

      // 4. Rank
      const arriveBy = mode === 'arrive_by' ? selectedSlot ?? undefined : undefined;
      const results = rankOptions(inputs, mode, arriveBy);

      // 5. Navigate
      navigation.navigate('Results', {
        results: results.map(r => ({
          facility: r.facility,
          eta: r.eta,
          occupancy: r.occupancy,
          arrivalTime: r.arrivalTime.toISOString(),
          slackMinutes: r.slackMinutes,
          bucket: r.bucket,
          score: r.score,
          tags: r.tags,
        })),
        mode,
        arriveByTime: arriveBy?.toISOString() ?? null,
      });
    } catch (e) {
      setLocationError('Could not get your location. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>Sparko</Text>
        <Text style={styles.subtitle}>SJSU Parking Optimizer</Text>
      </View>

      {/* Mode toggle */}
      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'leave_now' && styles.modeBtnActive]}
          onPress={() => setMode('leave_now')}
        >
          <Text style={[styles.modeBtnText, mode === 'leave_now' && styles.modeBtnTextActive]}>
            Leave Now
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeBtn, mode === 'arrive_by' && styles.modeBtnActive]}
          onPress={() => setMode('arrive_by')}
        >
          <Text style={[styles.modeBtnText, mode === 'arrive_by' && styles.modeBtnTextActive]}>
            Arrive By
          </Text>
        </TouchableOpacity>
      </View>

      {/* Time picker — only shown in arrive_by mode */}
      {mode === 'arrive_by' && (
        <View style={styles.pickerSection}>
          <Text style={styles.pickerLabel}>Arrive by</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.slotScroll}>
            {timeSlots.map((slot, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  styles.slot,
                  selectedSlot?.getTime() === slot.getTime() && styles.slotSelected,
                ]}
                onPress={() => setSelectedSlot(slot)}
              >
                <Text style={[
                  styles.slotText,
                  selectedSlot?.getTime() === slot.getTime() && styles.slotTextSelected,
                ]}>
                  {formatTime(slot)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.toggleSection}>
        <TouchableOpacity
          style={[styles.toggleRow, includeDowntownPublic && styles.toggleRowActive]}
          onPress={() => setIncludeDowntownPublic(v => !v)}
          activeOpacity={0.85}
        >
          <View style={styles.toggleTextCol}>
            <Text style={styles.toggleTitle}>Downtown public parking</Text>
            <Text style={styles.toggleSubtitle}>
              ParkSJ garages & lots near downtown — static rates & walk distance to campus (no SJSU sensor).
            </Text>
          </View>
          <View style={[styles.togglePill, includeDowntownPublic && styles.togglePillOn]}>
            <Text style={[styles.togglePillText, includeDowntownPublic && styles.togglePillTextOn]}>
              {includeDowntownPublic ? 'On' : 'Off'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {locationError && (
        <Text style={styles.errorText}>{locationError}</Text>
      )}

      <TouchableOpacity
        style={[styles.goBtn, loading && styles.goBtnDisabled]}
        onPress={handleGo}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="#000" />
          : <Text style={styles.goBtnText}>Find Parking</Text>
        }
      </TouchableOpacity>

      <Text style={styles.hint}>Uses your current GPS location</Text>
    </SafeAreaView>
  );
}

const GOLD = '#E5A823';
const BG = '#0055A2';
const CARD = '#004080';
const TEXT = '#ffffff';
const MUTED = '#A8C8F0';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG, paddingHorizontal: 24 },
  header: { marginTop: 32, marginBottom: 40 },
  logo: { fontSize: 36, fontWeight: '800', color: GOLD, letterSpacing: -1 },
  subtitle: { fontSize: 14, color: MUTED, marginTop: 4 },

  modeRow: {
    flexDirection: 'row', backgroundColor: CARD,
    borderRadius: 12, padding: 4, marginBottom: 32,
  },
  modeBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  modeBtnActive: { backgroundColor: GOLD },
  modeBtnText: { color: MUTED, fontWeight: '600', fontSize: 15 },
  modeBtnTextActive: { color: '#000' },

  pickerSection: { marginBottom: 24 },
  pickerLabel: { color: MUTED, fontSize: 12, fontWeight: '600', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.8 },
  slotScroll: { flexGrow: 0 },
  slot: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
    backgroundColor: CARD, marginRight: 8,
  },
  slotSelected: { backgroundColor: GOLD },
  slotText: { color: TEXT, fontSize: 14, fontWeight: '500' },
  slotTextSelected: { color: '#000', fontWeight: '700' },

  toggleSection: { marginBottom: 24 },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: CARD, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#1A6BC4',
  },
  toggleRowActive: { borderColor: GOLD },
  toggleTextCol: { flex: 1, paddingRight: 12 },
  toggleTitle: { color: TEXT, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  toggleSubtitle: { color: MUTED, fontSize: 12, lineHeight: 16 },
  togglePill: {
    minWidth: 48, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#003570', alignItems: 'center',
  },
  togglePillOn: { backgroundColor: GOLD },
  togglePillText: { color: MUTED, fontSize: 13, fontWeight: '800' },
  togglePillTextOn: { color: '#000' },

  errorText: { color: '#ff453a', fontSize: 14, marginBottom: 16, textAlign: 'center' },

  goBtn: {
    backgroundColor: GOLD, borderRadius: 14, paddingVertical: 18,
    alignItems: 'center', marginTop: 'auto', marginBottom: 8,
  },
  goBtnDisabled: { opacity: 0.6 },
  goBtnText: { color: '#000', fontSize: 17, fontWeight: '800' },

  hint: { color: MUTED, fontSize: 12, textAlign: 'center', marginBottom: 8 },
});
