// /app（components/Planner.tsx）: メンバー入力 → 終電解決 → 順位表示 → URL 共有。
// Transit API は helpers.mockTransitOffline で偽装（ローカル JSON に無い駅は「対応予定」）。
import { expect, test } from "@playwright/test";
import { memberRows, mockTransitFound, mockTransitOffline, pill, queryOf, waitForBuilt } from "./helpers";

test.beforeEach(async ({ page }) => {
  await mockTransitOffline(page);
});

test.describe("初期状態", () => {
  test("メンバー 0 人: 案内文が出て、候補地は既定の 5 つが選択済み", async ({ page }) => {
    await page.goto("/app");
    await waitForBuilt(page);
    await expect(page.locator(".ranking .lede")).toHaveText("①でメンバーの最寄り駅を追加すると、一番長くいられる場所が出ます。");
    await expect(memberRows(page)).toHaveCount(0);
    await expect(page.locator(".heading .num.note").first()).toHaveText("0 / 8人");

    const pressed = page.locator("button.pill[aria-pressed='true']");
    await expect(pressed).toHaveCount(5);
    await expect(pressed).toHaveText(["四条", "京都駅", "烏丸御池", "三条", "出町柳"]);
    await expect(page.locator("button.pill")).toHaveCount(8);

    await expect(page.locator("input[type=time]")).toHaveValue("19:00");
    await expect(page.locator("input[type=range]")).toHaveValue("5");
    await expect(page.locator(".cond b.num")).toHaveText("5分");
  });

  test("ヘッダーに今日のダイヤ種別（平日 / 土休日）が出る", async ({ page }) => {
    // 時計を偽装すると SSR（実時刻）とクライアント（偽時刻）でずれてハイドレーション警告になるので、実際の曜日から期待値を出す
    const dow = new Date().toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Tokyo" });
    const expected = dow === "Sat" || dow === "Sun" ? "京都・土休日ダイヤ" : "京都・平日ダイヤ";
    await page.goto("/app");
    await expect(page.locator(".topbar .status").first()).toContainText(expected);
  });

  test("「戻る」で LP へ", async ({ page }) => {
    await page.goto("/app");
    await page.getByRole("link", { name: "トップページへ戻る" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("h1")).toContainText("もうちょっと");
  });
});

test.describe("URL からの復元", () => {
  test("m= / v= / t= / w= が画面に反映される", async ({ page }) => {
    await page.goto("/app?m=田中:鞍馬,国際会館&v=shijo,demachiyanagi&t=20:30&w=10");
    const rows = memberRows(page);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).getByLabel("名前")).toHaveValue("田中");
    await expect(rows.nth(0).getByLabel("最寄り駅")).toHaveValue("鞍馬");
    // 名前を省くと駅名が名前になる
    await expect(rows.nth(1).getByLabel("名前")).toHaveValue("国際会館");
    await expect(rows.nth(1).getByLabel("最寄り駅")).toHaveValue("国際会館");

    await expect(page.locator("button.pill[aria-pressed='true']")).toHaveText(["四条", "出町柳"]);
    await expect(page.locator("input[type=time]")).toHaveValue("20:30");
    await expect(page.locator("input[type=range]")).toHaveValue("10");
  });

  test("不正な t= / 範囲外の w= は既定値に丸める", async ({ page }) => {
    await page.goto("/app?t=abc&w=99");
    await expect(page.locator("input[type=time]")).toHaveValue("19:00");
    await expect(page.locator("input[type=range]")).toHaveValue("15");
  });

  // Planner.tsx: `Number(params.get("w")) || 5` は 0 を falsy として 5 に戻すため、徒歩 0 分は URL で共有できない
  // （スライダーで 0 にすると w=0 が URL に書かれるが、リロードすると 5 に戻る）。直したらこの fixme を外す。
  test.fixme("w=0（徒歩 0 分）は URL から復元できる", async ({ page }) => {
    await page.goto("/app?w=0");
    await expect(page.locator("input[type=range]")).toHaveValue("0");
  });

  test("v= に未知の id だけなら既定の候補地に戻る", async ({ page }) => {
    await page.goto("/app?v=nowhere,unknown");
    await expect(page.locator("button.pill[aria-pressed='true']")).toHaveCount(5);
  });

  test("「駅」付きの駅名は落として受ける（鞍馬駅 → 鞍馬）", async ({ page }) => {
    await page.goto("/app?m=鞍馬駅");
    await expect(memberRows(page).first().getByLabel("最寄り駅")).toHaveValue("鞍馬");
  });
});

