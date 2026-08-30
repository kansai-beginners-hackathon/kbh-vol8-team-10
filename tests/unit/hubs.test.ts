// 実行: npm run test:unit
// data/hubs.ts — ハブ 7 駅の定義とヘルパー。値そのものより「他モジュールが前提にしている性質」を固定する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { HUBS, HUB_BY_ID, hubGeo, hubNames } from "../../data/hubs.ts";

test("HUBS は 7 駅で id が重複しない", () => {
  assert.equal(HUBS.length, 7);
  assert.equal(new Set(HUBS.map((h) => h.id)).size, 7);
  assert.deepEqual(
    HUBS.map((h) => h.id).sort(),
    ["demachiyanagi", "karasumaoike", "kawaramachi", "kyoto", "sanjo", "shijo", "shijoomiya"],
  );
});

test("HUB_BY_ID は HUBS の全要素を id で引ける", () => {
  for (const hub of HUBS) assert.equal(HUB_BY_ID[hub.id], hub);
  assert.equal(Object.keys(HUB_BY_ID).length, HUBS.length);
});

test("hubNames: name + aliases（name が先頭）", () => {
  assert.deepEqual(hubNames(HUB_BY_ID.sanjo), ["三条", "三条京阪"]);
  assert.deepEqual(hubNames(HUB_BY_ID.shijo), ["四条", "烏丸"]);
  assert.deepEqual(hubNames(HUB_BY_ID.shijoomiya), ["四条大宮", "大宮"]);
  assert.deepEqual(hubNames(HUB_BY_ID.demachiyanagi), ["出町柳"]);
});

test("hubGeo: Transit の from に渡す geo:lat,lon", () => {
  assert.equal(hubGeo(HUB_BY_ID.sanjo), "geo:35.00879,135.772337");
  assert.equal(hubGeo(HUB_BY_ID.shijo), "geo:35.00275,135.759673");
  for (const hub of HUBS) assert.match(hubGeo(hub), /^geo:\d+\.\d+,\d+\.\d+$/);
});

test("座標は京都市内（緯度 34.9〜35.1 / 経度 135.7〜135.8）", () => {
  for (const hub of HUBS) {
    assert.ok(hub.lat > 34.9 && hub.lat < 35.1, `${hub.name} lat=${hub.lat}`);
    assert.ok(hub.lon > 135.7 && hub.lon < 135.8, `${hub.name} lon=${hub.lon}`);
  }
});

test("transferMin は 0 より大きい整数（ハブ到着→支線乗車の乗換分）", () => {
  for (const hub of HUBS) {
    assert.ok(Number.isInteger(hub.transferMin) && hub.transferMin > 0, `${hub.name} transferMin=${hub.transferMin}`);
  }
});

test("stationIds は 1 件以上あり、すべて feed:駅 の形。新幹線は含まない", () => {
  for (const hub of HUBS) {
    assert.ok(hub.stationIds.length >= 1, `${hub.name} に stationIds が無い`);
    for (const id of hub.stationIds) {
      assert.match(id, /^[a-z0-9-]+:.+/, `${hub.name} ${id}`);
      assert.ok(!/新幹線|shinkansen/i.test(id), `${hub.name} に新幹線 ${id}`);
    }
  }
});

test("subwayOnly は地下鉄しか無いハブ（烏丸御池・四条）だけ", () => {
  assert.deepEqual(HUBS.filter((h) => h.subwayOnly).map((h) => h.id).sort(), ["karasumaoike", "shijo"]);
});

test("aliases に name 自身は含めない（hubNames が重複しないように）", () => {
  for (const hub of HUBS) {
    assert.ok(!hub.aliases.includes(hub.name), `${hub.name}`);
    assert.equal(new Set(hubNames(hub)).size, hubNames(hub).length);
  }
});
