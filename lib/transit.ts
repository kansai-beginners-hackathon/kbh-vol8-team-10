/**
 * Transit API（https://api.transit.ls8h.com）クライアント。
 *
 * 使うのは 2 本だけ:
 *  - locations/suggest : 駅名 → 駅 ID
 *  - plan              : ハブ(geo:) → 自宅駅 の終電。type=arrival&time=26:00 で聞く（type=last は使わない。ガイド 6-3）
 *
 * 方針:
 *  - HTTP エラー・JSON 解釈失敗・ネットワーク断は throw せず null を返す（呼び出し側が unavailable に畳む）
 *  - fetcher は差し替え可能（テストでは保存済みレスポンスを返す偽 fetch を渡す）
 *  - User-Agent は付けない（ブラウザから叩く前提。Node の fetch もそのまま通る）
 *  - 時刻は「サービス日 0:00 からの秒数」。86400 超は翌日扱いで、24 時台のまま扱う（% 24 しない）
 */

export const TRANSIT_BASE = "https://api.transit.ls8h.com/api/v1";

export type Fetcher = (url: string) => Promise<Response>;

/** plan の journeys[] / legs[] のうち使う部分だけ */
export interface TransitPlace {
  id?: string;
  name?: string;
}

export interface TransitLeg {
  kind: "transit" | "walk";
  headsign?: string;
  routeName?: string;
  trainType?: string;
  mode?: string;
  tripId?: string;
  from?: TransitPlace;
  to?: TransitPlace;
  departureSecs: number;
  arrivalSecs: number;
}

export interface TransitJourney {
  departureSecs: number;
  arrivalSecs: number;
  transferCount: number;
  legs: TransitLeg[];
}

interface SuggestStation {
  id: string;
  name: string;
  kind?: string;
}

