# 作業書 タスク2 — 振り分け + Transit API（乗換あり）

> 全体計画: `docs/実装計画_終電ロジック.md`
> API の癖: `docs/Transit_API_ガイド.md`（**6-3 と 8 章と 11 章**は必ず読む）
> 前提: タスク1（`lib/lastTrain.ts`）は完了している。`npm test` が通る状態から始める。

---

## 0. 何を作るか

「ハブ駅 → 自宅駅の終電」を 1 本の関数で答える。

```
resolveLastTrain(hub, home, dayType)
   │
   ├─ lastTrainBetween(ローカル JSON)
   │     found          → 返す（via: "local"）
   │     noTrainNeeded  → 返す。Transit は呼ばない
   │     needsTransfer / unknownStation ↓
   │
   ├─ Transit API  plan?type=arrival&time=26:00&numItineraries=6
   │     isSane を通った中で最も遅く出る便 → 返す（via: "transit"）
   │
   └─ 何も無い / 422 / 503 / ネットワーク断 → unavailable（「対応予定」）
```

フロント（タスク3）はこの関数だけを呼ぶ。「どっちのデータか」を知らなくていい。

---

## 1. 成果物

| ファイル | 種別 | 中身 |
|---|---|---|
| `data/hubs.ts` | 新規 | ハブ 7 駅の座標・乗換分・表示名 |
| `lib/transit.ts` | 新規 | Transit API クライアント |
| `lib/resolveLastTrain.ts` | 新規 | 振り分け役 |
| `tests/fixtures/transit-*.json` | 新規 | 実 API のレスポンスを保存したもの（テスト用） |
| `tests/transit.test.ts` | 新規 | 変換・`isSane`・整形のテスト。API は叩かない |
| `tests/resolveLastTrain.test.ts` | 新規 | 振り分けのテスト。Transit 呼び出しは差し替える |
| `docs/Transit_API_ガイド.md` | 変更 | 11 章のコードを実装に合わせて更新（最後） |

---

## 2. 契約（先に固定する）

### 2-1. 返り値

```ts
// lib/resolveLastTrain.ts
export type Resolved =
  | {
      kind: "found";
      time: string;            // "23:41" / "24:05"（24 時台はそのまま。lib/time.ts の toMin で比較）
      via: "local" | "transit";
      transferCount: number;   // local は常に 0
      headsign: string | null; // 最初の乗車区間の行き先。Transit の地下鉄などは null
    }
  | { kind: "noTrainNeeded" }                 // 同じ駅。電車不要
  | { kind: "unavailable"; reason: string };  // 出せない。reason はログ用（UI には出さない）
```

### 2-2. ハブ

```ts
// data/hubs.ts
export interface Hub {
  id: string;         // network.ts の HUBS のキーと同じ
  name: string;       // 表示名
  lat: number;
  lon: number;
  transferMin: number; // ハブ到着 → 支線乗車までの乗換分（network.ts の手打ち値を移す）
}
```

| id | name | lat | lon | transferMin | 座標の出所 |
|---|---|---|---|---|---|
| demachiyanagi | 出町柳 | 35.030417 | 135.773044 | 5 | 京阪(35.029914,135.772542)と叡電(35.030920,135.773545)の中点 |
| sanjo | 三条 | 35.008790 | 135.772337 | 5 | 京阪三条 |
| kawaramachi | 京都河原町 | 35.003780 | 135.768680 | 3 | 阪急 |
| karasumaoike | 烏丸御池 | 35.009990 | 135.759630 | 3 | 地下鉄 |
| shijo | 四条 | 35.002750 | 135.759673 | 3 | 地下鉄 |
| kyoto | 京都 | 34.985729 | 135.758523 | 8 | JR（地下鉄・近鉄も 100m 以内） |
| shijoomiya | 四条大宮 | 35.003247 | 135.748455 | 5 | 嵐電（阪急大宮も隣接） |

座標は `locations/suggest` の `lat/lon`（2026-08-29 取得）。`transferMin` は `data/network.ts` の `STATIONS[].routes[].transferMin` から。

### 2-3. Transit 呼び出しのパラメータ

| パラメータ | 値 | 理由 |
|---|---|---|
| `from` | `geo:${hub.lat},${hub.lon}` | ハブは複数事業者の駅の集合。座標で渡して Transit に選ばせる |
| `to` | `locations/suggest` で取った駅 ID | 自宅駅は駅名しか分からない |
| `date` | 今日 `YYYYMMDD` | Planner に日付入力が無い |
| `type` | `arrival` | **`last` は使わない**（ガイド 6-3） |
| `time` | `26:00` | 「翌 2:00 までに着く便」 |
| `numItineraries` | `6` | 候補を多めに取って自分で最遅を選ぶ |

