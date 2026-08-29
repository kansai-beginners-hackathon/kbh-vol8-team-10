// 実行: npm run test:integration
// resolveLastTrain × 全社ローカル JSON（lib/localData.ts の ALL_LINES / ALL_LAST_TRAINS）× data/hubs.ts。
// tests/integration/resolveLastTrain.test.ts は地下鉄 JSON だけで振り分けを見るが、本番は 6 社 merge 後のデータで動く。
// ここでは「私鉄の駅がローカルで解けて Transit に回らない」「ハブ別名で引ける」ことを本番と同じデータで固定する。
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { HUBS, HUB_BY_ID } from "../../data/hubs.ts";
import { ALL_LAST_TRAINS, ALL_LINES } from "../../lib/localData.ts";
import { clearResolveCache, defaultDeps, resolveLastTrain, type ResolveDeps } from "../../lib/resolveLastTrain.ts";

/** Transit を呼んだらテストが落ちる deps。ローカルで解けるべきケース専用 */
const localOnly = (): { deps: ResolveDeps; calls: { plan: number; suggest: number } } => {
  const calls = { plan: 0, suggest: 0 };
  return {
    calls,
    deps: {
      lines: ALL_LINES,
      lastTrains: ALL_LAST_TRAINS,
      planLastArrival: async () => { calls.plan++; throw new Error("planLastArrival は呼ばれないはず"); },
      suggestStationId: async () => { calls.suggest++; throw new Error("suggestStationId は呼ばれないはず"); },
      today: () => "20260829",
      minIntervalMs: 0,
    },
  };
};

/** Transit が「駅 ID 見つからず」を返す deps（Transit がオフラインの状況） */
const transitOffline = () => {
  const calls = { plan: 0, suggest: 0 };
  const deps: ResolveDeps = {
    lines: ALL_LINES,
    lastTrains: ALL_LAST_TRAINS,
    planLastArrival: async () => { calls.plan++; return { journey: null, outcome: "noJourneys" as const }; },
    suggestStationId: async () => { calls.suggest++; return null; },
    today: () => "20260829",
    minIntervalMs: 0,
  };
  return { deps, calls };
};

beforeEach(() => clearResolveCache());

test("defaultDeps は全社 merge 後のデータを使う", () => {
  assert.equal(defaultDeps.lines, ALL_LINES);
  assert.equal(defaultDeps.lastTrains, ALL_LAST_TRAINS);
  assert.equal(defaultDeps.minIntervalMs, 300);
  assert.match(defaultDeps.today(), /^\d{8}$/);
});

test("出町柳 → 鞍馬: 叡電をローカルで解く 22:30（LP の『掲示 23:50 / 本当は 22:30』の根拠）", async () => {
  const { deps, calls } = localOnly();
  assert.deepEqual(await resolveLastTrain(HUB_BY_ID.demachiyanagi, "鞍馬", "weekday", deps), {
    kind: "found", time: "22:30", via: "local", transferCount: 0, headsign: "鞍馬",
  });
  assert.deepEqual(calls, { plan: 0, suggest: 0 });
});

test("京都 → 新田辺: 近鉄京都線をローカルで解く（地下鉄の京都と同名でも埋もれない）", async () => {
  const { deps } = localOnly();
  const r = await resolveLastTrain(HUB_BY_ID.kyoto, "新田辺", "weekday", deps);
  assert.equal(r.kind, "found");
  assert.equal(r.kind === "found" && r.via, "local");
  assert.equal(r.kind === "found" && r.time, "24:00");
});

test("四条 → 桂: 地下鉄「四条」では引けないが別名「烏丸」で阪急京都線が引ける 24:12", async () => {
  const { deps } = localOnly();
  assert.deepEqual(await resolveLastTrain(HUB_BY_ID.shijo, "桂", "weekday", deps), {
    kind: "found", time: "24:12", via: "local", transferCount: 0, headsign: "桂",
  });
});

test("四条大宮 → 嵐山: 嵐電をローカルで解く", async () => {
  const { deps } = localOnly();
  const r = await resolveLastTrain(HUB_BY_ID.shijoomiya, "嵐山", "weekday", deps);
  assert.equal(r.kind === "found" && r.time, "23:40");
});

test("三条 → 山科: 別名「三条京阪」で東西線 23:58", async () => {
  const { deps } = localOnly();
  const r = await resolveLastTrain(HUB_BY_ID.sanjo, "山科", "weekday", deps);
  assert.equal(r.kind === "found" && r.time, "23:58");
  assert.equal(r.kind === "found" && r.headsign, "六地蔵");
});

