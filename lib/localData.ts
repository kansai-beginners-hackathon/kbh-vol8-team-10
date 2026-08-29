/**
 * ローカル終電 JSON を 1 組の LinesData / LastTrainsData に束ねる。
 *
 *   路線の駅順  : subway-lines.json + private-lines.json
 *   駅別の終電  : subway / eizan / arashiden / hankyu / keihan / kintetsu の 6 ファイル
 *
 * lastTrainBetween は駅を名前で 1 件だけ引く（`stations.find(s => s.name === from)`）ので、
 * 複数社に同じ名前の駅がある場合（京都 = 地下鉄 + 近鉄、出町柳 = 叡電 + 京阪、西院 = 嵐電 + 阪急）は
 * ここで 1 つの駅にまとめておかないと、先に来たファイルの路線しか見てもらえない。
 *
 * import した JSON はモジュール間で共有される実体なので、merge は元を書き換えず新しい配列を作る。
 */
import arashidenJson from "../data/arashiden-last-trains.json" with { type: "json" };
import eizanJson from "../data/eizan-last-trains.json" with { type: "json" };
import hankyuJson from "../data/hankyu-last-trains.json" with { type: "json" };
import keihanJson from "../data/keihan-last-trains.json" with { type: "json" };
import kintetsuJson from "../data/kintetsu-last-trains.json" with { type: "json" };
import privateLinesJson from "../data/private-lines.json" with { type: "json" };
import subwayLastTrainsJson from "../data/subway-last-trains.json" with { type: "json" };
import subwayLinesJson from "../data/subway-lines.json" with { type: "json" };
import type { LastTrainsData, LinesData } from "./lastTrain.ts";

const asLines = (j: unknown) => j as unknown as LinesData;
const asLastTrains = (j: unknown) => j as unknown as LastTrainsData;

/** 路線を連結する。lineId が重複したら先勝ち（同じ路線を 2 度数えない） */
export function mergeLines(sources: readonly LinesData[]): LinesData {
  const byId = new Map<string, LinesData["lines"][number]>();
  for (const src of sources) {
    for (const line of src.lines) if (!byId.has(line.lineId)) byId.set(line.lineId, line);
  }
  return { lines: [...byId.values()] };
}

/** 駅を名前でまとめる。同じ駅名の路線は 1 つの stations[].lines に集める（lineId・行き先とも先勝ち） */
export function mergeLastTrains(sources: readonly LastTrainsData[]): LastTrainsData {
  type Station = LastTrainsData["stations"][number];
  /** destinations まで複製する。ここを共有すると push で import 元の JSON を書き換えてしまう */
  const copy = (line: Station["lines"][number]) => ({ ...line, destinations: [...line.destinations] });
  const byName = new Map<string, Station>();
  for (const src of sources) {
    for (const station of src.stations) {
      const merged = byName.get(station.name);
      if (!merged) {
        byName.set(station.name, { ...station, lines: station.lines.map(copy) });
        continue;
      }
      for (const line of station.lines) {
        const same = merged.lines.find((l) => l.lineId === line.lineId);
        if (!same) {
          merged.lines.push(copy(line));
          continue;
        }
        for (const dest of line.destinations) {
          if (!same.destinations.some((d) => d.name === dest.name)) same.destinations.push(dest);
        }
      }
    }
  }
  return { stations: [...byName.values()] };
}

/** 地下鉄 + 私鉄 5 社の路線（駅順・through） */
export const ALL_LINES: LinesData = mergeLines([asLines(subwayLinesJson), asLines(privateLinesJson)]);

/** 地下鉄 + 私鉄 5 社の駅別終電 */
export const ALL_LAST_TRAINS: LastTrainsData = mergeLastTrains([
  asLastTrains(subwayLastTrainsJson),
  asLastTrains(eizanJson),
  asLastTrains(arashidenJson),
  asLastTrains(hankyuJson),
  asLastTrains(keihanJson),
  asLastTrains(kintetsuJson),
]);

const SUBWAY_STATION_NAMES: ReadonlySet<string> = new Set(
  asLastTrains(subwayLastTrainsJson).stations.map((s) => s.name),
);

/**
 * 京都市営地下鉄に載っている駅名か。
 * ALL_LAST_TRAINS ではなく地下鉄ファイルだけを見る（merge 後は私鉄の駅も「収録済み」になるため、
 * 地下鉄 feed を優先する条件や Hub.subwayOnly の判定には使えない）。
 */
export function isSubwayStation(name: string): boolean {
  return SUBWAY_STATION_NAMES.has(name);
}
