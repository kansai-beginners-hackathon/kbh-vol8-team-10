// 実行: npm run test:unit
// lib/calc.ts — 要件定義 §6 の式（最遅出発 = max over 経路 of min(支線, 幹線) − 徒歩）と順位付け、タクシー概算。
import { test } from "node:test";
import assert from "node:assert/strict";
import { bestRoute, latestLeave, rankVenues, resultFor, taxiFare } from "../../lib/calc.ts";
import { toMin } from "../../lib/time.ts";
import type { Member, Route, Station, Venue } from "../../lib/types.ts";

const route = (hub: string, last: string | null, transferMin: number, over: Partial<Route> = {}): Route => ({
  hub, last, transferMin, via: "local", transferCount: 0, ...over,
});
const station = (name: string, routes: Route[]): Station => ({ name, routes, taxiKm: 0 });

/** 四条っぽい候補地。shijo はハブそのもの（transitMin 0 / lastDepart null） */
const venue: Venue = {
  id: "shijo",
  name: "四条",
  toHub: {
    shijo: { transitMin: 0, lastDepart: null },
    karasumaoike: { transitMin: 5, lastDepart: "23:55" },
    kyoto: { transitMin: 8, lastDepart: "23:47" },
  },
};

// ---- bestRoute: 式の各項
test("bestRoute: 支線が縛る（支線最終 − transitMin − transferMin < 幹線最終）", () => {
  // 23:50 − 5 − 3 = 23:42 < 23:55
  const st = station("A", [route("karasumaoike", "23:50", 3)]);
  const r = bestRoute(st, venue);
  assert.ok(r);
  assert.equal(r.value, toMin("23:42"));
  assert.equal(r.route.hub, "karasumaoike");
});

test("bestRoute: 幹線が縛る（候補地→ハブの最終の方が早い）", () => {
  // 支線側 24:10 − 8 − 8 = 23:54、幹線 23:47 → 23:47
  const st = station("B", [route("kyoto", "24:10", 8)]);
  assert.equal(bestRoute(st, venue)?.value, toMin("23:47"));
});

test("bestRoute: 24 時台の支線最終も分で計算する（文字列比較しない）", () => {
  // 24:05 − 5 − 3 = 23:57 だが幹線 23:55 が縛る → 23:55
  const st = station("C", [route("karasumaoike", "24:05", 3)]);
  assert.equal(bestRoute(st, venue)?.value, toMin("23:55"));
});

test("bestRoute: 複数経路なら一番遅くなる経路を採る", () => {
  const st = station("D", [
    route("karasumaoike", "23:30", 3), // 23:22
    route("kyoto", "23:50", 8), // min(23:34, 23:47) = 23:34
  ]);
  const r = bestRoute(st, venue);
  assert.equal(r?.route.hub, "kyoto");
  assert.equal(r?.value, toMin("23:34"));
});

test("bestRoute: 候補地から行けないハブの経路は除外。全部除外なら null", () => {
  const st = station("E", [route("demachiyanagi", "23:50", 5), route("sanjo", "23:50", 5)]);
  assert.equal(bestRoute(st, venue), null);
});

test("bestRoute: 行けないハブが混ざっていても、行けるハブだけで決まる", () => {
  const st = station("F", [route("demachiyanagi", "24:30", 0), route("kyoto", "23:40", 8)]);
  const r = bestRoute(st, venue);
  assert.equal(r?.route.hub, "kyoto");
  assert.equal(r?.value, toMin("23:24"));
});

test("bestRoute: 経路が 0 本の駅は null", () => {
  assert.equal(bestRoute(station("G", []), venue), null);
});

test("bestRoute: 同値なら先に出てきた経路を保つ（> で更新）", () => {
  const st = station("H", [route("karasumaoike", "23:50", 3), route("kyoto", "23:58", 8)]); // 両方 23:42
  assert.equal(bestRoute(st, venue)?.route.hub, "karasumaoike");
});

// ---- latestLeave: 徒歩を引いて切り捨て
test("latestLeave: bestRoute の値から徒歩分を引く", () => {
  const st = station("A", [route("karasumaoike", "23:50", 3)]);
  assert.equal(latestLeave(st, venue, 5), toMin("23:37"));
  assert.equal(latestLeave(st, venue, 0), toMin("23:42"));
});

test("latestLeave: 帰れない → null", () => {
  assert.equal(latestLeave(station("Z", [route("sanjo", "23:50", 5)]), venue, 5), null);
});

test("latestLeave: 電車不要（last null）で候補地もハブそのもの → Infinity（制約なし）", () => {
  const st = station("四条", [route("shijo", null, 0)]);
  assert.equal(latestLeave(st, venue, 5), Infinity);
});

// ---- resultFor
const members: Member[] = [
  { name: "早い人", station: "A" },
  { name: "遅い人", station: "F" },
];
const stations: Record<string, Station> = {
  A: station("A", [route("karasumaoike", "23:50", 3)]), // 23:42 − 5 = 23:37
  F: station("F", [route("kyoto", "23:58", 8)]), // min(23:42, 23:47) − 5 = 23:37 → 同値にならないよう調整
  G: station("G", [route("kyoto", "24:30", 8)]), // 幹線 23:47 − 5 = 23:42
};

