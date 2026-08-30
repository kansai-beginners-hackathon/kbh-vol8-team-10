// E2E（tests/e2e）。実行: npm run test:e2e
// Next の dev サーバーを 3100 番で自動起動する（3000 番で開発中のサーバーとぶつけない）。
// 外部 API（Transit / OpenAI）は各テストが page.route で偽装するので、ネットワークも API キーも要らない。
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `${BASE_URL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // /api/parse はキー未設定だと 503 で止まるので、入力検証まで到達できるようダミーを入れる（本物は e2e では使わない）
    env: { ...process.env, OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "sk-e2e-dummy" },
  },
});
