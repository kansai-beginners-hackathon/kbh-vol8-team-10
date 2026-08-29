// テキスト貼り付け（components/ChatImport.tsx → /api/parse → Planner.applyParsed）。
// /api/parse は page.route で偽装（OpenAI は叩かない）。
import { expect, test } from "@playwright/test";
import { importError, memberRows, mockParse, mockTransitOffline, pill, queryOf, waitForBuilt } from "./helpers";

const SAMPLE = "今日19時に三条集合ー\n田中: 行きます！鞍馬から向かいます\n佐藤: 私も行く 桂です";

async function open(page: import("@playwright/test").Page) {
  await page.locator("details.chat-import summary").click();
  await expect(page.getByLabel("貼り付けるテキスト")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mockTransitOffline(page);
});

test("閉じた状態で始まり、開くと textarea と無効なボタンが出る", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByLabel("貼り付けるテキスト")).toBeHidden();
  await open(page);
  await expect(page.getByRole("button", { name: "読み取って追加" })).toBeDisabled();
  await expect(page.locator(".chat-import .note")).toContainText("「行けない」と言っている人と、駅が書かれていない人は入りません");
  await page.getByLabel("貼り付けるテキスト").fill("   ");
  await expect(page.getByRole("button", { name: "読み取って追加" })).toBeDisabled();
});

test("読み取り成功: メンバー追加・集合時刻・候補地が反映され、一言が出る", async ({ page }) => {
  const requests = await mockParse(page, {
    venue: "三条",
    meetAt: "19:30",
    members: [{ name: "田中", station: "鞍馬" }, { name: "佐藤", station: "桂駅" }],
  });
  await page.goto("/app?v=shijo");
  await open(page);
  await page.getByLabel("貼り付けるテキスト").fill(SAMPLE);
  await page.getByRole("button", { name: "読み取って追加" }).click();

  await expect(page.locator(".chat-import-done")).toHaveText("田中・佐藤 を追加。集合 19:30。候補地に三条");
  expect(requests).toEqual([{ text: SAMPLE }]);

  const rows = memberRows(page);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByLabel("名前")).toHaveValue("田中");
  await expect(rows.nth(1).getByLabel("最寄り駅")).toHaveValue("桂", { timeout: 5000 }); // 「駅」は落とす
  await expect(page.locator("input[type=time]")).toHaveValue("19:30");
  await expect(pill(page, "三条")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => queryOf(page)).toMatchObject({ m: "田中:鞍馬,佐藤:桂", v: "shijo,sanjo", t: "19:30" });

  // textarea は空に戻り、ボタンは無効
  await expect(page.getByLabel("貼り付けるテキスト")).toHaveValue("");
  await expect(page.getByRole("button", { name: "読み取って追加" })).toBeDisabled();

  // 追加された人の終電も解けて順位が出る（鞍馬はローカル、桂は烏丸経由の阪急）。
  // 「バッジが無い」だけだと再計算前に通り抜けるので、1 位と時刻が出るまで待つ
  await expect(page.locator(".ranking .heading h2")).toContainText("この2人が一番長くいられる場所");
  // 候補地は四条 + 読み取った三条。田中（鞍馬）がボトルネックで、出町柳に近い三条が 1 位
  await expect(page.locator(".winner-name")).toHaveText("三条");
  // 22:30 − 三条→出町柳 8 分 − 乗換 5 − 徒歩 5 = 22:12
  await expect(page.locator(".winner-time strong")).toHaveText("22:12");
  await expect(page.locator(".badge-unavailable")).toHaveCount(0);
});

test("重複と上限: 同じ名前＋駅は飛ばし、8 人を超えない", async ({ page }) => {
  await mockParse(page, {
    venue: null,
    meetAt: null,
    members: [
      { name: "田中", station: "鞍馬" }, // 既にいる
      { name: "A", station: "五条" },
      { name: "B", station: "四条" },
      { name: "C", station: "京都" },
    ],
  });
  await page.goto("/app?m=田中:鞍馬,X:山科,Y:二条,Z:東山,W:蹴上,V:御陵");
  await expect(memberRows(page)).toHaveCount(6);
  await open(page);
  await page.getByLabel("貼り付けるテキスト").fill("なにか");
  await page.getByRole("button", { name: "読み取って追加" }).click();
  await expect(page.locator(".chat-import-done")).toHaveText("A・B を追加。2人は重複か上限（8人）で入れていません");
  await expect(memberRows(page)).toHaveCount(8);
});