test("resultFor: 全員帰れる → rows は出発の早い順、dissolve は最も早い人、bottleneck はその人", () => {
  const r = resultFor(venue, [{ name: "a", station: "A" }, { name: "g", station: "G" }], stations, 5);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.rows.map((x) => [x.member.name, x.leave]), [["a", toMin("23:37")], ["g", toMin("23:42")]]);
  assert.equal(r.dissolve, toMin("23:37"));
  assert.equal(r.bottleneck.name, "a");
  assert.equal(r.venue, venue);
});

test("resultFor: 1 人でも帰れない → ok false、deadMember はその人（後ろの人は見ない）", () => {
  const dead: Station = station("dead", [route("sanjo", "23:00", 5)]);
  const r = resultFor(venue, [{ name: "a", station: "A" }, { name: "x", station: "dead" }, { name: "g", station: "G" }], { ...stations, dead }, 5);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.deadMember.name, "x");
});

test("resultFor: stations に無い駅のメンバーは deadMember", () => {
  const r = resultFor(venue, [{ name: "?", station: "未収録" }], stations, 5);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.deadMember.station, "未収録");
});

test("resultFor: 全員が制約なし（Infinity）でも ok。dissolve は Infinity", () => {
  const r = resultFor(venue, [{ name: "四条の人", station: "四条" }], { 四条: station("四条", [route("shijo", null, 0)]) }, 5);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.dissolve, Infinity);
});

// ---- rankVenues
const venueKyoto: Venue = {
  id: "kyoto",
  name: "京都駅",
  toHub: { kyoto: { transitMin: 0, lastDepart: null }, karasumaoike: { transitMin: 12, lastDepart: "23:47" } },
};
const venueFar: Venue = { id: "far", name: "遠い", toHub: { demachiyanagi: { transitMin: 30, lastDepart: "23:00" } } };

test("rankVenues: いられる時間の長い順。帰れない候補地は末尾", () => {
  // A: 四条 23:37 / 京都駅 (23:50−12−3=23:35 vs 23:47) − 5 = 23:30 / 遠い: 帰れない
  const r = rankVenues([venueFar, venueKyoto, venue], [{ name: "a", station: "A" }], stations, 5);
  assert.deepEqual(r.map((x) => x.venue.id), ["shijo", "kyoto", "far"]);
  assert.equal(r[0].ok && r[0].dissolve, toMin("23:37"));
  assert.equal(r[1].ok && r[1].dissolve, toMin("23:30"));
  assert.equal(r[2].ok, false);
});

test("rankVenues: 帰れない候補地同士は入力順を保つ", () => {
  const far2: Venue = { ...venueFar, id: "far2" };
  const r = rankVenues([far2, venueFar], [{ name: "a", station: "A" }], stations, 5);
  assert.deepEqual(r.map((x) => x.venue.id), ["far2", "far"]);
});

test("rankVenues: メンバー 0 人 → 空配列", () => {
  assert.deepEqual(rankVenues([venue, venueKyoto], [], stations, 5), []);
});

test("rankVenues: 候補地 0 件 → 空配列", () => {
  assert.deepEqual(rankVenues([], members, stations, 5), []);
});

test("rankVenues: 徒歩が長いほど dissolve は早まる（順位は変わらない）", () => {
  const a = rankVenues([venue, venueKyoto], [{ name: "a", station: "A" }], stations, 0);
  const b = rankVenues([venue, venueKyoto], [{ name: "a", station: "A" }], stations, 15);
  assert.deepEqual(a.map((x) => x.venue.id), b.map((x) => x.venue.id));
  assert.equal((a[0].ok ? a[0].dissolve : 0) - (b[0].ok ? b[0].dissolve : 0), 15);
});

test("rankVenues: Infinity（制約なし）の候補地は有限の候補地より上に来る", () => {
  const st = { 四条: station("四条", [route("shijo", null, 0), route("kyoto", "23:30", 8)]) };
  const r = rankVenues([venueKyoto, venue], [{ name: "四条の人", station: "四条" }], st, 5);
  assert.equal(r[0].venue.id, "shijo");
  assert.equal(r[0].ok && r[0].dissolve, Infinity);
  assert.equal(r[1].ok && Number.isFinite(r[1].dissolve), true);
});

// ---- taxiFare
test("taxiFare: 0km（初乗りのみ）→ 500 × 1.2 = 600", () => {
  assert.equal(taxiFare(0), 600);
});

test("taxiFare: 1km（道路 1.3km）→ 700", () => {
  // 500 + (0.3 / 0.246) × 100 = 621.95 → ×1.2 = 746 → 100 円単位に丸め 700
  assert.equal(taxiFare(1), 700);
});

test("taxiFare: 5km（道路 6.5km）→ 3300", () => {
  // 500 + (5.5 / 0.246) × 100 = 2735.8 → ×1.2 = 3283 → 3300
  assert.equal(taxiFare(5), 3300);
});

test("taxiFare: 100 円単位で、距離に対して単調非減少", () => {
  let prev = -1;
  for (let km = 0; km <= 20; km += 0.5) {
    const fare = taxiFare(km);
    assert.equal(fare % 100, 0, `${km}km → ${fare}`);
    assert.ok(fare >= prev, `${km}km で減った`);
    prev = fare;
  }
});
