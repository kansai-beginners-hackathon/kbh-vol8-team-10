import test from "node:test";
import assert from "node:assert/strict";
import { calculateLatestDepartureForLocation } from "../lib/return-home.js";

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