test("候補地に無い集合場所は選ばず、その旨を伝える。1 桁の時刻は 0 埋め", async ({ page }) => {
  await mockParse(page, { venue: "梅田", meetAt: "9:00", members: [{ name: "佐藤", station: "五条" }] });
  await page.goto("/app");
  await open(page);
  await page.getByLabel("貼り付けるテキスト").fill("x");
  await page.getByRole("button", { name: "読み取って追加" }).click();
  await expect(page.locator(".chat-import-done")).toHaveText("佐藤 を追加。集合 09:00。「梅田」は候補地に無いので選んでいません");
  await expect(page.locator("input[type=time]")).toHaveValue("09:00");
  await expect(page.locator("button.pill[aria-pressed='true']")).toHaveCount(5);
});

test("追加できる人がいなければその旨。名前が空なら駅名が名前", async ({ page }) => {
  await mockParse(page, { venue: null, meetAt: null, members: [{ name: "", station: "五条" }] });
  await page.goto("/app?m=五条");
  await open(page);
  await page.getByLabel("貼り付けるテキスト").fill("x");
  await page.getByRole("button", { name: "読み取って追加" }).click();
  // 名前が空 → 駅名「五条」が名前になり、既にいる 五条/五条 と重複 → 0 人追加・1 人は重複
  await expect(page.locator(".chat-import-done")).toHaveText("追加できる人はいませんでした。1人は重複か上限（8人）で入れていません");
  await expect(memberRows(page)).toHaveCount(1);
});

test("API が 400 を返す → エラー文（role=alert）。textarea は消えない", async ({ page }) => {
  await mockParse(page, { error: "LINEの会話を貼り付けてください" }, 400);
  await page.goto("/app");
  await open(page);
  await page.getByLabel("貼り付けるテキスト").fill("x");
  await page.getByRole("button", { name: "読み取って追加" }).click();
  await expect(importError(page)).toHaveText("LINEの会話を貼り付けてください");
  await expect(page.getByLabel("貼り付けるテキスト")).toHaveValue("x");
  await expect(memberRows(page)).toHaveCount(0);
});

test("API が 503（キー未設定）→ サーバーのメッセージをそのまま出す", async ({ page }) => {
  await mockParse(page, { error: "AI の設定が完了していません（OPENAI_API_KEY 未設定）。管理者に連絡してください" }, 503);
  await page.goto("/app");
  await open(page);
  await page.getByLabel("貼り付けるテキスト").fill("x");
  await page.getByRole("button", { name: "読み取って追加" }).click();
  await expect(importError(page)).toContainText("OPENAI_API_KEY 未設定");
});

test("JSON でない応答（500 の HTML など）→ ステータス付きの汎用エラー", async ({ page }) => {
  await page.route(/\/api\/parse\/?(\?.*)?$/, (route) => route.fulfill({ status: 500, contentType: "text/html", body: "<html>Internal Server Error</html>" }));
  await page.goto("/app");
  await open(page);
  await page.getByLabel("貼り付けるテキスト").fill("x");
  await page.getByRole("button", { name: "読み取って追加" }).click();
  await expect(importError(page)).toHaveText("読み取りに失敗しました（500）。少し待ってもう一度試してください");
});

test("通信失敗 → ネットワーク確認のエラー", async ({ page }) => {
  await page.route(/\/api\/parse\/?(\?.*)?$/, (route) => route.abort("connectionfailed"));
  await page.goto("/app");
  await open(page);
  await page.getByLabel("貼り付けるテキスト").fill("x");
  await page.getByRole("button", { name: "読み取って追加" }).click();
  await expect(importError(page)).toHaveText("通信に失敗しました。ネットワークを確認してもう一度試してください");
});

test("読み取り中はボタンが「読み取り中…」で二重送信できない", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route(/\/api\/parse\/?(\?.*)?$/, async (route) => {
    await gate;
    await route.fulfill({ json: { venue: null, meetAt: null, members: [{ name: "田中", station: "鞍馬" }] } });
  });
  await page.goto("/app");
  await open(page);
  await page.getByLabel("貼り付けるテキスト").fill("x");
  await page.getByRole("button", { name: "読み取って追加" }).click();
  await expect(page.getByRole("button", { name: "読み取り中…" })).toBeDisabled();
  await expect(page.getByLabel("貼り付けるテキスト")).toBeDisabled();
  release();
  await expect(page.locator(".chat-import-done")).toHaveText("田中 を追加");
});
