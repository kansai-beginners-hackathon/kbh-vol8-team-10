// 実行: npm test （= node --test tests/*.test.ts）
import { test } from "node:test";
import assert from "node:assert/strict";
import { HUBS, type Hub } from "../data/hubs.ts";
import { buildStations, todayType, type Resolver } from "../lib/buildStations.ts";
import { bestRoute, latestLeave, rankVenues, resultFor } from "../lib/calc.ts";
import type { Resolved } from "../lib/resolveLastTrain.ts";
import type { Member, Station, Venue } from "../lib/types.ts";

const found = (time: string, via: "local" | "transit" = "local", transferCount = 0): Resolved => ({
  kind: "found", time, via, transferCount, headsign: null,
});
const unavailable: Resolved = { kind: "unavailable", reason: "test" };

/** 呼び出しを記録しつつ、表 (hubId → Resolved) で答える偽 resolve。表に無いハブは fallback */
function fakeResolver(table: Partial<Record<string, Resolved>>, fallback: Resolved = found("23:30")) {
  const calls: { hub: string; home: string }[] = [];
  const resolve: Resolver = async (hub, home) => {
    calls.push({ hub: hub.id, home });
    return table[hub.id] ?? fallback;
  };
  return { resolve, calls };
}

const tanaka: Member = { name: "田中", station: "五条" };

test("1 人・7 ハブ全部 found → routes が 7 本、last は時刻文字列", async () => {
  const { resolve } = fakeResolver({}, found("23:45"));
  const r = await buildStations([tanaka], "weekday", resolve);
  const st = r.stations["五条"];
  assert.ok(st);
  assert.equal(st.routes.length, 7);
  for (const route of st.routes) {
    assert.equal(route.last, "23:45");
    assert.equal(route.via, "local");
    assert.equal(route.transferCount, 0);
  }
  assert.deepEqual(st.routes.map((x) => x.hub), HUBS.map((h) => h.id));
  assert.equal(st.taxiKm, 0);
  assert.deepEqual(r.unavailable, []);
});

test("一部のハブが unavailable → その経路だけ落ちる。unavailable は空", async () => {
  const { resolve } = fakeResolver({ sanjo: unavailable, kawaramachi: unavailable, shijoomiya: unavailable });
  const r = await buildStations([tanaka], "weekday", resolve);
  assert.equal(r.stations["五条"].routes.length, 4);
  assert.ok(!r.stations["五条"].routes.some((x) => ["sanjo", "kawaramachi", "shijoomiya"].includes(x.hub)));
  assert.deepEqual(r.unavailable, []);
});

test("全部 unavailable → stations に無く、unavailable にそのメンバー", async () => {
  const { resolve } = fakeResolver({}, unavailable);
  const kurama: Member = { name: "鞍馬さん", station: "鞍馬" };
  const r = await buildStations([tanaka, kurama], "weekday", resolve);
  // 田中は fallback... ではなく全部 unavailable なので両方落ちる
  assert.deepEqual(Object.keys(r.stations), []);
  assert.deepEqual(r.unavailable, [tanaka, kurama]);
});

test("unavailable と found が混ざる → unavailable には全滅した人だけ", async () => {
  const resolve: Resolver = async (_hub, home) => (home === "鞍馬" ? unavailable : found("23:40"));
  const kurama: Member = { name: "鞍馬さん", station: "鞍馬" };
  const r = await buildStations([tanaka, kurama], "weekday", resolve);
  assert.deepEqual(Object.keys(r.stations), ["五条"]);
  assert.deepEqual(r.unavailable, [kurama]);
});

test("同じ駅がハブ（noTrainNeeded）→ last === null, transferMin === 0", async () => {
  const { resolve } = fakeResolver({ shijo: { kind: "noTrainNeeded" } });
  const r = await buildStations([{ name: "四条さん", station: "四条" }], "weekday", resolve);
  const route = r.stations["四条"].routes.find((x) => x.hub === "shijo");
  assert.ok(route);
  assert.equal(route.last, null);
  assert.equal(route.transferMin, 0);
  assert.equal(route.via, "local");
  assert.equal(route.transferCount, 0);
  assert.equal(r.stations["四条"].routes.length, 7);
});

test("同じ自宅駅のメンバー 2 人 → resolve は 7 回（14 ではない）", async () => {
  const { resolve, calls } = fakeResolver({});
  const r = await buildStations([tanaka, { name: "佐藤", station: "五条" }], "weekday", resolve);
  assert.equal(calls.length, 7);
  assert.equal(Object.keys(r.stations).length, 1);
});

test("全滅した自宅駅を共有する 2 人は両方 unavailable に入る", async () => {
  const { resolve, calls } = fakeResolver({}, unavailable);
  const a: Member = { name: "A", station: "鞍馬" };
  const b: Member = { name: "B", station: "鞍馬" };
  const r = await buildStations([a, b], "weekday", resolve);
  assert.equal(calls.length, 7);
  assert.deepEqual(r.unavailable, [a, b]);
});

