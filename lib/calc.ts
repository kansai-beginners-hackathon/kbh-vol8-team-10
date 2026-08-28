import { toMin } from "./time";
import type { Member, MemberLeave, Route, Station, Venue, VenueResult } from "./types";

/**
 * 要件定義 §6 の式。
 *
 * 最遅出発(v, m) =
 *   max over m の各帰着経路 r:                         ← 一番遅くなる経路を採る
 *     min( 支線最終 − transitMin − transferMin,          ← ① 支線が縛る
 *          lastDepart )                                  ← ② 幹線が縛る
 *   − walkToStationMin
 *
 * 端数は切り捨て。結果は必ず安全側（早め）に倒れる。
 */
export function latestLeave(station: Station, venue: Venue, walkMin: number): number | null {
  let best: number | null = null;
  for (const route of station.routes) {
    const cell = venue.toHub[route.hub];
    if (!cell) continue; // この候補地からそのハブへ行けない → 経路を除外
    const viaBranch = toMin(route.last) - cell.transitMin - route.transferMin;
    const viaTrunk = cell.lastDepart ? toMin(cell.lastDepart) : Infinity;
    const value = Math.min(viaBranch, viaTrunk);
    if (best === null || value > best) best = value;
  }
  if (best === null) return null; // 全経路が除外 → この候補地からは帰れない
  return Math.floor(best - walkMin);
}

export function resultFor(
  venue: Venue,
  members: Member[],
  stations: Record<string, Station>,
  walkMin: number,
): VenueResult {
  const rows: MemberLeave[] = [];
  for (const member of members) {
    const station = stations[member.station];
    const leave = station ? latestLeave(station, venue, walkMin) : null;
    if (leave === null) return { venue, ok: false, deadMember: member };
    rows.push({ member, leave });
  }
  rows.sort((a, b) => a.leave - b.leave);
  return { venue, ok: true, rows, dissolve: rows[0].leave, bottleneck: rows[0].member };
}

/** いられる時間の長い順。帰れない候補地は末尾 */
export function rankVenues(
  venues: Venue[],
  members: Member[],
  stations: Record<string, Station>,
  walkMin: number,
): VenueResult[] {
  return venues
    .map((venue) => resultFor(venue, members, stations, walkMin))
    .sort((a, b) => {
      if (a.ok && b.ok) return b.dissolve - a.dissolve;
      return a.ok ? -1 : b.ok ? 1 : 0;
    });
}

/** 掲示されている最終と、自宅駅に着く本当の最終の差 */
export function lieOf(station: Station) {
  const route = station.routes.reduce<Route>((a, b) => (toMin(b.last) > toMin(a.last) ? b : a), station.routes[0]);
  return {
    posted: route.posted,
    postedTo: route.postedTo,
    real: route.last,
    gapMin: toMin(route.posted) - toMin(route.last),
  };
}

/**
 * タクシー概算。道路距離 ≒ 直線距離 × 1.3。
 * 京都市の初乗り 1km 500 円・以降 246m ごとに 100 円。深夜（22-5 時）は 2 割増。
 * 表示には必ず「約」を付ける。
 */
export function taxiFare(taxiKm: number): number {
  const roadKm = taxiKm * 1.3;
  const raw = 500 + (Math.max(0, roadKm - 1) / 0.246) * 100;
  return Math.round((raw * 1.2) / 100) * 100;
}
