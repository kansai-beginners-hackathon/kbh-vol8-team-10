import test from "node:test";
import assert from "node:assert/strict";
import { calculateLatestDepartureForLocation } from "../../lib/return-home.ts";

test("四条の最終帰宅時間が計算できる", () => {
  const result = calculateLatestDepartureForLocation("四条", 5, 3);

  assert.equal(result.locationName, "四条");
  assert.equal(result.mustLeaveAt, "23:56");
  assert.equal(result.mostLateRoute.mode, "阪急");
  assert.equal(result.mostLateRoute.lastDepart, "24:10");
});

test("京都駅の最終帰宅時間が計算できる", () => {
  const result = calculateLatestDepartureForLocation("京都駅", 5, 3);

  assert.equal(result.locationName, "京都駅");
  assert.equal(result.mustLeaveAt, "23:32");
});

// ---- 追加: 引数の既定値・エラー・返り値の形（data/last-train-direct-range.json と突き合わせる）
import fs from "node:fs";
import path from "node:path";
import { toMin } from "../../lib/time.ts";

type Dataset = { locations: { id: string; name: string; routes: { mode: string; hub: string; lastDepart: string; travelMin: number }[] }[] };
const dataset = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, "../../data/last-train-direct-range.json"), "utf8"),
) as Dataset;

test("既定は walkMin=5, bufferMin=0（四条は 23:59）", () => {
  const r = calculateLatestDepartureForLocation("四条");
  assert.equal(r.walkMin, 5);
  assert.equal(r.bufferMin, 0);
  assert.equal(r.mustLeaveAt, "23:59");
});

test("bufferMin を増やすと mustLeaveAt はその分早くなる", () => {
  const a = calculateLatestDepartureForLocation("四条", 5, 0);
  const b = calculateLatestDepartureForLocation("四条", 5, 10);
  assert.equal(a.mustLeaveAtMinutes - b.mustLeaveAtMinutes, 10);
});

test("walkMin を増やしても同じだけ早くなる", () => {
  const a = calculateLatestDepartureForLocation("京都駅", 0, 0);
  const b = calculateLatestDepartureForLocation("京都駅", 15, 0);
  assert.equal(a.mustLeaveAtMinutes - b.mustLeaveAtMinutes, 15);
});

test("未知の場所は Location not found で throw", () => {
  assert.throws(() => calculateLatestDepartureForLocation("存在しない場所"), /Location not found: 存在しない場所/);
});

test("データにある 8 地点はすべて計算できる", () => {
  assert.equal(dataset.locations.length, 8);
  for (const loc of dataset.locations) {
    const r = calculateLatestDepartureForLocation(loc.name);
    assert.equal(r.locationId, loc.id);
    assert.equal(r.locationName, loc.name);
    assert.match(r.mustLeaveAt, /^\d{2}:\d{2}$/);
  }
});

test("routes はデータの経路と同数で、各行に earliestReturnDeadline / mustLeaveAt が HH:MM で入る", () => {
  const loc = dataset.locations.find((l) => l.name === "出町柳")!;
  const r = calculateLatestDepartureForLocation("出町柳", 5, 0);
  assert.equal(r.routes.length, loc.routes.length);
  for (const [i, row] of r.routes.entries()) {
    assert.equal(row.mode, loc.routes[i].mode);
    assert.equal(row.hub, loc.routes[i].hub);
    assert.equal(row.lastDepart, loc.routes[i].lastDepart);
    assert.equal(row.travelMin, loc.routes[i].travelMin);
    assert.match(row.earliestReturnDeadline, /^\d{2}:\d{2}$/);
    assert.match(row.mustLeaveAt, /^\d{2}:\d{2}$/);
    // mustLeaveAt = lastDepart − travelMin − walkMin
    assert.equal(toMin(row.mustLeaveAt), toMin(row.lastDepart) - row.travelMin - 5);
    assert.equal(toMin(row.earliestReturnDeadline), toMin(row.lastDepart) - row.travelMin);
  }
});

test("mostLateRoute は routes の中で mustLeaveAt が最も遅い経路", () => {
  const r = calculateLatestDepartureForLocation("三条", 5, 0);
  const latest = Math.max(...r.routes.map((x) => toMin(x.mustLeaveAt)));
  assert.equal(r.mustLeaveAtMinutes, latest);
  assert.equal(toMin(r.mustLeaveAt), latest);
  const picked = r.routes.find((x) => x.hub === r.mostLateRoute.hub && x.mode === r.mostLateRoute.mode)!;
  assert.equal(toMin(picked.mustLeaveAt), latest);
  assert.equal(r.latestPossibleArrivalAt, picked.earliestReturnDeadline);
});

test("徒歩・余裕が大きすぎて負になっても 00:00 で止まる（表示が壊れない）", () => {
  const r = calculateLatestDepartureForLocation("四条", 1000, 1000);
  assert.equal(r.mustLeaveAt, "00:00");
  assert.ok(r.mustLeaveAtMinutes < 0, "分の値はそのまま負");
});
