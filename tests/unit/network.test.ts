// 実行: npm run test:unit
// data/network.ts — 候補地 → ハブ の表（VENUES）とデモ用既定値。calc.ts / Planner が前提にしている形を固定する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { HUBS } from "../../data/hubs.ts";
import { DEFAULT_MEMBERS, DEFAULT_VENUE_IDS, VENUES, derivedLastDepart, undeterminedCells, venuesFor } from "../../data/network.ts";
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

test("lastDepart が null なのは、候補地がハブそのもの か 徒歩接続（三条→京都河原町）だけ", () => {
  const nulls: string[] = [];
  for (const v of VENUES) {
    for (const [hub, cell] of Object.entries(v.toHub)) {
      if (cell && cell.lastDepart === null) nulls.push(`${v.id}→${hub}`);
    }
  }
  assert.deepEqual(nulls.sort(), [
    "demachiyanagi→demachiyanagi",
    "karasumaoike→karasumaoike",
    "kyoto→kyoto",
    "sanjo→kawaramachi", // 四条大橋を渡って徒歩。電車の制約なし
    "sanjo→sanjo",
    "shijo→shijo",
  ]);
});

test("候補地自身への所要は 0、それ以外は 0 より大きい（徒歩接続も所要は持つ）", () => {
  for (const v of VENUES) {
    for (const [hub, cell] of Object.entries(v.toHub)) {
      if (!cell) continue;
      if (hub === v.id) assert.equal(cell.transitMin, 0, `${v.name} 自身への所要が 0 でない`);
      else assert.ok(cell.transitMin > 0, `${v.name} → ${hub} の所要が 0`);
    }
  }
});

test("venuesFor: 平日と土日で候補地の並び・id は同じ。導出セルはローカル JSON の値に一致する", () => {
  const wd = venuesFor("weekday");
  const we = venuesFor("weekend");
  assert.deepEqual(wd.map((v) => v.id), we.map((v) => v.id));
  assert.deepEqual(VENUES, wd, "VENUES は weekday の結果");
  // 四条 → 烏丸御池（烏丸線 北行き）は導出される
  assert.equal(wd.find((v) => v.id === "shijo")!.toHub.karasumaoike!.lastDepart, "23:50");
});

test("undeterminedCells: 暫定値のままのセルは null でも導出済みでもない", () => {
  const undetermined = undeterminedCells("weekday");
  assert.ok(undetermined.length > 0);
  for (const c of undetermined) {
    const cell = VENUES.find((v) => v.id === c.venue)!.toHub[c.hub]!;
    assert.equal(cell.lastDepart, c.fallback, `${c.venue}→${c.hub} は暫定値のはず`);
    assert.match(c.fallback, /^\d{2}:\d{2}$/);
  }
  // 導出できたセルは undetermined に入らない
  assert.ok(!undetermined.some((c) => c.venue === "shijo" && c.hub === "karasumaoike"));
});

test("derivedLastDepart: 未知のハブ id は null", () => {
  assert.equal(derivedLastDepart({ id: "x", name: "x", stations: ["四条"], toHub: {} }, "nowhere", "weekday"), null);
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