test("烏丸御池 → 太秦天神川 と 三条 → 太秦天神川 はどちらもローカル。時刻は異なる", async () => {
  const { deps } = localOnly();
  const a = await resolveLastTrain(HUB_BY_ID.karasumaoike, "太秦天神川", "weekday", deps);
  const b = await resolveLastTrain(HUB_BY_ID.sanjo, "太秦天神川", "weekday", deps);
  assert.equal(a.kind === "found" && a.time, "23:55");
  assert.equal(b.kind === "found" && b.time, "23:49");
});

test("自宅駅の前後の空白と全角スペースは trim される（『 鞍馬 』でも解ける）", async () => {
  const { deps } = localOnly();
  const r = await resolveLastTrain(HUB_BY_ID.demachiyanagi, " 鞍馬 ", "weekday", deps);
  assert.equal(r.kind === "found" && r.time, "22:30");
});

test("四条 → 山科: 全社データでも「地下鉄同士の乗換」は対応予定（isSubwayStation は地下鉄ファイルだけを見る）", async () => {
  const { deps, calls } = localOnly();
  const r = await resolveLastTrain(HUB_BY_ID.shijo, "山科", "weekday", deps);
  assert.equal(r.kind, "unavailable");
  assert.match(r.kind === "unavailable" ? r.reason : "", /地下鉄同士/);
  assert.deepEqual(calls, { plan: 0, suggest: 0 });
});

test("烏丸御池 → 桂: 両駅とも収録済み・同一路線に無い・地下鉄だけのハブ、だが桂は地下鉄駅ではない → Transit へ", async () => {
  const { deps, calls } = transitOffline();
  const r = await resolveLastTrain(HUB_BY_ID.karasumaoike, "桂", "weekday", deps);
  assert.equal(r.kind, "unavailable");
  assert.match(r.kind === "unavailable" ? r.reason : "", /駅ID/);
  assert.equal(calls.suggest, 1);
});

test("京都河原町 → 大阪梅田: ローカル未収録 → Transit へ（オフラインなら unavailable）", async () => {
  const { deps, calls } = transitOffline();
  const r = await resolveLastTrain(HUB_BY_ID.kawaramachi, "大阪梅田", "weekday", deps);
  assert.equal(r.kind, "unavailable");
  assert.equal(calls.suggest, 1);
  assert.equal(calls.plan, 0, "駅 ID が無ければ plan は呼ばない");
});

test("ハブ名そのものが自宅駅なら noTrainNeeded（別名でも）", async () => {
  const { deps } = localOnly();
  assert.deepEqual(await resolveLastTrain(HUB_BY_ID.sanjo, "三条京阪", "weekday", deps), { kind: "noTrainNeeded" });
  assert.deepEqual(await resolveLastTrain(HUB_BY_ID.shijo, "烏丸", "weekday", deps), { kind: "noTrainNeeded" });
  assert.deepEqual(await resolveLastTrain(HUB_BY_ID.kyoto, "京都", "weekday", deps), { kind: "noTrainNeeded" });
});

test("全ハブ × 地下鉄駅（五条）: 地下鉄ハブと京都はローカル、私鉄ハブは Transit（オフラインで unavailable）。throw しない", async () => {
  const { deps } = transitOffline();
  const results = await Promise.all(HUBS.map((hub) => resolveLastTrain(hub, "五条", "weekday", deps)));
  const byHub = Object.fromEntries(HUBS.map((h, i) => [h.id, results[i]]));
  assert.equal(byHub.shijo.kind, "found");
  assert.equal(byHub.karasumaoike.kind, "found");
  assert.equal(byHub.kyoto.kind, "found");
  assert.equal(byHub.sanjo.kind, "unavailable");
  assert.equal(byHub.kawaramachi.kind, "unavailable");
  assert.equal(byHub.demachiyanagi.kind, "unavailable");
  assert.equal(byHub.shijoomiya.kind, "unavailable");
});

test("weekend でも同じ振り分け（叡電 22:30 は土休日も同じ）", async () => {
  const { deps } = localOnly();
  const r = await resolveLastTrain(HUB_BY_ID.demachiyanagi, "鞍馬", "weekend", deps);
  assert.equal(r.kind === "found" && r.time, "22:30");
});
