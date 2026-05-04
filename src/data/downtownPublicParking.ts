// Downtown San José — ParkSJ-operated garages & public lots (static fields for Sparko).
// Rate summaries from https://parksj.org (verify current signs / site before relying in production).
// Coordinates are approximate entrance points for ETA; walk times are static estimates to SJSU_PIN.

import type { ParkingFacility } from './inventory';

export const DOWNTOWN_PUBLIC_FACILITIES: ParkingFacility[] = [
  {
    id: 'parksj_third_street_garage',
    name: 'Third Street Garage (ParkSJ)',
    address: '95 N. Third St., San Jose, CA 95113',
    coords: { lat: 37.33985, lng: -121.88835 },
    type: 'drive_park_walk',
    ratePerHour: 4.0,
    dailyMax: 25,
    walkMinutesToPin: 17,
    distanceFromCampusMi: 0.9,
    notes:
      'ParkSJ city garage. First 90 min free, then $1/15 min; weekday max $25 (6am–6pm), $10 nights/weekends. See parksj.org.',
    statusPageName: '__downtown_public__',
    region: 'downtown_sj',
    occupancyTracking: 'none',
  },
  {
    id: 'parksj_fourth_street_garage',
    name: 'Fourth Street Garage (ParkSJ)',
    address: '44 S. Fourth St. (at San Fernando), San Jose, CA 95113',
    coords: { lat: 37.33695, lng: -121.88655 },
    type: 'drive_park_walk',
    ratePerHour: 4.0,
    dailyMax: 25,
    walkMinutesToPin: 12,
    distanceFromCampusMi: 0.55,
    notes:
      'ParkSJ city garage near MLK Library & SJSU. First 90 min free, then $1/15 min; weekday max $25. See parksj.org.',
    statusPageName: '__downtown_public__',
    region: 'downtown_sj',
    occupancyTracking: 'none',
  },
  {
    id: 'parksj_market_san_pedro_garage',
    name: 'Market & San Pedro Square Garage (ParkSJ)',
    address: '45 N. Market St., San Jose, CA 95113',
    coords: { lat: 37.33655, lng: -121.89435 },
    type: 'drive_park_walk',
    ratePerHour: 4.0,
    dailyMax: 25,
    walkMinutesToPin: 18,
    distanceFromCampusMi: 0.95,
    notes:
      'ParkSJ city garage. First 90 min free, then $1/15 min; weekday max $25. SAP event nights may use flat rates — check signage.',
    statusPageName: '__downtown_public__',
    region: 'downtown_sj',
    occupancyTracking: 'none',
  },
  {
    id: 'parksj_second_san_carlos_garage',
    name: 'Second & San Carlos Street Garage (ParkSJ)',
    address: '280 S. Second St., San Jose, CA 95113',
    coords: { lat: 37.33485, lng: -121.88495 },
    type: 'drive_park_walk',
    ratePerHour: 4.0,
    dailyMax: 25,
    walkMinutesToPin: 13,
    distanceFromCampusMi: 0.65,
    notes:
      'ParkSJ city garage (SoFA). First 90 min free, then $1/15 min; weekday max $25. See parksj.org.',
    statusPageName: '__downtown_public__',
    region: 'downtown_sj',
    occupancyTracking: 'none',
  },
  {
    id: 'parksj_south_hall_lot',
    name: 'South Hall Lot (ParkSJ)',
    address: '435 S. Market St. at Viola St., San Jose, CA 95113',
    coords: { lat: 37.33135, lng: -121.88985 },
    type: 'drive_park_walk',
    ratePerHour: 7.0,
    dailyMax: 25,
    walkMinutesToPin: 20,
    distanceFromCampusMi: 1.05,
    notes:
      'Surface lot near Convention Center. Typical $7 flat; special events up to ~$25 — check posted rate. See parksj.org.',
    statusPageName: '__downtown_public__',
    region: 'downtown_sj',
    occupancyTracking: 'none',
  },
];
