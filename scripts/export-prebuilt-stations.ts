/**
 * デモ／既定メンバーの自宅駅について、ハブ→自宅駅の終電（Station）を実データから解いて
 * data/prebuilt-stations.json に焼く。
 *
 * Planner はこの JSON に入っている駅は Transit を待たずに即表示する（「例を見る」で待たせない）。
 * 入っていない駅だけ従来どおり resolveLastTrain に回る。
 *
 * 実行: node scripts/export-prebuilt-stations.ts
 * （ダイヤ改正や data/*.json の更新後に再実行する）
 */
import { writeFileSync } from "node:fs";
import { DEFAULT_MEMBERS } from "../data/network.ts";
import { buildStations } from "../lib/buildStations.ts";
import type { DayType } from "../lib/lastTrain.ts";
import type { Station } from "../lib/types.ts";

/** LP の「例を見る」リンク（app/page.tsx DEMO_HREF）に入っている駅。4 人とも乗換なし（ローカル時刻表） */
const DEMO_STATIONS = ["鞍馬", "桂", "国際会館", "新田辺"];

const homes = [...new Set([...DEMO_STATIONS, ...DEFAULT_MEMBERS.map((m) => m.station)])];
const members = homes.map((station) => ({ name: station, station }));

const out: { fetchedAt: string; note: string; stations: Record<DayType, Record<string, Station>>; unavailable: Record<DayType, string[]> } = {
  fetchedAt: new Date().toISOString().slice(0, 10),
  note: "scripts/export-prebuilt-stations.ts の出力。Planner はここにある駅は Transit を待たずに使う",
  stations: { weekday: {}, weekend: {} },
  unavailable: { weekday: [], weekend: [] },
};

for (const dayType of ["weekday", "weekend"] as DayType[]) {
  console.log(`[${dayType}] ${homes.join(", ")}`);
  const r = await buildStations(members, dayType, undefined, undefined, (home, station) => {
    console.log(`  ${station ? "ok " : "-- "} ${home}${station ? ` (${station.routes.length} routes)` : ""}`);
  });
  out.stations[dayType] = r.stations;
  // 対応予定は焼かない。焼くと、その駅を後で入力した人が再検索されずに即「対応予定」になる（Transit の一時的な失敗が固定される）
  out.unavailable[dayType] = [];
  const missing = [...new Set(r.unavailable.map((m) => m.station))];
  if (missing.length) console.warn(`  ⚠ 解けなかった駅（焼かない・実行時に再検索される）: ${missing.join(", ")}`);
  const demoMissing = DEMO_STATIONS.filter((s) => missing.includes(s));
  if (demoMissing.length) throw new Error(`デモの駅が解けていない: ${demoMissing.join(", ")}。DEMO_HREF を見直す`);
}

writeFileSync(new URL("../data/prebuilt-stations.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("wrote data/prebuilt-stations.json");
