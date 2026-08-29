// 実行: npm test
// 候補地 → ハブ の最終が、同じ路線ならローカル JSON から導出されていることを確認する
import { test } from "node:test";
import assert from "node:assert/strict";
import { undeterminedCells, venuesFor, VENUES } from "../data/network.ts";
import { lastTrainBetween } from "../lib/lastTrain.ts";
import { ALL_LAST_TRAINS, ALL_LINES } from "../lib/localData.ts";

const cell = (venueId: string, hub: string, dayType: "weekday" | "weekend" = "weekday") =>
  venuesFor(dayType).find((v) => v.id === venueId)!.toHub[hub]!;

test("同じ路線のセルはローカル JSON の値になる（四条→烏丸御池 = 烏丸線 北行きの最終）", () => {
  const expected = lastTrainBetween(ALL_LINES, ALL_LAST_TRAINS, "四条", "烏丸御池", "weekday");
  assert.equal(expected.kind, "found");
  assert.equal(cell("shijo", "karasumaoike").lastDepart, expected.kind === "found" ? expected.time : "");
  assert.equal(cell("shijo", "karasumaoike").lastDepart, "23:50");
});

test("烏丸御池→四条 は 23:55（旧・手打ち 24:00 より早い）", () => {
  assert.equal(cell("karasumaoike", "shijo").lastDepart, "23:55");
});

test("三条→出町柳 は京阪 24:23、出町柳→三条 は 23:57", () => {
  assert.equal(cell("sanjo", "demachiyanagi").lastDepart, "24:23");
  assert.equal(cell("demachiyanagi", "sanjo").lastDepart, "23:57");
});

test("四条→京都河原町 は阪急（烏丸→京都河原町）24:32、四条→四条大宮 は阪急（烏丸→大宮）24:12", () => {
  assert.equal(cell("shijo", "kawaramachi").lastDepart, "24:32");
  assert.equal(cell("shijo", "shijoomiya").lastDepart, "24:12");
});

test("三条→烏丸御池 は東西線（三条京阪→烏丸御池）23:49", () => {
  assert.equal(cell("sanjo", "karasumaoike").lastDepart, "23:49");
});

test("ハブそのもの / 徒歩 は null のまま（導出しない）", () => {
  assert.equal(cell("shijo", "shijo").lastDepart, null);
  assert.equal(cell("sanjo", "kawaramachi").lastDepart, null, "三条→河原町は徒歩");
});

test("導出できないセルは暫定値を使う（四条→三条 は乗換が要る）", () => {
  assert.equal(cell("shijo", "sanjo").lastDepart, "23:50");
  assert.ok(undeterminedCells("weekday").some((c) => c.venue === "shijo" && c.hub === "sanjo"));
});

test("transitMin は手打ちのまま", () => {
  assert.equal(cell("shijo", "karasumaoike").transitMin, 5);
});

test("VENUES は id / name の参照用に 8 候補地を持つ", () => {
  assert.deepEqual(VENUES.map((v) => v.id), ["shijo", "kyoto", "karasumaoike", "sanjo", "demachiyanagi", "kitaoji", "yamashina", "katsura"]);
});
