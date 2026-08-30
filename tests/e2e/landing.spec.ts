// LP（app/page.tsx）: 導線と文言。
import { expect, test } from "@playwright/test";

test.describe("LP", () => {
  test("タイトル・見出し・3 ステップが出る", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/もうちょっと/);
    await expect(page.locator("h1")).toContainText("もうちょっと");
    await expect(page.locator(".hero .lede")).toContainText("一番長く一緒にいられる場所");
    const steps = page.locator(".steps .step-card");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText("みんなの帰る駅を入れる");
    await expect(steps.nth(1)).toContainText("今夜の候補地を選ぶ");
    await expect(steps.nth(2)).toContainText("いちばん長くいられる場所が出る");
  });

  test("出町柳の例（掲示 23:50 / 鞍馬に着く最終 22:30）が載っている", async ({ page }) => {
    await page.goto("/");
    const truth = page.locator(".truth");
    await expect(truth).toContainText("23:50");
    await expect(truth).toContainText("22:30");
    await expect(page.locator(".insight")).toContainText("80分");
  });

  test("「始める」は /app へ（メンバー 0 人で始まる）", async ({ page }) => {
    await page.goto("/");
    await page.locator(".hero").getByRole("link", { name: "始める" }).click();
    await expect(page).toHaveURL(/\/app\/?(\?.*)?$/);
    await expect(page.locator("h2", { hasText: "メンバーの最寄り駅" })).toBeVisible();
    await expect(page.locator(".member-list .member:not(.member-head)")).toHaveCount(0);
  });

  test("「例を見る」は事前計算済みの 4 人・候補地 5 つ・土日ダイヤを URL に載せる", async ({ page }) => {
    await page.goto("/");
    const demo = page.getByRole("link", { name: "例を見る" });
    const href = await demo.getAttribute("href");
    expect(href).toBeTruthy();
    const q = new URL(href!, "http://x").searchParams;
    expect(q.get("m")).toBe("田中:嵐山,佐藤:桂,鈴木:国際会館,高橋:びわ湖浜大津");
    expect(q.get("v")).toBe("shijo,kyoto,karasumaoike,sanjo,demachiyanagi");
    expect(q.get("d")).toBe("weekend");
  });

  test("「始める」リンクは hero・closing の 2 箇所（ヘッダー行は無い）", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "始める" })).toHaveCount(2);
    await expect(page.locator(".topbar")).toHaveCount(0);
  });

  test("フッターに免責が出る", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("footer")).toContainText("遅延・運休・臨時ダイヤには対応しません");
  });

  test("スマホ幅でも横スクロールしない", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
