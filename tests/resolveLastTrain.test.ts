// 実行: npm test （= node --test tests/*.test.ts）
// deps を差し替えて Transit を叩かずに振り分けを検証する。
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { HUB_BY_ID } from "../data/hubs.ts";
import { lastTrainBetween, type LastTrainsData, type LinesData } from "../lib/lastTrain.ts";
import { clearResolveCache, resolveLastTrain, todayYYYYMMDD, type ResolveDeps } from "../lib/resolveLastTrain.ts";
import type { TransitJourney } from "../lib/transit.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const lines = read("data/subway-lines.json") as LinesData;
const lastTrains = read("data/subway-last-trains.json") as LastTrainsData;

/** fixture 三条→宇治 の 23:41 発 journey */
const ujiJourney: TransitJourney = (read("tests/fixtures/transit-sanjo-uji.json").journeys as TransitJourney[]).find(
  (j) => j.departureSecs === 85260,
)!;

const neverCalled = (what: string) => async (): Promise<never> => {
  throw new Error(`${what} は呼ばれないはず`);
};

/** 既定は「Transit を呼んだら落ちる」deps。ケースごとに上書きする */
const makeDeps = (over: Partial<ResolveDeps> = {}) => {
  const calls = { plan: 0, suggest: 0, planArgs: [] as unknown[][], suggestArgs: [] as unknown[][] };
  const deps: ResolveDeps = {
    lines,
    lastTrains,
    planLastArrival: neverCalled("planLastArrival"),
    suggestStationId: neverCalled("suggestStationId"),
    today: () => "20260829",
    minIntervalMs: 0,
    ...over,
  };
  // 呼び出し回数を数えるラッパー
  const plan = deps.planLastArrival;
  const suggest = deps.suggestStationId;
  deps.planLastArrival = (...a) => (calls.plan++, calls.planArgs.push(a), plan(...a));
  deps.suggestStationId = (...a) => (calls.suggest++, calls.suggestArgs.push(a), suggest(...a));
  return { deps, calls };
};

beforeEach(() => clearResolveCache());

test("四条 → 五条: ローカルで解ける。Transit は呼ばれない", async () => {
  const { deps } = makeDeps();
  assert.deepEqual(await resolveLastTrain(HUB_BY_ID.shijo, "五条", "weekday", deps), {
    kind: "found",
    time: "23:57",
    via: "local",
    transferCount: 0,
    headsign: "竹田",
  });
});

test("四条 → 四条: noTrainNeeded。Transit は呼ばれない", async () => {
  const { deps } = makeDeps();
  assert.deepEqual(await resolveLastTrain(HUB_BY_ID.shijo, "四条", "weekday", deps), { kind: "noTrainNeeded" });
});

test("三条 → 宇治: Transit で 23:41 乗換1（fixture）", async () => {
  const { deps, calls } = makeDeps({
    suggestStationId: async () => "scrape-keihan:京阪電気鉄道-宇治線-宇治",
    planLastArrival: async (from, to, date, originNames) => {
      assert.equal(from, "geo:35.00879,135.772337");
      assert.equal(to, "scrape-keihan:京阪電気鉄道-宇治線-宇治");
      assert.equal(date, "20260829");
      assert.deepEqual(originNames, ["三条", "三条京阪"]);
      return ujiJourney;
    },
  });
  assert.deepEqual(await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps), {
    kind: "found",
    time: "23:41",
    via: "transit",
    transferCount: 1,
    headsign: "淀",
  });
  assert.equal(calls.suggest, 1);
  assert.equal(calls.plan, 1);
  assert.deepEqual(calls.suggestArgs[0], ["宇治", []], "宇治は地下鉄収録駅ではないので feed 優先なし");
});

test("京都 → 近鉄奈良: Transit に経路なし → unavailable", async () => {
  const { deps } = makeDeps({
    suggestStationId: async () => "kintetsu-nara-line:近畿日本鉄道-奈良線-近鉄奈良",
    planLastArrival: async () => null,
  });
  const r = await resolveLastTrain(HUB_BY_ID.kyoto, "近鉄奈良", "weekday", deps);
  assert.equal(r.kind, "unavailable");
  assert.match(r.kind === "unavailable" ? r.reason : "", /経路なし/);
});

test("京都河原町 → 大阪梅田: 駅 ID が見つからない → unavailable。plan は呼ばれない", async () => {
  const { deps, calls } = makeDeps({ suggestStationId: async () => null });
  const r = await resolveLastTrain(HUB_BY_ID.kawaramachi, "大阪梅田", "weekday", deps);
  assert.equal(r.kind, "unavailable");
  assert.match(r.kind === "unavailable" ? r.reason : "", /駅ID/);
  assert.equal(calls.plan, 0);
});

