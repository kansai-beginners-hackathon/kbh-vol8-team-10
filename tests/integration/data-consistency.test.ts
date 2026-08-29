// 実行: npm run test:integration
// 別ファイルに分かれているデータ同士の整合。片方だけ直すと画面が静かに壊れる箇所を固定する。
//   data/hubs.ts ↔ ローカル終電 JSON（ハブ名で引けるか）
//   data/network.ts ↔ data/hubs.ts（候補地の toHub のキー）
//   data/last-train-direct-range.json ↔ data/network.ts（/api/return-home の地点名 = 候補地名）
//   Planner の駅候補（地下鉄 JSON の駅名）
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { HUBS, hubNames } from "../../data/hubs.ts";
import { DEFAULT_MEMBERS, VENUES } from "../../data/network.ts";
import { ALL_LAST_TRAINS, ALL_LINES, isSubwayStation } from "../../lib/localData.ts";
import { isHHMM } from "../../lib/time.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const knownStations = new Set(ALL_LAST_TRAINS.stations.map((s) => s.name));

test("全ハブの name と aliases はローカル終電 JSON に収録済み（ローカル照合が効く）", () => {
  for (const hub of HUBS) {
    for (const name of hubNames(hub)) assert.ok(knownStations.has(name), `${hub.id}: ${name} が未収録`);
  }
});

test("subwayOnly のハブ名は地下鉄駅。それ以外のハブは name か別名のどこかが私鉄側にも乗る", () => {
  for (const hub of HUBS) {
    if (hub.subwayOnly) assert.ok(isSubwayStation(hub.name), hub.name);
  }
  // 三条は京阪（三条）+ 地下鉄（三条京阪）
  assert.equal(isSubwayStation("三条"), false);
  assert.equal(isSubwayStation("三条京阪"), true);
});

test("ハブの stationIds の feed は、ローカル JSON の路線（地下鉄・京阪・阪急・叡電・嵐電・近鉄）か JR", () => {
  const feeds = new Set(HUBS.flatMap((h) => h.stationIds.map((id) => id.split(":")[0])));
  for (const feed of feeds) {
    assert.match(feed, /^(scrape-kyoto-subway|scrape-keihan|scrape-hankyu|scrape-randen|eizan-rail|kintetsu-kyoto-line|jrwest-[a-z-]+)$/, feed);
  }
});

test("候補地の toHub は 7 ハブ全部を持ち、ハブそのものの候補地は id がハブ id と一致", () => {
  const hubIds = HUBS.map((h) => h.id);
  for (const v of VENUES) {
    assert.deepEqual(Object.keys(v.toHub).sort(), [...hubIds].sort(), v.name);
    if (hubIds.includes(v.id)) {
      assert.equal(v.toHub[v.id]?.lastDepart, null, `${v.name} は自分がハブなのに lastDepart が null でない`);
      // 候補地名はハブ名と一致（京都駅 ↔ 京都 だけ表示名が違う）
      const hub = HUBS.find((h) => h.id === v.id)!;
      assert.ok(v.name === hub.name || v.name === `${hub.name}駅`, `${v.name} ≠ ${hub.name}`);
    }
  }
});

test("/api/return-home のデータ（last-train-direct-range.json）の地点名は候補地名と同じ集合", () => {
  const rh = read("data/last-train-direct-range.json") as { targetLocations: string[]; locations: { id: string; name: string; routes: { lastDepart: string; travelMin: number }[] }[] };
  assert.deepEqual(rh.locations.map((l) => l.name).sort(), VENUES.map((v) => v.name).sort());
  assert.deepEqual(rh.targetLocations.sort(), VENUES.map((v) => v.name).sort());
  for (const loc of rh.locations) {
    assert.ok(VENUES.some((v) => v.id === loc.id), `${loc.name} の id ${loc.id} が候補地 id に無い`);
    for (const r of loc.routes) {
      assert.ok(isHHMM(r.lastDepart), `${loc.name}: ${r.lastDepart}`);
      assert.ok(Number.isInteger(r.travelMin) && r.travelMin >= 0);
    }
  }
});

test("Planner の駅候補（地下鉄 JSON の駅名）は 31 駅で重複なし。全部 ALL_LAST_TRAINS にもある", () => {
  const subway = read("data/subway-last-trains.json") as { stations: { name: string }[] };
  const names = subway.stations.map((s) => s.name);
  assert.equal(names.length, 31);
  assert.equal(new Set(names).size, 31);
  for (const n of names) {
    assert.ok(knownStations.has(n), n);
    assert.ok(isSubwayStation(n), n);
  }
});

test("路線の駅順に出てくる駅は、終電 JSON にも収録されている（私鉄の路線外 through 先は除く）", () => {
  for (const line of ALL_LINES.lines) {
    for (const name of line.stations) assert.ok(knownStations.has(name), `${line.lineName}: ${name}`);
  }
});

test("終電 JSON の各駅の lineId は路線定義に存在する", () => {
  const lineIds = new Set(ALL_LINES.lines.map((l) => l.lineId));
  for (const st of ALL_LAST_TRAINS.stations) {
    for (const l of st.lines) assert.ok(lineIds.has(l.lineId), `${st.name}: ${l.lineId}`);
  }
});

test("終電 JSON の時刻は HH:MM か空文字", () => {
  for (const st of ALL_LAST_TRAINS.stations) {
    for (const l of st.lines) {
      for (const d of l.destinations) {
        for (const day of ["weekday", "weekend"] as const) {
          const t = d[day];
          assert.ok(t === "" || isHHMM(t), `${st.name} ${l.lineId} ${d.name} ${day}: ${JSON.stringify(t)}`);
        }
      }
    }
  }
});

test("デモの 6 人のうちローカルで解ける駅は収録済み、そうでない駅は未収録（Transit 行き）", () => {
  const local = DEFAULT_MEMBERS.filter((m) => knownStations.has(m.station)).map((m) => m.station).sort();
  assert.deepEqual(local, ["国際会館", "太秦天神川", "鞍馬"].sort());
});