test("transit の found は via / transferCount がそのまま Route に乗る", async () => {
  const { resolve } = fakeResolver({ sanjo: found("23:41", "transit", 2) });
  const r = await buildStations([{ name: "宇治さん", station: "宇治" }], "weekday", resolve);
  const route = r.stations["宇治"].routes.find((x) => x.hub === "sanjo")!;
  assert.equal(route.via, "transit");
  assert.equal(route.transferCount, 2);
  assert.equal(route.transferMin, 5); // hubs.ts の値
});

test("resolve が throw しても落ちず unavailable 扱い", async () => {
  const resolve: Resolver = async () => { throw new Error("network down"); };
  const r = await buildStations([tanaka], "weekday", resolve);
  assert.deepEqual(Object.keys(r.stations), []);
  assert.deepEqual(r.unavailable, [tanaka]);
});

test("hubs を差し替えられる", async () => {
  const hubs: Hub[] = [{ ...HUBS[0], id: "x", name: "X", transferMin: 2 }];
  const { resolve, calls } = fakeResolver({}, found("23:00"));
  const r = await buildStations([tanaka], "weekday", resolve, hubs);
  assert.equal(calls.length, 1);
  assert.deepEqual(r.stations["五条"].routes, [{ hub: "x", transferMin: 2, last: "23:00", via: "local", transferCount: 0 }]);
});

test("todayType: 土日は weekend、平日は weekday", () => {
  assert.equal(todayType(new Date("2026-08-29T12:00:00")), "weekend"); // 土
  assert.equal(todayType(new Date("2026-08-30T12:00:00")), "weekend"); // 日
  assert.equal(todayType(new Date("2026-08-31T12:00:00")), "weekday"); // 月
});

// ---- calc.ts の変更（last: null）の確認
const venue: Venue = {
  id: "shijo",
  name: "四条",
  toHub: { shijo: { transitMin: 0, lastDepart: null }, karasumaoike: { transitMin: 5, lastDepart: "23:55" } },
};

test("latestLeave: last === null の route は候補地→ハブの lastDepart だけで決まる", () => {
  const station: Station = {
    name: "烏丸御池",
    taxiKm: 0,
    routes: [{ hub: "karasumaoike", transferMin: 0, last: null, via: "local", transferCount: 0 }],
  };
  // 支線は縛らない。lastDepart 23:55 のみ → 23:55 − 徒歩 5 分
  assert.equal(latestLeave(station, venue, 5), 23 * 60 + 50);
});

test("latestLeave: last === null かつ lastDepart === null → 制約なし（Infinity）", () => {
  const station: Station = {
    name: "四条",
    taxiKm: 0,
    routes: [{ hub: "shijo", transferMin: 0, last: null, via: "local", transferCount: 0 }],
  };
  assert.equal(latestLeave(station, venue, 5), Infinity);
});

test("latestLeave: last あり route と null route が混在 → 遅い方（null 側）を採る", () => {
  const station: Station = {
    name: "烏丸御池",
    taxiKm: 0,
    routes: [
      { hub: "shijo", transferMin: 3, last: "23:30", via: "local", transferCount: 0 },
      { hub: "karasumaoike", transferMin: 0, last: null, via: "local", transferCount: 0 },
    ],
  };
  assert.equal(latestLeave(station, venue, 0), 23 * 60 + 55);
  assert.equal(bestRoute(station, venue)?.route.hub, "karasumaoike");
});

test("resultFor: stations に無い駅のメンバーは deadMember（呼び出し側で除外する前提）", () => {
  const r = resultFor(venue, [{ name: "X", station: "鞍馬" }], {}, 5);
  assert.equal(r.ok, false);
});

test("rankVenues: メンバー 0 人なら空配列（rows[0] を読んで落ちない）", () => {
  assert.deepEqual(rankVenues([venue], [], {}, 5), []);
});

// ---- 並列化・進捗通知
test("自宅駅 2 件 × 7 ハブを並列に投げ、3 件目以降は待つ", async () => {
  let started = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const resolve: Resolver = async () => { started++; await gate; return found("23:30"); };
  const p = buildStations([tanaka, { name: "佐藤", station: "山科" }, { name: "鞍馬さん", station: "鞍馬" }, { name: "D", station: "宇治" }], "weekday", resolve);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(started, 14); // 同時に進める自宅駅は 2 件 → 2 駅 × 7 ハブ。3 駅目以降は待つ
  release();
  const r = await p;
  assert.equal(started, 28);
  assert.equal(Object.keys(r.stations).length, 4);
});

test("onProgress: 自宅駅ごとに解けた順で呼ばれる。対応予定は null", async () => {
  const delays: Record<string, number> = { 五条: 30, 山科: 5, 鞍馬: 15 };
  const resolve: Resolver = async (_hub, home) => {
    await new Promise((r) => setTimeout(r, delays[home]));
    return home === "鞍馬" ? unavailable : found("23:30");
  };
  const events: [string, boolean][] = [];
  const members: Member[] = [tanaka, { name: "佐藤", station: "山科" }, { name: "鞍馬さん", station: "鞍馬" }];
  const r = await buildStations(members, "weekday", resolve, HUBS, (home, st) => events.push([home, st !== null]));
  assert.deepEqual(events, [["山科", true], ["鞍馬", false], ["五条", true]]);
  assert.deepEqual(Object.keys(r.stations).sort(), ["五条", "山科"]);
  assert.deepEqual(r.unavailable.map((m) => m.station), ["鞍馬"]);
});
