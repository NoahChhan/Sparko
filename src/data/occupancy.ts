// Occupancy module — scrapes sjsuparkingstatus.sjsu.edu
// Falls back to time-aware mock if the site is unreachable or stale.
// The rest of the app only calls getOccupancy() / getAllOccupancy() and
// never needs to know which source was used.

import { FACILITIES, DOWNTOWN_PUBLIC_FACILITIES } from './inventory';

export interface OccupancyResult {
  facilityId: string;
  percent: number;       // 0–100 (meaningless when source === 'static'; use UI caption instead)
  source: 'live' | 'mocked' | 'static';
  fetchedAt: number;     // unix ms timestamp
  stale: boolean;
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000;  // 5 min — matches typical sensor refresh
// Note: SJSU uses an internal CA cert — NSAllowsArbitraryLoads in app.json
// handles this for iOS. The site also only responds on SJSU campus WiFi.
const STATUS_URL = 'https://sjsuparkingstatus.sjsu.edu/GarageStatus';

function findFacilityMeta(facilityId: string) {
  return FACILITIES.find(f => f.id === facilityId)
    ?? DOWNTOWN_PUBLIC_FACILITIES.find(f => f.id === facilityId);
}

// Maps statusPageName values (from inventory) → facility IDs
// Must stay in sync with inventory.ts statusPageName fields
const NAME_TO_ID: Record<string, string> = {
  'North Garage': 'north_garage',
  'South Garage': 'south_garage',
  'West Garage': 'west_garage',
  'South Campus Garage': 'south_campus',
};

// ---------------------------------------------------------------------------
// Scraper — parses the server-rendered HTML from sjsuparkingstatus.sjsu.edu
// No DOM available in React Native, so we use regex on the raw HTML string.
// The page structure is stable: <h2 class="garage__name">NAME</h2> followed
// by <span class="garage__fullness"> PERCENT %  </span>
// ---------------------------------------------------------------------------
async function scrapeOccupancy(): Promise<Record<string, number> | null> {
  // AbortController + setTimeout — more compatible than AbortSignal.timeout()
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(STATUS_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Sparko/1.0 SJSU Student App' },
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn('[Sparko] Occupancy fetch failed — HTTP', res.status);
      return null;
    }

    const html = await res.text();
    console.log('[Sparko] Occupancy HTML length:', html.length);

    const blockRegex =
      /class="garage__name">\s*([^<]+?)\s*<\/h2>[\s\S]*?class="garage__fullness">\s*([\d.]+)\s*%/g;

    const result: Record<string, number> = {};
    let match: RegExpExecArray | null;

    while ((match = blockRegex.exec(html)) !== null) {
      const rawName = match[1].trim();
      const percent = parseFloat(match[2]);
      const id = NAME_TO_ID[rawName];
      console.log('[Sparko] Parsed:', rawName, '→', id, '=', percent);
      if (id && !isNaN(percent)) {
        result[id] = percent;
      }
    }

    if (Object.keys(result).length === 0) {
      console.warn('[Sparko] Regex matched nothing — HTML may have changed');
      return null;
    }

    return result;
  } catch (e) {
    clearTimeout(timer);
    console.warn('[Sparko] Occupancy fetch error:', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Demo seed — fixed realistic values used when live data is unavailable.
// Designed to showcase all three risk buckets in the demo:
//   South Garage: 96% → Risky (essentially full)
//   North Garage: 88% → Borderline (high but findable)
//   West Garage:  74% → On Time (good availability)
//   South Campus: 41% → On Time (cheapest + plenty of space)
//
// To update for your demo, change these values and save — no rebuild needed
// as long as Metro is running.
// ---------------------------------------------------------------------------
const DEMO_SEED: Record<string, number> = {
  north_garage:  88,
  south_garage:  96,
  west_garage:   74,
  south_campus:  41,
};

// ---------------------------------------------------------------------------
// Mock — uses demo seed + small jitter so numbers feel alive, not frozen
// ---------------------------------------------------------------------------
function getMockedPercent(facilityId: string): number {
  const base = DEMO_SEED[facilityId] ?? 60;
  const jitter = (Math.random() - 0.5) * 6; // ±3% so it doesn't look static
  return Math.min(100, Math.max(0, base + jitter));
}

// ---------------------------------------------------------------------------
// In-memory cache — one shared fetch for all facilities per interval
// ---------------------------------------------------------------------------
let cache: Record<string, OccupancyResult> = {};
let lastFetchAttempt = 0;
let cachedLiveData: Record<string, number> | null = null;

async function refreshLiveData(): Promise<void> {
  const now = Date.now();
  if (now - lastFetchAttempt < STALE_THRESHOLD_MS) return; // don't hammer the site
  lastFetchAttempt = now;
  cachedLiveData = await scrapeOccupancy();
}

export async function getOccupancy(facilityId: string): Promise<OccupancyResult> {
  const meta = findFacilityMeta(facilityId);
  if (meta?.occupancyTracking === 'none') {
    const now = Date.now();
    const result: OccupancyResult = {
      facilityId,
      percent: 0,
      source: 'static',
      fetchedAt: now,
      stale: false,
    };
    cache[facilityId] = result;
    return result;
  }

  const cached = cache[facilityId];
  const now = Date.now();

  // Only return cache if it's live data — never let stale mock block a live fetch
  if (cached && cached.source === 'live' && now - cached.fetchedAt < STALE_THRESHOLD_MS) {
    return { ...cached, stale: false };
  }

  await refreshLiveData();

  if (cachedLiveData && facilityId in cachedLiveData) {
    const result: OccupancyResult = {
      facilityId,
      percent: cachedLiveData[facilityId],
      source: 'live',
      fetchedAt: now,
      stale: false,
    };
    cache[facilityId] = result;
    return result;
  }

  // Live unavailable — use mock
  const result: OccupancyResult = {
    facilityId,
    percent: getMockedPercent(facilityId),
    source: 'mocked',
    fetchedAt: now,
    stale: false,
  };
  cache[facilityId] = result;
  return result;
}

// Fetch all facilities in one shot — call this on app load
export async function getAllOccupancy(
  facilityIds: string[]
): Promise<Record<string, OccupancyResult>> {
  await refreshLiveData(); // one network call for all
  const results = await Promise.all(facilityIds.map(id => getOccupancy(id)));
  return Object.fromEntries(results.map(r => [r.facilityId, r]));
}

// Force cache clear (e.g. pull-to-refresh)
export function clearOccupancyCache(): void {
  cache = {};
  lastFetchAttempt = 0;
  cachedLiveData = null;
}
