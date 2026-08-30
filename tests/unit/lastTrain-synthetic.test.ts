// 実行: npm run test:unit
// lib/lastTrain.ts を実データに依存しない小さな路線で検証する（tests/unit/lastTrain.test.ts は実データ版）。
// reachIndex / passes の分岐（自駅止まり・through・逆方向・時刻欠け・時刻表欠け）を 1 つずつ踏む。
import { test } from "node:test";
import assert from "node:assert/strict";
import { lastTrainBetween, type LastTrainsData, type LinesData } from "../../lib/lastTrain.ts";

/** A - B - C - D の 1 路線。路線外の行き先 X は C まで通る（through） */
const lines: LinesData = {
  lines: [{ lineId: "L", lineName: "テスト線", stations: ["A", "B", "C", "D"], through: { X: "C" } }],
};

const dest = (name: string, weekday: string, weekend = weekday) => ({ name, weekday, weekend });

const lastTrains: LastTrainsData = {
  stations: [
    {
      name: "A",
      lines: [
        {
          lineId: "L",
          destinations: [
            dest("D", "23:00", "22:00"), // 終点行き
            dest("X", "23:30", ""), // 路線外だが through で C まで。weekend は時刻無し
            dest("A", "23:59"), // 自駅止まり（end === i）→ どこにも行かない
            dest("Z", "23:58"), // 路線外で through にも無い → 判定不能で候補外
            dest("B", "23:45"), // 1 駅先止まり
          ],
        },
      ],
    },
    { name: "B", lines: [{ lineId: "L", destinations: [dest("A", "23:10"), dest("D", "23:20")] }] },
    { name: "C", lines: [] }, // 駅順にはあるが時刻データが無い
    { name: "D", lines: [{ lineId: "L", destinations: [dest("A", "23:05")] }] },
  ],
};

const q = (from: string, to: string, day: "weekday" | "weekend" = "weekday") => lastTrainBetween(lines, lastTrains, from, to, day);

test("A → B: D行き 23:00・X行き 23:30・B行き 23:45 が通る。一番遅い B行き 23:45", () => {
  assert.deepEqual(q("A", "B"), { kind: "found", time: "23:45", headsign: "B", lineName: "テスト線" });
});

test("A → C: B行きは届かない。through の X行き 23:30 が最遅", () => {
  assert.deepEqual(q("A", "C"), { kind: "found", time: "23:30", headsign: "X", lineName: "テスト線" });
});

test("A → D: X行きは C 止まり（through）なので届かない → D行き 23:00", () => {
  assert.deepEqual(q("A", "D"), { kind: "found", time: "23:00", headsign: "D", lineName: "テスト線" });
});

test("weekend: 時刻が空の行き先は候補にしない（X行き weekend '' → D行き 22:00 が残るが B行き 23:45 が最遅）", () => {
  assert.deepEqual(q("A", "B", "weekend"), { kind: "found", time: "23:45", headsign: "B", lineName: "テスト線" });
  assert.deepEqual(q("A", "C", "weekend"), { kind: "found", time: "22:00", headsign: "D", lineName: "テスト線" });
});

test("自駅止まり（A行き from A）と判定不能な行き先（Z行き）は最遅でも採らない", () => {
  // どちらも 23:58/23:59 で最も遅いが、結果に出てこない
  for (const to of ["B", "C", "D"]) {
    const r = q("A", to);
    assert.equal(r.kind, "found");
    assert.ok(r.kind === "found" && !["A", "Z"].includes(r.headsign), `${to}: ${JSON.stringify(r)}`);
  }
});

test("逆方向: B → A は A行き 23:10（D行きは反対向き）", () => {
  assert.deepEqual(q("B", "A"), { kind: "found", time: "23:10", headsign: "A", lineName: "テスト線" });
});

test("逆方向: D → A は終点発 23:05、D → B も同じ便", () => {
  assert.deepEqual(q("D", "A"), { kind: "found", time: "23:05", headsign: "A", lineName: "テスト線" });
  assert.deepEqual(q("D", "B"), { kind: "found", time: "23:05", headsign: "A", lineName: "テスト線" });
});

test("B → C: D行き 23:20 が通る", () => {
  assert.deepEqual(q("B", "C"), { kind: "found", time: "23:20", headsign: "D", lineName: "テスト線" });
});

test("時刻表の無い駅（C）から出る便は無い → needsTransfer（両駅とも収録済み）", () => {
  assert.deepEqual(q("C", "D"), { kind: "needsTransfer" });
  assert.deepEqual(q("C", "A"), { kind: "needsTransfer" });
});

test("同じ駅 → noTrainNeeded（収録の有無より先に判定）", () => {
  assert.deepEqual(q("A", "A"), { kind: "noTrainNeeded" });
  assert.deepEqual(q("未収録", "未収録"), { kind: "noTrainNeeded" });
});

test("未収録の駅 → unknownStation", () => {
  assert.deepEqual(q("A", "Q"), { kind: "unknownStation" });
  assert.deepEqual(q("Q", "A"), { kind: "unknownStation" });
  assert.deepEqual(q("X", "A"), { kind: "unknownStation" }, "行き先名として出ても駅として収録されていなければ unknown");
});

test("駅名は完全一致（前後の空白や『駅』付きは別名扱い）", () => {
  assert.deepEqual(q("A ", "B"), { kind: "unknownStation" });
  assert.deepEqual(q("A", "B駅"), { kind: "unknownStation" });
});

test("複数路線に両駅が乗る場合は路線を横断して一番遅い便", () => {
  const twoLines: LinesData = {
    lines: [
      { lineId: "L1", lineName: "遅い線", stations: ["P", "Q"] },
      { lineId: "L2", lineName: "早い線", stations: ["P", "R", "Q"] },
    ],
  };
  const data: LastTrainsData = {
    stations: [
      {
        name: "P",
        lines: [
          { lineId: "L1", destinations: [dest("Q", "23:40")] },
          { lineId: "L2", destinations: [dest("Q", "23:55")] },
        ],
      },
      { name: "Q", lines: [] },
    ],
  };
  assert.deepEqual(lastTrainBetween(twoLines, data, "P", "Q", "weekday"), { kind: "found", time: "23:55", headsign: "Q", lineName: "早い線" });
});

test("24 時台の時刻は 23 時台より遅いと判定される", () => {
  const data: LastTrainsData = {
    stations: [
      { name: "A", lines: [{ lineId: "L", destinations: [dest("D", "23:59"), dest("C", "24:05")] }] },
      { name: "B", lines: [] },
      { name: "C", lines: [] },
      { name: "D", lines: [] },
    ],
  };
  assert.deepEqual(lastTrainBetween(lines, data, "A", "B", "weekday"), { kind: "found", time: "24:05", headsign: "C", lineName: "テスト線" });
});

test("through 先の駅が路線上に無ければ判定不能として候補外", () => {
  const broken: LinesData = { lines: [{ lineId: "L", lineName: "壊", stations: ["A", "B"], through: { X: "存在しない" } }] };
  const data: LastTrainsData = { stations: [{ name: "A", lines: [{ lineId: "L", destinations: [dest("X", "23:30")] }] }, { name: "B", lines: [] }] };
  assert.deepEqual(lastTrainBetween(broken, data, "A", "B", "weekday"), { kind: "needsTransfer" });
});
