/**
 * 「ハブ駅 → 自宅駅の終電」を 1 本の関数で答える振り分け役。
 *
 *   resolveLastTrain(hub, home, dayType)
 *      ├─ lastTrainBetween(ローカル JSON)   found → via "local" / noTrainNeeded → そのまま
 *      │     ハブ名の別名（三条 → 三条京阪）でも試す
 *      │     needsTransfer かつ地下鉄だけのハブ → unavailable（地下鉄同士の乗換は対応予定）
 *      ├─ Transit API plan type=arrival     isSane + 出発駅がハブ を通った最遅便 → via "transit"
 *      │     from は geo:（ハブ座標）。出せなければハブの駅 ID（Hub.stationIds）で順にリトライ
 *      └─ 何も無い / 4xx / 5xx / ネットワーク断 → unavailable（UI では「対応予定」）
 *
 * フロント（タスク3）はこの関数だけを呼ぶ。「どっちのデータか」を知らなくていい。
 *
 * 約束:
 *  - どんな入力でも throw しない。必ず Resolved を返す
 *  - 同じ駅（noTrainNeeded）では Transit を呼ばない（呼んでも 422 samePlace）
 *  - Transit の結果はキャッシュする。found はメモリ + localStorage、unavailable はメモリのみ
 *    （一時障害でその日一日「対応予定」に固定されないように）
 *  - Transit の呼び出しは 300ms 以上空ける（7 ハブ × N 人を直列で回す前提）
 */
import { hubGeo, hubNames, type Hub } from "../data/hubs.ts";
import linesJson from "../data/subway-lines.json" with { type: "json" };
import lastTrainsJson from "../data/subway-last-trains.json" with { type: "json" };
import { lastTrainBetween, type DayType, type LastTrainsData, type LinesData, type LocalLastTrain } from "./lastTrain.ts";
import { toMin } from "./time.ts";
import {
  boardingSecs,
  firstHeadsign,
  planLastArrivalDetailed,
  type PlanResult,
  secsToHHMM,
  suggestStationId,
  type TransitJourney,
} from "./transit.ts";

export type { DayType };

/** 地下鉄収録駅の駅 ID を選ぶときに優先する feed */
const SUBWAY_FEED = "scrape-kyoto-subway";

export type Resolved =
  | {
      kind: "found";
      /** "23:41" / "24:05"（24 時台はそのまま。lib/time.ts の toMin で比較） */
      time: string;
      via: "local" | "transit";
      /** local は常に 0 */
      transferCount: number;
      /** 最初の乗車区間の行き先。Transit の地下鉄などは null */
      headsign: string | null;
    }
  /** 同じ駅。電車不要 → 終電の制約から外す */
  | { kind: "noTrainNeeded" }
  /** 出せない。reason はログ用（UI には出さない） */
  | { kind: "unavailable"; reason: string };

export interface ResolveDeps {
  lines: LinesData;
  lastTrains: LastTrainsData;
  /** originNames: 最初の乗車区間の出発駅として受け入れる駅名（ハブ名 + 別名） */
  /**
   * plan。PlanResult（結果の種別付き）を返すのが標準。
   * 互換のため TransitJourney | null も受け付ける（null は「出発駅を変えてやり直す」扱い）
   */
  planLastArrival: (
    from: string,
    to: string,
    date: string,
    originNames: readonly string[],
  ) => Promise<PlanResult | TransitJourney | null>;
  /** preferFeeds: 優先する feed ID（地下鉄収録駅なら地下鉄） */
  suggestStationId: (name: string, preferFeeds: readonly string[]) => Promise<string | null>;
  /** "YYYYMMDD"（ローカル時刻） */
  today: () => string;
  /** Transit 呼び出しの最小間隔 ms。テストでは 0 にできる */
  minIntervalMs?: number;
}

