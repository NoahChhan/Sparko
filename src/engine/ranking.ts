// Ranking engine — the core of Sparko's decision model
//
// Given ETAs + occupancy for each facility, this module:
//   1. Computes occupancy risk penalty
//   2. Assigns a risk bucket: OnTime | Borderline | Risky
//   3. Scores and sorts within each bucket
//   4. Tags special labels: BestChance, Cheapest, LessWalking, LowerCost
//
// All math is pure — no side effects, easy to unit test.

import { ParkingFacility } from '../data/inventory';
import { OccupancyResult } from '../data/occupancy';
import { ETABreakdown } from './eta';

export type RiskBucket = 'OnTime' | 'Borderline' | 'Risky';

export interface RankedOption {
  facility: ParkingFacility;
  eta: ETABreakdown;
  occupancy: OccupancyResult;

  // Computed fields
  arrivalTime: Date;           // absolute time you'd reach the SJSU pin
  slackMinutes: number | null; // null in "Leave now" mode
  occupancyRiskPenalty: number;// 0–1 additive penalty
  bucket: RiskBucket;
  score: number;               // lower = better (used for within-bucket sort)

  // Special labels — at most one primary tag per result set
  tags: ResultTag[];
}

export type ResultTag =
  | 'BestChance'   // lowest risk when all are Risky
  | 'Cheapest'     // lowest daily cost when all are Risky
  | 'LessWalking'  // least walk time among non-Risky options
  | 'LowerCost';   // lowest cost among non-Risky options

// ---------------------------------------------------------------------------
// Occupancy risk penalty
// Flat 0 below 85%, then ramps nonlinearly up to 1.0 at 100%
// ---------------------------------------------------------------------------
export function occupancyPenalty(percent: number): number {
  if (percent < 85) return 0;
  // Map 85–100 → 0–1 using a quadratic curve (steeper near full)
  const t = (percent - 85) / 15; // 0 at 85%, 1 at 100%
  return Math.min(1, t * t * 2);  // quadratic, capped at 1
}

// ---------------------------------------------------------------------------
// Risk bucket assignment
// Occupancy penalty can downgrade Borderline → Risky
// ---------------------------------------------------------------------------
function assignBucket(
  slackMinutes: number | null,
  penalty: number,
  occupancyPercent: number
): RiskBucket {
  // In "Leave now" mode there's no target time → no slack → bucket by occupancy only
  if (slackMinutes === null) {
    if (occupancyPercent >= 95) return 'Risky';
    if (occupancyPercent >= 85) return 'Borderline';
    return 'OnTime';
  }

  let bucket: RiskBucket;
  if (slackMinutes >= 10) bucket = 'OnTime';
  else if (slackMinutes >= 0) bucket = 'Borderline';
  else bucket = 'Risky';

  // Occupancy penalty can only downgrade, never upgrade
  // penalty > 0.4 ≈ 92%+ full → Borderline becomes Risky
  if (bucket === 'Borderline' && penalty > 0.4) bucket = 'Risky';
  // penalty > 0.8 ≈ 97%+ full → garage is essentially full, OnTime also becomes Risky
  if (bucket === 'OnTime' && penalty > 0.8) bucket = 'Risky';

  return bucket;
}

// ---------------------------------------------------------------------------
// Composite score — lower is better
// Primary: tardiness risk | Secondary: total time, cost, walk
// ---------------------------------------------------------------------------
const WEIGHTS = {
  totalTime: 0.5,
  cost: 0.25,
  walk: 0.15,
  occupancyRisk: 0.10,
};

function computeScore(
  eta: ETABreakdown,
  facility: ParkingFacility,
  penalty: number,
  slackMinutes: number | null,
): number {
  // Tardiness risk: huge penalty if late, scaled by how late
  const latenessPenalty = slackMinutes !== null && slackMinutes < 0
    ? Math.abs(slackMinutes) * 10
    : 0;

  const costScore = facility.dailyMax ?? facility.ratePerHour * 4; // assume 4h default
  const walkScore = eta.walkMinutes + eta.shuttleRideMinutes;

  return (
    latenessPenalty +
    WEIGHTS.totalTime * eta.totalMinutes +
    WEIGHTS.cost * costScore +
    WEIGHTS.walk * walkScore +
    WEIGHTS.occupancyRisk * penalty * 100
  );
}

// ---------------------------------------------------------------------------
// Main ranking function
// ---------------------------------------------------------------------------
export interface RankingInput {
  facility: ParkingFacility;
  eta: ETABreakdown;
  occupancy: OccupancyResult;
}

export function rankOptions(
  inputs: RankingInput[],
  mode: 'leave_now' | 'arrive_by',
  arriveByTime?: Date, // required when mode === 'arrive_by'
): RankedOption[] {
  const now = new Date();

  const ranked: RankedOption[] = inputs.map(({ facility, eta, occupancy }) => {
    const arrivalTime = new Date(now.getTime() + eta.totalMinutes * 60_000);

    const slackMinutes =
      mode === 'arrive_by' && arriveByTime
        ? (arriveByTime.getTime() - arrivalTime.getTime()) / 60_000
        : null;

    const penalty = occupancyPenalty(occupancy.percent);
    const bucket = assignBucket(slackMinutes, penalty, occupancy.percent);
    const score = computeScore(eta, facility, penalty, slackMinutes);

    return {
      facility,
      eta,
      occupancy,
      arrivalTime,
      slackMinutes,
      occupancyRiskPenalty: penalty,
      bucket,
      score,
      tags: [],
    };
  });

  // Sort: bucket order first (OnTime → Borderline → Risky), then score within bucket
  const bucketOrder: Record<RiskBucket, number> = { OnTime: 0, Borderline: 1, Risky: 2 };
  ranked.sort((a, b) =>
    bucketOrder[a.bucket] - bucketOrder[b.bucket] || a.score - b.score
  );

  // --- Apply highlight tags ---
  const nonRisky = ranked.filter(r => r.bucket !== 'Risky');
  const allRisky = nonRisky.length === 0;

  if (allRisky) {
    // Tag Best Chance (lowest score = lowest risk) and Cheapest
    const bestChance = ranked[0]; // already sorted by score
    bestChance.tags.push('BestChance');

    const cheapest = [...ranked].sort(
      (a, b) =>
        (a.facility.dailyMax ?? a.facility.ratePerHour * 4) -
        (b.facility.dailyMax ?? b.facility.ratePerHour * 4)
    )[0];
    if (cheapest.facility.id !== bestChance.facility.id) {
      cheapest.tags.push('Cheapest');
    } else {
      cheapest.tags.push('Cheapest'); // same option, gets both tags
    }
  } else {
    // Tag Less Walking and Lower Cost among non-Risky options
    const leastWalk = nonRisky.reduce((a, b) =>
      a.eta.walkMinutes + a.eta.shuttleRideMinutes <=
      b.eta.walkMinutes + b.eta.shuttleRideMinutes ? a : b
    );
    leastWalk.tags.push('LessWalking');

    const lowestCost = nonRisky.reduce((a, b) =>
      (a.facility.dailyMax ?? a.facility.ratePerHour * 4) <=
      (b.facility.dailyMax ?? b.facility.ratePerHour * 4) ? a : b
    );
    if (lowestCost.facility.id !== leastWalk.facility.id) {
      lowestCost.tags.push('LowerCost');
    }
  }

  return ranked;
}

// ---------------------------------------------------------------------------
// Unit-testable helpers (exported for tests)
// ---------------------------------------------------------------------------
export { assignBucket };
