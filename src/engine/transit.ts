import { SJSU_PIN } from '../data/inventory';
import rawTransitData from '../data/transit.json';

// ── Types matching the shape produced by build-transit-data.js ─────────────

interface TransitStop {
  stopId: string;
  name: string;
  lat: number;
  lng: number;
  sequence: number;
  arrivalMin: number;
}

interface TransitRoute {
  routeId: string;
  shortName: string;
  longName: string;
  headwayMinutes: number;
  stops: TransitStop[];
}

interface SjsuStop {
  stopId: string;
  name: string;
  lat: number;
  lng: number;
}

interface TransitData {
  generated: string;
  sjsuStops: SjsuStop[];
  routes: TransitRoute[];
}

const transitData = rawTransitData as unknown as TransitData;

// ── Result shape ────────────────────────────────────────────────────────────

export interface TransitETA {
  routeId: string;
  shortName: string;
  longName: string;
  walkToStopMinutes: number;
  waitMinutes: number;
  rideMinutes: number;
  walkFromStopMinutes: number;
  totalMinutes: number;
  headwayMinutes: number;
  boardingStopName: string;
  alightingStopName: string;
  longWalkWarning: boolean; // walk to boarding stop exceeds ~15 min
}

// ── Constants ───────────────────────────────────────────────────────────────

const WALK_SPEED_M_PER_MIN  = 80;   // ~4.8 km/h
const LONG_WALK_THRESHOLD_M = 1200; // ~15 min walk — flag as impractical but still show

// ── Helpers ─────────────────────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Given a user's coordinates, finds the best VTA bus option to SJSU.
 * Returns null if no route has a stop within MAX_WALK_TO_STOP_M of the user.
 *
 * Strategy: for each SJSU-serving route, find the closest boarding stop
 * that comes before the SJSU stop in sequence, then estimate
 * walk + wait (headway/2) + ride + short walk to SJSU pin.
 */
export function computeTransitETA(userLat: number, userLng: number): TransitETA | null {
  const sjsuStopIds = new Set(transitData.sjsuStops.map(s => s.stopId));

  let best: TransitETA | null = null;
  let bestTotal = Infinity;

  for (const route of transitData.routes) {
    if (route.routeId === '__placeholder__') continue;

    const sjsuStop = route.stops.find(s => sjsuStopIds.has(s.stopId));
    if (!sjsuStop) continue;

    // Find the nearest stop to the user that boards before SJSU
    let boarding: TransitStop | null = null;
    let boardingDist = Infinity;

    for (const stop of route.stops) {
      if (stop.sequence >= sjsuStop.sequence) continue;
      const dist = haversineM(userLat, userLng, stop.lat, stop.lng);
      if (dist < boardingDist) {
        boardingDist = dist;
        boarding = stop;
      }
    }

    if (!boarding) continue;

    const rideMin = sjsuStop.arrivalMin - boarding.arrivalMin;
    if (rideMin <= 0) continue;

    const walkToStop  = boardingDist / WALK_SPEED_M_PER_MIN;
    const wait        = route.headwayMinutes / 2;

    // Walk from alighting stop to SJSU pin
    const sjsuStopInfo = transitData.sjsuStops.find(s => s.stopId === sjsuStop.stopId);
    const aLat = sjsuStopInfo?.lat ?? sjsuStop.lat;
    const aLng = sjsuStopInfo?.lng ?? sjsuStop.lng;
    const walkFromStop = haversineM(SJSU_PIN.lat, SJSU_PIN.lng, aLat, aLng) / WALK_SPEED_M_PER_MIN;

    const total = walkToStop + wait + rideMin + walkFromStop;

    if (total < bestTotal) {
      bestTotal = total;
      best = {
        routeId:             route.routeId,
        shortName:           route.shortName,
        longName:            route.longName,
        walkToStopMinutes:   Math.round(walkToStop * 10) / 10,
        waitMinutes:         Math.round(wait * 10) / 10,
        rideMinutes:         Math.round(rideMin * 10) / 10,
        walkFromStopMinutes: Math.round(walkFromStop * 10) / 10,
        totalMinutes:        Math.round(total * 10) / 10,
        headwayMinutes:      route.headwayMinutes,
        boardingStopName:    boarding.name,
        alightingStopName:   sjsuStop.name,
        longWalkWarning:     boardingDist > LONG_WALK_THRESHOLD_M,
      };
    }
  }

  return best;
}
