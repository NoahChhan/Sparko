// ETA engine — computes estimated time to arrive at the SJSU pin
// for each facility given a user's current location.
//
// Drive time strategy (in priority order):
//   1. Google Maps / Mapbox API — not wired up yet (see ACTION REQUIRED below)
//   2. Straight-line fallback — haversine distance ÷ assumed avg speed
//
// ⚠️  ACTION REQUIRED: To get real drive times, pick one:
//   Option A — Google Maps:
//     Add EXPO_PUBLIC_GOOGLE_MAPS_KEY=<your key> to .env
//     and uncomment the fetchGoogleDriveMinutes() block below.
//   Option B — Mapbox:
//     Add EXPO_PUBLIC_MAPBOX_KEY=<your key> to .env
//     and uncomment the fetchMapboxDriveMinutes() block below.
//
// For the demo, straight-line is fine — it's clearly labeled and
// produces plausible rankings when garages are close together.

import { ParkingFacility, SJSU_PIN, SEARCH_BUFFER } from '../data/inventory';

export interface ETABreakdown {
  facilityId: string;
  driveMinutes: number;
  searchBufferMinutes: number;
  shuttleWaitMinutes: number;   // 0 unless South Campus
  shuttleRideMinutes: number;   // 0 unless South Campus
  walkMinutes: number;
  totalMinutes: number;
  driveSource: 'api' | 'straight_line';
}

// ---------------------------------------------------------------------------
// Haversine — straight-line distance in km between two lat/lng points
// ---------------------------------------------------------------------------
function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Straight-line → drive time estimate
// Uses 30 km/h average (accounts for urban stops, signals, parking lot crawl)
// Adds a 1.35 road-factor multiplier (straight line is never the actual route)
function straightLineDriveMinutes(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): number {
  const distKm = haversineKm(fromLat, fromLng, toLat, toLng) * 1.35;
  const avgSpeedKmh = 30;
  return (distKm / avgSpeedKmh) * 60;
}

// ---------------------------------------------------------------------------
// Live drive time — uncomment ONE of these when you have an API key
// ---------------------------------------------------------------------------

// --- Option A: Google Maps Directions API ---
// const GOOGLE_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
// async function fetchGoogleDriveMinutes(
//   fromLat: number, fromLng: number,
//   toLat: number, toLng: number
// ): Promise<number | null> {
//   if (!GOOGLE_KEY) return null;
//   const url =
//     `https://maps.googleapis.com/maps/api/directions/json` +
//     `?origin=${fromLat},${fromLng}` +
//     `&destination=${toLat},${toLng}` +
//     `&mode=driving&key=${GOOGLE_KEY}`;
//   try {
//     const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
//     const json = await res.json();
//     const seconds = json.routes?.[0]?.legs?.[0]?.duration?.value;
//     return seconds ? seconds / 60 : null;
//   } catch { return null; }
// }

//--- Option B: Mapbox Matrix API ---
const MAPBOX_KEY = process.env.EXPO_PUBLIC_MAPBOX_KEY;
async function fetchMapboxDriveMinutes(
  fromLat: number, fromLng: number,
  toLat: number, toLng: number
): Promise<number | null> {
  if (!MAPBOX_KEY) return null;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving` +
    `/${fromLng},${fromLat};${toLng},${toLat}` +
    `?access_token=${MAPBOX_KEY}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    const seconds = json.routes?.[0]?.duration;
    return seconds ? seconds / 60 : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Main ETA calculation for a single facility
// ---------------------------------------------------------------------------
export async function computeETA(
  facility: ParkingFacility,
  userLat: number,
  userLng: number,
): Promise<ETABreakdown> {
  // --- Drive time ---
  const liveDrive = await fetchMapboxDriveMinutes(
    userLat, userLng,
    facility.coords.lat, facility.coords.lng
  );
  const driveMinutes = liveDrive ?? straightLineDriveMinutes(
    userLat, userLng,
    facility.coords.lat, facility.coords.lng
  );
  const driveSource: 'api' | 'straight_line' = liveDrive ? 'api' : 'straight_line';

  // --- Search buffer (finding a spot once you arrive) ---
  const searchBufferMinutes = SEARCH_BUFFER[facility.type];

  // --- Shuttle legs (South Campus only) ---
  // shuttleTransferMinutes = full shuttle journey (wait + ride) defined in inventory
  // Walk after shuttle is walkMinutesToPin — short, already on campus
  const shuttleWaitMinutes = 0;
  const shuttleRideMinutes = facility.shuttleTransferMinutes ?? 0;

  // --- Walk ---
  // For on-campus garages: essentially negligible but we keep it for completeness
  // For South Campus: short walk from shuttle drop-off to pin
  const walkMinutes = facility.walkMinutesToPin;

  const totalMinutes =
    driveMinutes +
    searchBufferMinutes +
    shuttleWaitMinutes +
    shuttleRideMinutes +
    walkMinutes;

  return {
    facilityId: facility.id,
    driveMinutes: Math.round(driveMinutes * 10) / 10,
    searchBufferMinutes,
    shuttleWaitMinutes,
    shuttleRideMinutes,
    walkMinutes,
    totalMinutes: Math.round(totalMinutes * 10) / 10,
    driveSource,
  };
}

// Compute ETAs for all facilities in parallel
export async function computeAllETAs(
  facilities: ParkingFacility[],
  userLat: number,
  userLng: number,
): Promise<ETABreakdown[]> {
  return Promise.all(facilities.map(f => computeETA(f, userLat, userLng)));
}
