// 実行: npm test （= node --test tests/*.test.ts）
// 地下鉄 + 私鉄 5 社の merge と、叡電の直通統合（出町柳〜鞍馬）を検証する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { lastTrainBetween, type LastTrainsData, type LinesData } from "../lib/lastTrain.ts";
import { ALL_LAST_TRAINS, ALL_LINES, isSubwayStation, mergeLastTrains, mergeLines } from "../lib/localData.ts";

const q = (from: string, to: string, day: "weekday" | "weekend" = "weekday") =>
  lastTrainBetween(ALL_LINES, ALL_LAST_TRAINS, from, to, day);

const lineIds = (name: string) =>
  (ALL_LAST_TRAINS.stations.find((s) => s.name === name)?.lines ?? []).map((l) => l.lineId).sort();

// ---- merge の性質
test("mergeLines: 地下鉄 2 + 私鉄 7 = 9 路線。lineId は重複しない", () => {
  const ids = ALL_LINES.lines.map((l) => l.lineId);
  assert.equal(ids.length, 9);
  assert.equal(new Set(ids).size, ids.length);
});

test("mergeLastTrains: 駅名は 1 件にまとまる（find で先勝ちして片方の会社を落とさない）", () => {
  const names = ALL_LAST_TRAINS.stations.map((s) => s.name);
  assert.equal(new Set(names).size, names.length);
});

test("同名の駅は複数社の路線を持つ", () => {
  assert.deepEqual(lineIds("京都"), ["karasuma", "kintetsu-kyoto"]);
  assert.deepEqual(lineIds("出町柳"), ["eizan-kurama", "eizan-main", "keihan-main"]);
  assert.deepEqual(lineIds("西院"), ["hankyu-kyoto", "randen-arashiyama"]);
});

test("mergeLines: lineId が重複したら先勝ち", () => {
  const a: LinesData = { lines: [{ lineId: "x", lineName: "先", stations: ["A", "B"] }] };
  const b: LinesData = { lines: [{ lineId: "x", lineName: "後", stations: ["C"] }, { lineId: "y", lineName: "Y", stations: [] }] };
  assert.deepEqual(mergeLines([a, b]).lines.map((l) => [l.lineId, l.lineName]), [["x", "先"], ["y", "Y"]]);
});

test("mergeLastTrains: 同じ lineId なら行き先を足す。元の JSON は書き換えない", () => {
  const dest = (name: string, weekday: string) => ({ name, weekday, weekend: weekday });
  const a: LastTrainsData = { stations: [{ name: "A", lines: [{ lineId: "x", destinations: [dest("P", "23:00")] }] }] };
  const b: LastTrainsData = {
    stations: [{ name: "A", lines: [{ lineId: "x", destinations: [dest("P", "22:00"), dest("Q", "23:30")] }, { lineId: "y", destinations: [] }] }],
  };
  const merged = mergeLastTrains([a, b]);
  assert.equal(merged.stations.length, 1);
  assert.deepEqual(merged.stations[0].lines.map((l) => l.lineId), ["x", "y"]);
  // 同じ行き先は先勝ち（後から来た 22:00 で上書きしない）
  assert.deepEqual(merged.stations[0].lines[0].destinations.map((d) => [d.name, d.weekday]), [["P", "23:00"], ["Q", "23:30"]]);
  assert.equal(a.stations[0].lines[0].destinations.length, 1, "merge 元は増えていない");
});

test("isSubwayStation: merge 後も地下鉄ファイルだけを見る", () => {
  assert.equal(isSubwayStation("四条"), true);
  assert.equal(isSubwayStation("山科"), true);
  assert.equal(isSubwayStation("鞍馬"), false, "叡電の駅は収録済みでも地下鉄駅ではない");
  assert.equal(isSubwayStation("桂"), false);
});

// ---- 叡電: 鞍馬線は全列車が出町柳発着なので、出町柳〜鞍馬 を 1 本の路線として扱う
test("出町柳 → 岩倉: 鞍馬線に直通する 23:30 二軒茶屋行き", () => {
  assert.deepEqual(q("出町柳", "岩倉"), { kind: "found", time: "23:30", headsign: "二軒茶屋", lineName: "鞍馬線（出町柳〜鞍馬）" });
});

test("出町柳 → 鞍馬: 鞍馬行きは 22:30", () => {
  assert.deepEqual(q("出町柳", "鞍馬"), { kind: "found", time: "22:30", headsign: "鞍馬", lineName: "鞍馬線（出町柳〜鞍馬）" });
});

test("岩倉 → 宝ケ池: 共用区間まで戻る 修学院行き 23:58（統合前は路線外扱いで拾えなかった）", () => {
  assert.deepEqual(q("岩倉", "宝ケ池"), { kind: "found", time: "23:58", headsign: "修学院", lineName: "鞍馬線（出町柳〜鞍馬）" });
});

test("出町柳 → 八瀬比叡山口: 叡山本線側は鞍馬行きを拾わない", () => {
  assert.deepEqual(q("出町柳", "八瀬比叡山口"), { kind: "found", time: "23:02", headsign: "八瀬比叡山口", lineName: "叡山本線" });
});

test("出町柳 → 三宅八幡: 鞍馬線に入る便は八瀬方面に来ないので八瀬比叡山口行き 23:02", () => {
  assert.deepEqual(q("出町柳", "三宅八幡"), { kind: "found", time: "23:02", headsign: "八瀬比叡山口", lineName: "叡山本線" });
});

// ---- 他社に跨る駅も乗換なしで引ける
test("出町柳 → 樟葉: 京阪本線で引ける（叡電の駅データに埋もれない）", () => {
  const r = q("出町柳", "樟葉");
  assert.equal(r.kind, "found");
  assert.equal(r.kind === "found" ? r.lineName : "", "京阪本線・鴨東線");
});

test("京都 → 新田辺: 近鉄京都線で引ける（地下鉄の京都に埋もれない）", () => {
  const r = q("京都", "新田辺");
  assert.equal(r.kind, "found");
  assert.equal(r.kind === "found" ? r.lineName : "", "近鉄京都線");
});

test("烏丸 → 桂: 阪急京都線（四条ハブの別名から引ける）", () => {
  const r = q("烏丸", "桂");
  assert.equal(r.kind, "found");
  assert.equal(r.kind === "found" ? r.lineName : "", "阪急京都線");
});

test("嵐山 → 四条大宮: 嵐山本線", () => {
  const r = q("嵐山", "四条大宮");
  assert.equal(r.kind, "found");
  assert.equal(r.kind === "found" ? r.lineName : "", "嵐山本線");
});

test("四条大宮 → 北野白梅町: 帷子ノ辻での乗換が要る → needsTransfer", () => {
  assert.deepEqual(q("四条大宮", "北野白梅町"), { kind: "needsTransfer" });
});
