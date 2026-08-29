/**
 * 候補地 → ハブ の所要・最終（VENUES）と、デモ用の既定値。
 *
 * - `VENUES[].toHub` は候補地発・各ハブ行きの「所要分（+3 分安全側）」と「最終の発時刻」。
 *   ⚠️ まだ手打ちの暫定値。Yahoo!乗換案内の終電検索で実測値に置き換える予定（別メンバー担当）。
 * - ハブ → 自宅駅の終電は lib/buildStations.ts（resolveLastTrain）で実データから組む。
 *   ハブの定義は data/hubs.ts。
 */
import type { Venue } from "@/lib/types";

/** { ハブ: [所要分, 候補地発の最終] }。null = 候補地がハブそのもの */
const cells = (table: Record<string, [number, string | null]>): Venue["toHub"] =>
  Object.fromEntries(Object.entries(table).map(([hub, [transitMin, lastDepart]]) => [hub, { transitMin, lastDepart }]));

export const VENUES: Venue[] = [
  { id: "shijo", name: "四条", toHub: cells({ shijo: [0, null], karasumaoike: [5, "23:55"], kawaramachi: [6, "24:10"], sanjo: [12, "23:50"], demachiyanagi: [18, "23:35"], kyoto: [8, "23:47"], shijoomiya: [12, "23:50"] }) },
  { id: "kyoto", name: "京都駅", toHub: cells({ kyoto: [0, null], shijo: [7, "23:47"], karasumaoike: [12, "23:47"], kawaramachi: [15, "23:40"], sanjo: [18, "23:35"], demachiyanagi: [26, "23:25"], shijoomiya: [18, "23:35"] }) },
  { id: "karasumaoike", name: "烏丸御池", toHub: cells({ karasumaoike: [0, null], shijo: [5, "24:00"], kawaramachi: [10, "23:55"], sanjo: [9, "23:50"], demachiyanagi: [16, "23:40"], kyoto: [11, "23:50"], shijoomiya: [13, "23:45"] }) },
  { id: "sanjo", name: "三条", toHub: cells({ sanjo: [0, null], karasumaoike: [8, "23:55"], shijo: [11, "23:52"], kawaramachi: [9, "23:55"], demachiyanagi: [8, "23:52"], kyoto: [17, "23:45"], shijoomiya: [17, "23:40"] }) },
  { id: "demachiyanagi", name: "出町柳", toHub: cells({ demachiyanagi: [0, null], sanjo: [8, "23:55"], karasumaoike: [16, "23:45"], shijo: [19, "23:42"], kawaramachi: [17, "23:45"], kyoto: [26, "23:35"], shijoomiya: [25, "23:30"] }) },
  { id: "kitaoji", name: "北大路", toHub: cells({ shijo: [9, "23:50"], karasumaoike: [12, "23:47"], demachiyanagi: [17, "23:40"], sanjo: [20, "23:35"], kawaramachi: [15, "23:45"], kyoto: [18, "23:40"], shijoomiya: [22, "23:32"] }) },
  { id: "yamashina", name: "山科", toHub: cells({ karasumaoike: [10, "23:53"], kyoto: [8, "23:55"], sanjo: [16, "23:45"], shijo: [15, "23:45"], kawaramachi: [20, "23:38"], demachiyanagi: [24, "23:30"], shijoomiya: [24, "23:30"] }) },
  { id: "katsura", name: "桂", toHub: cells({ kawaramachi: [13, "23:50"], shijo: [20, "23:38"], karasumaoike: [22, "23:35"], kyoto: [22, "23:35"], sanjo: [26, "23:28"], demachiyanagi: [32, "23:20"], shijoomiya: [16, "23:42"] }) },
];

export const DEFAULT_MEMBERS = [
  { name: "田中", station: "鞍馬" },
  { name: "佐藤", station: "びわ湖浜大津" },
  { name: "鈴木", station: "大阪梅田" },
  { name: "高橋", station: "国際会館" },
  { name: "伊藤", station: "太秦天神川" },
  { name: "渡辺", station: "枚方市" },
];

export const DEFAULT_VENUE_IDS = ["shijo", "kyoto", "karasumaoike", "sanjo", "demachiyanagi"];
