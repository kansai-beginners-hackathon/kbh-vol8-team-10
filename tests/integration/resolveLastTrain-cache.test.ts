// 実行: npm run test:integration
// resolveLastTrain の localStorage キャッシュ（ブラウザでだけ効く分岐）。
// Node には window が無いので、このファイルの中だけ window.localStorage を偽装する（別プロセスなので他のテストには漏れない）。
//   - found は無期限で書く / unavailable は 30 分の期限付きで書く / noTrainNeeded は書かない
//   - メモリキャッシュが空でも localStorage から復元できる（リロード後に Transit を叩き直さない）
//   - 期限切れ・壊れた JSON・setItem の失敗は無視して動き続ける
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { HUB_BY_ID } from "../../data/hubs.ts";
import type { LastTrainsData, LinesData } from "../../lib/lastTrain.ts";
import type { TransitJourney } from "../../lib/transit.ts";

// ---- window.localStorage の偽装（resolveLastTrain.ts を import する前に用意する必要はないが、呼び出し時点で存在すればよい）
const store = new Map<string, string>();
let setItemThrows = false;
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (setItemThrows) throw new DOMException("QuotaExceededError");
    store.set(k, v);
  },
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
(globalThis as unknown as { window: unknown }).window = { localStorage: fakeStorage };

const { clearResolveCache, resolveLastTrain } = await import("../../lib/resolveLastTrain.ts");
type ResolveDeps = import("../../lib/resolveLastTrain.ts").ResolveDeps;

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const lines = read("data/subway-lines.json") as LinesData;
const lastTrains = read("data/subway-last-trains.json") as LastTrainsData;
const ujiJourney: TransitJourney = (read("tests/fixtures/transit-sanjo-uji.json").journeys as TransitJourney[]).find((j) => j.departureSecs === 85260)!;

const KEY_FOUND = "lt:sanjo:宇治:weekday:20260829";
const KEY_UNAVAILABLE = "lt:kyoto:近鉄奈良:weekday:20260829";

const makeDeps = (over: Partial<ResolveDeps> = {}) => {
  const calls = { plan: 0, suggest: 0 };
  const deps: ResolveDeps = {
    lines,
    lastTrains,
    planLastArrival: async () => { calls.plan++; return ujiJourney; },
    suggestStationId: async () => { calls.suggest++; return "x:y"; },
    dateFor: () => "20260829",
    minIntervalMs: 0,
    ...over,
  };
  return { deps, calls };
};

beforeEach(() => {
  clearResolveCache();
  store.clear();
  setItemThrows = false;
});

test("found は localStorage に書かれる（expiresAt 無し）", async () => {
  const { deps } = makeDeps();
  const r = await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps);
  assert.equal(r.kind, "found");
  const stored = JSON.parse(store.get(KEY_FOUND)!);
  assert.deepEqual(stored, r);
  assert.equal("expiresAt" in stored, false);
});

test("unavailable は 30 分の期限付きで書かれる", async () => {
  const { deps } = makeDeps({ planLastArrival: async () => ({ journey: null, outcome: "noJourneys" as const }) });
  const before = Date.now();
  const r = await resolveLastTrain(HUB_BY_ID.kyoto, "近鉄奈良", "weekday", deps);
  assert.equal(r.kind, "unavailable");
  const stored = JSON.parse(store.get(KEY_UNAVAILABLE)!);
  assert.equal(stored.kind, "unavailable");
  assert.equal(typeof stored.expiresAt, "number");
  assert.ok(stored.expiresAt >= before + 30 * 60 * 1000 - 1000 && stored.expiresAt <= Date.now() + 30 * 60 * 1000 + 1000);
});

test("noTrainNeeded と local found は localStorage に書かない（Transit の結果だけキャッシュする）", async () => {
  const { deps } = makeDeps();
  assert.deepEqual(await resolveLastTrain(HUB_BY_ID.shijo, "四条", "weekday", deps), { kind: "noTrainNeeded" });
  assert.equal((await resolveLastTrain(HUB_BY_ID.shijo, "五条", "weekday", deps)).kind, "found");
  assert.equal(store.size, 0);
});

test("メモリキャッシュを消しても localStorage の found から復元し、Transit を呼ばない（リロード相当）", async () => {
  const { deps, calls } = makeDeps();
  const first = await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps);
  assert.equal(calls.plan, 1);

  clearResolveCache(); // メモリだけ消える。localStorage は残る
  const second = await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps);
  assert.deepEqual(second, first);
  assert.equal(calls.plan, 1, "2 回目は localStorage から");
  assert.equal(calls.suggest, 1, "駅 ID の検索も要らない");
});

test("期限内の unavailable は localStorage から復元する（reason も保つ）", async () => {
  store.set(KEY_UNAVAILABLE, JSON.stringify({ kind: "unavailable", reason: "前回の失敗", expiresAt: Date.now() + 60_000 }));
  const { deps, calls } = makeDeps();
  const r = await resolveLastTrain(HUB_BY_ID.kyoto, "近鉄奈良", "weekday", deps);
  assert.deepEqual(r, { kind: "unavailable", reason: "前回の失敗" });
  assert.equal(calls.plan + calls.suggest, 0);
});

test("期限切れの unavailable は無視して Transit をやり直す", async () => {
  store.set(KEY_UNAVAILABLE, JSON.stringify({ kind: "unavailable", reason: "古い", expiresAt: Date.now() - 1 }));
  const { deps, calls } = makeDeps();
  const r = await resolveLastTrain(HUB_BY_ID.kyoto, "近鉄奈良", "weekday", deps);
  assert.equal(r.kind, "found", "今回は Transit が経路を返したので found");
  assert.ok(calls.plan >= 1);
});

test("expiresAt の無い古い形式の unavailable は無視する", async () => {
  store.set(KEY_UNAVAILABLE, JSON.stringify({ kind: "unavailable", reason: "旧形式" }));
  const { deps, calls } = makeDeps();
  await resolveLastTrain(HUB_BY_ID.kyoto, "近鉄奈良", "weekday", deps);
  assert.ok(calls.plan >= 1);
});

test("壊れた JSON が入っていても落ちず、Transit をやり直す", async () => {
  store.set(KEY_FOUND, "{not json");
  const { deps, calls } = makeDeps();
  const r = await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps);
  assert.equal(r.kind, "found");
  assert.equal(calls.plan, 1);
  assert.doesNotThrow(() => JSON.parse(store.get(KEY_FOUND)!), "正しい値で上書きされる");
});

test("localStorage.setItem が失敗（容量超過など）しても結果は返り、メモリには残る", async () => {
  setItemThrows = true;
  const { deps, calls } = makeDeps();
  const a = await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps);
  assert.equal(a.kind, "found");
  assert.equal(store.size, 0);
  const b = await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps);
  assert.deepEqual(a, b);
  assert.equal(calls.plan, 1, "メモリキャッシュは効く");
});

test("キーは ハブ id・自宅駅・曜日・日付 で分かれる", async () => {
  const { deps } = makeDeps();
  await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", deps);
  await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekend", deps);
  await resolveLastTrain(HUB_BY_ID.demachiyanagi, "宇治", "weekday", deps);
  await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday", { ...deps, dateFor: () => "20260830" });
  assert.deepEqual(
    [...store.keys()].sort(),
    ["lt:demachiyanagi:宇治:weekday:20260829", "lt:sanjo:宇治:weekday:20260829", "lt:sanjo:宇治:weekday:20260830", "lt:sanjo:宇治:weekend:20260829"],
  );
});
