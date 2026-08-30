// 実行: npm run test:integration
// 画面（Planner）が呼ぶのと同じ流れを、React 抜きで通す:
//   members → buildStations(resolveLastTrain × ローカル JSON) → rankVenues(VENUES) → 結果
// Transit はオフライン（駅 ID 見つからず）に固定し、ローカルで解ける駅だけで順位が決まることを確かめる。
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { HUBS } from "../../data/hubs.ts";
import { DEFAULT_MEMBERS, DEFAULT_VENUE_IDS, venuesFor } from "../../data/network.ts";
import { buildStations, type Resolver } from "../../lib/buildStations.ts";
import { bestRoute, rankVenues } from "../../lib/calc.ts";
import { ALL_LAST_TRAINS, ALL_LINES } from "../../lib/localData.ts";
import { clearResolveCache, resolveLastTrain, type ResolveDeps } from "../../lib/resolveLastTrain.ts";
import { toMin, toStr } from "../../lib/time.ts";
import type { Member, VenueResult } from "../../lib/types.ts";

const offline: ResolveDeps = {
  lines: ALL_LINES,
  lastTrains: ALL_LAST_TRAINS,
  planLastArrival: async () => ({ journey: null, outcome: "noJourneys" as const }),
  suggestStationId: async () => null,
  dateFor: () => "20260829",
  minIntervalMs: 0,
};
const resolver: Resolver = (hub, home, dayType) => resolveLastTrain(hub, home, dayType, offline);
// Planner と同じく、その日のダイヤで組んだ候補地（候補地→ハブの最終もローカル JSON から導出）
const venues = venuesFor("weekday").filter((v) => DEFAULT_VENUE_IDS.includes(v.id));

const 田中: Member = { name: "田中", station: "鞍馬" };
const 高橋: Member = { name: "高橋", station: "国際会館" };
const 伊藤: Member = { name: "伊藤", station: "太秦天神川" };
const 山科: Member = { name: "山科さん", station: "山科" };
const 鈴木: Member = { name: "鈴木", station: "大阪梅田" }; // ローカル未収録 → Transit → オフラインで対応予定

beforeEach(() => clearResolveCache());

test("ローカルで解ける 4 人: 全員 stations に入り、経路はすべて via local", async () => {
  const r = await buildStations([田中, 高橋, 伊藤, 山科], "weekday", resolver);
  assert.deepEqual(Object.keys(r.stations).sort(), ["国際会館", "太秦天神川", "山科", "鞍馬"].sort());
  assert.deepEqual(r.unavailable, []);
  for (const st of Object.values(r.stations)) {
    assert.ok(st.routes.length >= 1, st.name);
    for (const route of st.routes) {
      assert.equal(route.via, "local");
      assert.equal(route.transferCount, 0);
      assert.ok(HUBS.some((h) => h.id === route.hub));
    }
  }
});

test("鞍馬は出町柳経由の 1 経路だけ（他ハブは Transit 頼み → オフラインで落ちる）", async () => {
  const r = await buildStations([田中], "weekday", resolver);
  assert.deepEqual(r.stations["鞍馬"].routes, [{ hub: "demachiyanagi", transferMin: 5, last: "22:30", via: "local", transferCount: 0 }]);
});

test("国際会館は地下鉄ハブ 3 つ（四条・烏丸御池・京都）から帰れる", async () => {
  const r = await buildStations([高橋], "weekday", resolver);
  assert.deepEqual(r.stations["国際会館"].routes.map((x) => [x.hub, x.last]).sort(), [
    ["karasumaoike", "23:55"],
    ["kyoto", "23:47"],
    ["shijo", "23:50"],
  ]);
});

test("順位: 田中（鞍馬）がボトルネック。出町柳 22:20 > 四条 22:02（徒歩 5 分）", async () => {
  const { stations } = await buildStations([田中, 高橋], "weekday", resolver);
  const ranking = rankVenues(venues, [田中, 高橋], stations, 5);
  assert.equal(ranking.length, venues.length);
  assert.ok(ranking.every((x) => x.ok), "全候補地で全員帰れる");

  const top = ranking[0];
  assert.equal(top.venue.id, "demachiyanagi");
  // 出町柳: 鞍馬行き 22:30 − 乗換 5 − 徒歩 5 = 22:20
  assert.equal(top.ok && toStr(top.dissolve), "22:20");
  assert.equal(top.ok && top.bottleneck.name, "田中");

  const shijo = ranking.find((x) => x.venue.id === "shijo")!;
  // 四条 → 出町柳 18 分: 22:30 − 18 − 5 − 5 = 22:02
  assert.equal(shijo.ok && toStr(shijo.dissolve), "22:02");

  // 降順に並ぶ
  for (let i = 1; i < ranking.length; i++) {
    const a: VenueResult = ranking[i - 1];
    const b: VenueResult = ranking[i];
    assert.ok(a.ok && b.ok && a.dissolve >= b.dissolve);
  }
});

