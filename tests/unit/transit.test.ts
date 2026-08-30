// 実行: npm test（tests/unit と tests/integration を node --test で回す）
// Transit API は叩かない。tests/fixtures/ に保存した実レスポンスを偽 fetch で返す。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  boardingSecs,
  hasSubwayTransfer,
  isSane,
  isShinkansenLeg,
  usesShinkansen,
  planLastArrival,
  planLastArrivalDetailed,
  secsToHHMM,
  startsAt,
  suggestStationId,
  type TransitJourney,
} from "../../lib/transit.ts";

const fixtures = path.resolve(import.meta.dirname, "../fixtures");
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(fixtures, name), "utf8"));

/** fixture の JSON を返す偽 fetch。呼ばれた URL は calls に残す */
const fakeFetch = (json: unknown, status = 200) => {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { fetcher, calls };
};

const journey = (over: Partial<TransitJourney>): TransitJourney => ({
  departureSecs: 85260,
  arrivalSecs: 87180,
  transferCount: 1,
  legs: [
    { kind: "transit", headsign: "淀", from: { name: "三条" }, to: { name: "中書島" }, departureSecs: 85260, arrivalSecs: 86160 },
    { kind: "walk", departureSecs: 86160, arrivalSecs: 86220 },
    { kind: "transit", headsign: "宇治", from: { name: "中書島" }, to: { name: "宇治" }, departureSecs: 86280, arrivalSecs: 87180 },
  ],
  ...over,
});

// ---- secsToHHMM
test("secsToHHMM: 86280 → 23:58", () => assert.equal(secsToHHMM(86280), "23:58"));
test("secsToHHMM: 89100 → 24:45（24 時台はそのまま）", () => assert.equal(secsToHHMM(89100), "24:45"));
test("secsToHHMM: 104400 → 29:00（00:00 に丸めない）", () => assert.equal(secsToHHMM(104400), "29:00"));

// ---- isSane
test("isSane: 到着 29:54（翌朝着）は false", () => {
  assert.equal(isSane(journey({ arrivalSecs: 29 * 3600 + 54 * 60 })), false);
});
test("isSane: 出発 17:51 は false", () => {
  assert.equal(isSane(journey({ departureSecs: 17 * 3600 + 51 * 60, arrivalSecs: 20 * 3600 })), false);
});
test("isSane: 乗換待ち 5 時間は false", () => {
  assert.equal(
    isSane(
      journey({
        departureSecs: 84480,
        arrivalSecs: 26 * 3600,
        legs: [
          { kind: "transit", headsign: "淀", departureSecs: 84480, arrivalSecs: 85980 },
          { kind: "transit", headsign: "宇治", departureSecs: 85980 + 5 * 3600, arrivalSecs: 26 * 3600 },
        ],
      }),
    ),
    false,
  );
});
test("isSane: 三条→宇治 23:41→24:12 は true", () => assert.equal(isSane(journey({})), true));
test("isSane: null は false", () => assert.equal(isSane(null), false));

// ---- planLastArrival
test("planLastArrival: 三条→宇治 fixture から最も遅い sane な便（23:41 発・乗換1）", async () => {
  const { fetcher, calls } = fakeFetch(load("transit-sanjo-uji.json"));
  const j = await planLastArrival("geo:35.00879,135.772337", "scrape-keihan:京阪電気鉄道-宇治線-宇治", "20260829", fetcher);
  assert.ok(j);
  assert.equal(j.departureSecs, 85260);
  assert.equal(secsToHHMM(j.departureSecs), "23:41");
  assert.equal(j.transferCount, 1);
  assert.equal(j.legs[0].headsign, "淀");

  assert.equal(calls.length, 1);
  const url = new URL(calls[0]);
  assert.equal(url.pathname, "/api/v1/plan");
  assert.equal(url.searchParams.get("type"), "arrival");
  assert.equal(url.searchParams.get("time"), "26:00");
  assert.equal(url.searchParams.get("numItineraries"), "6");
  assert.equal(url.searchParams.get("from"), "geo:35.00879,135.772337");
  assert.equal(url.searchParams.get("date"), "20260829");
});

test("planLastArrival: 0 件 fixture → null", async () => {
  const { fetcher } = fakeFetch(load("transit-empty.json"));
  assert.equal(await planLastArrival("geo:35.00378,135.76868", "scrape-hankyu:阪急電鉄-京都線-大阪梅田", "20260829", fetcher), null);
});

