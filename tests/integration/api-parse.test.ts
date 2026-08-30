// 実行: npm run test:integration
// app/api/parse/route.js（LINE の会話 → 参加者と最寄り駅）を OpenAI を叩かずに検証する。
// OpenAI SDK はグローバル fetch を使うので、fetch を差し替えて chat.completions の応答を偽装する。
// 実際に gpt-4o-mini に投げて読み取り精度を見るのは tests/e2e/live-parse.mjs（npm run test:parse。要 API キー・起動中のサーバー）。
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

// ---- fetch の差し替え（route.js を import する前に入れる。OpenAI クライアントは最初のリクエストで作られ、その時点の fetch を掴む）
type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;
const originalFetch = globalThis.fetch;
let handler: Handler = () => {
  throw new Error("OpenAI が呼ばれないはずのケースで fetch された");
};
const openaiCalls: { url: string; init: RequestInit | undefined }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  openaiCalls.push({ url, init });
  return handler(url, init);
}) as typeof fetch;

const { POST } = await import("../../app/api/parse/route.js");

/** chat.completions の最小の応答。content に JSON 文字列を入れる */
const completion = (content: string | null, finish_reason = "stop", refusal: string | null = null) =>
  new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 0,
      model: "gpt-4o-mini",
      choices: [{ index: 0, message: { role: "assistant", content, refusal }, finish_reason, logprobs: null }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const post = (body: unknown, raw = false) =>
  POST(
    new Request("http://localhost:3000/api/parse/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );

const SAMPLE = "今日19時に三条集合ー\n田中: 行きます！鞍馬から向かいます\n佐藤: 私も行く 桂です\n鈴木: ごめん今日いけない";
const savedKey = process.env.OPENAI_API_KEY;

before(() => {
  // console.error のノイズを抑える（route.js は失敗時にログを出す）
  console.error = () => {};
});
beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test-dummy";
  openaiCalls.length = 0;
  handler = () => {
    throw new Error("OpenAI が呼ばれないはずのケースで fetch された");
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedKey;
});

// ---- 入力検証（OpenAI は呼ばれない）
test("OPENAI_API_KEY 未設定 → 503 と設定漏れの説明", async () => {
  delete process.env.OPENAI_API_KEY;
  const res = await post({ text: SAMPLE });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.match(body.error, /OPENAI_API_KEY/);
  assert.equal(openaiCalls.length, 0);
});

test("text 無し → 400", async () => {
  const res = await post({});
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "LINEの会話を貼り付けてください" });
});

test("text が空文字・空白だけ → 400", async () => {
  for (const text of ["", "   ", "\n\n"]) {
    const res = await post({ text });
    assert.equal(res.status, 400, JSON.stringify(text));
  }
  assert.equal(openaiCalls.length, 0);
});

test("10001 文字 → 400、10000 文字はちょうど通る", async () => {
  const res = await post({ text: "あ".repeat(10001) });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "文字数が多すぎます。1万文字以内にしてください" });
  assert.equal(openaiCalls.length, 0);

  handler = () => completion(JSON.stringify({ venue: null, meetAt: null, members: [] }));
  const ok = await post({ text: "あ".repeat(10000) });
  assert.equal(ok.status, 200);
  assert.equal(openaiCalls.length, 1);
});

test("body が JSON でない → 500（想定外エラーとして畳む）", async () => {
  const res = await post("{oops", true);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "サーバー側でエラーが起きました" });
});

// ---- 正常系（OpenAI を偽装）
test("正常系: AI の JSON をそのまま venue / meetAt / members で返す", async () => {
  const parsed = { venue: "三条", meetAt: "19:00", members: [{ name: "田中", station: "鞍馬" }, { name: "佐藤", station: "桂" }] };
  handler = () => completion(JSON.stringify(parsed));
  const res = await post({ text: SAMPLE });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), parsed);
});

test("OpenAI への要求: chat/completions・gpt-4o-mini・temperature 0・system + user・json_schema・Bearer", async () => {
  handler = () => completion(JSON.stringify({ venue: null, meetAt: null, members: [] }));
  await post({ text: SAMPLE });
  assert.equal(openaiCalls.length, 1);
  const { url, init } = openaiCalls[0];
  assert.match(url, /\/chat\/completions$/);
  assert.equal(init?.method, "POST");
  const headers = new Headers(init?.headers as HeadersInit);
  assert.equal(headers.get("authorization"), "Bearer sk-test-dummy");
  const body = JSON.parse(String(init?.body));
  assert.equal(body.model, "gpt-4o-mini");
  assert.equal(body.temperature, 0);
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[0].content, /最寄り駅/);
  assert.deepEqual(body.messages[1], { role: "user", content: SAMPLE });
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.name, "parsed");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(Object.keys(body.response_format.json_schema.schema.properties).sort(), ["meetAt", "members", "venue"]);
});

test("正規化: 名前や駅が空のメンバーは落とす。venue / meetAt の空文字は null", async () => {
  handler = () =>
    completion(
      JSON.stringify({
        venue: "  ",
        meetAt: "",
        members: [
          { name: "田中", station: "鞍馬" },
          { name: "", station: "桂" },
          { name: "佐藤", station: "   " },
        ],
      }),
    );
  const res = await post({ text: SAMPLE });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { venue: null, meetAt: null, members: [{ name: "田中", station: "鞍馬" }] });
});

test("メンバー 0 人でも 200 で members: []", async () => {
  handler = () => completion(JSON.stringify({ venue: "三条", meetAt: "19:00", members: [] }));
  assert.deepEqual(await (await post({ text: "今日19時に三条集合ー" })).json(), { venue: "三条", meetAt: "19:00", members: [] });
});

// ---- AI 側の異常
test("content が null（parsed が作れない）→ 502 と再試行の案内", async () => {
  handler = () => completion(null);
  const res = await post({ text: SAMPLE });
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "会話を読み取れませんでした。もう一度試してください" });
});

test("refusal（拒否）→ parsed は null → 502", async () => {
  handler = () => completion(null, "stop", "お手伝いできません");
  const res = await post({ text: SAMPLE });
  assert.equal(res.status, 502);
});

test("finish_reason=length（途中で切れた）→ SDK が throw → 500", async () => {
  handler = () => completion('{"venue":"三条","meetAt":"19:00","mem', "length");
  const res = await post({ text: SAMPLE });
  assert.equal(res.status, 500);
});

test("content がスキーマに合わない JSON → SDK の検証で throw → 500", async () => {
  handler = () => completion(JSON.stringify({ venue: 1, members: "x" }));
  const res = await post({ text: SAMPLE });
  assert.equal(res.status, 500);
});

test("OpenAI が 401 を返す → 500（キーの間違いはサーバー側エラーとして畳む）", async () => {
  handler = () => new Response(JSON.stringify({ error: { message: "Incorrect API key", type: "invalid_request_error" } }), { status: 401, headers: { "content-type": "application/json" } });
  const res = await post({ text: SAMPLE });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "サーバー側でエラーが起きました" });
});

test("ネットワーク断（fetch が throw）→ 500", async () => {
  handler = () => {
    throw new TypeError("fetch failed");
  };
  const res = await post({ text: SAMPLE });
  assert.equal(res.status, 500);
});
