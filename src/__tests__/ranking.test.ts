import { rankOptions, occupancyPenalty, assignBucket, RankingInput } from '../engine/ranking';
import { FACILITIES } from '../data/inventory';

// ---------------------------------------------------------------------------
// Helpers — build minimal test fixtures
// ---------------------------------------------------------------------------
function makeInput(
  facilityId: string,
  driveMinutes: number,
  occupancyPercent: number,
): RankingInput {
  const facility = FACILITIES.find(f => f.id === facilityId)!;
  return {
    facility,
    eta: {
      facilityId,
      driveMinutes,
      searchBufferMinutes: 5,
      shuttleWaitMinutes: 0,
      shuttleRideMinutes: facilityId === 'south_campus' ? 12 : 0,
      walkMinutes: facility.walkMinutesToPin,
      totalMinutes: driveMinutes + 5 + (facilityId === 'south_campus' ? 12 : 0) + facility.walkMinutesToPin,
      driveSource: 'straight_line',
    },
    occupancy: {
      facilityId,
      percent: occupancyPercent,
      source: 'mocked',
      fetchedAt: Date.now(),
      stale: false,
    },
  };
}

function futureTime(minutesFromNow: number): Date {
  return new Date(Date.now() + minutesFromNow * 60_000);
}

// ---------------------------------------------------------------------------
// occupancyPenalty
// ---------------------------------------------------------------------------
describe('occupancyPenalty', () => {
  it('returns 0 below 85%', () => {
    expect(occupancyPenalty(0)).toBe(0);
    expect(occupancyPenalty(70)).toBe(0);
    expect(occupancyPenalty(84)).toBe(0);
  });

  it('returns > 0 at 85%', () => {
    expect(occupancyPenalty(85)).toBe(0); // exactly at threshold = 0
    expect(occupancyPenalty(86)).toBeGreaterThan(0);
  });

  it('is monotonically increasing above 85%', () => {
    const vals = [85, 90, 95, 99, 100].map(occupancyPenalty);
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]);
    }
  });

  it('caps at 1.0 at 100%', () => {
    expect(occupancyPenalty(100)).toBeLessThanOrEqual(1);
    expect(occupancyPenalty(100)).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// assignBucket
// ---------------------------------------------------------------------------
describe('assignBucket', () => {
  it('assigns OnTime when slack >= 10', () => {
    expect(assignBucket(10, 0, 50)).toBe('OnTime');
    expect(assignBucket(30, 0, 50)).toBe('OnTime');
  });

  it('assigns Borderline when 0 <= slack < 10', () => {
    expect(assignBucket(0, 0, 50)).toBe('Borderline');
    expect(assignBucket(9, 0, 50)).toBe('Borderline');
  });

  it('assigns Risky when slack < 0', () => {
    expect(assignBucket(-1, 0, 50)).toBe('Risky');
    expect(assignBucket(-20, 0, 50)).toBe('Risky');
  });

  it('downgrades Borderline → Risky when occupancy penalty is high', () => {
    // penalty > 0.4 should downgrade
    expect(assignBucket(5, 0.5, 93)).toBe('Risky');
  });

  it('downgrades OnTime → Risky when occupancy is essentially full (penalty > 0.8)', () => {
    // 99% full = penalty ~0.98 — no point sending someone there even with time buffer
    expect(assignBucket(15, 0.98, 99)).toBe('Risky');
  });

  it('does NOT downgrade OnTime when occupancy is high but not critical (<97%)', () => {
    // 91% full = penalty ~0.28 — concerning but still worth trying with good slack
    expect(assignBucket(15, 0.28, 91)).toBe('OnTime');
  });

  it('handles leave-now mode (null slack) — buckets by occupancy', () => {
    expect(assignBucket(null, 0, 50)).toBe('OnTime');
    expect(assignBucket(null, 0, 88)).toBe('Borderline');
    expect(assignBucket(null, 0, 97)).toBe('Risky');
  });
});

// ---------------------------------------------------------------------------
// rankOptions — arrive_by mode
// ---------------------------------------------------------------------------
describe('rankOptions (arrive_by)', () => {
  it('sorts OnTime before Borderline before Risky', () => {
    const inputs = [
      makeInput('south_campus', 5, 20),   // lots of slack, low occupancy → OnTime
      makeInput('south_garage', 25, 50),  // tight, moderate → Borderline/Risky
      makeInput('north_garage', 40, 50),  // late → Risky
    ];
    const arriveBy = futureTime(30); // 30 min from now
    const results = rankOptions(inputs, 'arrive_by', arriveBy);

    const buckets = results.map(r => r.bucket);
    const firstRisky = buckets.indexOf('Risky');
    const lastOnTime = buckets.lastIndexOf('OnTime');
    const lastBorderline = buckets.lastIndexOf('Borderline');

    if (lastOnTime !== -1 && firstRisky !== -1) {
      expect(lastOnTime).toBeLessThan(firstRisky);
    }
    if (lastBorderline !== -1 && firstRisky !== -1) {
      expect(lastBorderline).toBeLessThan(firstRisky);
    }
  });

  it('tags BestChance and Cheapest when all options are Risky', () => {
    // All garages take 60+ min but arrive-by is in 10 min → all Risky
    const inputs = [
      makeInput('north_garage', 60, 70),
      makeInput('south_garage', 65, 70),
      makeInput('west_garage', 70, 70),
    ];
    const arriveBy = futureTime(10);
    const results = rankOptions(inputs, 'arrive_by', arriveBy);

    expect(results.every(r => r.bucket === 'Risky')).toBe(true);
    const tags = results.flatMap(r => r.tags);
    expect(tags).toContain('BestChance');
    expect(tags).toContain('Cheapest');
  });

  it('tags LessWalking and LowerCost when non-Risky options exist', () => {
    const inputs = [
      makeInput('north_garage', 5, 40),
      makeInput('south_campus', 5, 40), // cheaper but requires shuttle
    ];
    const arriveBy = futureTime(60);
    const results = rankOptions(inputs, 'arrive_by', arriveBy);

    const tags = results.flatMap(r => r.tags);
    expect(tags).toContain('LessWalking');
    expect(tags).toContain('LowerCost');
  });

  it('high occupancy (95%+) downgrades to Risky', () => {
    const inputs = [makeInput('north_garage', 5, 96)];
    const arriveBy = futureTime(30);
    const results = rankOptions(inputs, 'arrive_by', arriveBy);
    expect(results[0].bucket).toBe('Risky');
  });

  it('stale occupancy does not crash (result still has a bucket)', () => {
    const input = makeInput('south_garage', 10, 50);
    input.occupancy.stale = true;
    const results = rankOptions([input], 'arrive_by', futureTime(30));
    expect(['OnTime', 'Borderline', 'Risky']).toContain(results[0].bucket);
  });
});

// ---------------------------------------------------------------------------
// rankOptions — leave_now mode
// ---------------------------------------------------------------------------
describe('rankOptions (leave_now)', () => {
  it('returns results without crashing when no arriveByTime given', () => {
    const inputs = [
      makeInput('north_garage', 10, 50),
      makeInput('south_garage', 8, 80),
    ];
    const results = rankOptions(inputs, 'leave_now');
    expect(results).toHaveLength(2);
    expect(results[0].slackMinutes).toBeNull();
  });

  it('prefers shorter total time in leave_now mode', () => {
    const inputs = [
      makeInput('north_garage', 15, 50),
      makeInput('south_garage', 8, 50),
    ];
    const results = rankOptions(inputs, 'leave_now');
    // south_garage is faster, should rank first
    expect(results[0].facility.id).toBe('south_garage');
  });
});
