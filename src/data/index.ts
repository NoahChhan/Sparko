export { FACILITIES, SJSU_PIN, SEARCH_BUFFER } from './inventory';
export type { ParkingFacility, OptionType } from './inventory';
export { getOccupancy, getAllOccupancy, clearOccupancyCache } from './occupancy';
export type { OccupancyResult } from './occupancy';

// Convenience: get full inventory (mirrors the exit-criteria getInventory() call)
export function getInventory() {
  const { FACILITIES: f } = require('./inventory');
  return f;
}