test.describe("メンバーの追加・編集・削除", () => {
  test("名前と駅を入れて追加 → 行が増え、URL に m= が入る", async ({ page }) => {
    await page.goto("/app");
    await page.getByLabel("追加する人の名前").fill("田中");
    await page.getByLabel("追加する人の最寄り駅").fill("鞍馬駅");
    await page.getByRole("button", { name: "追加" }).click();

    const rows = memberRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByLabel("名前")).toHaveValue("田中");
    await expect(rows.first().getByLabel("最寄り駅")).toHaveValue("鞍馬");
    await expect(page.locator(".heading .num.note").first()).toHaveText("1 / 8人");
    await expect.poll(() => queryOf(page).m).toBe("田中:鞍馬");

    // 入力欄は空に戻る
    await expect(page.getByLabel("追加する人の名前")).toHaveValue("");
    await expect(page.getByLabel("追加する人の最寄り駅")).toHaveValue("");
  });

  test("駅が空なら追加ボタンは無効", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByRole("button", { name: "追加" })).toBeDisabled();
    await page.getByLabel("追加する人の最寄り駅").fill("   ");
    await expect(page.getByRole("button", { name: "追加" })).toBeDisabled();
    await page.getByLabel("追加する人の最寄り駅").fill("五条");
    await expect(page.getByRole("button", { name: "追加" })).toBeEnabled();
  });

  test("名前を省くと駅名が名前になる。URL は駅名だけ", async ({ page }) => {
    await page.goto("/app");
    await page.getByLabel("追加する人の最寄り駅").fill("五条");
    await page.getByLabel("追加する人の最寄り駅").press("Enter");
    const row = memberRows(page).first();
    await expect(row.getByLabel("名前")).toHaveValue("五条");
    await expect(row.locator(".avatar")).toHaveText("五");
    await expect.poll(() => queryOf(page).m).toBe("五条");
  });

  test("8 人で上限。追加ボタンが無効になる", async ({ page }) => {
    const eight = ["五条", "四条", "京都", "山科", "鞍馬", "国際会館", "太秦天神川", "桂"].join(",");
    await page.goto(`/app?m=${eight}`);
    await expect(memberRows(page)).toHaveCount(8);
    await expect(page.locator(".heading .num.note").first()).toHaveText("8 / 8人");
    await page.getByLabel("追加する人の最寄り駅").fill("二条");
    await expect(page.getByRole("button", { name: "追加" })).toBeDisabled();
  });

  test("× で削除 → 行と URL から消える", async ({ page }) => {
    await page.goto("/app?m=田中:鞍馬,佐藤:五条");
    await expect(memberRows(page)).toHaveCount(2);
    await memberRows(page).nth(0).getByRole("button", { name: "削除" }).click();
    await expect(memberRows(page)).toHaveCount(1);
    await expect(memberRows(page).first().getByLabel("名前")).toHaveValue("佐藤");
    await expect.poll(() => queryOf(page).m).toBe("佐藤:五条");
  });

  test("駅の変更は確定（blur / Enter）でだけ反映。名前 = 駅名なら名前も追従", async ({ page }) => {
    await page.goto("/app?m=五条");
    const row = memberRows(page).first();
    const station = row.getByLabel("最寄り駅");
    await station.fill("四条");
    // まだ確定していない → URL は変わらない
    expect(queryOf(page).m).toBe("五条");
    await station.press("Enter");
    await expect.poll(() => queryOf(page).m).toBe("四条");
    await expect(row.getByLabel("名前")).toHaveValue("四条");
  });

  test("駅を空にして確定すると元の値に戻る", async ({ page }) => {
    await page.goto("/app?m=五条");
    const station = memberRows(page).first().getByLabel("最寄り駅");
    await station.fill("");
    await station.blur();
    await expect(station).toHaveValue("五条");
  });

  test("名前の編集は即反映。空にすると駅名に戻る", async ({ page }) => {
    await page.goto("/app?m=田中:鞍馬");
    const name = memberRows(page).first().getByLabel("名前");
    await name.fill("田中太郎");
    await expect.poll(() => queryOf(page).m).toBe("田中太郎:鞍馬");
    await name.fill("");
    await expect(name).toHaveValue("鞍馬");
    await expect.poll(() => queryOf(page).m).toBe("鞍馬");
  });
});

