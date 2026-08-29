import lastTrainDirectRange from "../data/last-train-direct-range.json";

type RouteRecord = {
  mode: string;
  hub: string;
  lastDepart: string;
  travelMin: number;
};

type LocationRecord = {
  id: string;
  name: string;
  routes: RouteRecord[];
};

type Dataset = {
  locations: LocationRecord[];
};

const dataset = lastTrainDirectRange as Dataset;

function toMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function toClockString(totalMinutes: number): string {
  const normalized = Math.max(0, totalMinutes);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function calculateLatestDepartureForLocation(
  locationName: string,
  walkMin = 5,
  bufferMin = 0,
) {
  const location = dataset.locations.find((entry) => entry.name === locationName);

  if (!location) {
    throw new Error(`Location not found: ${locationName}`);
  }

  const candidates = location.routes.map((route) => {
    const latestPossibleArrival = toMinutes(route.lastDepart) - route.travelMin;
    const mustLeaveAt = latestPossibleArrival - walkMin - bufferMin;

    return {
      ...route,
      latestPossibleArrival,
      mustLeaveAt,
      mustLeaveAtLabel: toClockString(mustLeaveAt),
      latestPossibleArrivalLabel: toClockString(latestPossibleArrival),
    };
  });

  const mostLate = candidates.reduce((best, current) => {
    return current.mustLeaveAt > best.mustLeaveAt ? current : best;
  }, candidates[0]);

  return {
    locationId: location.id,
    locationName: location.name,
    walkMin,
    bufferMin,
    mustLeaveAt: mostLate.mustLeaveAtLabel,
    mustLeaveAtMinutes: mostLate.mustLeaveAt,
    latestPossibleArrivalAt: mostLate.latestPossibleArrivalLabel,
    mostLateRoute: {
      mode: mostLate.mode,
      hub: mostLate.hub,
      lastDepart: mostLate.lastDepart,
      travelMin: mostLate.travelMin,
    },
    routes: candidates.map(({ mode, hub, lastDepart, travelMin, latestPossibleArrivalLabel, mustLeaveAtLabel }) => ({
      mode,
      hub,
      lastDepart,
      travelMin,
      earliestReturnDeadline: latestPossibleArrivalLabel,
      mustLeaveAt: mustLeaveAtLabel,
    })),
  };
}