test("順位の内部整合: dissolve は rows の最小、rows は昇順、bottleneck は rows[0]", async () => {
  const members = [田中, 高橋, 伊藤, 山科];
  const { stations } = await buildStations(members, "weekday", resolver);
  for (const r of rankVenues(venues, members, stations, 5)) {
    assert.ok(r.ok, r.venue.name);
    if (!r.ok) continue;
    assert.equal(r.rows.length, members.length);
    assert.equal(r.dissolve, Math.min(...r.rows.map((x) => x.leave)));
    assert.equal(r.bottleneck, r.rows[0].member);
    for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i - 1].leave <= r.rows[i].leave);
    // 各人の leave は bestRoute の値 − 徒歩
    for (const row of r.rows) {
      const best = bestRoute(stations[row.member.station], r.venue);
      assert.ok(best);
      assert.equal(row.leave, Math.floor(best.value - 5));
    }
  }
});

test("対応予定の人（大阪梅田）は unavailable に入り、順位からは外して計算する", async () => {
  const members = [田中, 鈴木];
  const r = await buildStations(members, "weekday", resolver);
  assert.deepEqual(r.unavailable, [鈴木]);
  assert.deepEqual(Object.keys(r.stations), ["鞍馬"]);

  // Planner と同じく、stations に無い人は順位に入れない
  const ranked = members.filter((m) => r.stations[m.station]);
  const ranking = rankVenues(venues, ranked, r.stations, 5);
  assert.ok(ranking.every((x) => x.ok));
  assert.equal(ranking[0].ok && ranking[0].bottleneck.name, "田中");

  // 外さずに入れると全候補地が ❌ になる（外す理由）
  const wrong = rankVenues(venues, members, r.stations, 5);
  assert.ok(wrong.every((x) => !x.ok && x.deadMember === 鈴木));
});

test("デモの 6 人（DEFAULT_MEMBERS）: ローカルで解けるのは鞍馬・国際会館・太秦天神川、残りは対応予定", async () => {
  const r = await buildStations(DEFAULT_MEMBERS, "weekday", resolver);
  assert.deepEqual(Object.keys(r.stations).sort(), ["国際会館", "太秦天神川", "鞍馬"].sort());
  assert.deepEqual(r.unavailable.map((m) => m.station).sort(), ["びわ湖浜大津", "大阪梅田", "枚方市"].sort());
});

test("自宅駅がハブそのもの（四条）: 四条の候補地では制約なし（Infinity）、順位で最上位", async () => {
  const 四条の人: Member = { name: "四条の人", station: "四条" };
  const { stations } = await buildStations([四条の人], "weekday", resolver);
  const shijoRoute = stations["四条"].routes.find((x) => x.hub === "shijo")!;
  assert.equal(shijoRoute.last, null);
  const ranking = rankVenues(venues, [四条の人], stations, 5);
  assert.equal(ranking[0].venue.id, "shijo");
  assert.equal(ranking[0].ok && ranking[0].dissolve, Infinity);
  assert.ok(ranking.slice(1).every((x) => x.ok && Number.isFinite(x.dissolve)));
});

test("徒歩 0 分と 15 分で、順位は同じまま dissolve だけ 15 分ずれる", async () => {
  const members = [田中, 高橋, 伊藤];
  const { stations } = await buildStations(members, "weekday", resolver);
  const a = rankVenues(venues, members, stations, 0);
  const b = rankVenues(venues, members, stations, 15);
  assert.deepEqual(a.map((x) => x.venue.id), b.map((x) => x.venue.id));
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    assert.equal((x.ok ? x.dissolve : 0) - (y.ok ? y.dissolve : 0), 15);
  }
});

test("いられる時間（集合 19:00 → dissolve）は分で計算できる", async () => {
  const { stations } = await buildStations([田中], "weekday", resolver);
  const top = rankVenues(venues, [田中], stations, 5)[0];
  assert.ok(top.ok);
  const stay = (top.ok ? top.dissolve : 0) - toMin("19:00");
  assert.equal(stay, 200, "22:20 − 19:00 = 3 時間 20 分");
});
