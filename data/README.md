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

## 画面との関係

`app/page.js` がこのJSONを直接読み込みます。
そのため、Supabaseのキー、外部API、バックエンドサーバーがなくても、次のコマンドだけで画面を起動できます。

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