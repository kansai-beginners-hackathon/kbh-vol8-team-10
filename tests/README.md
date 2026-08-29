# tests/

| フォルダ | 何を見るか | ランナー | 実行 |
| --- | --- | --- | --- |
| `unit/` | 1 モジュールの純粋な振る舞い（`lib/*.ts`・`data/*.ts`）。外部 I/O なし。偽の resolver / fetch を渡す | `node --test` | `npm run test:unit` |
| `integration/` | 複数モジュール＋実データ JSON の組み合わせ。Route Handler を Next サーバー無しで直接呼ぶ。OpenAI / Transit は fetch を差し替えて偽装 | `node --test` | `npm run test:integration` |
| `e2e/` | ブラウザで LP → /app → 入力 → 順位 → URL 共有まで。`/api/*` も HTTP 越しに叩く。外部 API は `page.route` で偽装 | Playwright（Chromium） | `npm run test:e2e` |
| `fixtures/` | Transit API の保存済みレスポンス（unit / integration が読む） | — | — |
| `setup/` | `node --test` 用のモジュール解決フック | — | — |

- `npm test` … unit + integration（数秒。CI の既定）
- `npm run test:coverage` … 同上 + `lib/` `data/` `app/api/` の行カバレッジ表
- `npm run test:all` … unit + integration + e2e
- `npm run test:e2e:ui` … Playwright の UI モード
- `npm run test:parse` … `e2e/live-parse.mjs`。**本物の** OpenAI と起動中のサーバー（既定 :3000）に投げて読み取り精度を見るスモーク。Playwright には拾われない

## 前提

- Node 22.6 以上（`.ts` をそのまま実行する。トランスパイル無し）
- E2E は初回だけ `npx playwright install chromium`
- E2E はネットワークも API キーも不要。`playwright.config.ts` が `next dev -p 3100` を自動起動し、`/api/parse` の入力検証に到達できるようダミーの `OPENAI_API_KEY` を入れる。3100 番で既に動いているサーバーがあればそれを使う（`CI=1` なら使わない）

## `setup/alias-loader.mjs` がやっていること

Next のバンドラは解決してくれるが素の Node は解決しないものを、テスト実行時だけ埋める。アプリのコードは触らない。

1. `@/lib/foo` → リポジトリルート（tsconfig の `paths`）
2. 拡張子なしの import に `.ts` などを補う
3. `import x from "./x.json"` に `with { type: "json" }` を補う（`lib/return-home.ts`）
4. `next/server` のような exports マップの無いパッケージ内パスに `.js` を補う

## 書き方の約束

- テスト名は日本語で「入力 → 期待」を書く。既存のスタイルに合わせる
- 期待値をデータ JSON から引く場合、時刻はハードコードでよい（データ更新でテストが落ちるのは意図どおり。`unit/lastTrain.test.ts` 冒頭のコメント参照）
- 外部 API は必ず偽装する。unit / integration は `fetch` か deps の差し替え、e2e は `page.route`（`e2e/helpers.ts`）
- まだ直っていない挙動は `test.todo`（node）/ `test.fixme`（Playwright）で残し、直したら本テストに昇格させる
  - `unit/transit-helpers.test.ts`: `suggestStationId` は `stations` が配列でないと TypeError を投げる
  - `e2e/planner.spec.ts`: URL の `w=0`（徒歩 0 分）が 5 に戻る（`Number(...) || 5`）

## E2E で使っている画面の目印

`components/Planner.tsx` / `components/ChatImport.tsx` のクラス名・aria-label に依存している。変えたら `e2e/helpers.ts` と各 spec を追従させる。

- メンバー行 `.member-list .member`（見出し行は `.member-head`）、`aria-label="名前"` / `"最寄り駅"` / `"削除"`
- 追加フォーム `aria-label="追加する人の名前"` / `"追加する人の最寄り駅"`、ボタン「追加」
- 候補地 `button.pill[aria-pressed]`
- 順位 `.winner-name` `.winner-time` `.bottleneck` `.rank-list li` `.reason` `.flat`、案内文 `.ranking .lede`
- 対応予定 `.badge-unavailable`、計算中 `.status-building`
- 貼り付け `details.chat-import`、`aria-label="貼り付けるテキスト"`、`.chat-import-done`、`.chat-import [role=alert]`