test("planLastArrival: 422 fixture（res.ok === false）→ null、throw しない", async () => {
  const { fetcher } = fakeFetch(load("transit-422.json"), 422);
  assert.equal(await planLastArrival("a", "b", "20260829", fetcher), null);
});

test("planLastArrival: 全部 isSane 落ち → null", async () => {
  const { fetcher } = fakeFetch({ journeys: [journey({ arrivalSecs: 29 * 3600 })] });
  assert.equal(await planLastArrival("a", "b", "20260829", fetcher), null);
});

test("planLastArrival: fetch が投げる（ネットワーク断）→ null", async () => {
  const fetcher = async () => {
    throw new TypeError("fetch failed");
  };
  assert.equal(await planLastArrival("a", "b", "20260829", fetcher), null);
});

test("planLastArrival: JSON でない本文 → null", async () => {
  const fetcher = async () => new Response("<html>error</html>", { status: 200 });
  assert.equal(await planLastArrival("a", "b", "20260829", fetcher), null);
});

// ---- suggestStationId
test("suggestStationId: 宇治 → 京阪宇治線の駅 ID", async () => {
  const { fetcher, calls } = fakeFetch(load("suggest-uji.json"));
  assert.equal(await suggestStationId("宇治", fetcher), "scrape-keihan:京阪電気鉄道-宇治線-宇治");
  const url = new URL(calls[0]);
  assert.equal(url.pathname, "/api/v1/locations/suggest");
  assert.equal(url.searchParams.get("q"), "宇治");
});

test("suggestStationId: 完全一致が後ろにあっても優先する（stop は無視）", async () => {
  const { fetcher } = fakeFetch({
    stations: [
      { id: "bus:五条駅前", name: "五条駅前", kind: "stop" },
      { id: "x:五条坂", name: "五条坂", kind: "station" },
      { id: "scrape-kyoto-subway:京都市-烏丸線-五条", name: "五条", kind: "station" },
    ],
  });
  assert.equal(await suggestStationId("五条", fetcher), "scrape-kyoto-subway:京都市-烏丸線-五条");
});

test("suggestStationId: 0 件 → null", async () => {
  const { fetcher } = fakeFetch({ stations: [] });
  assert.equal(await suggestStationId("存在しない駅", fetcher), null);
});

test("suggestStationId: HTTP 500 → null", async () => {
  const { fetcher } = fakeFetch({ error: "boom" }, 500);
  assert.equal(await suggestStationId("宇治", fetcher), null);
});

// ---- startsAt / boardingSecs（geo: 出発のスナップ対策）
test("startsAt: 最初の乗車区間の from.name がハブ名（別名含む）なら true", () => {
  assert.equal(startsAt(journey({}), ["三条", "三条京阪"]), true);
  assert.equal(startsAt(journey({}), ["四条", "烏丸"]), false);
  assert.equal(startsAt(journey({}), []), true, "originNames が空なら常に true");
});

test("startsAt: 先頭が徒歩でも最初の乗車区間で判定する", () => {
  const j = journey({
    departureSecs: 82854,
    legs: [
      { kind: "walk", from: { name: "三条" }, to: { name: "三条京阪" }, departureSecs: 82854, arrivalSecs: 82974 },
      { kind: "transit", from: { name: "三条京阪" }, to: { name: "山科" }, departureSecs: 83160, arrivalSecs: 83700 },
    ],
  });
  assert.equal(startsAt(j, ["三条", "三条京阪"]), true);
  assert.equal(boardingSecs(j), 83160, "列車の発時刻は徒歩開始ではなく乗車区間の発時刻");
});

test("planLastArrival: 四条→山科 fixture は全部 烏丸御池発（スナップ）→ originNames 付きなら null", async () => {
  const fx = load("transit-shijo-yamashina.json");
  const without = await planLastArrival("geo:35.00275,135.759673", "x", "20260829", fakeFetch(fx).fetcher);
  assert.equal(without?.departureSecs, 86100, "チェック無しだと 23:55 烏丸御池発が返ってしまう");
  const withCheck = await planLastArrival("geo:35.00275,135.759673", "x", "20260829", fakeFetch(fx).fetcher, {
    originNames: ["四条", "烏丸"],
  });
  assert.equal(withCheck, null);
});

test("planLastArrival: 三条→宇治 fixture は originNames=[三条] を通る", async () => {
  const j = await planLastArrival("geo:35.00879,135.772337", "x", "20260829", fakeFetch(load("transit-sanjo-uji.json")).fetcher, {
    originNames: ["三条", "三条京阪"],
  });
  assert.equal(j?.departureSecs, 85260);
});

