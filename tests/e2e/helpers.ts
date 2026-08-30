import { expect, type Page } from "@playwright/test";

export const TRANSIT_HOST = /api\.transit\.ls8h\.com/;

/**
 * Transit API をオフライン相当に偽装する。
 * suggest は駅 0 件、plan は経路 0 件 → ローカル JSON に無い駅は「対応予定」になる。
 * 実 API を叩かないので、テストは決定的でネットワーク不要。
 */
export async function mockTransitOffline(page: Page): Promise<{ suggest: string[]; plan: string[] }> {
  const calls = { suggest: [] as string[], plan: [] as string[] };
  await page.route(TRANSIT_HOST, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/locations/suggest")) {
      calls.suggest.push(url.searchParams.get("q") ?? "");
      await route.fulfill({ json: { stations: [] } });
    } else {
      calls.plan.push(url.searchParams.get("to") ?? "");
      await route.fulfill({ json: { journeys: [] } });
    }
  });
  return calls;
}

/** Transit が特定の駅だけ答える偽装。suggest → 駅 ID、plan → 1 本の journey（発 departureSecs） */
export async function mockTransitFound(page: Page, opts: { stationName: string; stationId: string; departureSecs: number; headsign: string; originName: string; transferCount?: number }) {
  await page.route(TRANSIT_HOST, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/locations/suggest")) {
      const q = url.searchParams.get("q");
      await route.fulfill({ json: { stations: q === opts.stationName ? [{ id: opts.stationId, name: opts.stationName, kind: "station" }] : [] } });
      return;
    }
    await route.fulfill({
      json: {
        journeys: [
          {
            departureSecs: opts.departureSecs,
            arrivalSecs: opts.departureSecs + 1800,
            transferCount: opts.transferCount ?? 0,
            legs: [{ kind: "transit", headsign: opts.headsign, from: { name: opts.originName }, to: { name: opts.stationName }, departureSecs: opts.departureSecs, arrivalSecs: opts.departureSecs + 1800 }],
          },
        ],
      },
    });
  });
}

/** /api/parse/ を偽装する。status 200 なら ParsedChat を返す */
export async function mockParse(page: Page, body: unknown, status = 200) {
  const requests: unknown[] = [];
  await page.route(/\/api\/parse\/?(\?.*)?$/, async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status, json: body });
  });
  return requests;
}

/** Planner のメンバー行（見出し行は除く） */
export const memberRows = (page: Page) => page.locator(".member-list .member:not(.member-head)");

/** 「更新中…」が消えるまで待つ（終電の解決が終わった）。事前計算済みの駅だけなら最初から出ない */
export async function waitForBuilt(page: Page) {
  await expect(page.locator(".status-building")).toHaveCount(0);
}

/** メンバー行の「対応予定」表示（ローカルにも Transit にも無い駅） */
export const unavailableBadge = (page: Page) => page.locator(".state-unavailable");

/** ③ のダイヤ切り替え（平日 / 土日） */
export const dayTypePill = (page: Page, label: "平日" | "土日") => page.getByRole("group", { name: "ダイヤ" }).getByRole("button", { name: label });

/** URL の m= / v= / t= / w= / d= を読む */
export function queryOf(page: Page) {
  const q = new URL(page.url()).searchParams;
  return { m: q.get("m"), v: q.get("v"), t: q.get("t"), w: q.get("w"), d: q.get("d") };
}

/** 候補地の pill（②）。ランキング行のボタンにも候補地名が入るので、pill に限定して完全一致で引く */
export const pill = (page: Page, name: string) => page.locator("button.pill", { hasText: new RegExp(`^${name}$`) });

/** テキスト貼り付けのエラー表示。Next のルートアナウンサー（role=alert）と区別するため chat-import 内に限定 */
export const importError = (page: Page) => page.locator(".chat-import [role=alert]");
