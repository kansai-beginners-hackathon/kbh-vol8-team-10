// 実行: npm run test:integration
// app/api/return-home/route.ts の Route Handler を Next のサーバー無しで直接呼ぶ。
// `@/lib/return-home` の解決と JSON import は tests/setup/alias-loader.mjs が面倒を見る。
import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../../app/api/return-home/route.ts";

const BASE = "http://localhost:3000/api/return-home/";
const get = (query: string) => GET(new Request(`${BASE}${query}`));
const post = (body: unknown, raw = false) =>
  POST(
    new Request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );

test("GET ?location=四条&walkMin=5&bufferMin=3 → 200 / ok / 23:56", async () => {
  const res = await get("?location=四条&walkMin=5&bufferMin=3");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.result.locationName, "四条");
  assert.equal(body.result.mustLeaveAt, "23:56");
  assert.equal(body.result.walkMin, 5);
  assert.equal(body.result.bufferMin, 3);
  assert.equal(body.result.mostLateRoute.mode, "阪急");
});

test("GET パラメータ無し → 四条・walk 5・buffer 0 が既定", async () => {
  const body = await (await get("")).json();
  assert.equal(body.ok, true);
  assert.equal(body.result.locationName, "四条");
  assert.equal(body.result.walkMin, 5);
  assert.equal(body.result.bufferMin, 0);
  assert.equal(body.result.mustLeaveAt, "23:59");
});

test("GET 未知の場所 → 400 / ok false / エラー文", async () => {
  const res = await get("?location=存在しない");
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, error: "Location not found: 存在しない" });
});

test("GET 京都駅（URL エンコード済み）", async () => {
  const res = await get(`?location=${encodeURIComponent("京都駅")}&walkMin=5&bufferMin=3`);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.result.mustLeaveAt, "23:32");
});

test("GET walkMin が数値でない → NaN 計算になるが 200 で返す（現状の挙動を固定。mustLeaveAt は 00:00 に潰れる）", async () => {
  const res = await get("?location=四条&walkMin=abc");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  // Math.max(0, NaN) = NaN → "NaN:NaN" のような文字列になる。表示側で拾えるように形だけ確認
  assert.equal(typeof body.result.mustLeaveAt, "string");
});

test("POST JSON → GET と同じ結果", async () => {
  const [a, b] = await Promise.all([
    post({ location: "三条", walkMin: 5, bufferMin: 3 }).then((r) => r.json()),
    get("?location=三条&walkMin=5&bufferMin=3").then((r) => r.json()),
  ]);
  assert.deepEqual(a, b);
});

test("POST 空オブジェクト → 既定値（四条）", async () => {
  const res = await post({});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.result.locationName, "四条");
  assert.equal(body.result.mustLeaveAt, "23:59");
});

test("POST 数値が文字列でも Number() で受ける", async () => {
  const body = await (await post({ location: "四条", walkMin: "5", bufferMin: "3" })).json();
  assert.equal(body.result.mustLeaveAt, "23:56");
});

test("POST 未知の場所 → 400", async () => {
  const res = await post({ location: "月" });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).ok, false);
});

test("POST 壊れた JSON → 400（request.json の例外も catch される）", async () => {
  const res = await post("{not json", true);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(typeof body.error, "string");
});

test("8 地点すべて GET で 200", async () => {
  for (const name of ["四条", "京都駅", "烏丸御池", "三条", "出町柳", "北大路", "山科", "桂"]) {
    const res = await get(`?location=${encodeURIComponent(name)}`);
    assert.equal(res.status, 200, name);
    assert.equal((await res.json()).result.locationName, name);
  }
});
