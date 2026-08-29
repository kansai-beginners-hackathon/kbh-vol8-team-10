// 実行: npm run test:unit
// lib/time.ts — "HH:MM" と分の相互変換。24 時台（"24:05"）を文字列比較せず分で扱えることが要点。
import { test } from "node:test";
import assert from "node:assert/strict";
import { isHHMM, toMin, toStr } from "../../lib/time.ts";

// ---- toMin
test("toMin: 通常の時刻", () => {
  assert.equal(toMin("00:00"), 0);
  assert.equal(toMin("09:30"), 570);
  assert.equal(toMin("23:59"), 1439);
});

test("toMin: 24 時台はそのまま分に直す（24:05 → 1445。00:05 の 5 ではない）", () => {
  assert.equal(toMin("24:05"), 1445);
  assert.equal(toMin("25:00"), 1500);
});

test("toMin: 1 桁の時も読める", () => {
  assert.equal(toMin("9:05"), 545);
});

test("toMin: 文字列比較では逆転する組が、分では正しく順序づく", () => {
  // "24:05" < "9:30" は文字列比較だと true（先頭の '2' < '9'）。分なら 1445 > 570
  assert.ok("24:05" < "9:30");
  assert.ok(toMin("24:05") > toMin("9:30"));
  assert.ok("23:50" < "9:30");
  assert.ok(toMin("23:50") > toMin("9:30"));
});

// ---- toStr
test("toStr: 分 → HH:MM（0 埋め）", () => {
  assert.equal(toStr(0), "00:00");
  assert.equal(toStr(570), "09:30");
  assert.equal(toStr(1439), "23:59");
});

test("toStr: 24 時台は表示用に 00 時台へ折り返す", () => {
  assert.equal(toStr(1445), "00:05");
  assert.equal(toStr(1440), "00:00");
});

test("toStr: 小数の分は切り捨てて表示しない（呼び出し側は整数を渡す前提）だが、整数なら往復する", () => {
  for (const t of ["00:00", "07:15", "23:57", "12:00"]) assert.equal(toStr(toMin(t)), t);
});

test("toStr: toStr(toMin(24 時台)) は 00 時台になる（表示の折り返し）", () => {
  assert.equal(toStr(toMin("24:10")), "00:10");
});

// ---- isHHMM
test("isHHMM: 受け付ける形", () => {
  assert.equal(isHHMM("19:00"), true);
  assert.equal(isHHMM("9:00"), true, "1 桁の時も OK");
  assert.equal(isHHMM("24:05"), true, "24 時台も OK");
});

test("isHHMM: 受け付けない形", () => {
  assert.equal(isHHMM(null), false);
  assert.equal(isHHMM(""), false);
  assert.equal(isHHMM("abc"), false);
  assert.equal(isHHMM("19:0"), false, "分は 2 桁");
  assert.equal(isHHMM("19:000"), false);
  assert.equal(isHHMM("119:00"), false, "時は 2 桁まで");
  assert.equal(isHHMM("19-00"), false);
  assert.equal(isHHMM(" 19:00"), false, "前後の空白は不可");
});