export function todayYYYYMMDD(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export const defaultDeps: ResolveDeps = {
  lines: linesJson as unknown as LinesData,
  lastTrains: lastTrainsJson as unknown as LastTrainsData,
  planLastArrival: (from, to, date, originNames) => planLastArrivalDetailed(from, to, date, fetch, { originNames }),
  suggestStationId: (name, preferFeeds) => suggestStationId(name, fetch, { preferFeeds }),
  today: () => todayYYYYMMDD(),
  minIntervalMs: 300,
};

// ---- キャッシュ（メモリ + localStorage）

const memCache = new Map<string, Resolved>();
/** 進行中の Transit 問い合わせ（キー → Promise）。完了したら消す */
const inFlight = new Map<string, Promise<Resolved>>();
/** 進行中の駅 ID 検索（自宅駅名 → Promise）。同じ自宅駅の 7 ハブ分をまとめる */
const suggestInFlight = new Map<string, Promise<string | null>>();
/** 自宅駅名 → Transit 駅 ID。同じ人を 7 ハブ分回すので suggest は 1 回で済ませる。null（失敗）は覚えない */
const stationIdCache = new Map<string, string>();

const cacheKey = (hub: Hub, home: string, dayType: DayType, date: string) => `lt:${hub.id}:${home}:${dayType}:${date}`;

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** unavailable を localStorage に残す時間。一時障害を長く引きずらない程度に短く、リロード連打で同じ失敗を繰り返さない程度に長く */
const UNAVAILABLE_TTL_MS = 30 * 60 * 1000;

function readCache(key: string): Resolved | null {
  const hit = memCache.get(key);
  if (hit) return hit;
  if (!hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Resolved & { expiresAt?: number };
    if (parsed.kind === "found") {
      memCache.set(key, parsed);
      return parsed;
    }
    if (parsed.kind === "unavailable" && typeof parsed.expiresAt === "number" && parsed.expiresAt > Date.now()) {
      const value: Resolved = { kind: "unavailable", reason: parsed.reason };
      memCache.set(key, value);
      return value;
    }
    return null; // 古い形式・期限切れ
  } catch {
    return null;
  }
}

/** found は localStorage に無期限で、unavailable は UNAVAILABLE_TTL_MS だけ書く（出せない駅の再検索を毎リロード繰り返さない） */
function writeCache(key: string, value: Resolved): void {
  memCache.set(key, value);
  if (value.kind === "noTrainNeeded" || !hasLocalStorage()) return;
  try {
    const stored = value.kind === "unavailable" ? { ...value, expiresAt: Date.now() + UNAVAILABLE_TTL_MS } : value;
    window.localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // 容量超過・プライベートモードなどは無視
  }
}

/** テスト用。メモリキャッシュを空にする（localStorage は触らない） */
export function clearResolveCache(): void {
  memCache.clear();
  stationIdCache.clear();
}

// ---- 間隔制御

let lastTransitCallAt = 0;
let throttleChain: Promise<void> = Promise.resolve();

/** 前回の Transit 呼び出しから minIntervalMs 以上空ける。並行に呼ばれても直列化する */
function throttle(minIntervalMs: number): Promise<void> {
  if (minIntervalMs <= 0) return Promise.resolve();
  const next = throttleChain.then(async () => {
    const wait = lastTransitCallAt + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastTransitCallAt = Date.now();
  });
  throttleChain = next.catch(() => {});
  return next;
}

// ---- ローカル JSON

/**
 * ハブ名と別名（三条 → 三条京阪）でローカル JSON を引き、found なら最も遅いもの。
 * noTrainNeeded > needsTransfer > unknownStation の優先で「見つからなかった理由」を返す。
 */
function localLookup(deps: ResolveDeps, hub: Hub, home: string, dayType: DayType): LocalLastTrain {
  let best: (LocalLastTrain & { kind: "found" }) | null = null;
  let fallback: LocalLastTrain = { kind: "unknownStation" };
  for (const name of hubNames(hub)) {
    const r = lastTrainBetween(deps.lines, deps.lastTrains, name, home, dayType);
    if (r.kind === "found") {
      if (best === null || toMin(r.time) > toMin(best.time)) best = r;
    } else if (r.kind === "noTrainNeeded") {
      return r;
    } else if (r.kind === "needsTransfer") {
      fallback = r;
    }
  }
  return best ?? fallback;
}

// ---- 本体

export async function resolveLastTrain(
  hub: Hub,
  home: string,
  dayType: DayType,
  deps: ResolveDeps = defaultDeps,
): Promise<Resolved> {
  try {
    const homeName = home.trim();

    // 1. ローカル JSON（乗換なし）
    const local = localLookup(deps, hub, homeName, dayType);
    if (local.kind === "found") {
      return { kind: "found", time: local.time, via: "local", transferCount: 0, headsign: local.headsign };
    }
    if (local.kind === "noTrainNeeded") return { kind: "noTrainNeeded" };
    if (!homeName) return { kind: "unavailable", reason: "駅名が空" };
    if (local.kind === "needsTransfer" && hub.subwayOnly) {
      // 両駅とも地下鉄収録・同一路線に無い。地下鉄 feed の経路検索は壊れているので Transit に任せない
      return { kind: "unavailable", reason: `地下鉄同士の乗換は対応予定: ${hub.name}→${homeName}` };
    }

    // 2. キャッシュ
    const date = deps.today();
    const key = cacheKey(hub, homeName, dayType, date);
    const cached = readCache(key);
    if (cached) return cached;

    // 2'. 同じ問い合わせが進行中なら、その結果を待つ（React 開発モードの 2 重実行や並列化で同じキーが重なる）
    const pending = inFlight.get(key);
    if (pending) return await pending;
    const task = (async (): Promise<Resolved> => {
      const interval = deps.minIntervalMs ?? 300;

      // 3. 駅 ID（地下鉄収録駅なら地下鉄の ID を優先。山科 = JR / 地下鉄 / 湖西線）
      //    同じ自宅駅の 7 ハブ分が並列で来るので、進行中の suggest は共有して 1 回にする
      let stationId = stationIdCache.get(homeName) ?? null;
      if (stationId === null) {
        let lookup = suggestInFlight.get(homeName);
        if (!lookup) {
          lookup = (async () => {
            const isSubway = deps.lastTrains.stations.some((s) => s.name === homeName);
            await throttle(interval);
            const id = await deps.suggestStationId(homeName, isSubway ? [SUBWAY_FEED] : []);
            if (id) stationIdCache.set(homeName, id);
            return id;
          })().finally(() => suggestInFlight.delete(homeName));
          suggestInFlight.set(homeName, lookup);
        }
        stationId = await lookup;
      }
      if (!stationId) {
        return remember(key, { kind: "unavailable", reason: `駅IDが見つからない: ${homeName}` });
      }

      // 4. Transit。まず geo:（駅の選択を Transit に任せる）。出発駅がハブ以外にスナップされた経路は planLastArrival 側で弾く
      await throttle(interval);
      const first = toPlanResult(await deps.planLastArrival(hubGeo(hub), stationId, date, hubNames(hub)));
      let journey: TransitJourney | null = first.journey;

      // 4'. geo: が出せなかったらハブの駅 ID を順に試し、最も遅く乗れる便。
      //     ただし「200 で経路 0 件」は目的地側に経路が無いということなので、出発駅を変えても出ない → やり直さない
      //     （出せない駅 1 人につき最大 15 回の無駄な問い合わせを省く。Transit サーバーは 1 秒 2〜3 件しか処理できない）
      if (!journey && first.outcome !== "noJourneys") {
        for (const fromId of hub.stationIds) {
          await throttle(interval);
          const j = toPlanResult(await deps.planLastArrival(fromId, stationId, date, hubNames(hub))).journey;
          if (j && (journey === null || boardingSecs(j) > boardingSecs(journey))) journey = j;
        }
      }
      if (!journey) {
        return remember(key, { kind: "unavailable", reason: `Transitに経路なし: ${hub.name}→${homeName}` });
      }

      // 5. 整形（時刻は最初の乗車区間の発時刻。先頭の徒歩は transferMin が持つ）
      return remember(key, {
        kind: "found",
        time: secsToHHMM(boardingSecs(journey)),
        via: "transit",
        transferCount: journey.transferCount,
        headsign: firstHeadsign(journey),
      });
    })();
    inFlight.set(key, task);
    try {
      return await task;
    } finally {
      inFlight.delete(key);
    }
  } catch (e) {
    // 6. 何が起きても Resolved を返す
    return { kind: "unavailable", reason: e instanceof Error ? e.message : String(e) };
  }
}

/** deps.planLastArrival の互換形（TransitJourney | null）を PlanResult に揃える。null は「やり直す価値あり」扱い */
function toPlanResult(r: PlanResult | TransitJourney | null): PlanResult {
  if (r === null) return { journey: null, outcome: "rejected" };
  if ("outcome" in r) return r;
  return { journey: r, outcome: "found" };
}

function remember(key: string, value: Resolved): Resolved {
  writeCache(key, value);
  return value;
}
