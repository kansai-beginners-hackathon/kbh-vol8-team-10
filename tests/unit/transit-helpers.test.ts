// 実行: npm run test:unit
// lib/transit.ts の補助関数と、tests/unit/transit.test.ts で踏んでいない分岐（形の検証・空クエリ・rejected）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRANSIT_BASE,
  boardingSecs,
  firstHeadsign,
  firstTransitLeg,
  isSane,
  planLastArrivalDetailed,
  secsToHHMM,
  suggestStationId,
  type TransitJourney,
} from "../../lib/transit.ts";

const fakeFetch = (json: unknown, status = 200) => {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { fetcher, calls };
};

const journey = (over: Partial<TransitJourney> = {}): TransitJourney => ({
  departureSecs: 85260,
  arrivalSecs: 87180,
  transferCount: 0,
  legs: [{ kind: "transit", headsign: "淀", from: { name: "三条" }, to: { name: "宇治" }, departureSecs: 85260, arrivalSecs: 87180 }],
  ...over,
});

test("TRANSIT_BASE は v1", () => {
  assert.equal(TRANSIT_BASE, "https://api.transit.ls8h.com/api/v1");
});

// ---- secsToHHMM の境界
test("secsToHHMM: 0 → 00:00、59 秒は切り捨て、86399 → 23:59、86400 → 24:00", () => {
  assert.equal(secsToHHMM(0), "00:00");
  assert.equal(secsToHHMM(59), "00:00");
  assert.equal(secsToHHMM(86399), "23:59");
  assert.equal(secsToHHMM(86400), "24:00");
});

// ---- firstTransitLeg / firstHeadsign / boardingSecs
test("firstTransitLeg: 先頭の walk は飛ばして最初の transit", () => {
  const j = journey({
    legs: [
      { kind: "walk", departureSecs: 85000, arrivalSecs: 85200 },
      { kind: "transit", headsign: "X", departureSecs: 85260, arrivalSecs: 86000 },
      { kind: "transit", headsign: "Y", departureSecs: 86100, arrivalSecs: 87180 },
    ],
  });
  assert.equal(firstTransitLeg(j)?.headsign, "X");
  assert.equal(firstHeadsign(j), "X");
  assert.equal(boardingSecs(j), 85260);
});

test("徒歩だけの journey: firstTransitLeg は null、headsign は null、boardingSecs は journey の発時刻", () => {
  const j = journey({ departureSecs: 80000, legs: [{ kind: "walk", departureSecs: 80000, arrivalSecs: 80600 }] });
  assert.equal(firstTransitLeg(j), null);
  assert.equal(firstHeadsign(j), null);
  assert.equal(boardingSecs(j), 80000);
});

test("legs が空: boardingSecs は journey の発時刻", () => {
  assert.equal(boardingSecs(journey({ legs: [] })), 85260);
});

test("firstHeadsign: transit leg に headsign が無ければ null（地下鉄 feed など）", () => {
  const j = journey({ legs: [{ kind: "transit", departureSecs: 85260, arrivalSecs: 87180 }] });
  assert.equal(firstHeadsign(j), null);
});

// ---- isSane の境界
test("isSane: 到着ちょうど 27:00 は true、1 秒過ぎると false", () => {
  assert.equal(isSane(journey({ arrivalSecs: 27 * 3600 })), true);
  assert.equal(isSane(journey({ arrivalSecs: 27 * 3600 + 1 })), false);
});

test("isSane: 出発ちょうど 20:00 は true、1 秒前は false", () => {
  assert.equal(isSane(journey({ departureSecs: 20 * 3600 })), true);
  assert.equal(isSane(journey({ departureSecs: 20 * 3600 - 1 })), false);
});

test("isSane: 乗換待ちちょうど 60 分は true、61 分は false", () => {
  const legs = (waitSecs: number) => [
    { kind: "transit" as const, departureSecs: 80000, arrivalSecs: 81000 },
    { kind: "transit" as const, departureSecs: 81000 + waitSecs, arrivalSecs: 86000 },
  ];
  assert.equal(isSane(journey({ departureSecs: 80000, arrivalSecs: 86000, legs: legs(3600) })), true);
  assert.equal(isSane(journey({ departureSecs: 80000, arrivalSecs: 86000, legs: legs(3660) })), false);
});

test("isSane: undefined は false", () => {
  assert.equal(isSane(undefined), false);
});

// ---- suggestStationId の入力・形
test("suggestStationId: 空白だけの駅名は fetch せず null", async () => {
  const { fetcher, calls } = fakeFetch({ stations: [{ id: "x:y", name: "y", kind: "station" }] });
  assert.equal(await suggestStationId("   ", fetcher), null);
  assert.equal(calls.length, 0);
});

test("suggestStationId: 前後の空白は落として問い合わせる", async () => {
  const { fetcher, calls } = fakeFetch({ stations: [{ id: "x:宇治", name: "宇治", kind: "station" }] });
  assert.equal(await suggestStationId("  宇治 ", fetcher), "x:宇治");
  assert.equal(new URL(calls[0]).searchParams.get("q"), "宇治");
  assert.equal(new URL(calls[0]).searchParams.get("limit"), "10");
});

