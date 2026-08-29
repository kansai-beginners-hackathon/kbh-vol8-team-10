# ローカル終電データ

出典・取得方法・取得日の一覧は [`docs/データ出典.md`](../docs/データ出典.md) にまとめています。

| 事業者・路線 | 取得方法 | 取得日 |
|---|---|---|
| 京都市営地下鉄 | スクリプト（`npm run data:export`）で公式HTMLから取得 | 2026-08-28 |
| 叡電 | 公式PDFを人が転記（出町柳のみ `npm run data:import:eizan-last-two` で自動取得） | 2026-08-29 |
| 嵐電 | 公式の時刻表画像を人が転記 | 2026-08-29 |
| 阪急京都線 | 公式の駅別時刻表HTMLを人が転記 | 2026-08-29 |
| 京阪本線＋鴨東線 | 公式の駅別発車時刻表PDFを人が転記 | 2026-08-29 |
| 近鉄京都線 | 公式の駅時刻表HTMLを人が転記 | 2026-08-29 |
| 候補地→ハブ（`network.ts` / `venue-hub-trains.json`） | Yahoo!乗換案内で人が実測（+3分の安全マージン） | 2026-08-30 |

路線ごとの収録範囲と駅数は「現在の収録内容」、ダイヤ改正の扱いと Transit API の位置づけは `docs/データ出典.md` を参照してください。

`subway-last-trains.json` は、画面がAPIやSupabaseに接続しなくても動くように同梱しているデータです。

`last-train-direct-range.json` は、四条・京都駅・烏丸御池・三条・出町柳・北大路・山科・桂の8地点から、京都市営地下鉄・叡電・阪急・近鉄・京阪・嵐電・京都市営バスで一本で行ける範囲の終電情報を静的JSONとして残したものです。

### 私鉄各線の駅別終電（`*-last-trains.json` ＋ `private-lines.json`）

`eizan-last-trains.json` / `arashiden-last-trains.json` / `hankyu-last-trains.json` / `keihan-last-trains.json` / `kintetsu-last-trains.json` は、路線上の**全駅**について「駅 × 路線 × 行き先 → 最終時刻」を持つ静的JSONです。`subway-last-trains.json` と同じ構造（`stations[].lines[].destinations[]` に `weekday` / `weekend`、24時台は `24:05` 表記）で、圧縮・分割はしていません（1路線=1ファイル）。`lib/lastTrain.ts` の `lastTrainBetween` がそのまま読めます。出典は各社公式時刻表で、`source.url` と各行の `sourceUrl` に参照ページを残します。推測値は入れず、公式時刻表で確認できない駅・行き先はその項目ごと省略します。

阪急・京阪・近鉄など優等列車のある路線は、`lastTrainBetween` が列車種別（各停/急行/準急/特急）を区別できないため、原則**各駅停車（普通）のみ**を収録します（途中駅を通過する列車を「乗れる終電」と誤表示しないため）。実際の最終列車はこれより遅い場合があります（特に平日深夜。近鉄京都線は新田辺以南への直通普通が早く終わり以降は急行のみ）。例外や省略の詳細は各ファイルの `source.note` に明記します。行き先は代表的な終着・区間止まりだけを収録し、`through` で路線外の行き先の到達駅を補います（例: 京阪 `寝屋川市`→樟葉、近鉄 `大和西大寺`／奈良方面）。

`private-lines.json` は私鉄各線の駅順（`subway-lines.json` と同じ形式。`lines[].stations` が並び順、`lines[].through` が路線外の行き先の到達駅）。`*-last-trains.json` と組み合わせて駅間の終電を導出します。叡電・嵐電・阪急京都線・京阪本線＋鴨東線・近鉄京都線を収録。

直通運転で1本に繋がっている区間は、**運転系統どおりに1路線として統合**します（京阪＝本線＋鴨東線、叡電の鞍馬線＝出町柳〜鞍馬）。`lastTrainBetween` は「両駅が同じ `lines[].stations` に載っていること」で乗換なしを判定するため、線路上の路線名で分けると出町柳→岩倉のような直通が乗換扱いになってしまうためです。共用区間（叡電の出町柳〜宝ケ池）の駅は `*-last-trains.json` 側でも両路線の `lines[]` を持ち、行き先はそれぞれの路線上のものだけを載せます。

旧 `*-direct-8stations` 系（8地点ハブ集約の圧縮JSON）は、鉄道分は新形式に全て置き換え済みで削除しました（嵐電・叡電・阪急・京阪・近鉄）。バスの `kyoto-city-bus-direct-8stations` は対象外のため残しています。

