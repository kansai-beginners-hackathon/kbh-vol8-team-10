/**
 * メンバーの自宅駅 × ハブ 7 駅を resolveLastTrain で解いて、rankVenues に渡す STATIONS を組む。
 *
 * - 直列で回す（resolveLastTrain 側の間隔制御に任せる）。7 ハブ × 自宅駅の種類数
 * - 同じ自宅駅のメンバーが複数いても resolve は 1 回
 * - 全ハブで unavailable だった自宅駅のメンバーは `unavailable`（「対応予定」）に入れる。
 *   順位計算からは外す（deadMember 扱いにすると全候補地が ❌ になるため）
 */
import { HUBS, type Hub } from "../data/hubs.ts";
import type { DayType } from "./lastTrain.ts";
import { resolveLastTrain, type Resolved } from "./resolveLastTrain.ts";
import type { Member, Route, Station } from "./types.ts";

export type Resolver = (hub: Hub, home: string, dayType: DayType) => Promise<Resolved>;

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
): Promise<BuildResult> {
  const stations: Record<string, Station> = {};
  const unavailable: Member[] = [];
  const homes = [...new Set(members.map((m) => m.station))];

  for (const home of homes) {
    const routes: Route[] = [];
    for (const hub of hubs) {
      const r = await safeResolve(resolve, hub, home, dayType);
      if (r.kind === "found") {
        routes.push({ hub: hub.id, transferMin: hub.transferMin, last: r.time, via: r.via, transferCount: r.transferCount });
      } else if (r.kind === "noTrainNeeded") {
        routes.push({ hub: hub.id, transferMin: 0, last: null, via: "local", transferCount: 0 });
      }
      // unavailable → この経路は無いものとする
    }
    if (routes.length > 0) {
      stations[home] = { name: home, routes, taxiKm: 0 };
    } else {
      unavailable.push(...members.filter((m) => m.station === home));
    }
  }

  return { stations, unavailable };
}

/** resolveLastTrain は throw しない契約だが、万一投げても画面を壊さない */
async function safeResolve(resolve: Resolver, hub: Hub, home: string, dayType: DayType): Promise<Resolved> {
  try {
    return await resolve(hub, home, dayType);
  } catch (e) {
    return { kind: "unavailable", reason: e instanceof Error ? e.message : String(e) };
  }
}
