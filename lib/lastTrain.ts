/**
 * 乗換なしで帰れる最終列車を、ローカル JSON から導出する。
 *
 * 持っているデータは「駅 × 路線 × 行き先 → その行き先への最終時刻」だけで、
 * 駅間ペアの時刻は持たない。「帰る駅を *通る* 行き先」を路線の駅順から判定し、
 * その中で最も遅い便を返す（要件定義 §5「◯◯を通る便」の考え方）。
 *
 * 結果は理由付き（kind）で返す。
 *  - found          : 乗換なしで帰れる最終が見つかった
 *  - noTrainNeeded  : 出発駅 = 帰る駅。電車が要らないので終電の制約から外す（Transit は呼ばない）
 *  - needsTransfer  : 両駅とも収録済みだが同じ路線に無い → 呼び出し側が Transit API に回す
 *  - unknownStation : どちらかが未収録（私鉄など）→ 呼び出し側が Transit API に回す
 * Transit でも出ないものは、現段階では「対応予定」として扱う。
 *
 * 純粋関数。JSON は引数で受け取る（node --test で読み込んで渡せる／
 * 将来、私鉄の同じ形の JSON をそのまま渡せる）。
 */
import { toMin } from "./time.ts";

export type DayType = "weekday" | "weekend";

/** data/subway-lines.json の 1 路線。stations の配列順が駅の並び順 */
export interface Line {
  lineId: string;
  lineName: string;
  stations: string[];
  /** 路線外の行き先 → この路線上ではどの駅まで通るか（例: びわ湖浜大津 → 御陵） */
  through?: Record<string, string>;
}

export interface LinesData {
  lines: Line[];
}

/** data/subway-last-trains.json のうち、この関数が使う部分 */
export interface LastTrainsData {
  stations: {
    name: string;
    lines: {
      lineId: string;
      destinations: { name: string; weekday: string; weekend: string }[];
    }[];
  }[];
}

export interface LastTrain {
  /** "23:50" / "24:01"（24 時台はそのまま。lib/time.ts の toMin で比較する） */
  time: string;
  /** 行き先（掲示板の表示名） */
  headsign: string;
  lineName: string;
}

export type LocalLastTrain =
  | ({ kind: "found" } & LastTrain)
  | { kind: "noTrainNeeded" }
  | { kind: "needsTransfer" }
  | { kind: "unknownStation" };

/**
 * from から to へ乗換なしで行ける最終列車。
 */
export function lastTrainBetween(
  lines: LinesData,
  lastTrains: LastTrainsData,
  from: string,
  to: string,
  dayType: DayType,
): LocalLastTrain {
  if (from === to) return { kind: "noTrainNeeded" };

  const known = (name: string) => lastTrains.stations.some((s) => s.name === name);
  if (!known(from) || !known(to)) return { kind: "unknownStation" };
  const fromStation = lastTrains.stations.find((s) => s.name === from)!;

  let best: LastTrain | null = null;

  for (const line of lines.lines) {
    const i = line.stations.indexOf(from);
    const j = line.stations.indexOf(to);
    if (i < 0 || j < 0) continue; // この路線に両駅が乗っていない

    const timetable = fromStation.lines.find((l) => l.lineId === line.lineId);
    if (!timetable) continue; // 駅順にはあるが時刻データが無い

    for (const dest of timetable.destinations) {
      const end = reachIndex(line, dest.name);
      if (end === null) continue; // 路線外で through にも無い行き先 → 判定不能なので候補にしない
      if (!passes(i, j, end)) continue;

      const time = dest[dayType];
      if (!time) continue;
      if (best === null || toMin(time) > toMin(best.time)) {
        best = { time, headsign: dest.name, lineName: line.lineName };
      }
    }
  }

  return best ? { kind: "found", ...best } : { kind: "needsTransfer" };
}

/** 行き先 name の便が、この路線上で最後に通る駅の index。判定不能なら null */
function reachIndex(line: Line, name: string): number | null {
  const direct = line.stations.indexOf(name);
  if (direct >= 0) return direct;
  const via = line.through?.[name];
  if (via === undefined) return null;
  const idx = line.stations.indexOf(via);
  return idx >= 0 ? idx : null;
}

/** from(i) を出て end まで走る便が to(j) に停まるか。end は含む、from は含まない */
function passes(i: number, j: number, end: number): boolean {
  if (end > i) return j > i && j <= end;
  if (end < i) return j < i && j >= end;
  return false; // end === i: 自駅止まり
}
