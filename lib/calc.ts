import { toMin } from "./time.ts";
import type { HubCell, Member, MemberLeave, Route, Station, Venue, VenueResult } from "./types.ts";

/**
 * 要件定義 §6 の式。
 *
 * 最遅出発(v, m) =
 *   max over m の各帰着経路 r:                         ← 一番遅くなる経路を採る
 *     min( ①支線に間に合う候補地発の最終,
 *          lastDepart )                                  ← ② 幹線が縛る
 *   − walkToStationMin
 *
 * ① は cell.trains（候補地→ハブの実在の便）があればそこから選び、無ければ
 * 従来どおり `支線最終 − transitMin − transferMin` で逆算する。branchLimit を参照。
 *
 * 端数は切り捨て。結果は必ず安全側（早め）に倒れる。
 */

/**
 * trains は「その区間の全便」ではなく飛び飛びの標本なので、収録に穴があると実際よりずっと早い便を
 * 掴んでしまう（四条 → 出町柳 で 21:01 の次が 22:00 しか無く、本当は 21:5x に乗れるのに 21:01 を返した例）。
 *
 * 穴の見つけ方は「採った便のすぐ次の便までの間隔」。収録済みの便の運転間隔は中央値 13 分・9 割が
 * 30 分以内なので、そこが 30 分を超えていたら間に電車があるのに載っていないとみなす。
 * 逆算から 60 分以上離れた場合も同じ扱い（土休日の 桂 → 京都 のように次の便まで届かないケースの保険）。
 */
const TRAIN_GAP_LIMIT_MIN = 30;
const FORMULA_GAP_LIMIT_MIN = 60;

/**
 * ① 支線の最終に間に合うために、候補地を何時までに出ればよいか（分）。
 *
 * cell.trains がある区間では「ハブ着 + 乗換 ≤ 支線最終」を満たす**実在の便**の中で一番遅い発時刻。
 * 逆算だと電車が走っていない時刻を返してしまうため（lib/types.ts の HubCell.trains 参照）。
 * 該当する便が無い（＝収録している時間帯より前が締め切り）か、収録に穴が空いているときは逆算に戻す。
 */
function branchLimit(cell: HubCell, route: Route, branchLast: string): number {
  const byFormula = toMin(branchLast) - cell.transitMin - route.transferMin;
  if (!cell.trains?.length) return byFormula;

  const limit = toMin(branchLast) - route.transferMin;
  let latest = -Infinity;
  for (const [depart, arrive] of cell.trains) {
    if (toMin(arrive) <= limit && toMin(depart) > latest) latest = toMin(depart);
  }
  if (latest === -Infinity) return byFormula;

  let nextLater = Infinity;
  for (const [depart] of cell.trains) {
    const time = toMin(depart);
    if (time > latest && time < nextLater) nextLater = time;
  }
  const hole = nextLater - latest > TRAIN_GAP_LIMIT_MIN || byFormula - latest > FORMULA_GAP_LIMIT_MIN;
  return hole ? byFormula : latest;
}

/** 候補地 venue から station へ帰るとき、一番遅くなる経路とその値（徒歩を引く前・分） */
export function bestRoute(station: Station, venue: Venue): { route: Route; value: number } | null {
  let best: { route: Route; value: number } | null = null;
  for (const route of station.routes) {
    const cell = venue.toHub[route.hub];
    if (!cell) continue; // この候補地からそのハブへ行けない → 経路を除外
    // last === null は電車不要（自宅駅がハブそのもの）。支線は縛らず、候補地→ハブの最終だけが効く
    const viaBranch = route.last === null ? Infinity : branchLimit(cell, route, route.last);
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
