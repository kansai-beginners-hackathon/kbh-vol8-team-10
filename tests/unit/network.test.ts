// 実行: npm run test:unit
// data/network.ts — 候補地 → ハブ の表（VENUES）とデモ用既定値。calc.ts / Planner が前提にしている形を固定する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { HUBS } from "../../data/hubs.ts";
import { DEFAULT_MEMBERS, DEFAULT_VENUE_IDS, VENUES } from "../../data/network.ts";
import { isHHMM, toMin } from "../../lib/time.ts";

const hubIds = new Set(HUBS.map((h) => h.id));

test("VENUES は 8 候補地で id・name が重複しない", () => {
  assert.equal(VENUES.length, 8);
  assert.equal(new Set(VENUES.map((v) => v.id)).size, VENUES.length);
  assert.equal(new Set(VENUES.map((v) => v.name)).size, VENUES.length);
});

test("toHub のキーはすべて data/hubs.ts のハブ id", () => {
  for (const v of VENUES) {
    for (const hub of Object.keys(v.toHub)) assert.ok(hubIds.has(hub), `${v.name} → 未知のハブ ${hub}`);
  }
});

test("各候補地は 7 ハブ全部への行き方を持つ", () => {
  for (const v of VENUES) assert.equal(Object.keys(v.toHub).length, HUBS.length, v.name);
});

test("候補地がハブそのもののときだけ lastDepart null・transitMin 0（id がハブ id と一致）", () => {
  for (const v of VENUES) {
    for (const [hub, cell] of Object.entries(v.toHub)) {
      if (!cell) continue;
      if (cell.lastDepart === null) {
        assert.equal(hub, v.id, `${v.name} の ${hub} が null だが候補地自身ではない`);
        assert.equal(cell.transitMin, 0, `${v.name} 自身への所要が 0 でない`);
      } else {
        assert.ok(cell.transitMin > 0, `${v.name} → ${hub} の所要が 0`);
      }
    }
  }
});

test("ハブでもある候補地（四条・京都駅・烏丸御池・三条・出町柳）は自分自身のセルが null", () => {
  for (const id of ["shijo", "kyoto", "karasumaoike", "sanjo", "demachiyanagi"]) {
    const v = VENUES.find((x) => x.id === id)!;
    assert.equal(v.toHub[id]?.lastDepart, null, id);
  }
  // ハブでない候補地（北大路・山科・桂）は null を持たない
  for (const id of ["kitaoji", "yamashina", "katsura"]) {
    const v = VENUES.find((x) => x.id === id)!;
    assert.ok(Object.values(v.toHub).every((c) => c && c.lastDepart !== null), id);
  }
});

test("lastDepart は HH:MM で 22:00〜24:59 の範囲（終電として妥当）", () => {
  for (const v of VENUES) {
    for (const [hub, cell] of Object.entries(v.toHub)) {
      if (!cell || cell.lastDepart === null) continue;
      assert.ok(isHHMM(cell.lastDepart), `${v.name} → ${hub}: ${cell.lastDepart}`);
      const min = toMin(cell.lastDepart);
      assert.ok(min >= toMin("22:00") && min <= toMin("24:59"), `${v.name} → ${hub}: ${cell.lastDepart}`);
    }
  }
});

test("transitMin は 0〜60 の整数", () => {
  for (const v of VENUES) {
    for (const [hub, cell] of Object.entries(v.toHub)) {
      if (!cell) continue;
      assert.ok(Number.isInteger(cell.transitMin) && cell.transitMin >= 0 && cell.transitMin <= 60, `${v.name} → ${hub}: ${cell.transitMin}`);
    }
  }
});

test("DEFAULT_VENUE_IDS は VENUES に存在する id だけ・重複なし", () => {
  const ids = new Set(VENUES.map((v) => v.id));
  for (const id of DEFAULT_VENUE_IDS) assert.ok(ids.has(id), id);
  assert.equal(new Set(DEFAULT_VENUE_IDS).size, DEFAULT_VENUE_IDS.length);
  assert.ok(DEFAULT_VENUE_IDS.length >= 2, "比較できるよう 2 件以上");
});

test("DEFAULT_MEMBERS は 8 人以内で name・station が空でない", () => {
  assert.ok(DEFAULT_MEMBERS.length <= 8);
  for (const m of DEFAULT_MEMBERS) {
    assert.ok(m.name.trim().length > 0);
    assert.ok(m.station.trim().length > 0);
    assert.ok(!m.station.endsWith("駅"), `${m.station} は「駅」を付けない`);
  }
});
