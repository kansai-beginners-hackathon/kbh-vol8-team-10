# ローカル終電データ

`subway-last-trains.json` は、画面がAPIやSupabaseに接続しなくても動くように同梱しているデータです。

`last-train-direct-range.json` は、四条・京都駅・烏丸御池・三条・出町柳・北大路・山科・桂の8地点から、京都市営地下鉄・叡電・阪急・近鉄・京阪・嵐電・京都市営バスで一本で行ける範囲の終電情報を静的JSONとして残したものです。

### 私鉄各線の駅別終電（`*-last-trains.json` ＋ `private-lines.json`）

`eizan-last-trains.json` / `arashiden-last-trains.json` / `hankyu-last-trains.json` / `keihan-last-trains.json` / `kintetsu-last-trains.json` は、路線上の**全駅**について「駅 × 路線 × 行き先 → 最終時刻」を持つ静的JSONです。`subway-last-trains.json` と同じ構造（`stations[].lines[].destinations[]` に `weekday` / `weekend`、24時台は `24:05` 表記）で、圧縮・分割はしていません（1路線=1ファイル）。`lib/lastTrain.ts` の `lastTrainBetween` がそのまま読めます。出典は各社公式時刻表で、`source.url` と各行の `sourceUrl` に参照ページを残します。推測値は入れず、公式時刻表で確認できない駅・行き先はその項目ごと省略します。

阪急・京阪・近鉄など優等列車のある路線は、`lastTrainBetween` が列車種別（各停/急行/準急/特急）を区別できないため、原則**各駅停車（普通）のみ**を収録します（途中駅を通過する列車を「乗れる終電」と誤表示しないため）。実際の最終列車はこれより遅い場合があります（特に平日深夜。近鉄京都線は新田辺以南への直通普通が早く終わり以降は急行のみ）。例外や省略の詳細は各ファイルの `source.note` に明記します。行き先は代表的な終着・区間止まりだけを収録し、`through` で路線外の行き先の到達駅を補います（例: 京阪 `寝屋川市`→樟葉、近鉄 `大和西大寺`／奈良方面）。

`private-lines.json` は私鉄各線の駅順（`subway-lines.json` と同じ形式。`lines[].stations` が並び順、`lines[].through` が路線外の行き先の到達駅）。`*-last-trains.json` と組み合わせて駅間の終電を導出します。叡電・嵐電・阪急京都線・京阪本線＋鴨東線・近鉄京都線を収録。

旧 `*-direct-8stations` 系（8地点ハブ集約の圧縮JSON）は、鉄道分は新形式に全て置き換え済みで削除しました（嵐電・叡電・阪急・京阪・近鉄）。バスの `kyoto-city-bus-direct-8stations` は対象外のため残しています。

`kyoto-city-bus-direct-8stations.json` は、上記8地点から京都市営バスで一本だけで繋がる駅ごとの最終便を、3つの中心ハブ（三条・四条・京都駅）に集約して残した最小圧縮JSONです。詳細は `kyoto-city-bus-direct-8stations/part-01.json` と `part-02.json` の2分割にして、1ファイルあたり4件までに抑えています。データ量の増加を防ぎつつ、最短で確認できる終電だけを保持します。

## 現在の収録内容

- 京都市営地下鉄（`subway-last-trains.json`）
  - 烏丸線15駅、東西線17駅（烏丸御池の重複を除く31駅）
  - 烏丸御池は烏丸線と東西線の2路線
- 叡電（`eizan-last-trains.json`）: 叡山本線・鞍馬線の全駅
- 嵐電（`arashiden-last-trains.json`）: 嵐山本線・北野線の全駅（平日・土休日で深夜帯は同時刻）
- 阪急京都線（`hankyu-last-trains.json`）: 京都河原町〜高槻市の15駅（府外の主要駅まで）。普通列車ベース
- 京阪本線＋鴨東線（`keihan-last-trains.json`）: 出町柳〜樟葉の19駅（府外の主要駅まで）。2026-08-22改正、普通列車ベース
- 近鉄京都線（`kintetsu-last-trains.json`）: 京都〜大和西大寺の全26駅。2026-03-14ダイヤ、普通列車ベース
- いずれも平日・土曜休日の終発時刻、行き先別の最終時刻、`24:01` のような24時台の表記

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