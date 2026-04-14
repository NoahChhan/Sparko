import React from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import { RiskBucket, ResultTag } from '../engine/ranking';

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

function OccupancyBar({ percent, source }: { percent: number; source: 'live' | 'mocked' }) {
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

export default function ResultsScreen({ navigation, route }: Props) {
  const { results, mode, arriveByTime } = route.params;
  const allRisky = results.every(r => r.bucket === 'Risky');

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
                  <Text style={styles.statLabel}>Daily max</Text>
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
              </View>

              {/* Occupancy bar */}
              {r.occupancy && (
                <OccupancyBar
                  percent={r.occupancy.percent}
                  source={r.occupancy.source}
                />
              )}
            </View>
          );
        })}

        <Text style={styles.footer}>
          Occupancy from sjsuparkingstatus.sjsu.edu
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
  headerMeta: { flex: 1 },
  headerMode: { color: TEXT, fontSize: 16, fontWeight: '700' },

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

  address: { color: MUTED, fontSize: 12, marginBottom: 14 },

  statsRow: { flexDirection: 'row', marginBottom: 12, gap: 0 },
  stat: { flex: 1 },
  statValue: { color: TEXT, fontSize: 16, fontWeight: '700' },
  statLabel: { color: MUTED, fontSize: 11, marginTop: 2 },

  slackText: { fontSize: 13, fontWeight: '600', marginBottom: 10 },

  breakdown: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12,
  },
  breakdownItem: { color: MUTED, fontSize: 12 },

  barTrack: {
    height: 4, backgroundColor: '#2c2c2e',
    borderRadius: 2, overflow: 'hidden', marginBottom: 4,
  },
  barFill: { height: '100%', borderRadius: 2 },
  occupancyLabel: { color: MUTED, fontSize: 11 },

  footer: { color: '#3a3a3c', fontSize: 11, textAlign: 'center', marginTop: 8 },
});
