/**
 * ⚠️ モック用のダミーデータ。実際の時刻表とは一致しない。
 *
 * 本番では
 *  - 地下鉄: data/subway-last-trains.json（京都市交通局・取得済み）
 *  - 私鉄:   ハブ駅 9 個 × 平日/休日の時刻表を人が転記
 *  - 候補地→ハブ: Yahoo!乗換案内の終電検索 54 セル
 * に置き換える。構造（型）はそのまま使える。
 */
import type { Station, Venue } from "@/lib/types";

export const HUBS: Record<string, string> = {
  demachiyanagi: "出町柳",
  sanjo: "三条",
  kawaramachi: "京都河原町",
  karasumaoike: "烏丸御池",
  shijo: "四条",
  kyoto: "京都",
  shijoomiya: "四条大宮",
};

const s = (name: string, taxiKm: number, routes: Station["routes"]): Station => ({ name, taxiKm, routes });

export const STATIONS: Record<string, Station> = Object.fromEntries(
  [
    s("鞍馬", 17, [{ hub: "demachiyanagi", transferMin: 5, last: "22:30", posted: "23:50", postedTo: "修学院" }]),
    s("八瀬比叡山口", 11, [{ hub: "demachiyanagi", transferMin: 5, last: "23:02", posted: "23:50", postedTo: "修学院" }]),
    s("市原", 13, [{ hub: "demachiyanagi", transferMin: 5, last: "23:15", posted: "23:50", postedTo: "修学院" }]),
    s("宝ヶ池", 7, [{ hub: "demachiyanagi", transferMin: 5, last: "23:30", posted: "23:50", postedTo: "修学院" }]),
    s("大阪梅田", 45, [
      { hub: "kawaramachi", transferMin: 3, last: "23:15", posted: "23:50", postedTo: "正雀" },
      { hub: "kyoto", transferMin: 8, last: "23:58", posted: "23:58", postedTo: "大阪" },
    ]),
    s("桂", 9, [{ hub: "kawaramachi", transferMin: 3, last: "23:40", posted: "23:50", postedTo: "正雀" }]),
    s("長岡天神", 14, [{ hub: "kawaramachi", transferMin: 3, last: "23:28", posted: "23:50", postedTo: "正雀" }]),
    s("びわ湖浜大津", 13, [{ hub: "karasumaoike", transferMin: 3, last: "23:12", posted: "23:55", postedTo: "六地蔵" }]),
    s("太秦天神川", 6, [{ hub: "karasumaoike", transferMin: 3, last: "23:50", posted: "23:55", postedTo: "六地蔵" }]),
    s("山科", 7, [
      { hub: "karasumaoike", transferMin: 3, last: "23:47", posted: "23:55", postedTo: "六地蔵" },
      { hub: "kyoto", transferMin: 8, last: "23:52", posted: "23:52", postedTo: "米原" },
    ]),
    s("国際会館", 9, [{ hub: "shijo", transferMin: 3, last: "23:47", posted: "23:59", postedTo: "竹田" }]),
    s("北大路", 4, [{ hub: "shijo", transferMin: 3, last: "23:54", posted: "23:59", postedTo: "竹田" }]),
    s("竹田", 7, [
      { hub: "shijo", transferMin: 3, last: "23:59", posted: "23:59", postedTo: "竹田" },
      { hub: "kyoto", transferMin: 8, last: "23:40", posted: "23:40", postedTo: "奈良" },
    ]),
    s("枚方市", 30, [{ hub: "sanjo", transferMin: 5, last: "23:47", posted: "24:05", postedTo: "樟葉" }]),
    s("中書島", 9, [{ hub: "sanjo", transferMin: 5, last: "23:58", posted: "24:05", postedTo: "樟葉" }]),
    s("嵐山", 13, [{ hub: "shijoomiya", transferMin: 5, last: "23:10", posted: "23:30", postedTo: "帷子ノ辻" }]),
    s("亀岡", 22, [{ hub: "kyoto", transferMin: 8, last: "23:11", posted: "23:58", postedTo: "高槻" }]),
    s("草津", 30, [{ hub: "kyoto", transferMin: 8, last: "23:34", posted: "24:00", postedTo: "野洲" }]),
  ].map((station) => [station.name, station]),
);

export const STATION_NAMES = Object.keys(STATIONS);

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