`kyoto-city-bus-direct-8stations.json` は、上記8地点から京都市営バスで一本だけで繋がる駅ごとの最終便を、3つの中心ハブ（三条・四条・京都駅）に集約して残した最小圧縮JSONです。詳細は `kyoto-city-bus-direct-8stations/part-01.json` と `part-02.json` の2分割にして、1ファイルあたり4件までに抑えています。データ量の増加を防ぎつつ、最短で確認できる終電だけを保持します。

## 現在の収録内容

- 京都市営地下鉄（`subway-last-trains.json`）
  - 烏丸線15駅、東西線17駅（烏丸御池の重複を除く31駅）
  - 烏丸御池は烏丸線と東西線の2路線
- 叡電（`eizan-last-trains.json`）: 叡山本線・鞍馬線の全駅。鞍馬線は出町柳〜鞍馬の直通系統として統合
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

> ⚠️ このスクリプト（`scripts/import-kyoto-city-bus.mjs`）はリポジトリに未コミットです。`package.json` にコマンドだけが残っています。バスは現行の終電計算に使っていません。

京都市営バスのGTFS-JPはODPTのアクセストークンが必要です。`developer.odpt.org` で取得したトークンを環境変数に設定して実行します。

```powershell
$env:ODPT_CONSUMER_KEY = "取得したトークン"
npm run data:import:kyoto-bus
```

`data/kyoto-city-bus-timetable.json` に、公式GTFSの停留所・系統・便・曜日条件を結合した時刻データを保存します。ダイヤ更新時は `KYOTO_BUS_GTFS_DATE` に配布日（例: `20260729`）を指定してください。

## 京都市バスの公式HTML時刻表

> ⚠️ このスクリプト（`scripts/import-kyoto-city-bus-timetables.mjs`）はリポジトリに未コミットです。`package.json` にコマンドだけが残っています。

公式の系統一覧から、各停留所・行先の平日・土曜・休日ダイヤを静的JSONにまとめる場合：

```bash
npm run data:import:kyoto-bus-timetables
```

`data/kyoto-city-bus-timetables.json` に、公式HTMLの出典URL、系統、停留所、行先、発車時刻、注記を保存します。

### 叡電の終電・終電一本前（`eizan-last-two.json`）

`eizan-last-two.json` は、叡電の駅について**行き先別の終電と終電一本前**を持つJSONです。`weekday` / `weekend` は `["終電一本前", "終電"]` の順で、1日1本しか無い行き先は1要素だけになります。`track` は終電の発車番線（時刻表の凡例「行先 / 発車番線」の丸数字）、`lastTwoDepartures` は行き先を問わないその駅の終発2本です。現在は**出町柳のみ**収録しています。

更新・駅の追加は次のコマンドです（引数を省くと出町柳）。

```bash
npm run data:import:eizan-last-two
node scripts/import-eizan-last-two.mjs 出町柳 岩倉 宝ケ池
```

公式ページ `https://eizandensha.co.jp/information/<slug>/?di=<n>` はHTMLではなく**PDFを直接返す**ため、スクリプト側でPDFを読んでいます（zlibでFlateDecodeを展開し、ToUnicode CMapで文字を復元して、描画位置で表のセルを組み直す）。時刻表の1セルは上段が行先の略号＋発車番線、下段が分で、「時」の数字はその間に置かれます。左半分が平日、右半分が土曜・休日です。

収録した終電は `eizan-last-trains.json` の出町柳の値と全件一致することを確認済みです。

## アプリからの読み込み

`lib/localData.ts` が地下鉄と私鉄5社のJSONを1組にまとめ、`lib/resolveLastTrain.ts` の既定データ（`defaultDeps`）として渡します。

- 路線: `subway-lines.json` + `private-lines.json` → `ALL_LINES`（9路線）
- 終電: `subway` / `eizan` / `arashiden` / `hankyu` / `keihan` / `kintetsu` の6ファイル → `ALL_LAST_TRAINS`（125駅）

`lastTrainBetween` は駅を名前で1件だけ引くので、複数社に同じ名前の駅がある場合（京都=地下鉄+近鉄、出町柳=叡電+京阪、西院=嵐電+阪急、竹田・十条=地下鉄+近鉄）は `lines[]` を1駅にまとめます。まとめないと先に読んだファイルの路線しか見てもらえません。

地下鉄収録駅かどうかの判定（Transitの feed 優先と `Hub.subwayOnly`）は、merge後のデータではなく `isSubwayStation()` が `subway-last-trains.json` だけを見ます。
