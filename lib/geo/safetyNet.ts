import { haversineMeters } from "../reco/scoring";

export type GeoPoint = { lat: number; lng: number };

type FilterResult<T> = {
  kept: T[];
  droppedCount: number;
  maxKeptDistance?: number;
};

const isValidCoordinate = (value: number) => Number.isFinite(value);

export const filterByMaxDistance = <T>(
  origin: GeoPoint | null | undefined,
  items: T[],
  getPoint: (item: T) => GeoPoint | null | undefined,
  maxDistanceMeters: number,
  options?: { disableDistanceFilter?: boolean },
): FilterResult<T> => {
  if (!origin || options?.disableDistanceFilter) {
    return { kept: items, droppedCount: 0 };
  }
  const kept: T[] = [];
  let droppedCount = 0;
  let maxKeptDistance: number | undefined;

  for (const item of items) {
    const point = getPoint(item);
    if (!point || !isValidCoordinate(point.lat) || !isValidCoordinate(point.lng)) {
      droppedCount += 1;
      continue;
    }
    const distance = haversineMeters(origin, point);
    if (distance <= maxDistanceMeters) {
      kept.push(item);
      if (maxKeptDistance === undefined || distance > maxKeptDistance) {
        maxKeptDistance = distance;
      }
    } else {
      droppedCount += 1;
    }
  }

  return {
    kept,
    droppedCount,
    maxKeptDistance,
  };
};
