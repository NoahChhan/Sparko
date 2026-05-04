import React from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import { RiskBucket, ResultTag } from '../engine/ranking';
import { SerializedTransitResult } from '../../App';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Results'>;
  route: RouteProp<RootStackParamList, 'Results'>;
};

// ---- Bucket styling --------------------------------------------------------
const BUCKET_CONFIG: Record<RiskBucket, { label: string; color: string; bg: string }> = {
  OnTime:     { label: 'On Time',    color: '#30d158', bg: '#0d2e18' },
  Borderline: { label: 'Borderline', color: '#ffd60a', bg: '#2e2700' },
  Risky:      { label: 'Risky',      color: '#ff453a', bg: '#2e0e0d' },
};

const TAG_LABEL: Record<ResultTag, string> = {
  BestChance:  '⚡ Best Chance',
  Cheapest:    '💰 Cheapest',
  LessWalking: '🚶 Less Walking',
  LowerCost:   '💰 Lower Cost',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatSlack(slack: number | null): string {
  if (slack === null) return '';
  if (slack >= 0) return `+${Math.round(slack)} min buffer`;
  return `${Math.round(Math.abs(slack))} min late`;
}

function OccupancyBlock({ percent, source }: { percent: number; source: 'live' | 'mocked' | 'static' }) {
  if (source === 'static') {
    return (
      <Text style={styles.staticOccupancyCaption}>
        Downtown / public: Sparko does not track live fullness here. Check ParkSJ (parksj.org) or posted signs before you go.
      </Text>
    );
  }
  const color = percent >= 95 ? '#ff453a' : percent >= 85 ? '#ffd60a' : '#30d158';
  return (
    <View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${percent}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={styles.occupancyLabel}>
        {Math.round(percent)}% full
        {source === 'live' ? '  · live from SJSU' : '  · estimated'}
      </Text>
    </View>
  );
}

function TransitCard({ t }: { t: SerializedTransitResult }) {
  return (
    <View style={transitStyles.card}>
      <View style={transitStyles.topRow}>
        <View style={transitStyles.routeBadge}>
          <Text style={transitStyles.routeBadgeText}>🚌 Line {t.shortName}</Text>
        </View>
        <Text style={transitStyles.arrivalTime}>{formatTime(t.arrivalTime)}</Text>
      </View>

      <Text style={transitStyles.longName} numberOfLines={1}>{t.longName}</Text>

      <View style={transitStyles.statsRow}>
        <View style={transitStyles.stat}>
          <Text style={transitStyles.statValue}>{Math.round(t.totalMinutes)} min</Text>
          <Text style={transitStyles.statLabel}>Total</Text>
        </View>
        <View style={transitStyles.stat}>
          <Text style={transitStyles.statValue}>$2.50</Text>
          <Text style={transitStyles.statLabel}>Flat fare</Text>
        </View>
        <View style={transitStyles.stat}>
          <Text style={transitStyles.statValue}>~{t.headwayMinutes} min</Text>
          <Text style={transitStyles.statLabel}>Bus interval</Text>
        </View>
      </View>

      <View style={transitStyles.breakdown}>
        <Text style={transitStyles.breakdownItem}>🚶 {Math.round(t.walkToStopMinutes)} min walk to stop</Text>
        <Text style={transitStyles.breakdownItem}>⏱ ~{Math.round(t.waitMinutes)} min wait</Text>
        <Text style={transitStyles.breakdownItem}>🚌 {Math.round(t.rideMinutes)} min ride</Text>
        <Text style={transitStyles.breakdownItem}>🚶 {Math.round(t.walkFromStopMinutes)} min to campus</Text>
      </View>

      <Text style={transitStyles.stopLine} numberOfLines={1}>
        Board at {t.boardingStopName}
      </Text>

      {t.longWalkWarning && (
        <View style={transitStyles.warningRow}>
          <Text style={transitStyles.warningText}>
            ⚠️  Long walk to stop — driving is likely faster from here
          </Text>
        </View>
      )}
    </View>
  );
}

export default function ResultsScreen({ navigation, route }: Props) {
  const { results, mode, arriveByTime, transitResult, originLabel } = route.params;
  const allRisky = results.every(r => r.bucket === 'Risky');
  const hasDowntown = results.some(r => r.facility.region === 'downtown_sj');

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerMeta}>
          <Text style={styles.headerMode}>
            {mode === 'leave_now' ? 'Leaving now' : `Arrive by ${formatTime(arriveByTime!)}`}
          </Text>
          <Text style={styles.headerOrigin} numberOfLines={1}>From {originLabel}</Text>
        </View>
      </View>

      {/* All-Risky warning banner */}
      {allRisky && (
        <View style={styles.riskyBanner}>
          <Text style={styles.riskyBannerText}>
            ⚠️  All options are risky right now. Showing your least-bad choices.
          </Text>
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {transitResult && <TransitCard t={transitResult} />}

        {results.map((r, i) => {
          const bucket = BUCKET_CONFIG[r.bucket as RiskBucket];
          const isFirst = i === 0;

          return (
            <View key={r.facility.id} style={[styles.card, isFirst && styles.cardFirst]}>
              {/* Tag pills */}
              {r.tags.length > 0 && (
                <View style={styles.tagRow}>
                  {r.tags.map(tag => (
                    <View key={tag} style={styles.tagPill}>
                      <Text style={styles.tagText}>{TAG_LABEL[tag as ResultTag]}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Top row: name + risk badge */}
              <View style={styles.cardTopRow}>
                <Text style={styles.facilityName}>{r.facility.name}</Text>
                <View style={[styles.riskBadge, { backgroundColor: bucket.bg }]}>
                  <Text style={[styles.riskBadgeText, { color: bucket.color }]}>
                    {bucket.label}
                  </Text>
                </View>
              </View>

              {/* Address */}
              <Text style={styles.address}>{r.facility.address}</Text>

              {r.facility.region === 'downtown_sj' && (
                <View style={styles.regionRow}>
                  <Text style={styles.regionPill}>Downtown San José · public</Text>
                  {typeof r.facility.distanceFromCampusMi === 'number' && (
                    <Text style={styles.distanceText}>
                      ≈{r.facility.distanceFromCampusMi.toFixed(2)} mi walk to campus pin
                    </Text>
                  )}
                </View>
              )}

              {/* ETA row */}
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{formatTime(r.arrivalTime)}</Text>
                  <Text style={styles.statLabel}>Arrival</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{Math.round(r.eta.totalMinutes)} min</Text>
                  <Text style={styles.statLabel}>Total ETA</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>
                    ${r.facility.dailyMax ?? `${r.facility.ratePerHour}/hr`}
                  </Text>
                <Text style={styles.statLabel}>
                  {r.facility.region === 'downtown_sj' ? 'Typical daily cap' : 'Daily max'}
                </Text>
              </View>
            </View>

              {/* Slack line */}
              {r.slackMinutes !== null && (
                <Text style={[
                  styles.slackText,
                  { color: r.slackMinutes >= 0 ? '#30d158' : '#ff453a' }
                ]}>
                  {formatSlack(r.slackMinutes)}
                </Text>
              )}

              {/* ETA breakdown */}
              <View style={styles.breakdown}>
                <Text style={styles.breakdownItem}>
                  🚗 {Math.round(r.eta.driveMinutes)} min drive
                  {r.eta.driveSource === 'straight_line' ? ' (est.)' : ''}
                </Text>
                {r.eta.shuttleRideMinutes > 0 && (
                  <Text style={styles.breakdownItem}>
                    🚌 {r.eta.shuttleRideMinutes} min shuttle
                  </Text>
                )}
                <Text style={styles.breakdownItem}>
                  🅿️ {r.eta.searchBufferMinutes} min find spot
                </Text>
                {r.eta.walkMinutes > 0 && (
                  <Text style={styles.breakdownItem}>
                    🚶 {r.eta.walkMinutes} min walk to campus pin
                  </Text>
                )}
              </View>

              {r.facility.notes ? (
                <Text style={styles.notes}>{r.facility.notes}</Text>
              ) : null}

              {/* Occupancy bar */}
              {r.occupancy && (
                <OccupancyBlock
                  percent={r.occupancy.percent}
                  source={r.occupancy.source}
                />
              )}
            </View>
          );
        })}

        <Text style={styles.footer}>
          {hasDowntown
            ? 'SJSU garages: occupancy from sjsuparkingstatus.sjsu.edu when available. Downtown: static rates / distance — verify ParkSJ.'
            : 'Occupancy from sjsuparkingstatus.sjsu.edu when available'}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const BG = '#0055A2';
const CARD = '#004080';
const CARD_FIRST = '#004F99';
const TEXT = '#ffffff';
const MUTED = '#A8C8F0';
const GOLD = '#E5A823';
const BORDER = '#1A6BC4';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  headerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16,
  },
  backBtn: { paddingRight: 16 },
  backText: { color: GOLD, fontSize: 16, fontWeight: '600' },
  headerMeta:   { flex: 1 },
  headerMode:   { color: TEXT, fontSize: 16, fontWeight: '700' },
  headerOrigin: { color: MUTED, fontSize: 12, marginTop: 2 },

  riskyBanner: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: '#2e0e0d', borderRadius: 10,
    padding: 12, borderWidth: 1, borderColor: '#ff453a55',
  },
  riskyBannerText: { color: '#ff453a', fontSize: 13, fontWeight: '500' },

  list: { paddingHorizontal: 16, paddingBottom: 40 },

  card: {
    backgroundColor: CARD, borderRadius: 16,
    padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: BORDER,
  },
  cardFirst: { backgroundColor: CARD_FIRST, borderColor: '#3a3a3c' },

  tagRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  tagPill: {
    backgroundColor: '#003570', borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: GOLD,
  },
  tagText: { color: GOLD, fontSize: 12, fontWeight: '600' },

  cardTopRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', marginBottom: 4,
  },
  facilityName: { color: TEXT, fontSize: 18, fontWeight: '700', flex: 1 },
  riskBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 8 },
  riskBadgeText: { fontSize: 12, fontWeight: '700' },

  address: { color: MUTED, fontSize: 12, marginBottom: 8 },

  regionRow: { marginBottom: 12, gap: 6 },
  regionPill: {
    alignSelf: 'flex-start', backgroundColor: '#003570', color: GOLD,
    fontSize: 11, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 8, overflow: 'hidden',
  },
  distanceText: { color: MUTED, fontSize: 12, marginTop: 4 },

  statsRow: { flexDirection: 'row', marginBottom: 12, gap: 0 },
  stat: { flex: 1 },
  statValue: { color: TEXT, fontSize: 16, fontWeight: '700' },
  statLabel: { color: MUTED, fontSize: 11, marginTop: 2 },

  slackText: { fontSize: 13, fontWeight: '600', marginBottom: 10 },

  breakdown: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12,
  },
  breakdownItem: { color: MUTED, fontSize: 12 },

  notes: { color: MUTED, fontSize: 11, lineHeight: 15, marginBottom: 12, fontStyle: 'italic' },

  barTrack: {
    height: 4, backgroundColor: '#2c2c2e',
    borderRadius: 2, overflow: 'hidden', marginBottom: 4,
  },
  barFill: { height: '100%', borderRadius: 2 },
  occupancyLabel: { color: MUTED, fontSize: 11 },

  staticOccupancyCaption: {
    color: MUTED, fontSize: 11, lineHeight: 16,
    backgroundColor: '#00357055', padding: 10, borderRadius: 8,
  },

  footer: { color: '#3a3a3c', fontSize: 11, textAlign: 'center', marginTop: 8 },
});

