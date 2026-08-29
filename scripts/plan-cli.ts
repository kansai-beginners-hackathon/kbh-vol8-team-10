// アプリと同じ計算（Planner.tsx の rankVenues 呼び出しを Node で再現）
import { buildStations } from "../lib/buildStations.ts";
import { rankVenues } from "../lib/calc.ts";
import { toStr } from "../lib/time.ts";
import { VENUES } from "../data/network.ts";
import type { Member } from "../lib/types.ts";
import type { DayType } from "../lib/lastTrain.ts";

export async function plan(members: Member[], venueIds: string[], dayType: DayType, walk: number) {
  const { stations, unavailable } = await buildStations(members, dayType);
  const ready = members.filter((m) => stations[m.station]);
  const ranking = rankVenues(VENUES.filter((v) => venueIds.includes(v.id)), ready, stations, walk);
  return { ranking, unavailable, stations, ready };
}

export const fmt = (min: number) => (Number.isFinite(min) ? toStr(min) : "—");

if (process.argv[2]) {
  const [mRaw, vRaw, dRaw, wRaw] = process.argv.slice(2);
  const members: Member[] = mRaw.split(",").map((t) => {
    const [a, b] = t.split(":");
    return b ? { name: a, station: b } : { name: a, station: a };
  });
  const venueIds = vRaw === "all" ? VENUES.map((v) => v.id) : vRaw.split(",");
  const r = await plan(members, venueIds, dRaw as DayType, Number(wRaw ?? 0));
  console.log(`ダイヤ: ${dRaw} / 徒歩: ${wRaw ?? 0} 分 / メンバー: ${members.map((m) => m.station).join("・")}`);
  if (r.unavailable.length) console.log(`対応予定: ${r.unavailable.map((m) => m.station).join("・")}`);
  r.ranking.forEach((res, i) => {
    if (res.ok) {
      console.log(`${i + 1}. ${res.venue.name.padEnd(5)} 解散 ${fmt(res.dissolve)}  最初に詰む人: ${res.bottleneck.station}`);
      console.log(`     ${res.rows.map((row) => `${row.member.station} ${fmt(row.leave)}`).join(" / ")}`);
    } else {
      console.log(`${i + 1}. ${res.venue.name.padEnd(5)} ❌ 帰れない（${res.deadMember.station}）`);
    }
  });
}
