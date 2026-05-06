import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, TextInput, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { facilitiesForSearch } from '../data/inventory';
import { getAllOccupancy, clearOccupancyCache } from '../data/occupancy';
import { computeAllETAs } from '../engine/eta';
import { rankOptions, RankingInput } from '../engine/ranking';
import { computeTransitETA } from '../engine/transit';
import { formatTime } from '../utils/format';

const GOLD   = '#E5A823';
const BG     = '#0055A2';
const CARD   = '#004080';
const TEXT   = '#ffffff';
const MUTED  = '#A8C8F0';
const BORDER = '#1A6BC4';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'Home'> };
type Mode = 'leave_now' | 'arrive_by';

const STATUS_GARAGES = [
  { id: 'north_garage', label: 'North' },
  { id: 'south_garage', label: 'South' },
  { id: 'west_garage',  label: 'West' },
  { id: 'south_campus', label: 'S. Campus' },
];

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
  const [includeDowntownPublic, setIncludeDowntownPublic] = useState(false);
  const [garageStatus, setGarageStatus] = useState<
    Record<string, { percent: number; source: 'live' | 'mocked' | 'static' }> | null
  >(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

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
  }, [mode, timeSlots]);

  async function fetchGarageStatus() {
    try {
      const result = await getAllOccupancy(STATUS_GARAGES.map(g => g.id));
      setGarageStatus(
        Object.fromEntries(
          Object.entries(result).map(([id, r]) => [id, { percent: r.percent, source: r.source }])
        )
      );
    } catch { /* non-fatal — strip stays hidden */ }
  }

  useEffect(() => {
    fetchGarageStatus().then(() => setStatusLoading(false));
  }, []);

  async function handleRefresh() {
    setIsRefreshing(true);
    clearOccupancyCache();
    await fetchGarageStatus();
    setIsRefreshing(false);
  }

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

      const facilities = facilitiesForSearch(includeDowntownPublic);

      const [occupancyMap, etas] = await Promise.all([
        getAllOccupancy(facilities.map(f => f.id)),
        computeAllETAs(facilities, latitude, longitude),
      ]);
      const transitETA = computeTransitETA(latitude, longitude);

      const inputs: RankingInput[] = facilities.map((facility, i) => ({
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
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={GOLD}
          />
        }
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.logo}>Sparko</Text>
          <View style={styles.headerBottom}>
            <Text style={styles.subtitle}>SJSU Commute Optimizer</Text>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live</Text>
            </View>
          </View>
        </View>

        {/* ── Unified plan card: FROM / WHEN / TIME ──────────────────── */}
        <View style={styles.planCard}>
          {/* FROM row */}
          <View style={styles.planRow}>
            <Text style={styles.planRowLabel}>FROM</Text>
            {isEditingOrigin ? (
              <View style={styles.planRowContent}>
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
            ) : (
              <TouchableOpacity style={styles.planRowContent} onPress={openOriginEditor}>
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

          <View style={styles.cardDivider} />

          {/* WHEN row */}
          <View style={styles.planRow}>
            <Text style={styles.planRowLabel}>WHEN</Text>
            <View style={styles.planRowContent}>
              <View style={styles.modeToggle}>
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
            </View>
          </View>

          {/* TIME row — only shown in arrive_by mode */}
          {mode === 'arrive_by' && (
            <>
              <View style={styles.cardDivider} />
              <View style={[styles.planRow, styles.planRowNoRightPad]}>
                <Text style={styles.planRowLabel}>TIME</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.slotScroll}
                  contentContainerStyle={styles.slotScrollContent}
                >
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
            </>
          )}
        </View>

        {/* Geocode suggestions float below the plan card */}
        {isEditingOrigin && suggestions.length > 0 && (
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

        {/* ── Downtown public parking toggle ─────────────────────────── */}
        <TouchableOpacity
          style={[styles.toggleRow, includeDowntownPublic && styles.toggleRowActive]}
          onPress={() => setIncludeDowntownPublic(v => !v)}
          activeOpacity={0.85}
        >
          <View style={styles.toggleTextCol}>
            <Text style={styles.toggleTitle}>Downtown public parking</Text>
            <Text style={styles.toggleSubtitle}>
              ParkSJ garages near downtown — static rates, no live sensor.
            </Text>
          </View>
          <View style={[styles.togglePill, includeDowntownPublic && styles.togglePillOn]}>
            <Text style={[styles.togglePillText, includeDowntownPublic && styles.togglePillTextOn]}>
              {includeDowntownPublic ? 'On' : 'Off'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* ── Garage status strip ────────────────────────────────────── */}
        {(statusLoading || garageStatus) && (
          <View style={styles.statusSection}>
            <View style={styles.statusHeader}>
              <Text style={styles.sectionLabel}>Garage Status</Text>
              {garageStatus && (
                <Text style={[
                  styles.statusBadge,
                  { color: Object.values(garageStatus).some(g => g.source === 'live') ? '#30d158' : MUTED },
                ]}>
                  {Object.values(garageStatus).some(g => g.source === 'live') ? '● Live' : '● Est.'}
                </Text>
              )}
            </View>
            {statusLoading ? (
              <ActivityIndicator size="small" color={MUTED} />
            ) : (
              <View style={styles.statusGrid}>
                {[STATUS_GARAGES.slice(0, 2), STATUS_GARAGES.slice(2, 4)].map((pair, rowIdx) => (
                  <View key={rowIdx} style={styles.statusGridRow}>
                    {pair.map(({ id, label }) => {
                      const g = garageStatus?.[id];
                      if (!g) return null;
                      const dotColor = g.percent >= 95 ? '#ff453a' : g.percent >= 85 ? '#ffd60a' : '#30d158';
                      return (
                        <View key={id} style={styles.statusItem}>
                          <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
                          <Text style={styles.statusName}>{label}</Text>
                          <Text style={[styles.statusPct, { color: dotColor }]}>
                            {Math.round(g.percent)}%
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>

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

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: BG },
  scrollContent: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 8 },

  // ── Header ──────────────────────────────────────────────────────────
  header:       { marginBottom: 20 },
  logo:         { fontSize: 36, fontWeight: '800', color: GOLD, letterSpacing: -1 },
  headerBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  subtitle:     { fontSize: 14, color: MUTED },
  liveBadge:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: '#30d158' },
  liveText:     { color: '#30d158', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  sectionLabel: {
    color: MUTED, fontSize: 11, fontWeight: '700',
    letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase',
  },

  // ── Plan card ───────────────────────────────────────────────────────
  planCard: {
    backgroundColor: CARD, borderRadius: 16,
    borderWidth: 1, borderColor: BORDER,
    marginBottom: 12, overflow: 'hidden',
  },
  planRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  planRowNoRightPad: { paddingRight: 0 },
  planRowLabel: {
    color: MUTED, fontSize: 11, fontWeight: '700',
    letterSpacing: 1, width: 46,
  },
  planRowContent: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  cardDivider:    { height: StyleSheet.hairlineWidth, backgroundColor: BORDER },

  // ── Origin within plan card ─────────────────────────────────────────
  originDot:   { fontSize: 16, marginRight: 10, color: GOLD },
  originLabel: { flex: 1, color: TEXT, fontSize: 15, fontWeight: '500' },
  originInput: { flex: 1, color: TEXT, fontSize: 15, paddingVertical: 0 },
  clearBtn:     { padding: 4, marginLeft: 4 },
  clearBtnText: { color: MUTED, fontSize: 16, fontWeight: '600' },

  // ── Mode toggle within plan card ────────────────────────────────────
  modeToggle:        { flex: 1, flexDirection: 'row', backgroundColor: '#003570', borderRadius: 10, padding: 3 },
  modeBtn:           { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  modeBtnActive:     { backgroundColor: GOLD },
  modeBtnText:       { color: MUTED, fontWeight: '600', fontSize: 15 },
  modeBtnTextActive: { color: '#000' },

  // ── Time picker within plan card ────────────────────────────────────
  slotScroll:        { flexGrow: 0 },
  slotScrollContent: { gap: 8, paddingRight: 16 },
  slot:              { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#003570' },
  slotSelected:      { backgroundColor: GOLD },
  slotText:          { color: TEXT, fontSize: 14, fontWeight: '500' },
  slotTextSelected:  { color: '#000', fontWeight: '700' },

  // ── Geocode suggestions ─────────────────────────────────────────────
  suggestionList: {
    backgroundColor: CARD, borderRadius: 12,
    marginBottom: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: BORDER,
  },
  suggestionRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  suggestionBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  suggestionPin:    { fontSize: 14, marginRight: 10, marginTop: 1 },
  suggestionText:   { flex: 1, color: TEXT, fontSize: 14 },

  // ── Downtown toggle ─────────────────────────────────────────────────
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: CARD, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: BORDER, marginBottom: 16,
  },
  toggleRowActive:  { borderColor: GOLD },
  toggleTextCol:    { flex: 1, paddingRight: 12 },
  toggleTitle:      { color: TEXT, fontSize: 15, fontWeight: '700', marginBottom: 3 },
  toggleSubtitle:   { color: MUTED, fontSize: 12, lineHeight: 16 },
  togglePill:       { minWidth: 48, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: '#003570', alignItems: 'center' },
  togglePillOn:     { backgroundColor: GOLD },
  togglePillText:   { color: MUTED, fontSize: 13, fontWeight: '800' },
  togglePillTextOn: { color: '#000' },

  // ── Garage status strip ─────────────────────────────────────────────
  statusSection:  { marginBottom: 16 },
  statusHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  statusBadge:    { fontSize: 11, fontWeight: '700' },
  statusGrid:     { gap: 10 },
  statusGridRow:  { flexDirection: 'row', gap: 10 },
  statusItem:     { flex: 1, backgroundColor: CARD, borderRadius: 14, paddingVertical: 18, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: BORDER },
  statusDot:      { width: 14, height: 14, borderRadius: 7 },
  statusName:     { color: MUTED, fontSize: 12, fontWeight: '600' },
  statusPct:      { fontSize: 26, fontWeight: '800' },

  // ── Error + CTA ─────────────────────────────────────────────────────
  errorText:     { color: '#ff453a', fontSize: 14, marginBottom: 16, textAlign: 'center' },
  goBtn:         { backgroundColor: GOLD, borderRadius: 14, paddingVertical: 18, alignItems: 'center', marginHorizontal: 24, marginBottom: 8 },
  goBtnDisabled: { opacity: 0.6 },
  goBtnText:     { color: '#000', fontSize: 17, fontWeight: '800' },
});
