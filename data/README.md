# ローカル終電データ

`subway-last-trains.json` は、画面がAPIやSupabaseに接続しなくても動くように同梱しているデータです。

`last-train-direct-range.json` は、四条・京都駅・烏丸御池・三条・出町柳・北大路・山科・桂の8地点から、京都市営地下鉄・叡電・阪急・近鉄・京阪・嵐電・京都市営バスで一本で行ける範囲の終電情報を静的JSONとして残したものです。

## 現在の収録内容

- 京都市営地下鉄
- 烏丸線15駅、東西線17駅（烏丸御池の重複を除く31駅）
- 烏丸御池は烏丸線と東西線の2路線
- 平日・土曜休日の終発時刻
- 行き先別の最終時刻
- `24:01` のような24時台の表記

## `subway-lines.json`（路線の駅順）

`subway-last-trains.json` は「駅 × 路線 × 行き先 → 最終時刻」しか持たないので、
「四条から五条に帰る最終」のような**駅間の終電**は、この路線データと組み合わせて導出します。

- `lines[].stations`: 路線の駅名を並び順で（配列順が駅順）
- `lines[].through`: 路線外の行き先が、この路線上ではどの駅まで通るか
  （`新田辺 → 竹田`、`近鉄奈良 → 竹田`、`びわ湖浜大津 → 御陵`）

導出関数は `lib/lastTrain.ts` の `lastTrainBetween(lines, lastTrains, from, to, dayType)`。
乗換なしで帰れる最終を `kind: "found"` で返す。同じ駅なら `noTrainNeeded`（電車不要、制約から外す）、乗換が要るなら `needsTransfer`、未収録なら `unknownStation`（後の 2 つは Transit API に回す）。テストは `tests/lastTrain.test.ts`（`npm test`。`node --test` で `.ts` を直接実行するため **Node 22.6 以上**が必要）。

正本は `scripts/stations.js` の `LINES`。駅順や `through` を直したら `npm run data:lines` で再生成します
（公式サイトへの fetch は行いません）。

## 画面との関係

このディレクトリの JSON はビルドに同梱され、実行時に外部 API を叩かなくても画面が動く前提のデータです。
現在の `components/Planner.tsx` は `data/network.ts` のモックを読んでおり、
この JSON と `lib/lastTrain.ts` を Planner に接続する作業は未着手です。
Supabaseのキー、外部API、バックエンドサーバーがなくても、次のコマンドだけで画面を起動できます。

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:3000/` を開いてください。

## データを更新するとき

公式HTMLを取得できる環境で、リポジトリのルートから次を実行します。

```bash
npm run data:export
```

このコマンドは `subway-last-trains.json` と `subway-lines.json` の両方を書き出します。
駅順・`through` だけ直したいときは fetch の要らない `npm run data:lines` を使ってください。

このコマンドは実行時にはアプリから呼ばれず、取得済みのJSONだけをビルドへ同梱します。
24時を超える時刻は `00:01` に変換せず、`24:01` のまま保存します。

公式時刻表の出典と取得日も、JSONの `source` に残します。

## 京都市営バスの時刻表を追加するとき

京都市営バスのGTFS-JPはODPTのアクセストークンが必要です。`developer.odpt.org` で取得したトークンを環境変数に設定して実行します。

```powershell
$env:ODPT_CONSUMER_KEY = "取得したトークン"
npm run data:import:kyoto-bus
```

`data/kyoto-city-bus-timetable.json` に、公式GTFSの停留所・系統・便・曜日条件を結合した時刻データを保存します。ダイヤ更新時は `KYOTO_BUS_GTFS_DATE` に配布日（例: `20260729`）を指定してください。

## 京都市バスの公式HTML時刻表

公式の系統一覧から、各停留所・行先の平日・土曜・休日ダイヤを静的JSONにまとめる場合：

```bash
npm run data:import:kyoto-bus-timetables
```

`data/kyoto-city-bus-timetables.json` に、公式HTMLの出典URL、系統、停留所、行先、発車時刻、注記を保存します。