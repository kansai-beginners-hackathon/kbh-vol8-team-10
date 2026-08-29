/**
 * ハブ駅（支線へ乗り換える駅）7 つ。
 *
 * 座標は Transit API `locations/suggest` の lat/lon（2026-08-29 取得）。
 * ハブは複数事業者の駅の集合（出町柳 = 京阪 + 叡電）なので、Transit には
 * `geo:lat,lon` で渡して駅の選択を API に任せる。
 * transferMin は data/network.ts の STATIONS[].routes[].transferMin から移した手打ち値。
 */
export interface Hub {
  /** data/network.ts の HUBS のキーと同じ */
  id: string;
  /** 表示名。lib/lastTrain.ts の駅名とも一致させる（ローカル JSON の照合に使う） */
  name: string;
  lat: number;
  lon: number;
  /** ハブ到着 → 支線乗車までの乗換分 */
  transferMin: number;
  /**
   * Transit がこのハブの geo: を駅にスナップしたとき、出発駅名として受け入れる別名。
   * name 以外に「同じ場所の別事業者の駅名」を並べる（三条 ↔ 三条京阪、四条 ↔ 阪急烏丸）。
   * 最初の乗車区間の from.name がここに無ければ「別の駅から出発させられた」とみなして採用しない
   * （例: geo:四条 → 烏丸御池発の東西線を返してくる）。
   * ローカル JSON の照合にもこの名前で試す（三条 → 三条京阪 で東西線が引ける）。
   */
  aliases: string[];
  /**
   * このハブを構成する Transit の駅 ID（locations/suggest で取得。2026-08-29）。
   * `geo:` 出発が失敗したとき（422 searchWindowTooDense: geo:四条 → 桂 など。近くに駅が密集していると起きる）に
   * from をこの ID に差し替えて順に試す。新幹線は除く。
   */
  stationIds: string[];
  /**
   * 地下鉄しか無いハブ。ローカル JSON で needsTransfer（両駅とも地下鉄収録・同一路線に無い）になったら
   * Transit に回さず「対応予定」にする（地下鉄 feed の経路検索は壊れている。ガイド 6-3）。
   */
  subwayOnly?: boolean;
}

export const HUBS: Hub[] = [
  // 京阪(35.029914,135.772542) と叡電(35.030920,135.773545) の中点
  {
    id: "demachiyanagi", name: "出町柳", lat: 35.030417, lon: 135.773044, transferMin: 5, aliases: [],
    stationIds: ["scrape-keihan:京阪電気鉄道-鴨東線-出町柳", "eizan-rail:叡山電鉄-叡山本線-出町柳"],
  },
  // 京阪三条（地下鉄東西線は「三条京阪」）
  {
    id: "sanjo", name: "三条", lat: 35.00879, lon: 135.772337, transferMin: 5, aliases: ["三条京阪"],
    stationIds: ["scrape-keihan:京阪電気鉄道-京阪本線-三条", "scrape-kyoto-subway:京都市-東西線-三条京阪"],
  },
  // 阪急
  {
    id: "kawaramachi", name: "京都河原町", lat: 35.00378, lon: 135.76868, transferMin: 3, aliases: [],
    stationIds: ["scrape-hankyu:阪急電鉄-京都線-京都河原町"],
  },
  // 地下鉄（烏丸線・東西線）
  {
    id: "karasumaoike", name: "烏丸御池", lat: 35.00999, lon: 135.75963, transferMin: 3, aliases: [], subwayOnly: true,
    stationIds: ["scrape-kyoto-subway:京都市-烏丸線-烏丸御池"],
  },
  // 地下鉄（阪急は「烏丸」）
  {
    id: "shijo", name: "四条", lat: 35.00275, lon: 135.759673, transferMin: 3, aliases: ["烏丸"], subwayOnly: true,
    stationIds: ["scrape-hankyu:阪急電鉄-京都線-烏丸", "scrape-kyoto-subway:京都市-烏丸線-四条"],
  },
  // JR（地下鉄・近鉄も「京都」、100m 以内）
  {
    id: "kyoto", name: "京都", lat: 34.985729, lon: 135.758523, transferMin: 8, aliases: [],
    stationIds: [
      "jrwest-tokaido:jrwest-tokaido.station.JR西日本-東海道線-京都",
      "jrwest-sanin-east:jrwest-sanin-east.station.JR西日本-山陰線-京都",
      "jrwest-kosei:jrwest-kosei.station.JR西日本-湖西線-京都",
      "kintetsu-kyoto-line:近畿日本鉄道-京都線-京都",
      "scrape-kyoto-subway:京都市-烏丸線-京都",
    ],
  },
  // 嵐電（阪急は「大宮」）
  {
    id: "shijoomiya", name: "四条大宮", lat: 35.003247, lon: 135.748455, transferMin: 5, aliases: ["大宮"],
    stationIds: ["scrape-randen:京福電気鉄道-嵐山本線-四条大宮", "scrape-hankyu:阪急電鉄-京都線-大宮"],
  },
];

export const HUB_BY_ID: Record<string, Hub> = Object.fromEntries(HUBS.map((h) => [h.id, h]));

/** ハブとして受け入れる駅名（name + aliases） */
export function hubNames(hub: Hub): string[] {
  return [hub.name, ...hub.aliases];
}

/** Transit API の from に渡す形。"geo:35.00879,135.772337" */
export function hubGeo(hub: Hub): string {
  return `geo:${hub.lat},${hub.lon}`;
}
