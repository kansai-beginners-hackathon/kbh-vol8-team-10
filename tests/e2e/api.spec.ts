// Route Handler を HTTP 越しに叩く（Next のルーティング・trailingSlash・JSON 応答まで含めて）。
import { expect, test } from "@playwright/test";

test.describe("/api/return-home/", () => {
  test("GET ?location=四条&walkMin=5&bufferMin=3 → 23:56", async ({ request }) => {
    const res = await request.get("/api/return-home/?location=四条&walkMin=5&bufferMin=3");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result.locationName).toBe("四条");
    expect(body.result.mustLeaveAt).toBe("23:56");
    expect(body.result.routes.length).toBeGreaterThan(0);
  });

  test("trailingSlash 無しでも（リダイレクト経由で）届く", async ({ request }) => {
    const res = await request.get("/api/return-home?location=京都駅&walkMin=5&bufferMin=3");
    expect(res.status()).toBe(200);
    expect((await res.json()).result.mustLeaveAt).toBe("23:32");
  });

  test("未知の場所 → 400", async ({ request }) => {
    const res = await request.get("/api/return-home/?location=月");
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "Location not found: 月" });
  });

  test("POST JSON", async ({ request }) => {
    const res = await request.post("/api/return-home/", { data: { location: "三条", walkMin: 5, bufferMin: 0 } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result.locationName).toBe("三条");
  });

  test("POST 壊れた JSON → 400", async ({ request }) => {
    // 文字列を渡すと Playwright が JSON 文字列として包むので、壊れた本文は Buffer で生のまま送る
    const res = await request.post("/api/return-home/", { headers: { "content-type": "application/json" }, data: Buffer.from("{oops") });
    expect(res.status()).toBe(400);
    expect((await res.json()).ok).toBe(false);
  });
});

test.describe("/api/parse/", () => {
  // 入力検証は OpenAI に届く前に返る。サーバーに OPENAI_API_KEY が無いときは 503 が先に返る
  // （playwright.config.ts の webServer はダミーキーを入れるが、reuseExistingServer で別のサーバーを使うとキー無しのことがある）。
  const expectValidationOr503 = async (res: import("@playwright/test").APIResponse, expected: string) => {
    const body = await res.json();
    if (res.status() === 503) {
      expect(body.error).toContain("OPENAI_API_KEY");
      return;
    }
    expect(res.status()).toBe(400);
    expect(body).toEqual({ error: expected });
  };

  test("空の text → 400", async ({ request }) => {
    const res = await request.post("/api/parse/", { data: { text: "" } });
    await expectValidationOr503(res, "LINEの会話を貼り付けてください");
  });

  test("text 無し → 400", async ({ request }) => {
    const res = await request.post("/api/parse/", { data: {} });
    await expectValidationOr503(res, "LINEの会話を貼り付けてください");
  });

  test("10001 文字 → 400", async ({ request }) => {
    const res = await request.post("/api/parse/", { data: { text: "a".repeat(10001) } });
    await expectValidationOr503(res, "文字数が多すぎます。1万文字以内にしてください");
  });

  test("GET は許可されない（405）", async ({ request }) => {
    const res = await request.get("/api/parse/");
    expect(res.status()).toBe(405);
  });
});

test.describe("ページ", () => {
  test("/ と /app/ は 200、存在しないページは 404", async ({ request }) => {
    expect((await request.get("/")).status()).toBe(200);
    expect((await request.get("/app/")).status()).toBe(200);
    expect((await request.get("/nowhere/")).status()).toBe(404);
  });
});