test.describe("候補地・条件", () => {
  test("候補地の pill はトグルで aria-pressed と URL の v= が変わる", async ({ page }) => {
    await page.goto("/app");
    const kitaoji = pill(page, "北大路");
    await expect(kitaoji).toHaveAttribute("aria-pressed", "false");
    await kitaoji.click();
    await expect(kitaoji).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => queryOf(page).v).toBe("shijo,kyoto,karasumaoike,sanjo,demachiyanagi,kitaoji");
    await pill(page, "四条").click();
    await expect.poll(() => queryOf(page).v).toBe("kyoto,karasumaoike,sanjo,demachiyanagi,kitaoji");
  });

  test("集合時刻と徒歩分は URL の t= / w= に入る", async ({ page }) => {
    await page.goto("/app");
    await page.locator("input[type=time]").fill("20:00");
    await expect.poll(() => queryOf(page).t).toBe("20:00");
    await page.locator("input[type=range]").fill("12");
    await expect(page.locator(".cond b.num")).toHaveText("12分");
    await expect.poll(() => queryOf(page).w).toBe("12");
  });
});

test.describe("順位（ローカル JSON で解ける駅）", () => {
  test("田中(鞍馬)・高橋(国際会館): 1 位は出町柳、22:15 まで、ボトルネックは田中", async ({ page }) => {
    await page.goto("/app?m=田中:鞍馬,高橋:国際会館&v=shijo,demachiyanagi&t=19:00&w=10");
    await waitForBuilt(page);

    await expect(page.locator(".ranking .heading h2")).toContainText("この2人が一番長くいられる場所");
    await expect(page.locator(".winner-name")).toHaveText("出町柳");
    // 鞍馬行き最終 22:30 − 乗換 5 分 − 徒歩 10 分 = 22:15
    await expect(page.locator(".winner-time strong")).toHaveText("22:15");
    await expect(page.locator(".winner-time small")).toContainText("までに出れば、全員帰れます");
    await expect(page.locator(".bottleneck")).toContainText("田中さんの終電時間は 22:15 です。");
    // 19:00 集合 → 3 時間 15 分
    await expect(page.locator(".winner .note")).toContainText("3時間15分");

    // 2 位の四条: 22:30 − 18 − 5 − 10 = 21:57、差 18 分
    const rows = page.locator(".rank-list li");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("四条");
    await expect(rows.first().locator(".rank-right b")).toHaveText("21:57");
    await expect(rows.first().locator(".diff")).toHaveText("−18分");
    await expect(page.locator(".reason")).toContainText("四条より");
    await expect(page.locator(".reason strong")).toHaveText("+18");

    // 田中の行がボトルネックとして強調される
    await expect(memberRows(page).nth(0)).toHaveClass(/is-bottleneck/);
    await expect(memberRows(page).nth(1)).not.toHaveClass(/is-bottleneck/);
  });

  test("タイムライン: 選んだ候補地で誰が何時まで", async ({ page }) => {
    await page.goto("/app?m=田中:鞍馬,高橋:国際会館&v=shijo,demachiyanagi&w=10");
    await waitForBuilt(page);
    await expect(page.locator(".detail h2")).toHaveText("出町柳なら、誰が何時まで");
    const tl = page.locator(".tl-row");
    await expect(tl).toHaveCount(2);
    await expect(tl.nth(0)).toContainText("田中");
    await expect(tl.nth(0).locator(".tl-time")).toHaveText("22:15");
    await expect(tl.nth(0)).toHaveClass(/is-bottleneck/);

    // 2 位（四条）をクリックすると詳細が切り替わる
    await page.locator(".rank-list .rank-row").first().click();
    await expect(page.locator(".detail h2")).toHaveText("四条なら、誰が何時まで");
    await expect(page.locator(".tl-row").nth(0).locator(".tl-time")).toHaveText("21:57");
  });

  test("差が 10 分以内なら「どこでもほぼ同じ」", async ({ page }) => {
    // 国際会館 1 人: 四条 (23:50−0−3−5=23:42) と 烏丸御池 (23:55−0−3−5=23:47) → 差 5 分
    await page.goto("/app?m=高橋:国際会館&v=shijo,karasumaoike&w=5");
    await waitForBuilt(page);
    await expect(page.locator(".winner-name")).toHaveText("烏丸御池");
    await expect(page.locator(".winner-time strong")).toHaveText("23:47");
    await expect(page.locator(".flat")).toContainText("差は 5分");
  });

  test("自宅駅が候補地そのもの: 終電の制約なし", async ({ page }) => {
    await page.goto("/app?m=四条&v=shijo");
    await waitForBuilt(page);
    await expect(page.locator(".winner-name")).toHaveText("四条");
    await expect(page.locator(".winner-time strong")).toHaveText("終電の制約なし");
    await expect(page.locator(".winner-time small")).toContainText("全員この駅が最寄りです");
    await expect(page.locator(".bottleneck")).toHaveCount(0);
  });

  test("徒歩を変えると時刻が動く（順位は同じ）", async ({ page }) => {
    await page.goto("/app?m=田中:鞍馬&v=demachiyanagi,shijo&w=5");
    await waitForBuilt(page);
    await expect(page.locator(".winner-time strong")).toHaveText("22:20");
    await page.locator("input[type=range]").fill("0");
    await expect(page.locator(".winner-time strong")).toHaveText("22:25");
    await expect(page.locator(".winner-name")).toHaveText("出町柳");
  });

  test("候補地を外すと順位から消える。全部外すと案内文", async ({ page }) => {
    await page.goto("/app?m=田中:鞍馬&v=demachiyanagi,shijo");
    await waitForBuilt(page);
    await expect(page.locator(".rank-list li")).toHaveCount(1);
    await pill(page, "四条").click();
    await expect(page.locator(".rank-list")).toHaveCount(0);
    await pill(page, "出町柳").click();
    await expect(page.locator(".ranking .lede")).toHaveText("メンバーと候補地を選ぶと、一番長くいられる場所が出ます。");
  });
});

