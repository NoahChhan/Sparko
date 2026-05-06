export {
  FACILITIES,
  SJSU_PIN,
  SEARCH_BUFFER,
  facilitiesForSearch,
  DOWNTOWN_PUBLIC_FACILITIES,
} from './inventory';
export type { ParkingFacility, OptionType, FacilityRegion, OccupancyTracking } from './inventory';
export { getOccupancy, getAllOccupancy, clearOccupancyCache } from './occupancy';
export type { OccupancyResult } from './occupancy';
