// 実行: npm test（tests/unit と tests/integration を node --test で回す）
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lastTrainBetween, type LastTrainsData, type LinesData } from "../../lib/lastTrain.ts";
import { toMin } from "../../lib/time.ts";

const root = path.resolve(import.meta.dirname, "../..");
const lines = JSON.parse(fs.readFileSync(path.join(root, "data/subway-lines.json"), "utf8")) as LinesData;
const lastTrains = JSON.parse(
  fs.readFileSync(path.join(root, "data/subway-last-trains.json"), "utf8"),
) as LastTrainsData;

const q = (from: string, to: string, day: "weekday" | "weekend" = "weekday") =>
  lastTrainBetween(lines, lastTrains, from, to, day);

// ---- 基本（期待値は data/subway-last-trains.json の実値）
test("四条 → 五条: 南行きの最終は竹田行き 23:57", () => {
  assert.deepEqual(q("四条", "五条"), { kind: "found", time: "23:57", headsign: "竹田", lineName: "烏丸線" });
});

test("京都 → 鞍馬口: 北行きの最終は国際会館行き 23:47", () => {
  assert.deepEqual(q("京都", "鞍馬口"), { kind: "found", time: "23:47", headsign: "国際会館", lineName: "烏丸線" });
});

test("四条 → 鞍馬口: 駅の最終(23:57 竹田)ではなく北行きの 23:50", () => {
  assert.deepEqual(q("四条", "鞍馬口"), { kind: "found", time: "23:50", headsign: "国際会館", lineName: "烏丸線" });
});

test("weekend でも同じ分岐を通る（四条 → 五条）", () => {
  assert.deepEqual(q("四条", "五条", "weekend"), { kind: "found", time: "23:57", headsign: "竹田", lineName: "烏丸線" });
});

// ---- 東西線と分岐（through）
test("烏丸御池 → 山科: びわ湖浜大津行き(御陵で分岐)は除外され六地蔵行き 23:55", () => {
  assert.deepEqual(q("烏丸御池", "山科"), { kind: "found", time: "23:55", headsign: "六地蔵", lineName: "東西線" });
});

test("烏丸御池 → 御陵: 分岐手前なので六地蔵行きと浜大津行きの遅い方 23:55", () => {
  const r = q("烏丸御池", "御陵");
  assert.equal(r.kind, "found");
  assert.equal(r.kind === "found" && r.time, "23:55");
  assert.equal(r.kind === "found" && r.lineName, "東西線");
});

test("太秦天神川 → 二条: 東西線の東行き（始発駅発）は六地蔵行き 23:45", () => {
  assert.deepEqual(q("太秦天神川", "二条"), { kind: "found", time: "23:45", headsign: "六地蔵", lineName: "東西線" });
});

test("六地蔵 → 山科: 東西線の西行き（終点発）", () => {
  assert.deepEqual(q("六地蔵", "山科"), { kind: "found", time: "23:28", headsign: "太秦天神川", lineName: "東西線" });
});

test("竹田 → 国際会館: 烏丸線の終点発は 23:40", () => {
  assert.deepEqual(q("竹田", "国際会館"), { kind: "found", time: "23:40", headsign: "国際会館", lineName: "烏丸線" });
});

// ---- 2 路線駅
test("烏丸御池 → 五条: 烏丸線側が選ばれる", () => {
  assert.deepEqual(q("烏丸御池", "五条"), { kind: "found", time: "23:55", headsign: "竹田", lineName: "烏丸線" });
});

// ---- 見つからないケース（理由付き）
test("四条 → 山科: 同じ路線に無い（乗換が要る）→ needsTransfer", () => {
  assert.deepEqual(q("四条", "山科"), { kind: "needsTransfer" });
});

test("四条 → 近鉄奈良: 行き先名ではあるが収録駅ではない → unknownStation（Transit へ）", () => {
  assert.deepEqual(q("四条", "近鉄奈良"), { kind: "unknownStation" });
});

test("竹田 → 新田辺: 近鉄線の駅は収録外 → unknownStation", () => {
  assert.deepEqual(q("竹田", "新田辺"), { kind: "unknownStation" });
});

test("同一駅 → noTrainNeeded（電車不要。終電の制約から外す）", () => {
  assert.deepEqual(q("四条", "四条"), { kind: "noTrainNeeded" });
});

test("未収録の駅 → unknownStation（どちら側でも）", () => {
  assert.deepEqual(q("四条", "梅田"), { kind: "unknownStation" });
  assert.deepEqual(q("梅田", "四条"), { kind: "unknownStation" });
});

// ---- データ品質: 同一路線・同一行き先の最終は、行き先へ向かって駅順に単調増加
//      （途中止まりの便が終点行きに丸められていると、ここで崩れる）
test("同一行き先の最終時刻は駅順に単調増加している", () => {
  for (const line of lines.lines) {
    const timeAt = (name: string, dest: string, day: "weekday" | "weekend") =>
      lastTrains.stations
        .find((s) => s.name === name)
        ?.lines.find((x) => x.lineId === line.lineId)
        ?.destinations.find((x) => x.name === dest)?.[day];

    const dests = new Set<string>();
    for (const s of lastTrains.stations) {
      s.lines.find((x) => x.lineId === line.lineId)?.destinations.forEach((d) => dests.add(d.name));
    }

    for (const dest of dests) {
      const endIdx = line.stations.indexOf(line.stations.includes(dest) ? dest : (line.through?.[dest] ?? ""));
      if (endIdx < 0) continue;
      for (const day of ["weekday", "weekend"] as const) {
        // 行き先へ向かう順に駅を並べる（endIdx より手前の駅は昇順、先の駅は降順）
        const forward = line.stations.slice(0, endIdx);
        const backward = line.stations.slice(endIdx + 1).reverse();
        for (const group of [forward, backward]) {
          let prev: { name: string; min: number } | null = null;
          for (const name of group) {
            const time = timeAt(name, dest, day);
            if (!time) continue;
            const min = toMin(time);
            if (prev) {
              assert.ok(min >= prev.min, `${line.lineName} ${dest}行き(${day}): ${prev.name} ${prev.min} → ${name} ${min} で逆転`);
            }
            prev = { name, min };
          }
        }
      }
    }
  }
});
