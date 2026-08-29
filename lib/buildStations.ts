/**
 * メンバーの自宅駅 × ハブ 7 駅を resolveLastTrain で解いて、rankVenues に渡す STATIONS を組む。
 *
 * - 1 つの自宅駅につき 7 ハブを並列で投げ、自宅駅は同時に CONCURRENT_HOMES 件ずつ進める。
 *   Transit への間隔制御（300ms）は resolveLastTrain 側がモジュール全体で直列化しているので、
 *   並列にしても相手への負荷は変わらず、通信の待ち時間だけが重なって短くなる。
 *   全部を一斉に投げないのは「最初の 1 人が揃うまでの時間」を短くするため（順番待ちの列に混ざらない）
 * - 同じ自宅駅のメンバーが複数いても resolve は 1 回
 * - 自宅駅ごとに解け終わるたびに onProgress を呼ぶ（画面は全員揃うのを待たずに足していける）
 * - 全ハブで unavailable だった自宅駅のメンバーは `unavailable`（「対応予定」）に入れる。
 *   順位計算からは外す（deadMember 扱いにすると全候補地が ❌ になるため）
 */
import { HUBS, type Hub } from "../data/hubs.ts";
import type { DayType } from "./lastTrain.ts";
import { resolveLastTrain, type Resolved } from "./resolveLastTrain.ts";
import type { Member, Route, Station } from "./types.ts";

/** 同時に進める自宅駅の数 */
const CONCURRENT_HOMES = 2;

export type Resolver = (hub: Hub, home: string, dayType: DayType) => Promise<Resolved>;

/** 自宅駅 home が解けた。station === null なら全ハブ unavailable（対応予定） */
export type ProgressListener = (home: string, station: Station | null) => void;

export interface BuildResult {
  /** rankVenues に渡す */
  stations: Record<string, Station>;
  /** 全ハブで unavailable だったメンバー（対応予定） */
  unavailable: Member[];
}

/** 今日が土日なら weekend。祝日は見ない（Planner に日付入力が無い） */
export function todayType(now = new Date()): DayType {
  const day = now.getDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
}

export async function buildStations(
  members: Member[],
  dayType: DayType,
  resolve: Resolver = resolveLastTrain,
  hubs: Hub[] = HUBS,
  onProgress?: ProgressListener,
): Promise<BuildResult> {
  const homes = [...new Set(members.map((m) => m.station))];

  const resolved: (readonly [string, Station | null])[] = [];
  let next = 0;
  const worker = async () => {
    while (next < homes.length) {
      const home = homes[next++];
      const station = await buildStation(home, dayType, resolve, hubs);
      onProgress?.(home, station);
      resolved.push([home, station] as const);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENT_HOMES, homes.length) }, worker));

  const stations: Record<string, Station> = {};
  const unavailable: Member[] = [];
  for (const [home, station] of resolved) {
    if (station) stations[home] = station;
    else unavailable.push(...members.filter((m) => m.station === home));
  }
  return { stations, unavailable };
}

/** 1 つの自宅駅について全ハブを（並列で）解く。経路が 1 本も無ければ null */
async function buildStation(home: string, dayType: DayType, resolve: Resolver, hubs: Hub[]): Promise<Station | null> {
  const results = await Promise.all(hubs.map((hub) => safeResolve(resolve, hub, home, dayType)));
  const routes: Route[] = [];
  hubs.forEach((hub, i) => {
    const r = results[i];
    if (r.kind === "found") {
      routes.push({ hub: hub.id, transferMin: hub.transferMin, last: r.time, via: r.via, transferCount: r.transferCount });
    } else if (r.kind === "noTrainNeeded") {
      routes.push({ hub: hub.id, transferMin: 0, last: null, via: "local", transferCount: 0 });
    }
    // unavailable → この経路は無いものとする
  });
  return routes.length > 0 ? { name: home, routes, taxiKm: 0 } : null;
}

/** resolveLastTrain は throw しない契約だが、万一投げても画面を壊さない */
async function safeResolve(resolve: Resolver, hub: Hub, home: string, dayType: DayType): Promise<Resolved> {
  try {
    return await resolve(hub, home, dayType);
  } catch (e) {
    return { kind: "unavailable", reason: e instanceof Error ? e.message : String(e) };
  }
}
