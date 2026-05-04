import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { FACILITIES } from '../data/inventory';
import { getAllOccupancy } from '../data/occupancy';
import { computeAllETAs } from '../engine/eta';
import { rankOptions, RankingInput } from '../engine/ranking';
import { computeTransitETA } from '../engine/transit';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Home'> };
type Mode = 'leave_now' | 'arrive_by';

interface GeoSuggestion { name: string; lat: number; lng: number; }

function generateTimeSlots(): Date[] {
  const slots: Date[] = [];
  const now = new Date();
  const ms = 5 * 60 * 1000;
  let t = new Date(Math.ceil(now.getTime() / ms) * ms);
  for (let i = 0; i < 36; i++) {
    slots.push(new Date(t));
    t = new Date(t.getTime() + ms);
  }
  return slots;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const MAPBOX_KEY = process.env.EXPO_PUBLIC_MAPBOX_KEY ?? '';
// San Jose city center — biases geocoding results toward the South Bay
const SJ_LNG = -121.8853;
const SJ_LAT = 37.3382;

export default function HomeScreen({ navigation }: Props) {
  const [mode, setMode] = useState<Mode>('leave_now');
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);
  const [timeSlots] = useState(generateTimeSlots);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Origin state
  const [originLabel, setOriginLabel] = useState('My Location');
  const [originCoords, setOriginCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isEditingOrigin, setIsEditingOrigin] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [suggestions, setSuggestions] = useState<GeoSuggestion[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (mode === 'arrive_by' && !selectedSlot) {
      setSelectedSlot(timeSlots[3]);
    }
  }, [mode]);

  // Geocode as user types — debounced 400ms
  function handleSearchChange(text: string) {
    setSearchText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (text.length < 3) { setSuggestions([]); return; }
      try {
        const url =
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(text)}.json` +
          `?proximity=${SJ_LNG},${SJ_LAT}&country=US&limit=4&access_token=${MAPBOX_KEY}`;
        const res  = await fetch(url);
        const json = await res.json();
        setSuggestions(
          (json.features ?? []).map((f: any) => ({
            name: f.place_name as string,
            lat:  f.center[1] as number,
            lng:  f.center[0] as number,
          }))
        );
      } catch { /* geocoding failure is non-fatal */ }
    }, 400);
  }

  function selectSuggestion(s: GeoSuggestion) {
    setOriginLabel(s.name);
    setOriginCoords({ lat: s.lat, lng: s.lng });
    setSearchText('');
    setSuggestions([]);
    setIsEditingOrigin(false);
  }

  function clearOrigin() {
    setOriginLabel('My Location');
    setOriginCoords(null);
    setSearchText('');
    setSuggestions([]);
    setIsEditingOrigin(false);
  }

  function openOriginEditor() {
    setIsEditingOrigin(true);
    setSearchText('');
    setSuggestions([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function handleGo() {
    setLoading(true);
    setError(null);

    try {
      // Resolve coordinates — GPS if no custom origin is set
      let latitude: number, longitude: number;

      if (originCoords) {
        latitude  = originCoords.lat;
        longitude = originCoords.lng;
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setError('Location permission denied. Enable it in Settings.');
          setLoading(false);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        latitude  = loc.coords.latitude;
        longitude = loc.coords.longitude;
      }

      // Fetch occupancy, drive ETAs, and transit ETA all in parallel
      const [occupancyMap, etas] = await Promise.all([
        getAllOccupancy(FACILITIES.map(f => f.id)),
        computeAllETAs(FACILITIES, latitude, longitude),
      ]);
      const transitETA = computeTransitETA(latitude, longitude);

      // Rank parking options
      const inputs: RankingInput[] = FACILITIES.map((facility, i) => ({
        facility,
        eta: etas[i],
        occupancy: occupancyMap[facility.id],
      }));
      const arriveBy = mode === 'arrive_by' ? selectedSlot ?? undefined : undefined;
      const results  = rankOptions(inputs, mode, arriveBy);

      navigation.navigate('Results', {
        results: results.map(r => ({
          facility:     r.facility,
          eta:          r.eta,
          occupancy:    r.occupancy,
          arrivalTime:  r.arrivalTime.toISOString(),
          slackMinutes: r.slackMinutes,
          bucket:       r.bucket,
          score:        r.score,
          tags:         r.tags,
        })),
        mode,
        arriveByTime:   arriveBy?.toISOString() ?? null,
        transitResult:  transitETA
          ? { ...transitETA, arrivalTime: new Date(Date.now() + transitETA.totalMinutes * 60000).toISOString() }
          : null,
        originLabel,
      });
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>Sparko</Text>
        <Text style={styles.subtitle}>SJSU Commute Optimizer</Text>
      </View>

      {/* ── Leaving From ──────────────────────────────────────────── */}
      <View style={styles.originSection}>
        <Text style={styles.sectionLabel}>LEAVING FROM</Text>

        {isEditingOrigin ? (
          <View>
            <View style={styles.originInputRow}>
              <Text style={styles.originDot}>◎</Text>
              <TextInput
                ref={inputRef}
                style={styles.originInput}
                value={searchText}
                onChangeText={handleSearchChange}
                placeholder="Search address or place…"
                placeholderTextColor={MUTED}
                returnKeyType="search"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={clearOrigin} style={styles.clearBtn}>
                <Text style={styles.clearBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            {suggestions.length > 0 && (
              <View style={styles.suggestionList}>
                {suggestions.map((s, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.suggestionRow, i < suggestions.length - 1 && styles.suggestionBorder]}
                    onPress={() => selectSuggestion(s)}
                  >
                    <Text style={styles.suggestionPin}>📍</Text>
                    <Text style={styles.suggestionText} numberOfLines={2}>{s.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        ) : (
          <TouchableOpacity style={styles.originRow} onPress={openOriginEditor}>
            <Text style={styles.originDot}>{originCoords ? '📍' : '◎'}</Text>
            <Text style={styles.originLabel} numberOfLines={1}>{originLabel}</Text>
            {originCoords && (
              <TouchableOpacity onPress={clearOrigin} style={styles.clearBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.clearBtnText}>✕</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* ── Mode toggle ───────────────────────────────────────────── */}
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

      {/* ── Arrive By time picker ─────────────────────────────────── */}
      {mode === 'arrive_by' && (
        <View style={styles.pickerSection}>
          <Text style={styles.sectionLabel}>ARRIVE BY</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.slotScroll}>
            {timeSlots.map((slot, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.slot, selectedSlot?.getTime() === slot.getTime() && styles.slotSelected]}
                onPress={() => setSelectedSlot(slot)}
              >
                <Text style={[styles.slotText, selectedSlot?.getTime() === slot.getTime() && styles.slotTextSelected]}>
                  {formatTime(slot)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.goBtn, loading && styles.goBtnDisabled]}
        onPress={handleGo}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="#000" />
          : <Text style={styles.goBtnText}>Plan My Commute</Text>
        }
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const GOLD  = '#E5A823';
const BG    = '#0055A2';
const CARD  = '#004080';
const TEXT  = '#ffffff';
const MUTED = '#A8C8F0';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG, paddingHorizontal: 24 },

  header: { marginTop: 32, marginBottom: 28 },
  logo:     { fontSize: 36, fontWeight: '800', color: GOLD, letterSpacing: -1 },
  subtitle: { fontSize: 14, color: MUTED, marginTop: 4 },

  sectionLabel: {
    color: MUTED, fontSize: 11, fontWeight: '700',
    letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase',
  },

  // ── Origin input ──────────────────────────────────────────────────
  originSection: { marginBottom: 24 },

  originRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  originDot:   { fontSize: 16, marginRight: 10, color: GOLD },
  originLabel: { flex: 1, color: TEXT, fontSize: 15, fontWeight: '500' },

  originInputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  originInput: {
    flex: 1, color: TEXT, fontSize: 15,
    paddingVertical: 4,
  },

  clearBtn:     { padding: 4 },
  clearBtnText: { color: MUTED, fontSize: 16, fontWeight: '600' },

  suggestionList: {
    backgroundColor: CARD, borderRadius: 12,
    marginTop: 4, overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  suggestionBorder: { borderBottomWidth: 1, borderBottomColor: '#1A6BC4' },
  suggestionPin:    { fontSize: 14, marginRight: 10, marginTop: 1 },
  suggestionText:   { flex: 1, color: TEXT, fontSize: 14 },

  // ── Mode toggle ───────────────────────────────────────────────────
  modeRow: {
    flexDirection: 'row', backgroundColor: CARD,
    borderRadius: 12, padding: 4, marginBottom: 24,
  },
  modeBtn:           { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  modeBtnActive:     { backgroundColor: GOLD },
  modeBtnText:       { color: MUTED, fontWeight: '600', fontSize: 15 },
  modeBtnTextActive: { color: '#000' },

  // ── Time picker ───────────────────────────────────────────────────
  pickerSection: { marginBottom: 24 },
  slotScroll:    { flexGrow: 0 },
  slot: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 10, backgroundColor: CARD, marginRight: 8,
  },
  slotSelected:     { backgroundColor: GOLD },
  slotText:         { color: TEXT, fontSize: 14, fontWeight: '500' },
  slotTextSelected: { color: '#000', fontWeight: '700' },

  errorText: { color: '#ff453a', fontSize: 14, marginBottom: 16, textAlign: 'center' },

  goBtn: {
    backgroundColor: GOLD, borderRadius: 14, paddingVertical: 18,
    alignItems: 'center', marginTop: 'auto', marginBottom: 8,
  },
  goBtnDisabled: { opacity: 0.6 },
  goBtnText:     { color: '#000', fontSize: 17, fontWeight: '800' },
});