`guidance/plan` ではなく `plan` を使う（レスポンスが小さい。`coverage.notices` は今回使わない）。

---

## 3. 手順

### ステップ1 — `data/hubs.ts`

上の表をそのまま `export const HUBS: Hub[]` と `export const HUB_BY_ID: Record<string, Hub>` にする。
`data/network.ts` の `HUBS: Record<string,string>`（id → 名前）はタスク3で消すので、**今は触らない**。

### ステップ2 — `lib/transit.ts`

必要な関数は 4 つ。全部 export する（テストするため）。

```ts
/** 86280 → "23:58"、104400 → "29:00"（24 時台以降もそのまま） */
export function secsToHHMM(secs: number): string

/** ガイド 8 章の isSane。翌朝着・20 時前発・乗換待ち 60 分超を弾く */
export function isSane(journey: TransitJourney): boolean

/** 駅名 → Transit の駅 ID。kind==="station" の先頭。無ければ null */
export async function suggestStationId(name: string, fetcher = fetch): Promise<string | null>

/** plan を叩いて、isSane を通った中で departureSecs 最大の journey を返す。無ければ null */
export async function planLastArrival(
  from: string, to: string, date: string, fetcher = fetch,
): Promise<TransitJourney | null>
```

- `fetcher` を引数で受けるのはテストで差し替えるため。既定は `fetch`（Node 25 / ブラウザ両方にある）
- 型 `TransitJourney` は `{ departureSecs, arrivalSecs, transferCount, legs: { kind, headsign?, departureSecs, arrivalSecs }[] }` の必要部分だけ定義
- HTTP エラー・JSON 解釈失敗は **throw せず null** を返す（呼び出し側で unavailable に畳む）
- `User-Agent` は付けない（ブラウザから叩く。Node の fetch も通る。ガイド 8 章）

### ステップ3 — fixture を保存する

テストで実 API を叩かないため、レスポンスを保存する。`tests/fixtures/` に 4 本。

```bash
B=https://api.transit.ls8h.com/api/v1
# 乗換1回・正常
curl -s --get "$B/plan" --data-urlencode "from=geo:35.008790,135.772337" \
  --data-urlencode "to=scrape-keihan:京阪電気鉄道-宇治線-宇治" \
  --data-urlencode "date=20260829" --data-urlencode "type=arrival" --data-urlencode "time=26:00" \
  --data-urlencode "numItineraries=6" > tests/fixtures/transit-sanjo-uji.json
sleep 1
# 0件
curl -s --get "$B/plan" --data-urlencode "from=geo:35.003780,135.768680" \
  --data-urlencode "to=scrape-hankyu:阪急電鉄-京都線-大阪梅田" \
  --data-urlencode "date=20260829" --data-urlencode "type=arrival" --data-urlencode "time=26:00" > tests/fixtures/transit-empty.json
sleep 1
# 422
curl -s --get "$B/plan" --data-urlencode "from=scrape-keihan:京阪電気鉄道-京阪本線-三条" \
  --data-urlencode "to=scrape-keihan:京阪電気鉄道-鴨東線-出町柳" \
  --data-urlencode "type=arrival" --data-urlencode "time=26:00" > tests/fixtures/transit-422.json
sleep 1
# suggest
curl -s --get "$B/locations/suggest" --data-urlencode "q=宇治" --data-urlencode "limit=5" > tests/fixtures/suggest-uji.json
```

保存したら中身を確認: 三条→宇治は `journeys` に 23:41 発（`departureSecs: 85260`）が含まれているはず。

### ステップ4 — `tests/transit.test.ts`

| テスト | 期待 |
|---|---|
| `secsToHHMM(86280)` | `"23:58"` |
| `secsToHHMM(89100)` | `"24:45"` |
| `secsToHHMM(104400)` | `"29:00"`（00:00 に丸めない） |
| `isSane` 到着 29:54 の journey | `false` |
| `isSane` 出発 17:51 の journey | `false` |
| `isSane` 乗換待ち 5 時間の journey | `false` |
| `isSane` 三条→宇治 23:41→24:12 | `true` |
| `planLastArrival` に fixture 三条→宇治を食わせる | `departureSecs` が最大の sane な journey（23:41）が返る |
| `planLastArrival` に fixture 0件 | `null` |
| `planLastArrival` に fixture 422（`res.ok === false`） | `null`、throw しない |
| `suggestStationId("宇治")` に fixture | `"scrape-keihan:京阪電気鉄道-宇治線-宇治"` |

`fetcher` に「fixture の JSON を返す偽 fetch」を渡す。`Response` は `new Response(JSON.stringify(json), { status })` で作れる。

