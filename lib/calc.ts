import { toMin } from "./time.ts";
import type { Member, MemberLeave, Route, Station, Venue, VenueResult } from "./types.ts";

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

/** 候補地 venue から station へ帰るとき、一番遅くなる経路とその値（徒歩を引く前・分） */
export function bestRoute(station: Station, venue: Venue): { route: Route; value: number } | null {
  let best: { route: Route; value: number } | null = null;
  for (const route of station.routes) {
    const cell = venue.toHub[route.hub];
    if (!cell) continue; // この候補地からそのハブへ行けない → 経路を除外
    // last === null は電車不要（自宅駅がハブそのもの）。支線は縛らず、候補地→ハブの最終だけが効く
    const viaBranch = route.last === null ? Infinity : toMin(route.last) - cell.transitMin - route.transferMin;
    const viaTrunk = cell.lastDepart ? toMin(cell.lastDepart) : Infinity;
    const value = Math.min(viaBranch, viaTrunk);
    if (best === null || value > best.value) best = { route, value };
  }
  return best;
}

export function latestLeave(station: Station, venue: Venue, walkMin: number): number | null {
  const best = bestRoute(station, venue);
  if (best === null) return null; // 全経路が除外 → この候補地からは帰れない
  return Math.floor(best.value - walkMin);
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
  if (members.length === 0) return []; // 順位に入れる人がいない（計算中・全員対応予定）
  return venues
    .map((venue) => resultFor(venue, members, stations, walkMin))
    .sort((a, b) => {
      if (a.ok && b.ok) return b.dissolve - a.dissolve;
      return a.ok ? -1 : b.ok ? 1 : 0;
    });
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