test("planLastArrival が throw → unavailable（例外が外に漏れない）", async () => {
  const { deps } = makeDeps({
    suggestStationId: async () => "x:y",
    planLastArrival: async () => {
      throw new Error("network down");
    },
  });
  assert.deepEqual(await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps), {
    kind: "unavailable",
    reason: "network down",
  });
});

test("suggestStationId が throw → unavailable", async () => {
  const { deps } = makeDeps({
    suggestStationId: async () => {
      throw new Error("suggest down");
    },
  });
  assert.deepEqual(await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps), {
    kind: "unavailable",
    reason: "suggest down",
  });
});

test("同じ問い合わせを 2 回 → planLastArrival は 1 回だけ（キャッシュ）", async () => {
  const { deps, calls } = makeDeps({
    suggestStationId: async () => "scrape-keihan:京阪電気鉄道-宇治線-宇治",
    planLastArrival: async () => ujiJourney,
  });
  const a = await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps);
  const b = await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps);
  assert.deepEqual(a, b);
  assert.equal(calls.plan, 1);
  assert.equal(calls.suggest, 1);
});

test("unavailable もキャッシュされる（同じ失敗を繰り返さない）", async () => {
  const { deps, calls } = makeDeps({
    suggestStationId: async () => "x:y",
    planLastArrival: async () => null,
  });
  await resolveLastTrain(HUB_BY_ID.kyoto, "近鉄奈良", "weekday", deps);
  const afterFirst = calls.plan; // geo + ハブ駅 ID のリトライ分
  assert.equal(afterFirst, 1 + HUB_BY_ID.kyoto.stationIds.length);
  await resolveLastTrain(HUB_BY_ID.kyoto, "近鉄奈良", "weekday", deps);
  assert.equal(calls.plan, afterFirst, "2 回目はキャッシュで Transit を呼ばない");
});

test("同じ自宅駅を別ハブで問い合わせても suggest は 1 回（駅 ID キャッシュ）", async () => {
  const { deps, calls } = makeDeps({
    suggestStationId: async () => "scrape-keihan:京阪電気鉄道-宇治線-宇治",
    planLastArrival: async () => ujiJourney,
  });
  await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps);
  await resolveLastTrain(HUB_BY_ID.demachiyanagi, "宇治", "weekday", deps);
  assert.equal(calls.suggest, 1);
  assert.equal(calls.plan, 2);
});

test("ハブと日付・曜日が違えばキャッシュは別", async () => {
  const { deps, calls } = makeDeps({
    suggestStationId: async () => "x:y",
    planLastArrival: async () => ujiJourney,
  });
  await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps);
  await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekend", deps);
  assert.equal(calls.plan, 2);
});

test("間隔制御: minIntervalMs=100 で 3 回呼ぶと 200ms 以上かかる", async () => {
  const { deps } = makeDeps({
    suggestStationId: async () => "x:y",
    planLastArrival: async () => ujiJourney,
    minIntervalMs: 100,
  });
  const t0 = Date.now();
  await resolveLastTrain(HUB_BY_ID.sanjo, "宇治A", "weekday", deps); // suggest + plan
  await resolveLastTrain(HUB_BY_ID.sanjo, "宇治B", "weekday", deps); // suggest + plan
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 200, `elapsed=${elapsed}ms`);
});

test("空の駅名 → unavailable（Transit は呼ばない）", async () => {
  const { deps } = makeDeps();
  const r = await resolveLastTrain(HUB_BY_ID.sanjo, "  ", "weekday", deps);
  assert.equal(r.kind, "unavailable");
});

test("todayYYYYMMDD: ローカル日付を YYYYMMDD に", () => {
  assert.equal(todayYYYYMMDD(new Date(2026, 7, 29, 23, 30)), "20260829");
  assert.equal(todayYYYYMMDD(new Date(2026, 0, 5)), "20260105");
});

// ---- レビューで入れた振り分けの追加ルール
test("四条 → 山科: 両駅とも地下鉄・同一路線に無い・地下鉄だけのハブ → 対応予定。Transit は呼ばない", async () => {
  const { deps, calls } = makeDeps();
  const r = await resolveLastTrain(HUB_BY_ID.shijo, "山科", "weekday", deps);
  assert.equal(r.kind, "unavailable");
  assert.match(r.kind === "unavailable" ? r.reason : "", /地下鉄同士/);
  assert.equal(calls.plan + calls.suggest, 0);
});

test("三条 → 山科: ハブ別名 三条京阪 でローカル JSON が引ける（東西線）", async () => {
  const { deps } = makeDeps();
  const expected = lastTrainBetween(lines, lastTrains, "三条京阪", "山科", "weekday");
  assert.equal(expected.kind, "found");
  const r = await resolveLastTrain(HUB_BY_ID.sanjo, "山科", "weekday", deps);
  assert.deepEqual(r, {
    kind: "found",
    time: expected.kind === "found" ? expected.time : "",
    via: "local",
    transferCount: 0,
    headsign: expected.kind === "found" ? expected.headsign : "",
  });
});