### ステップ5 — `lib/resolveLastTrain.ts`

```ts
export async function resolveLastTrain(
  hub: Hub,
  home: string,          // 自宅駅名
  dayType: DayType,
  deps = defaultDeps,    // { lines, lastTrains, planLastArrival, suggestStationId, today }
): Promise<Resolved>
```

流れ:

1. `lastTrainBetween(deps.lines, deps.lastTrains, hub.name, home, dayType)`
   - `found` → `{ kind:"found", time, via:"local", transferCount:0, headsign }`
   - `noTrainNeeded` → そのまま返す
   - それ以外 → 2 へ
2. キャッシュを見る（キー `lt:${hub.id}:${home}:${dayType}:${date}`）。あれば返す
3. `suggestStationId(home)` → null なら `unavailable("駅IDが見つからない")`
4. `planLastArrival(geo, stationId, date)` → null なら `unavailable("Transitに経路なし")`
5. `{ kind:"found", time: secsToHHMM(j.departureSecs), via:"transit", transferCount: j.transferCount, headsign: 最初の transit leg の headsign ?? null }` をキャッシュして返す
6. 途中で例外 → `unavailable(e.message)`。**必ず Resolved を返す。throw しない**

キャッシュ:
- メモリ `Map`（同一セッション）+ `localStorage`（ブラウザのみ。`typeof window !== "undefined"` で判定、read/write は try/catch）
- `unavailable` もキャッシュする（同じ失敗を繰り返さない）。TTL は不要（日付がキーに入っている）

間隔制御:
- `planLastArrival` の呼び出し前に前回から 300ms 以上空ける（モジュール内に最終呼び出し時刻を持つ）。7 ハブ × N 人を直列で回す前提

### ステップ6 — `tests/resolveLastTrain.test.ts`

`deps` を差し替えて Transit を叩かずに検証する。

| ケース | deps の設定 | 期待 |
|---|---|---|
| 四条 → 五条 | 何も呼ばれない | `found`, `via:"local"`, `time:"23:57"` |
| 四条 → 四条 | 何も呼ばれない | `noTrainNeeded` |
| 三条 → 宇治 | `planLastArrival` が fixture の journey を返す | `found`, `via:"transit"`, `time:"23:41"`, `transferCount:1` |
| 京都 → 近鉄奈良 | `planLastArrival` が null | `unavailable` |
| 河原町 → 大阪梅田 | `suggestStationId` が null | `unavailable` |
| `planLastArrival` が throw | | `unavailable`（例外が外に漏れない） |
| 同じ問い合わせを 2 回 | | `planLastArrival` は 1 回しか呼ばれない（キャッシュ） |

### ステップ7 — 実 API で手動確認（1 回だけ）

```bash
node --input-type=module -e '
import { resolveLastTrain } from "./lib/resolveLastTrain.ts";
import { HUB_BY_ID } from "./data/hubs.ts";
for (const [hub, home] of [["sanjo","宇治"],["shijo","五条"],["kyoto","三ノ宮"],["kawaramachi","大阪梅田"],["shijo","四条"]]) {
  console.log(hub, "→", home, await resolveLastTrain(HUB_BY_ID[hub], home, "weekday"));
}'
```

期待:

| | 期待 |
|---|---|
| sanjo → 宇治 | found transit 23:41 乗換1 |
| shijo → 五条 | found local 23:57 |
| kyoto → 三ノ宮 | found transit 23:29 乗換0（新快速） |
| kawaramachi → 大阪梅田 | unavailable（阪急 feed の欠損。さすけくんの JSON 待ち） |
| shijo → 四条 | noTrainNeeded |

### ステップ8 — ガイド 11 章を更新

`docs/Transit_API_ガイド.md` 11 章の `getLastTrain` を、実装した `planLastArrival` の呼び方に合わせる（`guidance/plan` → `plan`、`geo:` 出発）。

---

## 4. 完了条件

- [ ] `npm test` 全通過（タスク1 の 16 件 + 本タスク分）
- [ ] `npx tsc --noEmit` エラーなし
- [ ] ステップ7 の 5 ケースが期待どおり
- [ ] `resolveLastTrain` は**どんな入力でも throw しない**（unavailable に畳む）
- [ ] ネットワークを切って実行しても `unavailable` が返る（`planLastArrival` の fetch 失敗が捕まっている）

---

## 5. やらないこと

- `guidance/plan` の `coverage.notices` を UI に出す（ログ用途にも使わない）
- 祝日判定
- Transit の `transferCount ≥ 2` を弾く（返す。UI 側で「参考値」ラベルを付ける。タスク3）
- 阪急・叡電・近鉄の feed 欠損の回避（さすけくんの JSON で①層に来る）