test.describe("対応予定（ローカルに無く Transit も出せない駅）", () => {
  test("その人だけバッジが付き、順位計算から外れる", async ({ page }) => {
    await page.goto("/app?m=田中:鞍馬,鈴木:大阪梅田&v=demachiyanagi,shijo&w=10");
    await waitForBuilt(page);
    const rows = memberRows(page);
    await expect(rows.nth(1)).toHaveClass(/is-unavailable/);
    await expect(rows.nth(1).locator(".badge-unavailable")).toHaveText("この駅は対応予定・順位に含めていません");
    await expect(rows.nth(0).locator(".badge-unavailable")).toHaveCount(0);

    await expect(page.locator(".ranking .heading h2")).toContainText("この1人が一番長くいられる場所");
    await expect(page.locator(".ranking .heading .note")).toContainText("対応予定 1人を除く");
    await expect(page.locator(".winner-time strong")).toHaveText("22:15");
  });

  test("全員が対応予定なら、駅名を変える案内", async ({ page }) => {
    const calls = await mockTransitOffline(page);
    await page.goto("/app?m=鈴木:大阪梅田");
    await waitForBuilt(page);
    await expect(page.locator(".ranking .lede")).toHaveText("終電データのある駅のメンバーがいません。駅名を変えてみてください。");
    // 同じ駅の suggest はハブ 7 つ分でも 1 回にまとまる
    expect(calls.suggest.filter((q) => q === "大阪梅田").length).toBeLessThanOrEqual(1);
  });

  test("LP の「例を見る」: 4 人のうち Transit 頼みの 2 人が対応予定になる", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "例を見る" }).click();
    await expect(page).toHaveURL(/\/app/);
    await expect(memberRows(page)).toHaveCount(4);
    await waitForBuilt(page);
    await expect(page.locator(".badge-unavailable")).toHaveCount(2);
    await expect(page.locator(".ranking .heading .note")).toContainText("対応予定 2人を除く");
    await expect(page.locator(".winner-name")).toHaveText("出町柳");
  });
});

