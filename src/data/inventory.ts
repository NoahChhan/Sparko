// SJSU parking inventory — hard-coded for MVP demo
// Coordinates sourced via OpenStreetMap Nominatim geocoding from real addresses.
// Addresses confirmed via sjsuparkingstatus.sjsu.edu

export type OptionType = 'drive_park_walk' | 'drive_park_shuttle_walk';

export interface ParkingFacility {
  id: string;
  name: string;
  address: string;
  coords: { lat: number; lng: number };
  type: OptionType;
  ratePerHour: number;       // USD
  dailyMax: number | null;   // USD, null if unknown
  walkMinutesToPin: number;  // minutes from facility entrance to SJSU pin (on foot)
  notes: string;
  shuttleTransferMinutes?: number; // only for South Campus — time on shuttle to campus
  // Key used to match against sjsuparkingstatus.sjsu.edu HTML
  statusPageName: string;
}

// SJSU Geographic Center — single destination pin for all ETA calculations
// Source: OpenStreetMap centroid for San José State University
export const SJSU_PIN = {
  lat: 37.335190,
  lng: -121.881225,
  label: 'SJSU Geographic Center',
};

export const FACILITIES: ParkingFacility[] = [
  {
    id: 'north_garage',
    name: 'North Garage',
    address: '65 S. 10th St., San Jose, CA 95112',
    coords: { lat: 37.339519, lng: -121.880040 },
    type: 'drive_park_walk',
    ratePerHour: 2.0,
    dailyMax: 14,
    // ~0.44km from SJSU pin at avg 80m/min walking pace ≈ 5–6 min
    walkMinutesToPin: 6,
    notes: 'North end of campus. High demand MWF mornings.',
    statusPageName: 'North Garage',
  },
  {
    id: 'south_garage',
    name: 'South Garage',
    address: '377 S. 7th St., San Jose, CA 95112',
    coords: { lat: 37.333501, lng: -121.880181 },
    type: 'drive_park_walk',
    ratePerHour: 2.0,
    dailyMax: 14,
    // ~0.19km from SJSU pin ≈ 2–3 min
    walkMinutesToPin: 3,
    notes: 'Closest garage to campus center. Often fills first.',
    statusPageName: 'South Garage',
  },
  {
    id: 'west_garage',
    name: 'West Garage',
    address: '350 S. 4th St., San Jose, CA 95112',
    coords: { lat: 37.332291, lng: -121.883280 },
    type: 'drive_park_walk',
    ratePerHour: 2.0,
    dailyMax: 14,
    // ~0.36km from SJSU pin ≈ 4–5 min
    walkMinutesToPin: 5,
    notes: 'Near Event Center / Rec Center.',
    statusPageName: 'West Garage',
  },
  {
    id: 'south_campus',
    name: 'South Campus Garage',
    address: '1278 S. 10th St., San Jose, CA 95112',
    coords: { lat: 37.320768, lng: -121.865519 },
    type: 'drive_park_shuttle_walk',
    ratePerHour: 1.0,
    dailyMax: 6,
    walkMinutesToPin: 4,   // walk time AFTER shuttle drop-off on campus
    shuttleTransferMinutes: 12,
    notes: 'Cheapest option. Requires shuttle (~every 10 min). ~0.8 mi from campus.',
    statusPageName: 'South Campus Garage',
  },
];

// Default parking search/find buffer per option type (minutes)
// Accounts for circling, waiting for a spot after arriving at the garage entrance
export const SEARCH_BUFFER: Record<OptionType, number> = {
  drive_park_walk: 5,
  drive_park_shuttle_walk: 3, // lower demand = easier to find a spot
};