---

## 6. ハマりそうなところ

- **`type=last` を使わない。** 一番大きな罠。ガイド 5-③ の 🚨🚨
- `departureSecs` を `% 24` しない。`29:00` は翌朝 5 時。`isSane` が弾く前提
- `locations/suggest` は同名駅を複数返す（出町柳＝京阪と叡電）。先頭を取る。乗換ありの目的地なので事業者の違いは Transit が吸収する
- Node で `.ts` を直接 import するときは拡張子 `.ts` を付ける（`tsconfig.json` の `allowImportingTsExtensions` は既に有効）
- `localStorage` は SSR 中に無い。`typeof window` で判定し、read/write を try/catch で包む

---

## 7. レビュー後の変更（2026-08-29 実装時）

実 API で叩いて見つかった問題への対応。**2 章の契約から変わった点**:

| 変更 | 理由 |
|---|---|
| `Hub` に `aliases: string[]` と `subwayOnly?: boolean` を追加（三条→[三条京阪]、四条→[烏丸]、四条大宮→[大宮]。四条・烏丸御池が `subwayOnly`） | `geo:` 出発が別の駅にスナップされる（`geo:四条` → **烏丸御池発**の東西線が返り、四条→烏丸御池の 1 駅が消える）。最初の乗車区間の `from.name` がハブ名・別名に無い経路は捨てる |
| `planLastArrival(from, to, date, fetcher, { originNames })` | 上のチェックを `plan` の候補選択に入れる |
| `suggestStationId(name, fetcher, { preferFeeds })` | 同名駅の先頭が期待した事業者でない（大阪梅田→阪神、山科→JR、竹田→近鉄）。地下鉄収録駅なら `scrape-kyoto-subway` を優先 |
| `ResolveDeps.planLastArrival(from, to, date, originNames)` / `suggestStationId(name, preferFeeds)` | 上 2 つを deps 経由で渡す |
| ローカル JSON はハブ名の別名でも引く | 三条（京阪）→ 山科 は 三条京阪 → 東西線 で local に解ける |
| `Hub` に `stationIds: string[]`（Transit の駅 ID）を追加し、`geo:` が null なら駅 ID を from にして順にリトライ | `geo:四条` → 桂 が **422 searchWindowTooDense**（近くに地下鉄四条・阪急烏丸・烏丸御池が密集）。阪急烏丸の ID を指名すれば 23:52 正雀行きが返る |
| `needsTransfer` かつ `hub.subwayOnly` → `unavailable`（Transit を呼ばない） | 地下鉄同士の乗換（四条→山科）は地下鉄 feed の経路検索が壊れている（ガイド 6-3）。**対応予定**で出す |
| `time` は `journey.departureSecs` ではなく**最初の乗車区間の発時刻**（`boardingSecs`） | 先頭に徒歩 leg があると徒歩開始時刻になる。徒歩分は `Hub.transferMin` が持つ |
| `ResolveDeps.today()` → `dateFor(dayType)`（既定 `dateForDayType`）。Transit に渡す日付を **dayType のダイヤが走る直近の日**にする（土曜に weekday なら次の月曜） | 以前は常に今日の日付だったので、土曜に `weekday` を聞いてもローカル JSON は平日・Transit は土休日ダイヤ、と層がズレていた。Transit は日付でカレンダーを選ぶ（京阪の tripId が `weekday_*` / `holiday_*` に変わる）。ダイヤ区分は Planner の「平日 / 土休日」トグルでユーザーが選ぶ（祝日判定は持たない） |
| 新幹線の経路を弾く（`usesShinkansen`）。`suggestStationId` は新幹線の駅を除外し、同名駅は `FEED_PRIORITY`（京都近郊の事業者 → JR → 阪神・大阪メトロ）で選ぶ | 京都→姫路 が「23:05 のぞみ95号」、新大阪 が御堂筋線の駅ID（21:51 乗換2）になっていた。帰りの終電に新幹線は出さない。大阪梅田も阪神より阪急が先になる |
| `unavailable` は **メモリのみ**キャッシュ（localStorage には書かない） | Transit の一時障害でその日一日「対応予定」に固定されないように |
| 駅 ID キャッシュに `null` は残さない | suggest の一時失敗を同セッションの他ハブに波及させない |

ステップ7 の期待値も変わる: `kawaramachi → 大阪梅田` は suggest が阪神・大阪梅田を選ぶため **found 23:30 乗換1**（阪急 → 大山崎徒歩 → JR → 大阪 → 徒歩梅田）になる。阪急 ID を指名すれば 0 件。