/** 86280 → "23:58"、89100 → "24:45"、104400 → "29:00"（24 時台以降もそのまま。00:00 に丸めない） */
export function secsToHHMM(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 明らかにおかしい経路を弾く（ガイド 8 章）。
 *  - 翌朝着（27:00 以降に着く）: 一晩待つ経路
 *  - 20 時前発: 近鉄の 17:51 のような異常
 *  - 区間の間に 60 分超の待ち: 5 時間待ちで翌朝始発に接続する経路
 */
export function isSane(journey: TransitJourney | null | undefined): boolean {
  if (!journey) return false;
  if (journey.arrivalSecs > 27 * 3600) return false;
  if (journey.departureSecs < 20 * 3600) return false;
  for (let i = 1; i < journey.legs.length; i++) {
    const wait = journey.legs[i].departureSecs - journey.legs[i - 1].arrivalSecs;
    if (wait > 60 * 60) return false;
  }
  return true;
}

/** 最初の乗車区間（walk は飛ばす）。無ければ null */
export function firstTransitLeg(journey: TransitJourney): TransitLeg | null {
  return journey.legs.find((l) => l.kind === "transit") ?? null;
}

/** 最初の乗車区間の行き先。無い feed（地下鉄・叡電など）は null */
export function firstHeadsign(journey: TransitJourney): string | null {
  return firstTransitLeg(journey)?.headsign ?? null;
}

/**
 * 最初の乗車区間の発時刻（秒）。journey.departureSecs は先頭に徒歩 leg があると徒歩開始時刻になるので、
 * 「ハブ発の列車時刻」にはこちらを使う（徒歩分は Hub.transferMin が持つ）。乗車区間が無ければ journey の値。
 */
export function boardingSecs(journey: TransitJourney): number {
  return firstTransitLeg(journey)?.departureSecs ?? journey.departureSecs;
}

/**
 * 最初の乗車区間の出発駅が originNames のどれかか。
 * geo: で出発地を渡すと Transit が近くの別の駅にスナップすることがある
 * （geo:四条 → 烏丸御池発の東西線。四条→烏丸御池 の 1 駅が消えて時刻が嘘になる）。それを弾くためのチェック。
 * originNames が空なら常に true。
 */
export function startsAt(journey: TransitJourney, originNames: readonly string[]): boolean {
  if (originNames.length === 0) return true;
  const name = firstTransitLeg(journey)?.from?.name;
  return typeof name === "string" && originNames.includes(name);
}

/** 新幹線の列車名。routeName / trainType / headsign の先頭に付く */
const SHINKANSEN_NAME =
  /^(のぞみ|ひかり|こだま|みずほ|さくら|つばめ|はやぶさ|はやて|やまびこ|なすの|とき|たにがわ|かがやき|はくたか|つるぎ|あさま|こまち|つばさ)/;

/** feed ID（駅 ID / tripId の ":" より前）が新幹線か。tokaido-shinkansen / sanyo-shinkansen など */
export function isShinkansenFeed(id: string | undefined): boolean {
  return typeof id === "string" && id.split(":")[0].includes("shinkansen");
}

/**
 * 新幹線の乗車区間か。「帰りの終電」に新幹線は出さない（京都→姫路 が「23:05 のぞみ95号」になる）。
 * feed ID か列車名のどちらかで判定する
 */
export function isShinkansenLeg(leg: TransitLeg): boolean {
  if (leg.kind !== "transit") return false;
  if (isShinkansenFeed(leg.from?.id) || isShinkansenFeed(leg.to?.id) || isShinkansenFeed(leg.tripId)) return true;
  return [leg.routeName, leg.trainType, leg.headsign].some((t) => typeof t === "string" && SHINKANSEN_NAME.test(t));
}

/** 新幹線を 1 区間でも使う経路か */
export function usesShinkansen(journey: TransitJourney): boolean {
  return journey.legs.some(isShinkansenLeg);
}

const SUBWAY_FEED_ID = "scrape-kyoto-subway";

function isSubwayLeg(leg: TransitLeg): boolean {
  if (leg.kind !== "transit") return false;
  return [leg.from?.id, leg.to?.id, leg.tripId].some((id) => typeof id === "string" && id.split(":")[0] === SUBWAY_FEED_ID);
}

/**
 * 地下鉄の区間を含む乗換あり経路か。
 * 京都市営地下鉄 feed の所要時間は壊れている（四条→京都 5 分が 67 分、ガイド 6-3）ので、
 * 地下鉄で他社線に乗り継ぐ経路は「乗り継げない便を乗り継げる」「乗り継げる便を落とす」の両方が起きる
 * （烏丸御池→桂 が 23:06、四条→中書島 が乗れない 23:55）。乗換なしの地下鉄はローカル JSON が解くので、
 * Transit の地下鉄は使わない。
 */
export function hasSubwayTransfer(journey: TransitJourney): boolean {
  const transit = journey.legs.filter((l) => l.kind === "transit");
  return transit.length >= 2 && transit.some(isSubwayLeg);
}

/**
 * 同名駅が複数事業者にあるときの優先順（feed ID の前方一致）。
 * 京都近郊で使う事業者を先に。新幹線は除外（自宅駅にならない。宛先が新幹線駅だと経路も新幹線になる）。
 * 例: 新大阪 = 御堂筋線 / JR京都線 / 新幹線×2 / おおさか東線 → JR京都線。姫路 = JR山陽線 / 新幹線 / 播但線 → JR山陽線
 */
export const FEED_PRIORITY: readonly string[] = [
  "scrape-kyoto-subway",
  "scrape-keihan",
  "scrape-hankyu",
  "eizan-rail",
  "scrape-randen",
  "kintetsu-",
  "jrwest-tokaido",
  "jrwest-",
  "hanshin-",
  "osakametro-",
];

function feedRank(id: string): number {
  const feed = id.split(":")[0];
  const i = FEED_PRIORITY.findIndex((p) => feed.startsWith(p));
  return i < 0 ? FEED_PRIORITY.length : i;
}

/** fetch を投げずに JSON を取る。失敗はすべて null */
async function getJson(url: string, fetcher: Fetcher): Promise<unknown | null> {
  try {
    const res = await fetcher(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export interface SuggestOptions {
  /**
   * 優先する feed ID（駅 ID の ":" より前）。順に探し、完全一致の駅があればそれを採る。
   * 例: 地下鉄収録駅なら ["scrape-kyoto-subway"]（山科 = JR / 地下鉄 / 湖西線 の 3 件が返る）
   */
  preferFeeds?: readonly string[];
}

/**
 * 駅名 → Transit の駅 ID。
 * suggest は部分一致で同名・類似駅を複数返す（宇治 → 宇治, 宇治山田, ... / 山科 → JR, 地下鉄, 湖西線）ので、
 *  1. kind==="station" だけ残す。新幹線の駅は除く
 *  2. 名前が完全一致するもののうち preferFeeds の feed を優先
 *  3. 完全一致を FEED_PRIORITY（京都近郊の事業者が先）で並べた先頭
 *  4. station の先頭
 * の順で選ぶ。見つからなければ null。
 * 同名駅の事業者違い（出町柳 = 京阪 / 叡電）は乗換ありの目的地なので Transit 側が吸収する。
 */
export async function suggestStationId(
  name: string,
  fetcher: Fetcher = fetch,
  opts: SuggestOptions = {},
): Promise<string | null> {
  const q = name.trim();
  if (!q) return null;
  const url = new URL(`${TRANSIT_BASE}/locations/suggest`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "10");

  const data = (await getJson(url.toString(), fetcher)) as { stations?: SuggestStation[] } | null;
  const stations = (data?.stations ?? []).filter(
    (s) => s && s.kind === "station" && typeof s.id === "string" && !isShinkansenFeed(s.id),
  );
  if (stations.length === 0) return null;

  const exact = stations.filter((s) => s.name === q);
  for (const feed of opts.preferFeeds ?? []) {
    const hit = exact.find((s) => s.id.split(":")[0] === feed);
    if (hit) return hit.id;
  }
  // 完全一致が複数なら FEED_PRIORITY 順（同順位なら suggest の並び = score 順）
  const ranked = [...exact].map((s, i) => ({ s, i })).sort((a, b) => feedRank(a.s.id) - feedRank(b.s.id) || a.i - b.i);
  return (ranked[0]?.s ?? stations[0]).id;
}

export interface PlanOptions {
  /** 最初の乗車区間の出発駅として受け入れる駅名。geo: 出発が別の駅にスナップされた経路を弾く（startsAt） */
  originNames?: readonly string[];
}

/**
 * plan?type=arrival&time=26:00&numItineraries=6 を叩き、
 * isSane（と originNames があれば startsAt）を通った中で最も遅く出発する journey を返す。0 件・エラーは null。
 *
 * @param from  "geo:lat,lon" または駅 ID
 * @param to    駅 ID
 * @param date  "YYYYMMDD"
 */
/**
 * plan の結果の種別。呼び出し側が「別の出発駅でやり直す価値があるか」を判断するのに使う。
 *  - found      : 採用できる経路があった
 *  - noJourneys : サーバーは 200 で答えたが経路が 0 件（この目的地へは出せない。やり直しても出ない）
 *  - rejected   : 経路はあったが isSane / 出発駅チェック / 新幹線・地下鉄乗換の除外で全部弾いた（出発駅を変えれば出るかもしれない）
 *  - error      : HTTP エラー（422 searchWindowTooDense など）・通信失敗・JSON 不正
 */
export type PlanOutcome = "found" | "noJourneys" | "rejected" | "error";

export interface PlanResult {
  journey: TransitJourney | null;
  outcome: PlanOutcome;
}

export async function planLastArrival(
  from: string,
  to: string,
  date: string,
  fetcher: Fetcher = fetch,
  opts: PlanOptions = {},
): Promise<TransitJourney | null> {
  return (await planLastArrivalDetailed(from, to, date, fetcher, opts)).journey;
}

/** planLastArrival と同じ問い合わせをして、結果の種別（PlanOutcome）も返す */
export async function planLastArrivalDetailed(
  from: string,
  to: string,
  date: string,
  fetcher: Fetcher = fetch,
  opts: PlanOptions = {},
): Promise<PlanResult> {
  const url = new URL(`${TRANSIT_BASE}/plan`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("date", date);
  url.searchParams.set("type", "arrival"); // last は使わない（ガイド 6-3）
  url.searchParams.set("time", "26:00"); // 翌 2:00 までに着く便
  url.searchParams.set("numItineraries", "6");

  const data = (await getJson(url.toString(), fetcher)) as { journeys?: unknown } | null;
  if (data === null) return { journey: null, outcome: "error" };
  const journeys = Array.isArray(data.journeys) ? (data.journeys as TransitJourney[]) : [];
  if (journeys.length === 0) return { journey: null, outcome: "noJourneys" };

  let best: TransitJourney | null = null;
  for (const j of journeys) {
    if (!isJourneyShape(j) || !isSane(j)) continue;
    if (!startsAt(j, opts.originNames ?? [])) continue;
    if (usesShinkansen(j)) continue; // 帰りの終電に新幹線は出さない
    if (hasSubwayTransfer(j)) continue; // 地下鉄 feed の所要時間が壊れているので、地下鉄を挟む乗換は信用しない
    if (best === null || boardingSecs(j) > boardingSecs(best)) best = j;
  }
  return best ? { journey: best, outcome: "found" } : { journey: null, outcome: "rejected" };
}

function isJourneyShape(j: unknown): j is TransitJourney {
  if (!j || typeof j !== "object") return false;
  const o = j as Record<string, unknown>;
  return (
    typeof o.departureSecs === "number" &&
    typeof o.arrivalSecs === "number" &&
    typeof o.transferCount === "number" &&
    Array.isArray(o.legs)
  );
}
