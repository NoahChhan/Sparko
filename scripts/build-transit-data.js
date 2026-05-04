#!/usr/bin/env node
/**
 * build-transit-data.js
 *
 * One-time script that reads VTA GTFS files and outputs a trimmed JSON
 * containing only the routes and stops relevant to SJSU commutes.
 *
 * Run once:  node scripts/build-transit-data.js ~/Downloads/gtfs_vta
 * Output:    src/data/transit.json  (bundled with the app)
 *
 * Re-run whenever VTA publishes an updated GTFS feed.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const GTFS_DIR = process.argv[2];
if (!GTFS_DIR) {
  console.error('Usage: node scripts/build-transit-data.js <path-to-gtfs-folder>');
  process.exit(1);
}

const OUT_PATH = path.join(__dirname, '..', 'src', 'data', 'transit.json');

// SJSU Geographic Center (matches SJSU_PIN in inventory.ts)
const SJSU_LAT = 37.335190;
const SJSU_LNG = -121.881225;

// Any VTA stop within this radius counts as an "SJSU stop" (alighting point)
const SJSU_STOP_RADIUS_M = 450;

// Morning peak window used for headway and representative-trip selection
const MORNING_START_MIN = 6 * 60;  // 6:00 AM
const MORNING_END_MIN   = 9 * 60;  // 9:00 AM

// ── Utilities ──────────────────────────────────────────────────────────────

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// GTFS times can exceed 24:00:00 for overnight service — convert to minutes
function gtfsTimeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Parse a small CSV synchronously — handles quoted fields with commas inside
function parseCsvSync(filename) {
  const text = fs.readFileSync(path.join(GTFS_DIR, filename), 'utf8').replace(/\r/g, '');
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    vals.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}

// Stream a large CSV line by line — stop_times.txt can be 100 MB+
function streamCsv(filename, onRow) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(path.join(GTFS_DIR, filename)),
      crlfDelay: Infinity,
    });
    let headers = null;
    rl.on('line', line => {
      if (!line.trim()) return;
      if (!headers) {
        headers = line.split(',').map(h => h.replace(/"/g, '').trim());
        return;
      }
      const vals = line.split(',');
      const row = {};
      headers.forEach((h, i) => { row[h] = (vals[i] ?? '').trim(); });
      onRow(row);
    });
    rl.on('close', resolve);
    rl.on('error', reject);
  });
}

// Median gap between consecutive arrivals — used as the route headway
function calcHeadwayMin(arrivalMins) {
  const morning = arrivalMins
    .filter(m => m >= MORNING_START_MIN && m <= MORNING_END_MIN)
    .sort((a, b) => a - b);
  const pool = morning.length >= 2 ? morning : arrivalMins.slice().sort((a, b) => a - b);
  if (pool.length < 2) return 30;
  const gaps = pool.slice(1).map((t, i) => t - pool[i]).filter(g => g > 0 && g < 120);
  if (!gaps.length) return 30;
  gaps.sort((a, b) => a - b);
  return Math.round(gaps[Math.floor(gaps.length / 2)]);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // 1. Find stops near SJSU
  console.log('Loading stops...');
  const allStops = parseCsvSync('stops.txt');
  const stopById  = new Map(allStops.map(s => [s.stop_id, s]));
  const sjsuStopIds = new Set(
    allStops
      .filter(s => haversineM(SJSU_LAT, SJSU_LNG, +s.stop_lat, +s.stop_lon) <= SJSU_STOP_RADIUS_M)
      .map(s => s.stop_id)
  );
  console.log(`  ${sjsuStopIds.size} stops within ${SJSU_STOP_RADIUS_M}m of SJSU`);

  // 2. Build trip → route and route → trips lookups
  console.log('Loading trips...');
  const allTrips    = parseCsvSync('trips.txt');
  const tripToRoute = new Map(allTrips.map(t => [t.trip_id, t.route_id]));

  // 3. Load route names
  console.log('Loading routes...');
  const allRoutes = parseCsvSync('routes.txt');
  const routeById = new Map(allRoutes.map(r => [r.route_id, r]));

  // 4. Stream stop_times — pass 1
  //    Goal: find which routes serve SJSU stops; collect SJSU arrival times per route
  console.log('Scanning stop_times pass 1 (finding SJSU routes)...');
  // routeId → [{tripId, arrivalMin}]
  const routeSjsuArrivals = new Map();

  await streamCsv('stop_times.txt', row => {
    if (!sjsuStopIds.has(row.stop_id)) return;
    const routeId = tripToRoute.get(row.trip_id);
    if (!routeId) return;
    const arr = routeSjsuArrivals.get(routeId) ?? [];
    arr.push({ tripId: row.trip_id, arrivalMin: gtfsTimeToMin(row.arrival_time) });
    routeSjsuArrivals.set(routeId, arr);
  });

  const sjsuRouteIds = new Set(routeSjsuArrivals.keys());
  console.log(`  ${sjsuRouteIds.size} routes serve SJSU`);

  // For each route, pick a representative inbound morning trip to capture stop sequences.
  // A morning trip (arrives at SJSU 6–9 AM) gives realistic commute-hour ride times.
  const repTripByRoute = new Map(); // routeId → tripId
  for (const [routeId, arrivals] of routeSjsuArrivals) {
    const morning = arrivals.filter(a => a.arrivalMin >= MORNING_START_MIN && a.arrivalMin <= MORNING_END_MIN);
    const pool = morning.length > 0 ? morning : arrivals;
    pool.sort((a, b) => a.arrivalMin - b.arrivalMin);
    // Pick the median trip so we avoid the very first or last run of the day
    repTripByRoute.set(routeId, pool[Math.floor(pool.length / 2)].tripId);
  }

  const repTripIds = new Set(repTripByRoute.values());

  // 5. Stream stop_times — pass 2
  //    Goal: get the full ordered stop sequence for each representative trip
  console.log('Scanning stop_times pass 2 (collecting stop sequences)...');
  const routeStops = new Map(); // routeId → [{stopId, sequence, arrivalMin}]

  await streamCsv('stop_times.txt', row => {
    if (!repTripIds.has(row.trip_id)) return;
    const routeId = tripToRoute.get(row.trip_id);
    if (!routeId) return;
    const stops = routeStops.get(routeId) ?? [];
    stops.push({
      stopId:     row.stop_id,
      sequence:   parseInt(row.stop_sequence, 10),
      arrivalMin: gtfsTimeToMin(row.arrival_time),
    });
    routeStops.set(routeId, stops);
  });

  for (const stops of routeStops.values()) {
    stops.sort((a, b) => a.sequence - b.sequence);
  }

  // 6. Build output
  const sjsuStopsOut = [...sjsuStopIds].map(id => {
    const s = stopById.get(id);
    return { stopId: id, name: s.stop_name, lat: +s.stop_lat, lng: +s.stop_lon };
  });

  const routesOut = [];
  for (const routeId of sjsuRouteIds) {
    const r = routeById.get(routeId);
    if (!r) continue;
    const stops = routeStops.get(routeId);
    if (!stops?.length) continue;

    routesOut.push({
      routeId,
      shortName: r.route_short_name,
      longName:  r.route_long_name,
      headwayMinutes: calcHeadwayMin(
        (routeSjsuArrivals.get(routeId) ?? []).map(a => a.arrivalMin)
      ),
      stops: stops.map(s => {
        const stop = stopById.get(s.stopId);
        return {
          stopId:     s.stopId,
          name:       stop?.stop_name ?? '',
          lat:        +(stop?.stop_lat ?? 0),
          lng:        +(stop?.stop_lon ?? 0),
          sequence:   s.sequence,
          arrivalMin: s.arrivalMin,
        };
      }),
    });
  }

  const output = {
    generated: new Date().toISOString(),
    sjsuStops: sjsuStopsOut,
    routes: routesOut,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));

  console.log(`\n✓ Done! Wrote to ${OUT_PATH}`);
  console.log(`  ${routesOut.length} routes · ${sjsuStopsOut.length} SJSU stops\n`);
  console.log('Routes found:');
  routesOut.forEach(r =>
    console.log(`  Line ${r.shortName.padEnd(6)} ${r.stops.length} stops  ~${r.headwayMinutes} min headway  "${r.longName}"`)
  );
}

main().catch(err => { console.error(err); process.exit(1); });