// ---- suggestStationId の feed 優先
test("suggestStationId: 山科は JR / 地下鉄 / 湖西線 の 3 件。suggest の先頭は JR だが FEED_PRIORITY で地下鉄", async () => {
  const { fetcher } = fakeFetch(load("suggest-yamashina.json"));
  assert.equal(load("suggest-yamashina.json").stations[0].id, "jrwest-tokaido:jrwest-tokaido.station.JR西日本-東海道線-山科");
  assert.equal(await suggestStationId("山科", fetcher), "scrape-kyoto-subway:京都市-東西線-山科");
});

test("suggestStationId: preferFeeds=[scrape-kyoto-subway] なら地下鉄山科", async () => {
  const { fetcher } = fakeFetch(load("suggest-yamashina.json"));
  assert.equal(
    await suggestStationId("山科", fetcher, { preferFeeds: ["scrape-kyoto-subway"] }),
    "scrape-kyoto-subway:京都市-東西線-山科",
  );
});

test("suggestStationId: preferFeeds に該当が無ければ完全一致の先頭に戻る", async () => {
  const { fetcher } = fakeFetch(load("suggest-uji.json"));
  assert.equal(
    await suggestStationId("宇治", fetcher, { preferFeeds: ["scrape-kyoto-subway"] }),
    "scrape-keihan:京阪電気鉄道-宇治線-宇治",
  );
});

test("planLastArrivalDetailed: 0 件は noJourneys、422 は error、三条→宇治は found", async () => {
  const empty = await planLastArrivalDetailed("a", "b", "20260829", fakeFetch(load("transit-empty.json")).fetcher);
  assert.deepEqual(empty, { journey: null, outcome: "noJourneys" });
  const err = await planLastArrivalDetailed("a", "b", "20260829", fakeFetch(load("transit-422.json"), 422).fetcher);
  assert.deepEqual(err, { journey: null, outcome: "error" });
  const ok = await planLastArrivalDetailed("geo:35.00879,135.772337", "x", "20260829", fakeFetch(load("transit-sanjo-uji.json")).fetcher);
  assert.equal(ok.outcome, "found");
  assert.equal(ok.journey?.departureSecs, 85260);
});

// ---- 新幹線の除外
test("isShinkansenLeg: feed ID（tokaido-shinkansen）または列車名（のぞみ）で判定。在来線は false", () => {
  assert.equal(isShinkansenLeg({ kind: "transit", routeName: "のぞみ", headsign: "のぞみ95号 姫路", from: { id: "tokaido-shinkansen:tokaido.Kyoto" }, departureSecs: 0, arrivalSecs: 0 }), true);
  assert.equal(isShinkansenLeg({ kind: "transit", headsign: "こだま977号 岡山", departureSecs: 0, arrivalSecs: 0 }), true, "列車名だけでも弾く");
  assert.equal(isShinkansenLeg({ kind: "transit", headsign: "新快速 西明石", from: { id: "jrwest-tokaido:x" }, departureSecs: 0, arrivalSecs: 0 }), false);
  assert.equal(isShinkansenLeg({ kind: "walk", from: { id: "tokaido-shinkansen:tokaido.Shin-Osaka" }, departureSecs: 0, arrivalSecs: 0 }), false, "徒歩は対象外");
});

test("planLastArrival: 京都→姫路 fixture は全部新幹線 → null（rejected）", async () => {
  const fx = load("transit-kyoto-himeji.json");
  assert.ok((fx.journeys as TransitJourney[]).every(usesShinkansen), "fixture は 6 件とも新幹線を含む");
  const j = await planLastArrival("geo:34.985729,135.758523", "x", "20260831", fakeFetch(fx).fetcher, { originNames: ["京都"] });
  assert.equal(j, null);
});

test("planLastArrival: 新幹線の経路と在来線の経路が混ざっていたら在来線を選ぶ", async () => {
  const jr = journey({ departureSecs: 82980, legs: [{ kind: "transit", headsign: "新快速 姫路", from: { id: "jrwest-tokaido:k", name: "京都" }, departureSecs: 82980, arrivalSecs: 88000 }] });
  const sk = journey({ departureSecs: 83100, legs: [{ kind: "transit", routeName: "のぞみ", headsign: "のぞみ95号 姫路", from: { id: "tokaido-shinkansen:tokaido.Kyoto", name: "京都" }, departureSecs: 83100, arrivalSecs: 85860 }] });
  const j = await planLastArrival("a", "b", "20260831", fakeFetch({ journeys: [sk, jr] }).fetcher);
  assert.equal(j?.departureSecs, 82980, "新幹線の方が遅く出るが選ばない");
});

