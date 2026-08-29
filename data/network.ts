/**
 * 候補地 → ハブ の所要・最終（VENUES）と、デモ用の既定値。
 *
 * - `VENUES[].toHub` は候補地発・各ハブ行きの「所要分（+3 分安全側）」と「最終の発時刻」。
 *   平日ダイヤ。Yahoo!乗換案内の終電検索で実測（2026-08-30 調査、docs/候補地ハブ実測.md）。土休日は同ファイルの表を参照
 *   （平日と差が出るのは 6 セル・各 1 分だけ）。
 * - ハブ → 自宅駅の終電は lib/buildStations.ts（resolveLastTrain）で実データから組む。
 *   ハブの定義は data/hubs.ts。
 */
import type { Venue } from "@/lib/types";

/** { ハブ: [所要分, 候補地発の最終] }。null = 候補地がハブそのもの */
const cells = (table: Record<string, [number, string | null]>): Venue["toHub"] =>
  Object.fromEntries(Object.entries(table).map(([hub, [transitMin, lastDepart]]) => [hub, { transitMin, lastDepart }]));

export const VENUES: Venue[] = [
  { id: "shijo", name: "四条", toHub: cells({ shijo: [0, null], karasumaoike: [5, "23:50"], kawaramachi: [9, "24:28"], sanjo: [27, "23:58"], demachiyanagi: [32, "23:58"], kyoto: [6, "23:57"], shijoomiya: [12, "24:08"] }) },
  { id: "kyoto", name: "京都駅", toHub: cells({ kyoto: [0, null], shijo: [6, "23:47"], karasumaoike: [8, "23:47"], kawaramachi: [20, "23:47"], sanjo: [26, "23:46"], demachiyanagi: [30, "23:46"], shijoomiya: [23, "23:47"] }) },
  { id: "karasumaoike", name: "烏丸御池", toHub: cells({ karasumaoike: [0, null], shijo: [5, "23:55"], kawaramachi: [26, "23:55"], sanjo: [11, "23:55"], demachiyanagi: [21, "23:55"], kyoto: [8, "23:55"], shijoomiya: [25, "23:55"] }) },
  { id: "sanjo", name: "三条", toHub: cells({ sanjo: [0, null], karasumaoike: [11, "23:44"], shijo: [22, "23:46"], kawaramachi: [11, "24:10"], demachiyanagi: [7, "24:23"], kyoto: [26, "23:46"], shijoomiya: [24, "23:46"] }) },
  { id: "demachiyanagi", name: "出町柳", toHub: cells({ demachiyanagi: [0, null], sanjo: [7, "24:06"], karasumaoike: [18, "23:37"], shijo: [26, "23:42"], kawaramachi: [15, "24:06"], kyoto: [30, "23:42"], shijoomiya: [28, "23:42"] }) },
  { id: "kitaoji", name: "北大路", toHub: cells({ shijo: [15, "23:45"], karasumaoike: [10, "23:45"], demachiyanagi: [53, "23:23"], sanjo: [43, "23:23"], kawaramachi: [37, "23:45"], kyoto: [18, "23:45"], shijoomiya: [35, "23:45"] }) },
  { id: "yamashina", name: "山科", toHub: cells({ karasumaoike: [14, "23:41"], kyoto: [8, "24:07"], sanjo: [16, "23:41"], shijo: [19, "23:34"], kawaramachi: [31, "23:41"], demachiyanagi: [24, "23:41"], shijoomiya: [36, "23:34"] }) },
  { id: "katsura", name: "桂", toHub: cells({ kawaramachi: [13, "24:24"], shijo: [15, "24:24"], karasumaoike: [21, "23:34"], kyoto: [44, "24:02"], sanjo: [32, "23:53"], demachiyanagi: [37, "23:53"], shijoomiya: [13, "24:24"] }) },
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