const TRANSIT_CARD = '#0A3D2E';
const TRANSIT_BORDER = '#1A7A55';
const TRANSIT_TEXT = '#ffffff';
const TRANSIT_MUTED = '#7EC8A4';
const TRANSIT_GREEN = '#30d158';

const transitStyles = StyleSheet.create({
  card: {
    backgroundColor: TRANSIT_CARD, borderRadius: 16,
    padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: TRANSIT_BORDER,
  },
  topRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 4,
  },
  routeBadge: {
    backgroundColor: '#0F5C40', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: TRANSIT_GREEN,
  },
  routeBadgeText: { color: TRANSIT_GREEN, fontSize: 13, fontWeight: '700' },
  arrivalTime:    { color: TRANSIT_TEXT, fontSize: 15, fontWeight: '700' },
  longName:       { color: TRANSIT_MUTED, fontSize: 12, marginBottom: 14 },

  statsRow: { flexDirection: 'row', marginBottom: 12 },
  stat:      { flex: 1 },
  statValue: { color: TRANSIT_TEXT, fontSize: 16, fontWeight: '700' },
  statLabel: { color: TRANSIT_MUTED, fontSize: 11, marginTop: 2 },

  breakdown: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  breakdownItem: { color: TRANSIT_MUTED, fontSize: 12 },

  stopLine: { color: TRANSIT_MUTED, fontSize: 11, fontStyle: 'italic' },

  warningRow: {
    marginTop: 10, backgroundColor: '#2E1A00',
    borderRadius: 8, padding: 8,
    borderWidth: 1, borderColor: '#7A4500',
  },
  warningText: { color: '#FF9F0A', fontSize: 12, fontWeight: '500' },
});