// ---- suggestStationId: 新幹線除外と事業者の優先順
test("suggestStationId: 姫路は JR山陽線（新幹線の駅は除外）", async () => {
  const { fetcher } = fakeFetch(load("suggest-himeji.json"));
  assert.equal(await suggestStationId("姫路", fetcher), "jrwest-sanyo-east:jrwest-sanyo-east.station.JR西日本-山陽線-姫路");
});

test("suggestStationId: 新大阪は御堂筋線が先頭でも JR京都線を選ぶ（FEED_PRIORITY）", async () => {
  const { fetcher } = fakeFetch({
    stations: [
      { id: "osakametro-rail:大阪市高速電気軌道-御堂筋線-新大阪", name: "新大阪", kind: "station" },
      { id: "jrwest-tokaido:jrwest-tokaido.station.JR西日本-東海道線-新大阪", name: "新大阪", kind: "station" },
      { id: "sanyo-shinkansen:sanyo.station.Shin-Osaka", name: "新大阪", kind: "station" },
      { id: "tokaido-shinkansen:tokaido.station.Shin-Osaka", name: "新大阪", kind: "station" },
      { id: "jrwest-osaka-higashi:jrwest-osaka-higashi.station.JR西日本-おおさか東線-新大阪", name: "新大阪", kind: "station" },
    ],
  });
  assert.equal(await suggestStationId("新大阪", fetcher), "jrwest-tokaido:jrwest-tokaido.station.JR西日本-東海道線-新大阪");
});

test("suggestStationId: 大阪梅田は阪神が先頭でも阪急を選ぶ", async () => {
  const { fetcher } = fakeFetch({
    stations: [
      { id: "hanshin-rail-part-01:阪神電気鉄道-本線-大阪梅田", name: "大阪梅田", kind: "station" },
      { id: "scrape-hankyu:阪急電鉄-京都線-大阪梅田", name: "大阪梅田", kind: "station" },
    ],
  });
  assert.equal(await suggestStationId("大阪梅田", fetcher), "scrape-hankyu:阪急電鉄-京都線-大阪梅田");
});

test("suggestStationId: 新幹線の駅しか無ければ null", async () => {
  const { fetcher } = fakeFetch({ stations: [{ id: "tokaido-shinkansen:tokaido.station.Gifu-Hashima", name: "岐阜羽島", kind: "station" }] });
  assert.equal(await suggestStationId("岐阜羽島", fetcher), null);
});

// ---- 地下鉄を挟む乗換の除外
test("hasSubwayTransfer: 地下鉄 leg + 他社 leg は true、地下鉄 1 本だけ・私鉄同士は false", () => {
  const subwayLeg = { kind: "transit" as const, from: { id: "scrape-kyoto-subway:京都市-烏丸線-烏丸御池", name: "烏丸御池" }, to: { id: "scrape-kyoto-subway:京都市-烏丸線-四条", name: "四条" }, departureSecs: 82800, arrivalSecs: 82920 };
  const hankyuLeg = { kind: "transit" as const, headsign: "正雀", from: { id: "scrape-hankyu:阪急電鉄-京都線-烏丸", name: "烏丸" }, to: { id: "scrape-hankyu:阪急電鉄-京都線-桂", name: "桂" }, departureSecs: 83160, arrivalSecs: 83700 };
  assert.equal(hasSubwayTransfer(journey({ transferCount: 1, legs: [subwayLeg, { kind: "walk", departureSecs: 82920, arrivalSecs: 83040 }, hankyuLeg] })), true);
  assert.equal(hasSubwayTransfer(journey({ transferCount: 0, legs: [subwayLeg] })), false);
  assert.equal(hasSubwayTransfer(journey({})), false, "京阪同士の乗換（三条→宇治）は対象外");
});

test("planLastArrival: 地下鉄を挟む乗換経路は弾かれ、無ければ null", async () => {
  const j = journey({
    departureSecs: 82800,
    transferCount: 1,
    legs: [
      { kind: "transit", from: { id: "scrape-kyoto-subway:京都市-烏丸線-烏丸御池", name: "烏丸御池" }, departureSecs: 82800, arrivalSecs: 82920 },
      { kind: "transit", headsign: "正雀", from: { id: "scrape-hankyu:阪急電鉄-京都線-烏丸", name: "烏丸" }, departureSecs: 83160, arrivalSecs: 83700 },
    ],
  });
  assert.equal(await planLastArrival("geo:x", "y", "20260829", fakeFetch({ journeys: [j] }).fetcher), null);
});