test("suggestStationId: stations が無い・本文が null → null", async () => {
  assert.equal(await suggestStationId("宇治", fakeFetch({}).fetcher), null);
  assert.equal(await suggestStationId("宇治", fakeFetch({ stations: null }).fetcher), null);
  assert.equal(await suggestStationId("宇治", fakeFetch(null).fetcher), null);
});

// 現状は `(data?.stations ?? []).filter` が TypeError を投げる（resolveLastTrain 側の catch で unavailable に畳まれるので画面は壊れない）。
// lib/transit.ts の「throw せず null」の契約に揃えるなら Array.isArray で守る。直したらこの todo をテストに昇格させる。
test.todo("suggestStationId: stations が配列でない（文字列など）ときも throw せず null を返す");

test("suggestStationId: kind が station 以外・id が文字列でない要素は除外", async () => {
  const { fetcher } = fakeFetch({
    stations: [
      { id: "bus:宇治", name: "宇治", kind: "stop" },
      { id: 123, name: "宇治", kind: "station" },
      null,
      { id: "x:宇治山田", name: "宇治山田", kind: "station" },
    ],
  });
  assert.equal(await suggestStationId("宇治", fetcher), "x:宇治山田", "完全一致が無いので station の先頭");
});

test("suggestStationId: preferFeeds は完全一致の中からだけ選ぶ", async () => {
  const { fetcher } = fakeFetch({
    stations: [
      { id: "scrape-kyoto-subway:京都市-烏丸線-五条", name: "五条", kind: "station" },
      { id: "scrape-keihan:京阪-五条坂", name: "五条坂", kind: "station" },
    ],
  });
  // preferFeeds に scrape-keihan を出しても、完全一致「五条」は地下鉄だけ → 完全一致の先頭
  assert.equal(await suggestStationId("五条", fetcher, { preferFeeds: ["scrape-keihan"] }), "scrape-kyoto-subway:京都市-烏丸線-五条");
});

// ---- planLastArrivalDetailed の形の検証
test("planLastArrivalDetailed: journeys が配列でない → noJourneys", async () => {
  const r = await planLastArrivalDetailed("a", "b", "20260829", fakeFetch({ journeys: "x" }).fetcher);
  assert.deepEqual(r, { journey: null, outcome: "noJourneys" });
});

test("planLastArrivalDetailed: 形の壊れた journey（legs 無し・数値でない秒）は無視 → rejected", async () => {
  const r = await planLastArrivalDetailed("a", "b", "20260829", fakeFetch({
    journeys: [
      { departureSecs: 85260, arrivalSecs: 87180, transferCount: 0 }, // legs 無し
      { departureSecs: "85260", arrivalSecs: 87180, transferCount: 0, legs: [] }, // 文字列
      null,
      "x",
    ],
  }).fetcher);
  assert.deepEqual(r, { journey: null, outcome: "rejected" });
});

test("planLastArrivalDetailed: 壊れた journey と正常な journey が混ざれば正常な方を採る", async () => {
  const r = await planLastArrivalDetailed("a", "b", "20260829", fakeFetch({ journeys: [null, journey()] }).fetcher);
  assert.equal(r.outcome, "found");
  assert.equal(r.journey?.departureSecs, 85260);
});

test("planLastArrivalDetailed: 最も遅く『乗車』する便を選ぶ（徒歩開始時刻ではない）", async () => {
  const early = journey({ departureSecs: 85000, legs: [{ kind: "transit", departureSecs: 85000, arrivalSecs: 86000 }] });
  // 徒歩開始は 84000 で early より早いが、乗車は 85500 で遅い
  const lateBoarding = journey({
    departureSecs: 84000,
    legs: [
      { kind: "walk", departureSecs: 84000, arrivalSecs: 84300 },
      { kind: "transit", departureSecs: 85500, arrivalSecs: 86500 },
    ],
  });
  const r = await planLastArrivalDetailed("a", "b", "20260829", fakeFetch({ journeys: [early, lateBoarding] }).fetcher);
  assert.equal(r.journey?.departureSecs, 84000);
});

test("planLastArrivalDetailed: URL に from/to/date/type/time/numItineraries が乗る", async () => {
  const { fetcher, calls } = fakeFetch({ journeys: [] });
  await planLastArrivalDetailed("geo:1,2", "x:y", "20260101", fetcher);
  const url = new URL(calls[0]);
  assert.equal(url.origin + url.pathname, `${TRANSIT_BASE}/plan`);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    from: "geo:1,2",
    to: "x:y",
    date: "20260101",
    type: "arrival",
    time: "26:00",
    numItineraries: "6",
  });
});

test("planLastArrivalDetailed: 既定の fetcher はグローバル fetch（差し替え可能）", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response(JSON.stringify({ journeys: [] }), { status: 200 });
  }) as typeof fetch;
  try {
    const r = await planLastArrivalDetailed("a", "b", "20260829");
    assert.equal(called, true);
    assert.equal(r.outcome, "noJourneys");
  } finally {
    globalThis.fetch = original;
  }
});