test("京都 → 山科: needsTransfer だが京都は地下鉄だけのハブではない → Transit（JR）へ。地下鉄IDを優先要求", async () => {
  const jr: TransitJourney = {
    departureSecs: 87420,
    arrivalSecs: 87720,
    transferCount: 0,
    legs: [{ kind: "transit", headsign: "快速 野洲", from: { name: "京都" }, to: { name: "山科" }, departureSecs: 87420, arrivalSecs: 87720 }],
  };
  const { deps, calls } = makeDeps({
    suggestStationId: async () => "scrape-kyoto-subway:京都市-東西線-山科",
    planLastArrival: async () => jr,
  });
  const r = await resolveLastTrain(HUB_BY_ID.kyoto, "山科", "weekday", deps);
  assert.deepEqual(r, { kind: "found", time: "24:17", via: "transit", transferCount: 0, headsign: "快速 野洲" });
  assert.deepEqual(calls.suggestArgs[0], ["山科", ["scrape-kyoto-subway"]]);
  assert.deepEqual(calls.planArgs[0]?.[3], ["京都"]);
});

test("先頭に徒歩 leg がある journey → time は最初の乗車区間の発時刻", async () => {
  const j: TransitJourney = {
    departureSecs: 82854, // 徒歩開始 23:00:54
    arrivalSecs: 86455,
    transferCount: 1,
    legs: [
      { kind: "walk", from: { name: "三条" }, to: { name: "三条京阪" }, departureSecs: 82854, arrivalSecs: 82974 },
      { kind: "transit", from: { name: "三条京阪" }, to: { name: "山科" }, departureSecs: 83160, arrivalSecs: 83700 },
      { kind: "walk", departureSecs: 83700, arrivalSecs: 83826 },
      { kind: "transit", headsign: "新快速 西明石", from: { name: "山科" }, to: { name: "大阪" }, departureSecs: 84180, arrivalSecs: 86280 },
    ],
  };
  const { deps } = makeDeps({ suggestStationId: async () => "x:y", planLastArrival: async () => j });
  const r = await resolveLastTrain(HUB_BY_ID.sanjo, "大阪", "weekday", deps);
  assert.equal(r.kind === "found" && r.time, "23:06");
  assert.equal(r.kind === "found" && r.headsign, null, "最初の乗車区間（地下鉄）に headsign が無いので null");
});

test("suggest が null でも駅 ID キャッシュには残さない（別ハブで再試行できる）", async () => {
  let n = 0;
  const { deps, calls } = makeDeps({
    suggestStationId: async () => (n++ === 0 ? null : "x:y"),
    planLastArrival: async () => ujiJourney,
  });
  const a = await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps);
  assert.equal(a.kind, "unavailable");
  const b = await resolveLastTrain(HUB_BY_ID.demachiyanagi, "宇治", "weekday", deps);
  assert.equal(b.kind, "found");
  assert.equal(calls.suggest, 2);
});

test("四条 → 桂: geo: が null（422 など）→ ハブの駅 ID でリトライして見つける", async () => {
  const katsura: TransitJourney = {
    departureSecs: 85920,
    arrivalSecs: 86520,
    transferCount: 0,
    legs: [{ kind: "transit", headsign: "正雀", from: { name: "烏丸" }, to: { name: "桂" }, departureSecs: 85920, arrivalSecs: 86520 }],
  };
  const { deps, calls } = makeDeps({
    suggestStationId: async () => "scrape-hankyu:阪急電鉄-京都線-桂",
    planLastArrival: async (from) => (from === "scrape-hankyu:阪急電鉄-京都線-烏丸" ? katsura : null),
  });
  const r = await resolveLastTrain(HUB_BY_ID.shijo, "桂", "weekday", deps);
  assert.deepEqual(r, { kind: "found", time: "23:52", via: "transit", transferCount: 0, headsign: "正雀" });
  // geo + stationIds 2 件 = 3 回
  assert.equal(calls.plan, 1 + HUB_BY_ID.shijo.stationIds.length);
  assert.equal(calls.planArgs[0][0], "geo:35.00275,135.759673");
});

test("geo: もハブ駅 ID も全部 null → unavailable", async () => {
  const { deps, calls } = makeDeps({ suggestStationId: async () => "x:y", planLastArrival: async () => null });
  const r = await resolveLastTrain(HUB_BY_ID.kyoto, "近鉄奈良", "weekday", deps);
  assert.equal(r.kind, "unavailable");
  assert.equal(calls.plan, 1 + HUB_BY_ID.kyoto.stationIds.length);
});

test("geo: で見つかればハブ駅 ID は試さない", async () => {
  const { deps, calls } = makeDeps({
    suggestStationId: async () => "scrape-keihan:京阪電気鉄道-宇治線-宇治",
    planLastArrival: async () => ujiJourney,
  });
  await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps);
  assert.equal(calls.plan, 1);
});
