/**
 * 候補地 → ハブ の所要・最終（VENUES）と、デモ用の既定値。
 *
 * - `toHub` の「所要分（+3 分安全側）」は手打ち。
 * - 「候補地発・そのハブ行きの最終」は、候補地とハブが同じ路線に乗っていればローカル JSON
 *   （data/*-last-trains.json）から `lastTrainBetween` で導出する（venuesFor）。導出できない
 *   （徒歩接続・乗換が要る）セルだけ手打ちの暫定値を使う。null = 候補地がハブそのもの / 徒歩で行ける（電車の制約なし）。
 * - ハブ → 自宅駅の終電は lib/buildStations.ts（resolveLastTrain）で実データから組む。
 *   ハブの定義は data/hubs.ts。
 */
import type { DayType } from "../lib/lastTrain.ts";
import { lastTrainBetween } from "../lib/lastTrain.ts";
import { ALL_LAST_TRAINS, ALL_LINES } from "../lib/localData.ts";
import { toMin } from "../lib/time.ts";
import type { HubCell, Venue } from "../lib/types.ts";
import { HUB_BY_ID, hubNames } from "./hubs.ts";

/** { ハブ: [所要分, 候補地発の最終（導出できないときの暫定値）] }。null = 候補地がハブそのもの / 徒歩 */
type Seed = Record<string, [number, string | null]>;

interface VenueSeed {
  id: string;
  name: string;
  /** ローカル JSON で候補地として引くときの駅名（ハブ駅なら別名も。三条 = 三条京阪） */
  stations: string[];
  toHub: Seed;
}

const VENUE_SEEDS: VenueSeed[] = [
  { id: "shijo", name: "四条", stations: ["四条", "烏丸"], toHub: { shijo: [0, null], karasumaoike: [5, "23:50"], kawaramachi: [6, "24:32"], sanjo: [12, "23:50"], demachiyanagi: [18, "23:35"], kyoto: [8, "23:57"], shijoomiya: [12, "24:12"] } },
  { id: "kyoto", name: "京都駅", stations: ["京都"], toHub: { kyoto: [0, null], shijo: [7, "23:47"], karasumaoike: [12, "23:47"], kawaramachi: [15, "23:40"], sanjo: [18, "23:35"], demachiyanagi: [26, "23:25"], shijoomiya: [18, "23:35"] } },
  { id: "karasumaoike", name: "烏丸御池", stations: ["烏丸御池"], toHub: { karasumaoike: [0, null], shijo: [5, "23:55"], kawaramachi: [10, "23:55"], sanjo: [9, "23:55"], demachiyanagi: [16, "23:40"], kyoto: [11, "23:55"], shijoomiya: [13, "23:45"] } },
  // 三条 → 京都河原町 は徒歩（四条大橋を渡って 10 分）。電車の制約なし
  { id: "sanjo", name: "三条", stations: ["三条", "三条京阪"], toHub: { sanjo: [0, null], karasumaoike: [8, "23:49"], shijo: [11, "23:52"], kawaramachi: [9, null], demachiyanagi: [8, "24:23"], kyoto: [17, "23:45"], shijoomiya: [17, "23:40"] } },
  // 出町柳 → 京都河原町 は京阪で祇園四条まで行って徒歩。出町柳→祇園四条の最終は 出町柳→三条 と同じ列車
  { id: "demachiyanagi", name: "出町柳", stations: ["出町柳"], toHub: { demachiyanagi: [0, null], sanjo: [8, "23:57"], karasumaoike: [16, "23:45"], shijo: [19, "23:42"], kawaramachi: [17, "23:57"], kyoto: [26, "23:35"], shijoomiya: [25, "23:30"] } },
  { id: "kitaoji", name: "北大路", stations: ["北大路"], toHub: { shijo: [9, "23:50"], karasumaoike: [12, "23:47"], demachiyanagi: [17, "23:40"], sanjo: [20, "23:35"], kawaramachi: [15, "23:45"], kyoto: [18, "23:40"], shijoomiya: [22, "23:32"] } },
  { id: "yamashina", name: "山科", stations: ["山科"], toHub: { karasumaoike: [10, "23:53"], kyoto: [8, "23:55"], sanjo: [16, "23:45"], shijo: [15, "23:45"], kawaramachi: [20, "23:38"], demachiyanagi: [24, "23:30"], shijoomiya: [24, "23:30"] } },
  { id: "katsura", name: "桂", stations: ["桂"], toHub: { kawaramachi: [13, "23:50"], shijo: [20, "23:38"], karasumaoike: [22, "23:35"], kyoto: [22, "23:35"], sanjo: [26, "23:28"], demachiyanagi: [32, "23:20"], shijoomiya: [16, "23:42"] } },
];

/**
 * 候補地 → ハブ の最終をローカル JSON から引く。候補地の駅名 × ハブの駅名（別名含む）で乗換なしに行ける
 * 最も遅い便。同じ路線に無ければ null（呼び出し側が暫定値を使う）。
 */
export function derivedLastDepart(venue: VenueSeed, hubId: string, dayType: DayType): string | null {
  const hub = HUB_BY_ID[hubId];
  if (!hub) return null;
  let best: string | null = null;
  for (const from of venue.stations) {
    for (const to of hubNames(hub)) {
      const r = lastTrainBetween(ALL_LINES, ALL_LAST_TRAINS, from, to, dayType);
      if (r.kind === "found" && (best === null || toMin(r.time) > toMin(best))) best = r.time;
    }
  }
  return best;
}

/** その日のダイヤで組んだ候補地一覧。lastDepart は導出できたものはローカル JSON、それ以外は暫定値 */
export function venuesFor(dayType: DayType): Venue[] {
  return VENUE_SEEDS.map((seed) => {
    const toHub: Partial<Record<string, HubCell>> = {};
    for (const [hubId, [transitMin, fallback]] of Object.entries(seed.toHub)) {
      // null（ハブそのもの / 徒歩）は電車の制約なし。導出しない
      const lastDepart = fallback === null ? null : (derivedLastDepart(seed, hubId, dayType) ?? fallback);
      toHub[hubId] = { transitMin, lastDepart };
    }
    return { id: seed.id, name: seed.name, toHub };
  });
}

/** id / name の参照用（ダイヤに依らない）。順位計算には venuesFor(dayType) を使う */
export const VENUES: Venue[] = venuesFor("weekday");

/** テスト・確認用。どのセルが導出でなく暫定値のままか */
export function undeterminedCells(dayType: DayType): { venue: string; hub: string; fallback: string }[] {
  const out: { venue: string; hub: string; fallback: string }[] = [];
  for (const seed of VENUE_SEEDS) {
    for (const [hubId, [, fallback]] of Object.entries(seed.toHub)) {
      if (fallback !== null && derivedLastDepart(seed, hubId, dayType) === null) out.push({ venue: seed.id, hub: hubId, fallback });
    }
  }
  return out;
}

export const DEFAULT_MEMBERS = [
  { name: "田中", station: "鞍馬" },
  { name: "佐藤", station: "びわ湖浜大津" },
  { name: "鈴木", station: "大阪梅田" },
  { name: "高橋", station: "国際会館" },
  { name: "伊藤", station: "太秦天神川" },
  { name: "渡辺", station: "枚方市" },
];

export const DEFAULT_VENUE_IDS = ["shijo", "kyoto", "karasumaoike", "sanjo", "demachiyanagi"];