test.describe("Transit で解ける駅", () => {
  test("Transit が経路を返せば via transit の経路として順位に入る", async ({ page }) => {
    await page.unroute(/api\.transit\.ls8h\.com/);
    // 京都河原町 → 大阪梅田 23:20 発（84000 秒）
    await mockTransitFound(page, { stationName: "大阪梅田", stationId: "scrape-hankyu:阪急電鉄-京都線-大阪梅田", departureSecs: 84000, headsign: "大阪梅田", originName: "京都河原町" });
    await page.goto("/app?m=鈴木:大阪梅田&v=shijo&w=5");
    await waitForBuilt(page);
    await expect(page.locator(".badge-unavailable")).toHaveCount(0);
    await expect(page.locator(".winner-name")).toHaveText("四条");
    // 四条 → 京都河原町 6 分・乗換 3 分・徒歩 5 分: 23:20 − 6 − 3 − 5 = 23:06
    // （他ハブへ返した同じ journey は出発駅名が京都河原町なので startsAt で弾かれ、経路は kawaramachi の 1 本）
    await expect(page.locator(".winner-time strong")).toHaveText("23:06");
  });

  test("乗換 2 回以上の Transit 経路がボトルネックなら「参考値」バッジ", async ({ page }) => {
    await page.unroute(/api\.transit\.ls8h\.com/);
    await mockTransitFound(page, { stationName: "大阪梅田", stationId: "scrape-hankyu:阪急電鉄-京都線-大阪梅田", departureSecs: 84000, headsign: "大阪梅田", originName: "京都河原町", transferCount: 2 });
    // 鈴木（大阪梅田・乗換 2）が 23:06、高橋（国際会館・ローカル）は 23:4x → 鈴木がボトルネック
    await page.goto("/app?m=鈴木:大阪梅田,高橋:国際会館&v=shijo,karasumaoike&w=5");
    await waitForBuilt(page);
    await expect(page.locator(".winner .eyebrow .badge-ref")).toHaveText("参考値");
    await expect(page.locator(".bottleneck")).toContainText("鈴木");
    // 2 位（烏丸御池）も同じ経路がボトルネック → こちらにもバッジ
    await expect(page.locator(".rank-list li .badge-ref")).toHaveCount(1);
  });

  test("乗換 0〜1 回、またはローカル経路がボトルネックなら「参考値」は出ない", async ({ page }) => {
    await page.unroute(/api\.transit\.ls8h\.com/);
    await mockTransitFound(page, { stationName: "大阪梅田", stationId: "scrape-hankyu:阪急電鉄-京都線-大阪梅田", departureSecs: 84000, headsign: "大阪梅田", originName: "京都河原町", transferCount: 1 });
    await page.goto("/app?m=鈴木:大阪梅田&v=shijo&w=5");
    await waitForBuilt(page);
    await expect(page.locator(".winner-time strong")).toHaveText("23:06");
    await expect(page.locator(".badge-ref")).toHaveCount(0);
  });
});

test.describe("共有", () => {
  test("「リンクをコピー」で現在の URL がクリップボードに入る", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/app?m=田中:鞍馬&v=demachiyanagi");
    await waitForBuilt(page);
    await page.getByRole("button", { name: "リンクをコピー" }).click();
    await expect(page.getByRole("button", { name: "コピーしました" })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(page.url());
    expect(new URL(copied).searchParams.get("m")).toBe("田中:鞍馬");
    // 1.8 秒で元の文言に戻る
    await expect(page.getByRole("button", { name: "リンクをコピー" })).toBeVisible({ timeout: 5000 });
  });

  test("リロードしても URL から同じ状態が戻る", async ({ page }) => {
    await page.goto("/app");
    await page.getByLabel("追加する人の最寄り駅").fill("鞍馬");
    await page.getByRole("button", { name: "追加" }).click();
    await pill(page, "北大路").click();
    await page.locator("input[type=time]").fill("20:00");
    await expect.poll(() => queryOf(page)).toEqual({ m: "鞍馬", v: "shijo,kyoto,karasumaoike,sanjo,demachiyanagi,kitaoji", t: "20:00", w: "5" });
    await page.reload();
    await expect(memberRows(page)).toHaveCount(1);
    await expect(pill(page, "北大路")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("input[type=time]")).toHaveValue("20:00");
  });
});
