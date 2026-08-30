import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStationName, STATION_ALIASES } from "../lib/stationAliases.ts";
import { ALL_LAST_TRAINS } from "../lib/localData.ts";
import { HUBS } from "../data/hubs.ts";

test("末尾の「駅」を取る", () => {
  assert.equal(normalizeStationName("鞍馬駅"), "鞍馬");
  assert.equal(normalizeStationName("京都駅"), "京都");
});

test("前後・途中の空白と全角を整える", () => {
  assert.equal(normalizeStationName("　京都　河原町　"), "京都河原町");
  assert.equal(normalizeStationName(" 烏丸御池 "), "烏丸御池");
});

test("別名を正式名称にする", () => {
  assert.equal(normalizeStationName("河原町"), "京都河原町");
  assert.equal(normalizeStationName("四条河原町駅"), "京都河原町");
  assert.equal(normalizeStationName("浜大津"), "びわ湖浜大津");
  assert.equal(normalizeStationName("梅田"), "大阪梅田");
  assert.equal(normalizeStationName("宝ヶ池"), "宝ケ池");
  assert.equal(normalizeStationName("三条(京都府)"), "三条");
});

test("正式名称はそのまま（壊さない）", () => {
  for (const name of ["烏丸", "三条京阪", "松ヶ崎", "宝ケ池", "茶山・京都芸術大学", "びわ湖浜大津", "京都河原町"]) {
    assert.equal(normalizeStationName(name), name);
  }
});

test("別名の行き先は全部、実在する駅名", () => {
  // ローカル JSON の 125 駅 + ハブの表示名・別名 + Transit で引く府外の駅
  const known = new Set<string>(ALL_LAST_TRAINS.stations.map((s) => s.name));
  for (const hub of HUBS) for (const n of [hub.name, ...hub.aliases]) known.add(n);
  for (const n of ["びわ湖浜大津", "大阪梅田"]) known.add(n);

  for (const [alias, canonical] of Object.entries(STATION_ALIASES)) {
    assert.ok(known.has(canonical), `「${alias}」→「${canonical}」の行き先がデータに無い（打ち間違い？）`);
    assert.ok(!(canonical in STATION_ALIASES), `「${canonical}」が別名の左側にもある（二段変換になる）`);
  }
});