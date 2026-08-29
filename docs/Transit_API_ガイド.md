# Transit API 完全ガイド（初心者向け）

対象: https://api.transit.ls8h.com
調査日: 2026-08-28 ／ **すべて実際に叩いて確認済み**

> このファイルだけ読めば使えるように書いてあります。
> 特に **6章（feedごとの当たり外れ）** が実装の成否を決めるので、そこは必ず読んでください。
> **終電検索に `type=last` を使わないこと**（→ 6-3）が、このAPIで一番大きな罠です。

---

## 1. これは何か（1分）

**日本の電車・バスの経路検索と時刻表が引ける、無料のWeb API。**

```
「京都駅から大阪駅への終電は？」
        ↓ URLを1回叩くだけ
「23:58発 → 24:45着、普通 大阪行き」
```

`https://api.transit.ls8h.com` にGETするだけで使えます。

### 3つの約束

| | 内容 |
|---|---|
| **お金** | 無料 |
| **APIキー** | **不要**（登録もログインも要らない） |
| **メソッド** | **GETだけ**（データを書き込むことはできない） |

さらに **CORS全開放**（`Access-Control-Allow-Origin: *`）なので、**ブラウザのJavaScriptから直接叩けます。** サーバーを経由する必要がありません。

### ブラウザで試せます

このURLをブラウザのアドレスバーに貼ってEnterするだけで動きます。

```
https://api.transit.ls8h.com/api/health
```

→ `{"status":"ok"}` が出ればAPIは生きています。

---

## 2. ⚠️ 最初に知るべき罠：時刻が「秒数」で返ってくる

**これを知らないと必ず詰まります。**

APIは時刻を `"23:58"` ではなく **`86280` という数字**で返します。これは「**その日の午前0時からの秒数**」です。

```
86280 秒 ÷ 3600 = 23.966... 時
86280 ÷ 3600 = 23 時
86280 % 3600 ÷ 60 = 58 分
                        → 23:58
```

### さらに厄介なのは 86400 を超えること

```
89100 → 24:45   ← 深夜0時45分。24時間（86400秒）を超えている
104400 → 29:00  ← 翌朝5時
```

**公式ドキュメントにこう書いてあります。**

> 時刻: 結果タイムゾーンのサービス日 0:00 からの秒数。**86400 超過（翌日扱い）や負値があり得ます。** 表示整形はクライアント側で行ってください。

**「24:45」を「00:45」に直してはいけません。** 直すと「00:45は23:58より早い」と誤判定されて、終電の計算が壊れます。

### 変換関数（これをコピーして使う）

```ts
/** 86280 → "23:58" ／ 89100 → "24:45"（24時台はそのまま） */
export function secsToHHMM(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 表示用に「翌0:45」にしたいとき（比較には使わない） */
export function secsToLabel(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h >= 24 ? `翌${h - 24}:${String(m).padStart(2, "0")}` : `${h}:${String(m).padStart(2, "0")}`;
}
```

---

## 3. 駅の指定方法

駅は **`feedId:駅名` の形の長いID** で指定します。駅名だけでは指定できません。

```
✗ 出町柳
○ eizan-rail:叡山電鉄-叡山本線-出町柳
```

`feedId` は「どの事業者のデータか」を表します。**同じ「出町柳」でも京阪と叡電で別のIDです。**

```
scrape-keihan:京阪電気鉄道-鴨東線-出町柳    ← 京阪の出町柳
eizan-rail:叡山電鉄-叡山本線-出町柳         ← 叡電の出町柳
```

### 座標でも指定できる

```
geo:35.030920,135.773545
```

「駅ではなく、この場所から」を指定したいときに使います。

---

## 4. 使うエンドポイントは実質4つ

全部で12個ありますが、**モウチョットで使うのはこの4つだけ**です。

| # | エンドポイント | 何ができるか | 使う場面 |
|---|---|---|---|
| **①** | `/api/v1/locations/suggest` | **駅名から駅IDを探す** | 最初に必ず使う |
| **②** | `/api/v1/stations/{id}/departures` | **その駅の発車時刻を一覧で取る** | ★本命 |
| **③** | `/api/v1/plan` | **経路と終電を検索する** | メイン機能 |
| **④** | `/api/v1/guidance/plan` | ③の詳細版。**失敗理由も返る** | デバッグ用に強い |

残りの8つ（`/feeds`, `/operators`, `/places/suggest`, `/places/reverse`, `/stations/{id}`, `/route-map`, `/map/3d-scene`, `/api/health`）は今回ほぼ使いません。

---

## 5. 4つのエンドポイントの使い方

### ① 駅IDを探す — `locations/suggest`

```bash
curl -s --get "https://api.transit.ls8h.com/api/v1/locations/suggest" \
  --data-urlencode "q=出町柳" --data-urlencode "limit=5"
```

**パラメータ**

| 名前 | 必須 | 説明 |
|---|---|---|
| `q` | ✅ | 検索する駅名 |
| `limit` | | 件数。既定10、最大30 |

**返ってくるもの**

```json
{
  "stations": [
    { "id": "scrape-keihan:京阪電気鉄道-鴨東線-出町柳",
      "name": "出町柳", "feedId": "scrape-keihan", "feedName": "京阪電気鉄道",
      "lat": 35.029914, "lon": 135.772542, "kind": "station" },
    { "id": "eizan-rail:叡山電鉄-叡山本線-出町柳",
      "name": "出町柳", "feedId": "eizan-rail", "feedName": "叡山電鉄", ... }
  ]
}
```

> ⚠️ **同じ駅名で複数返ります。** どの事業者のホームに立つかで別IDなので、`feedName` を見て選んでください。

---

### ② 発車時刻を一覧で取る — `stations/{id}/departures` ★本命

**モウチョットで一番大事なエンドポイントです。**

```bash
curl -s --get "https://api.transit.ls8h.com/api/v1/stations/scrape-hankyu:阪急電鉄-京都線-京都河原町/departures" \
  --data-urlencode "date=20260828" --data-urlencode "time=22:00" --data-urlencode "limit=40"
```

**パラメータ**

| 名前 | 必須 | 説明 |
|---|---|---|
| `id` | ✅ | 駅ID（URLの中に入れる） |
| `date` | | `YYYYMMDD`。省略すると今日 |
| `time` | | `HH:MM`（`HH:MM:SS` も可）。この時刻以降の便が返る |
| `limit` | | 件数。既定20、**最大100** |

**返ってくるもの**

```json
{
  "stationId": "scrape-hankyu:阪急電鉄-京都線-京都河原町",
  "date": "20260828",
  "timezone": "Asia/Tokyo",
  "departures": [
    { "routeName": "京都線", "mode": "rail",
      "headsign": "大阪梅田",          ← ★行き先。これが命
      "tripId": "...", "stopId": "...", "departureSecs": 83700, "headwayBased": false }
  ]
}
```

**`headsign` が「行き先」です。** モウチョットの「終電の嘘」はこの1項目から作られます。

実際に阪急 京都河原町で取った結果:

```
22:48  大阪梅田
23:00  大阪梅田
23:15  大阪梅田    ← 大阪梅田に行く最終
23:30  正雀
23:50  正雀        ← 駅としての最終列車
```

**「京都河原町の最終は23:50」だが「大阪梅田行きの最終は23:15」。35分の差。** これが売りです。

> ⚠️ **`headsign` が無いfeedがあります。** どこにあるかは6章の表を見てください。
> ⚠️ **`trainType`（種別）は「路線が複数種別を持つとき」だけ付く任意項目です。** 阪急 京都河原町の実データには付いていません（JRには付く）。
> ⚠️ **403が返るfeedがあります。** ODPT由来のデータは規約上、発車時刻表として公開できないためです。
> 🚨 **翌朝の始発が末尾に混ざります。** 上の例で `limit` を増やすと `23:50 正雀` の次に **`29:00 大阪梅田`（＝翌朝5:00の始発）** が返ります。「最終」を取るときは `departureSecs` に上限（例: `27 * 3600`）を入れて弾いてください。8章の `isSane` は `plan` 用なので、`departures` 側にも同じガードが必要です。

---

### ③ 経路と終電を検索する — `plan`

```bash
curl -s --get "https://api.transit.ls8h.com/api/v1/plan" \
  --data-urlencode "from=jrwest-tokaido:jrwest-tokaido.station.JR西日本-東海道線-京都" \
  --data-urlencode "to=jrwest-tokaido:jrwest-tokaido.station.JR西日本-東海道線-大阪" \
  --data-urlencode "date=20260828" \
  --data-urlencode "type=arrival" --data-urlencode "time=26:00"   # ← 終電は「翌2:00までに着く便」で聞く（理由は下の🚨🚨）
```

**パラメータ（全部）**

| 名前 | 必須 | 既定 | 説明 |
|---|---|---|---|
| `from` | ✅ | | 出発地。駅IDまたは `geo:緯度,経度` |
| `to` | ✅ | | 目的地。同上 |
| `date` | | 今日 | `YYYYMMDD` |
| `time` | | 現在時刻 | `HH:MM` または `HH:MM:SS` |
| **`type`** | | `departure` | **`departure`（出発）/ `arrival`（到着）/ `first`（始発）/ `last`（終電）** |
| `maxTransfers` | | **3** | 乗換回数の上限。0〜8 |
| `numItineraries` | | **3** | 返す候補数。1〜6 |
| `avoidWalk` | | `false` | `true` で徒歩を含む経路を除外 |
| `allowModes` | | | 使う交通手段。`rail,bus` のようにカンマ区切り |
| `avoidModes` | | | 避ける交通手段。`bus,air,ferry` など |
| `via` | | | 経由地（最大3つ）。**⚠️ `type=departure` と `arrival` のときだけ使える** |
| `fromLabel` / `toLabel` | | | 表示用の名前。計算には影響しない |
| `viaLabel` | | | `via` それぞれの表示名（位置対応、最大3つ）。計算には影響しない |

> 🚨 **`via` は終電検索（`type=last`）では使えません。** これは重要な制約です。
> 「出町柳 →（宝ヶ池経由）→ 鞍馬」のような指定を終電検索でやることはできません。

> 🚨🚨 **終電を調べるのに `type=last` を使ってはいけません。`type=arrival` + `time=26:00` を使ってください。**
> `type=last` は「出発地を最後に出て、**いつか**目的地に着く便」を返します。「今夜のうちに着く」という条件が無いので、乗換があると翌朝の始発に接続した経路を平然と返し、乗換なしでも真の終電を外すことがあります（JR 京都→三ノ宮で 23:29 新快速を見逃して 23:58 普通→翌朝乗換を返した）。
> `type=arrival&time=26:00`（＝翌2:00までに着く便、到着時刻基準）なら「今夜中に着く最終」になります。詳しくは **6-3**。

**返ってくるもの**

```json
{
  "date": "20260828", "type": "arrival", "timezone": "Asia/Tokyo",
  "from": { "id": "...", "name": "京都" },
  "to":   { "id": "...", "name": "大阪" },
  "journeys": [
    {
      "departureSecs": 86280,      ← 23:58
      "arrivalSecs": 89100,        ← 24:45
      "durationSecs": 2820,        ← 47分
      "transferCount": 0,          ← 乗換回数
      "legs": [
        { "kind": "transit",
          "routeName": "東海道本線（JR京都線・神戸線・琵琶湖線）",
          "trainType": "普通",
          "headsign": "普通 大阪",   ← 行き先
          "mode": "rail",
          "from": { "id": "...", "name": "京都" },
          "to":   { "id": "...", "name": "大阪" },
          "departureSecs": 86280, "arrivalSecs": 89100 }
      ]
    }
  ]
}
```

- **`journeys` が空配列 `[]` のとき** = 経路が見つからなかった（エラーではない。200が返る）
- **`legs`** = 乗り換えごとに区切られた区間。`legs` が2つなら乗換1回
- **`kind`** は `transit`（乗車）または `walk`（徒歩）。`walk` の leg には `routeName` / `headsign` が無い

---

### ④ 詳細版 — `guidance/plan`

③と同じパラメータに加えて `strategy` などが使えます。**返り値の形が違います**（`journeys` ではなく `options`）。

**追加パラメータ**

| 名前 | 既定 | 説明 |
|---|---|---|
| `strategy` | `balanced` | `balanced` / `fastest` / `fewestTransfers` / `lowestFare` / `shortestWalk` |
| `live` | `false` | リアルタイム情報 |
| `tracking` | `none` | `origin` / `destination` / `both` |

**③より優れている点：失敗した理由が返ってくる**

```json
{
  "coverage": {
    "feeds": [ { "feedId": "eizan-rail", "name": "叡山電鉄公式時刻表PDF", "stale": false } ],
    "notices": [
      { "severity": "warning",
        "code": "noRouteInLoadedData",
        "message": "現在読み込まれている交通データでは、この条件に合う経路が見つかりませんでした。" }
    ]
  },
  "decision": { "strategy": "balanced", "recommendedOptionId": "route-1-85020-87540" },
  "options": [
    { "id": "route-1-85020-87540", "rank": 1, "recommended": true, "confidence": "high",
      "metrics": { "durationSecs": 2520, "walkSecs": 0, "waitSecs": 0, "transferCount": 0 },
      "load": { "walking": "low", "waiting": "low", "transfer": "low", "overall": "low" },
      "journey": { ...③と同じ形... },
      "map": { "bounds": {...}, "points": [...], "segments": [...] } }
  ]
}
```

**`coverage.notices` が日本語で理由を教えてくれます。** データ収集スクリプトを書くときは、`/plan` より **`/guidance/plan` を使うべき**です。「なぜ埋まらなかったか」がログに残るからです。

`options[].journey` の中身は ③ の `journeys[0]` と同じ形なので、**処理は共通化できます。**

---

## 6. ★ feedごとの当たり外れ（ここが実装の成否を決める）

**実際に叩いて確認した結果です。均一ではなく、事業者ごとに全然違います。**

### 6-1. `departures` で行き先（`headsign`）が取れるか

| 事業者 | headsign | 実際に取れた値 |
|---|---|---|
| **阪急京都線** | ✅ **あり** | 京都河原町: 23:15 大阪梅田 / 23:50 正雀 |
| **京阪** | ✅ **あり** | 三条: 23:18 淀屋橋 / 24:10 淀 |
| **嵐電** | ✅ **あり** | 四条大宮: 23:40 嵐山 |
| **JR東海道本線** | ✅ **あり** | 京都: 23:37 快速米原 / 23:58 普通大阪 |
| **叡山電鉄** | ❌ **なし** | 時刻は正確（22:30, 23:02, 23:50…）だが行き先が空 |
| **京都市営地下鉄** | ❌ **なし** | 時刻は正確（23:25, 23:47…）だが行き先が空 |
| **近鉄京都線** | ❌ **なし** | 時刻は正確（23:41, 24:00…）だが行き先が空 |

**時刻はどのfeedも正確です。** 私が公式時刻表で確認した値と一致しました。**違うのは「行き先が付いているか」だけ。**

行き先が無い理由は元データの形です。京都市営地下鉄の公式HTMLは行き先を「新」「奈」「浜」という記号で表しているので、スクレイパーが落としたと思われます。叡電はPDF由来です。

### 6-2. `plan`（経路検索）が正しいか

最初は `type=last` で調べ、その後 **`type=arrival&time=26:00` で聞き直した**結果を併記します。

| クエリ | 期待 | `type=last` の答え | `type=arrival&time=26:00` の答え | 判定 |
|---|---|---|---|---|
| JR 京都→大阪 | 23:58 | **23:58** | — | ✅ |
| JR 京都→近江八幡 | 23:37 | **23:37** | — | ✅ |
| 阪急 京都河原町→桂 | 23:50 | **23:50** | — | ✅ |
| 阪急 京都河原町→高槻市 | — | 23:50 直通 | — | ✅ |
| 叡電 出町柳→修学院 | 23:50 | **23:50** | — | ✅ |
| 京阪 三条→中書島 | — | 24:01 | — | ✅ 妥当 |
| JR嵯峨野 京都→亀岡 | — | 23:46 | — | ✅ 妥当 |
| JR湖西 京都→堅田 | — | 23:46 | — | ✅ 妥当 |
| 嵐電 四条大宮→嵐山 | — | 23:40 | — | ✅ 妥当 |
| **JR 京都→三ノ宮** | 23:29 新快速 | 23:58 普通大阪 → 大阪で**翌朝**乗換 → 29:35 | **23:29 新快速 直通 → 24:22** | ✅ **arrival なら正解**（last は乗換なしでも外す） |
| **京阪 三条→樟葉** | — | 24:01 淀行き → 淀で**翌朝**乗換 → 29:13 | **23:28 直通 → 24:11** | ✅ **arrival なら正解** |
| **京阪 三条→枚方市** | — | 24:01 → **29:20** 翌朝着 | **23:28 直通 → 24:19** | ✅ **arrival なら正解** |
| **京阪 三条→宇治**（中書島乗換） | — | 24:01 → 中書島で翌朝乗換 → 29:14 | **23:41 → 中書島 23:58 → 24:12**（乗換1回） | ✅ **乗換1回、arrival なら正解** |
| **京阪 三条→交野市**（枚方市乗換） | — | 24:01 → 翌朝 → 29:33（乗換2回） | **23:18 → 枚方市 → 24:10**（乗換1回） | ✅ **乗換1回、arrival なら正解** |
| **阪急 京都河原町→大阪梅田** | 23:15 | **0件** | **0件** | ❌ 阪急feedの問題（`departures` には出るのに） |
| **阪急 京都河原町→嵐山**（桂乗換） | — | **0件** | **0件**（桂→嵐山 単体なら出る） | ❌ 阪急feedの問題 |
| **阪急 京都河原町→神戸三宮**（十三乗換） | — | 23:50 → 桂で翌朝 → 30:27 | **0件** | ❌ 阪急feedの問題 |
| **叡電 出町柳→鞍馬** | 22:30 | **0件** | **0件** | ❌ 叡電feedで鞍馬線が繋がっていない |
| **叡電 出町柳→八瀬** | 23:02 | 23:50→**29:54** | 21:16→23:16（14分の区間が**2時間**） | ❌ 叡電feedの所要時間が壊れている |
| **地下鉄 四条→京都** | 直通5分 | 22:43→24:01（**66分・2区間**） | 22:32 直通でも **67分** | ❌ 地下鉄feedの所要時間が壊れている |
| **地下鉄 烏丸御池→六地蔵** | 23:55 | **0件** | **0件** | ❌ 地下鉄feedの問題 |
| **京阪 三条→出町柳** | — | **HTTP 422** `searchWindowTooDense` | **HTTP 422** 同じ | ❌ 隣駅すぎる？ 回避不明 |
| **近鉄 京都→近鉄奈良** | — | **17:51**発（4区間） | **HTTP 503** `error code: 1102`（3回とも） | ❌ 近鉄feedの問題 |

### 6-3. わかったパターン（重要：最初の診断は間違っていた）

当初「2区間以上（乗換あり）は全部おかしい」と判断しましたが、**壊れていたのは乗換ではなく `type=last` の意味**でした。

#### 原因① `type=last` は「今夜中に着く」を保証しない

`type=last` は「**出発地を最後に出て、いつか目的地に着く便**」を返します。到着が翌朝でも構わない仕様なので、

- 乗換があると → 出発地の最終に乗り、乗換駅で**翌朝5時の始発**に接続した経路を返す（三条→宇治 24:01→29:14）
- 乗換がなくても → 「最後に出発地を出る便」を優先するので、途中駅止まりの遅い普通を選んで真の終電を外す（JR 京都→三ノ宮: 23:29 新快速を見逃し、23:58 普通大阪→翌朝乗換を返した）

**回避策: `type=arrival&time=26:00`（到着時刻基準で「翌2:00までに着く便」）を使う。** これで京阪・JR は乗換1回を含めて正しい答えになりました（6-2 の表の右列）。

#### 原因② feed 固有のデータ欠損（こちらは `type` を変えても直らない）

| 事業者 | 症状 | 影響 |
|---|---|---|
| **阪急** | 京都河原町→大阪梅田 / 嵐山 / 神戸三宮 が **0件**（高槻市までは出る。桂→嵐山 単体なら出る） | 京都線の途中でグラフが切れている疑い。`plan` は京都線内の近距離だけ信用 |
| **叡電** | 鞍馬線に乗り継げない（→鞍馬 0件）。叡山本線も **14分の区間が2時間**と出る | `plan` は使わない。`departures` の時刻＋手入力 |
| **地下鉄** | 烏丸線 四条→京都（5分）が **67分**。烏丸御池→六地蔵 0件 | `plan` は使わない。`data/subway-last-trains.json` を使う |
| **近鉄** | `type=last` で 17:51 発の異常経路、`type=arrival` で **503** | `plan` は使わない。手入力 |
| **京阪** | 三条→出町柳（隣駅）で 422 `searchWindowTooDense` | 隣駅は `departures` で足りるので実害なし |

#### 結論

| | 傾向 |
|---|---|
| **京阪・JR（東海道/嵯峨野/湖西）** | ✅ `type=arrival` なら**乗換1回まで正確**。乗換2回はデータ不足 |
| **阪急** | ⚠️ 京都線内の近距離のみ。梅田・嵐山・神戸方面は 0件 |
| **叡電・地下鉄・近鉄** | ❌ `plan` は所要時間・接続が壊れている。`departures` の時刻か手入力 |
| **事業者をまたぐ乗換** | ❌ 0件 or 翌朝着（京阪三条→阪神神戸三宮は乗換3回・翌朝7:23着） |

**つまり「時刻表データは信頼できる。経路検索は `type=arrival` で聞けば京阪・JR は乗換1回まで信頼できる。阪急・叡電・地下鉄・近鉄は feed 側が壊れている」**という状態です。

---

## 7. ⚠️ 実装前に必ず理解すること：「行き先」と「その駅に着く最終」は違う

**私はここを間違えて、APIが壊れていると誤判定しました。** 同じ罠を踏まないでください。

阪急 京都河原町の時刻表:

```
23:15  大阪梅田行き
23:30  正雀行き
23:50  正雀行き      ← 駅としての最終列車
```

**「桂に着く最終は何時か？」**

```
✗ 間違い: 「桂行き」が無いから、桂には行けない
✗ 間違い: 桂止まりの最終は23:40（別ダイヤ）だから23:40

○ 正解: 正雀は桂より先（大阪側）なので、23:50 正雀行きは桂を通る
        → 桂に着く最終は 23:50
```

**必要なのは「行き先が◯◯の便」ではなく「◯◯を通る便」です。** そのためには**路線の駅の並び順**が必要になります。

```
京都河原町 → 烏丸 → 大宮 → 西院 → 西京極 → 桂 → … → 正雀 → 大阪梅田
                                              ↑                ↑
                                        桂はここ        正雀はここ（より先）
```

`headsign` の駅が、目的の駅より**先にあるか**で判定します。

---

## 8. エラーと対処

| HTTPコード | 意味 | 対処 |
|---|---|---|
| **200 + `journeys: []`** | 経路が見つからなかった（エラーではない） | `guidance/plan` で `coverage.notices` を見て理由を確認 |
| **400** | パラメータがおかしい | 綴りを確認。`type` の値は4つだけ |
| **403** | このfeedは発車時刻表を公開できない | ODPT由来のデータ。`plan` を使う |
| **404** | 駅IDが存在しない | `locations/suggest` でIDを取り直す |
| **422 `searchWindowTooDense`** | 便が多すぎて探索できない | **回避方法が見つかっていません。** `time` 指定も `type=arrival` も効きませんでした（京阪 三条→出町柳） |
| **503 Cloudflare `error code: 1102`** | サーバー側の計算資源超過（Worker の制限） | 近鉄 京都→奈良 `type=arrival` で3回連続。**リトライしても直らない**ので、そのペアは諦めて手入力 |
| **422 `samePlace`** | 出発地と目的地が同じ（`from and to are the same place`） | 入力を確認 |
| **422 `viaUnsupported`** | `type=first` / `last` で `via` を指定した | `via` を外す（5-③参照） |
| **403 Cloudflare `error code: 1010`** | **User-Agentでブロックされた** | Pythonの `urllib` は弾かれます。**curl か fetch を使う**（下記） |

### ⚠️ Python の urllib は弾かれます

```python
# ✗ これは 403 error code: 1010 になる
import urllib.request
urllib.request.urlopen(url)

# ○ curl を呼ぶ / requests を使う / User-Agent を付ける
import subprocess
subprocess.run(["curl", "-s", url], capture_output=True, text=True)
```

Node の `fetch` とブラウザからは普通に通ります。

### 明らかにおかしい答えを自動で弾く（必須）

```ts
function isSane(journey): boolean {
  if (!journey) return false;
  // 翌朝着 → 29:54, 29:20 のような「一晩待つ経路」を弾く
  if (journey.arrivalSecs > 27 * 3600) return false;
  // 終電が20時より前 → 近鉄の 17:51 のような異常を弾く
  if (journey.departureSecs < 20 * 3600) return false;
  // 区間の間に60分超の待ちがある → 5時間待ちを弾く
  for (let i = 1; i < journey.legs.length; i++) {
    const wait = journey.legs[i].departureSecs - journey.legs[i - 1].arrivalSecs;
    if (wait > 60 * 60) return false;
  }
  return true;
}
```

**この3つで、6-2で見つけた異常のほとんどが自動で弾けます。** ただし **`type=last` を使っている限り、弾いた後に何も残らない**ことが多いので、まず `type=arrival&time=26:00` で聞き、その上で `isSane` を通してください（11章の `planLastArrival` ＝ `lib/transit.ts` はそうなっています）。

> ⚠️ **`isSane` で弾けない異常もあります。** 叡電・地下鉄の「14分の区間が2時間」「5分の区間が67分」は、出発・到着とも夜のうちに収まっているので通ってしまいます。この2社（＋近鉄）は `plan` を使わないことで対処します（6-3）。

---

## 9. 利用規約で守るべきこと

規約を読みました。**守るべきは3つです。**

### ① アプリに「非公式である」旨を表示する（規約が明示的に要求）

> 利用者は、本 API の応答を利用するアプリケーションやサービスにおいて、**本サービスが非公式であり、正確性・完全性・最新性を保証しないこと、重要な判断では公式情報を確認すべきことを、必要に応じて表示してください。**

**画面のどこかに1行入れてください。**

```
時刻データは非公式APIによる参考値です。実際の乗車前に各交通事業者の公式情報をご確認ください。
```

### ② 過度なリクエストを避ける

> 過度なリクエスト、サービス運用を妨げる利用（中略）は禁止します。

**リクエストの間に1秒空けてください。** 実行時に毎回叩かず、**ビルド時に取ってキャッシュする**のが正解です。

### ③ キャッシュ・リトライ・フォールバックを自分で設計する（規約が推奨）

> 継続提供、特定の応答時間、特定のデータ範囲、過去互換性、商用サポート、障害時の復旧時間は保証しません。**公開 API を利用する場合は、利用者側でキャッシュ、リトライ、フォールバック、公式情報への誘導を設計してください。**

**予告なく仕様変更・停止があり得ます。** デモ当日に落ちても動くように、データはビルド時に焼いておくべきです。

### 出典表示について

データのライセンスと帰属表示は `/api/v1/feeds` と `/api/v1/operators` から取れます。**画面に出典を出すなら、そこから取った `attribution` を使ってください。**

---

## 10. モウチョットではどう使うか

### 使う / 使わないの切り分け

| 用途 | 使うか | 理由 |
|---|---|---|
| **ハブ発・行き先別の最終列車**（阪急・京阪・嵐電・JR） | ✅ **`departures` を使う** | `headsign` があるので自動で取れる |
| ハブ発・行き先別の最終列車（**地下鉄**） | ❌ 公式データを使う | `headsign` が無い。**すでに `data/subway-last-trains.json` に取得済み** |
| ハブ発・行き先別の最終列車（**叡電・近鉄**） | ❌ **手で入れる** | `headsign` が無い。叡電は「終電の嘘」の主役なので譲れない |
| **候補地 → ハブ の所要時間と最終**（京阪・JR 沿線） | ✅ **`plan` を `type=arrival&time=26:00` で** | 乗換1回まで正確（6-3）。`isSane` を通す |
| 候補地 → ハブ の所要時間と最終（**阪急・叡電・地下鉄・近鉄** 沿線） | ❌ `plan` に任せない | feed が壊れている。`departures` の時刻か、Yahoo 手引き・手入力 |
| 帰り先を近畿圏に広げる | ⚠️ 京阪・JR は乗換1回ぶん広げられる | 宇治線・交野線・JR神戸線方面は `type=arrival` で取れる。阪急梅田・神戸方面は 0件なので手入力 |
| 経路の乗り換え計算（2回以上・他社またぎ） | ❌ 任せない | データ不足で 0件 or 翌朝着になる |

### 乗換なし層は API を叩かず `lib/lastTrain.ts` で引く

地下鉄については実装済み。`data/subway-last-trains.json`（駅 × 行き先 → 最終）と `data/subway-lines.json`（路線の駅順 + 分岐の例外）から、`lastTrainBetween(from, to, dayType)` が「帰る駅を通る最終」を導出します。駅間ペアのデータは持ちません。
阪急・京阪・JR も `departures` の `headsign` から同じ形の JSON を作れば、この関数がそのまま使えます（未着手）。
`needsTransfer` / `unknownStation` が返ったら Transit の `type=arrival` に回す。`noTrainNeeded`（同じ駅）は電車が要らないので終電の制約から外し、Transit は呼ばない。それでも出ないものは現段階では「対応予定」として扱い、**今出せる範囲で勝負する**方針です。

### 呼び出しは全部ビルド時に済ませる

```
[ビルド時] スクリプトが departures / plan を叩く（1秒間隔）
             ↓
           data/last-departures.generated.json に焼く
             ↓
[実行時]   アプリはJSONを読むだけ。APIは叩かない
```

**理由**: デモ中にAPIが落ちても動く／審査員が触っても瞬時／規約の「過度なリクエスト禁止」も守れる。

例外として、**生成ファイルに無い駅を入力されたときだけ**実行時に叩くフォールバックを1本残します（審査員の最寄り駅をその場で入れる演出用）。

---

## 11. コピペで動くコード

### 駅IDを探す

```ts
type Station = { id: string; name: string; feedId: string; feedName: string; lat: number; lon: number };

export async function findStations(q: string): Promise<Station[]> {
  const url = new URL("https://api.transit.ls8h.com/api/v1/locations/suggest");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "10");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`suggest失敗: ${res.status}`);
  const data = await res.json();
  return data.stations ?? [];
}
```

### 発車時刻を取る（行き先つき）

```ts
type Departure = {
  routeName: string;
  trainType?: string;
  headsign?: string;        // ← 無いfeedがある
  departureSecs: number;
  tripId: string;
};

export async function getDepartures(
  stationId: string, date: string, time = "21:00", limit = 100,
): Promise<Departure[]> {
  const url = new URL(
    `https://api.transit.ls8h.com/api/v1/stations/${encodeURIComponent(stationId)}/departures`,
  );
  url.searchParams.set("date", date);
  url.searchParams.set("time", time);
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url);
  if (res.status === 403) return [];  // このfeedは発車時刻表を出せない
  if (!res.ok) throw new Error(`departures失敗: ${res.status}`);
  const data = await res.json();
  const deps: Departure[] = data.departures ?? [];
  // 翌朝の始発（29:00 など）が末尾に混ざるので、27時以降は「今日の便」として扱わない
  return deps.filter((d) => d.departureSecs < 27 * 3600);
}
```

### 終電を検索する（`type=arrival` ＋ サニティチェックつき）— 実装は `lib/transit.ts`

**`type=last` は使いません**（6-3）。「翌2:00までに着く便」を到着基準で最大6本もらい、`isSane` を通った中で**いちばん遅く出発するもの**を終電とします。

実装は `lib/transit.ts` の `planLastArrival` です。ポイントは 3 つ:

- **`plan` を使う**（`guidance/plan` ではない）。レスポンスが小さい。`coverage.notices` は使わない
- **出発地はハブの座標 `geo:緯度,経度`**（`data/hubs.ts` の `hubGeo(hub)`）。ハブは複数事業者の駅の集合（出町柳＝京阪+叡電）なので、駅の選択は Transit に任せる
- **HTTP エラー・JSON 解釈失敗・ネットワーク断は throw せず `null`**。呼び出し側（`lib/resolveLastTrain.ts`）が「対応予定」に畳む

```ts
// lib/transit.ts（抜粋）
export async function planLastArrival(
  from: string,            // "geo:35.00879,135.772337"（ハブ）または駅 ID
  to: string,              // 駅 ID（suggestStationId で取る）
  date: string,            // "YYYYMMDD"
  fetcher: Fetcher = fetch, // テストでは保存済みレスポンスを返す偽 fetch に差し替える
  opts: { originNames?: readonly string[] } = {},
): Promise<TransitJourney | null> {
  const url = new URL(`${TRANSIT_BASE}/plan`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("date", date);
  url.searchParams.set("type", "arrival");   // ← last ではなく arrival
  url.searchParams.set("time", "26:00");     // ← 翌2:00までに着く便
  url.searchParams.set("numItineraries", "6");

  const data = await getJson(url.toString(), fetcher); // !res.ok / 例外 → null
  const journeys = Array.isArray(data?.journeys) ? data.journeys : [];

  // journeys の並びは到着時刻順なので、自分で「isSane を通った中で最も遅く乗車する便」を選ぶ
  let best: TransitJourney | null = null;
  for (const j of journeys) {
    if (!isSane(j)) continue;
    if (!startsAt(j, opts.originNames ?? [])) continue; // geo: が別の駅にスナップされた経路を捨てる
    if (best === null || boardingSecs(j) > boardingSecs(best)) best = j; // 先頭の徒歩は数えない
  }
  return best;
}
```

使う側は `lib/resolveLastTrain.ts` の `resolveLastTrain(hub, home, dayType)` だけ呼べばよい。
ローカル JSON（乗換なし）→ Transit → `unavailable` の振り分け、キャッシュ、300ms の間隔制御はそこに入っています。

```ts
import { resolveLastTrain } from "@/lib/resolveLastTrain";
import { HUB_BY_ID } from "@/data/hubs";

const r = await resolveLastTrain(HUB_BY_ID.sanjo, "宇治", "weekday");
// { kind: "found", time: "23:41", via: "transit", transferCount: 1, headsign: "淀" }
```

> 実測（2026-08-29、`geo:` 出発）: 三条→宇治 → 23:41発（中書島乗換）／ 京都→三ノ宮 → 23:29 新快速 西明石 ／ 四条→五条 → ローカル JSON で 23:57（Transit は呼ばない）。`type=last` だと全部翌朝着になっていたケースです。

> ⚠️ **`locations/suggest` は同名駅を複数返し、先頭が期待した事業者とは限りません。** 例: `q=大阪梅田` は **阪神**・大阪梅田が先頭、阪急京都線・大阪梅田は 2 番目。`q=山科` は JR / 地下鉄 / 湖西線 の 3 件。宛先が阪神だと Transit は「阪急 23:30 正雀行き → 大山崎で徒歩 → JR 山崎 → 大阪 → 徒歩で阪神梅田」（乗換1・24:47着）を返し、阪急宛てだと 0 件（6-3 の阪急 feed 欠損）になります。`suggestStationId` は「`kind==="station"` ＋ 名前完全一致 ＋ `preferFeeds`（地下鉄収録駅なら `scrape-kyoto-subway` を優先）」で選びます。

> 🚨 **`geo:` 出発は近くの別の駅にスナップされることがあります。** `geo:四条` → 山科 を聞くと **烏丸御池発**の東西線（23:55・乗換0）が返り、四条→烏丸御池の 1 駅が消えて「四条発 23:55」という嘘の終電になります（徒歩 leg も付きません）。`planLastArrival` の `originNames`（`data/hubs.ts` の `hubNames(hub)` = ハブ名 + 別名。三条 ↔ 三条京阪、四条 ↔ 烏丸、四条大宮 ↔ 大宮）で、最初の乗車区間の `from.name` が一致しない経路は捨てます。
> `geo:` は **422 `searchWindowTooDense`** にもなります（`geo:四条` → 阪急 桂。近くに地下鉄四条・阪急烏丸・烏丸御池が密集）。阪急烏丸の駅 ID を from にすれば 23:52 正雀行きが返るので、`resolveLastTrain` は geo: が null のとき `Hub.stationIds` を順に試します。
> また地下鉄同士の乗換（四条 → 山科 など、両駅とも `subway-last-trains.json` に載っていて同一路線に無い）は、地下鉄 feed の経路検索が壊れている（6-3）ので Transit に聞かず「対応予定」にしています（`Hub.subwayOnly`）。

### 連続で叩くときは間隔を空ける

`resolveLastTrain` は Transit を呼ぶ前に**前回から 300ms 以上**空けます（モジュール内で最終呼び出し時刻を持ち、並行に呼ばれても直列化）。7 ハブ × N 人を直列で回す前提です。
結果はメモリと `localStorage` にキャッシュされ（キー `lt:${hub.id}:${home}:${dayType}:${date}`）、`unavailable` もキャッシュするので同じ失敗を繰り返しません。

`planLastArrival` を直接ループで叩くときは自分で空けてください:

```ts
export async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

for (const pair of pairs) {
  const j = await planLastArrival(pair.from, pair.to, "20260829");
  console.log(pair.from, "→", pair.to, j ? secsToHHMM(j.departureSecs) : "なし");
  await sleep(1000);   // 規約：過度なリクエストを避ける
}
```

---

## 12. まとめ（3行）

1. **時刻表データは正確。** 阪急・京阪・嵐電・JR は `headsign`（行き先）まで取れる
2. **終電検索は `type=last` ではなく `type=arrival&time=26:00`。** これで京阪・JR は乗換1回まで正確。阪急（梅田・嵐山・神戸方面）・叡電・地下鉄・近鉄は feed が壊れているので `plan` に任せない
3. **ビルド時に焼いてキャッシュする。** 規約もそれを推奨していて、デモ中に落ちるリスクも消える

---

## 付録. 京都の主要駅ID一覧（調査済み・コピペ用）

```ts
export const STATION_IDS = {
  // 京都市営地下鉄（headsign なし → 公式データを使う）
  地下鉄_京都:       "scrape-kyoto-subway:京都市-烏丸線-京都",
  地下鉄_四条:       "scrape-kyoto-subway:京都市-烏丸線-四条",
  地下鉄_烏丸御池:   "scrape-kyoto-subway:京都市-烏丸線-烏丸御池",
  地下鉄_東西烏丸御池:"scrape-kyoto-subway:京都市-東西線-烏丸御池",
  地下鉄_三条京阪:   "scrape-kyoto-subway:京都市-東西線-三条京阪",
  地下鉄_山科:       "scrape-kyoto-subway:京都市-東西線-山科",
  地下鉄_六地蔵:     "scrape-kyoto-subway:京都市-東西線-六地蔵",

  // 叡山電鉄（headsign なし → 手入力）
  叡電_出町柳:       "eizan-rail:叡山電鉄-叡山本線-出町柳",
  叡電_修学院:       "eizan-rail:叡山電鉄-叡山本線-修学院",
  叡電_八瀬比叡山口: "eizan-rail:叡山電鉄-叡山本線-八瀬比叡山口",
  叡電_市原:         "eizan-rail:叡山電鉄-鞍馬線-市原",
  叡電_鞍馬:         "eizan-rail:叡山電鉄-鞍馬線-鞍馬",

  // 京阪（headsign あり ✅）
  京阪_三条:         "scrape-keihan:京阪電気鉄道-京阪本線-三条",
  京阪_出町柳:       "scrape-keihan:京阪電気鉄道-鴨東線-出町柳",
  京阪_枚方市:       "scrape-keihan:京阪電気鉄道-京阪本線-枚方市",

  // 阪急（headsign あり ✅）
  阪急_京都河原町:   "scrape-hankyu:阪急電鉄-京都線-京都河原町",
  阪急_桂:           "scrape-hankyu:阪急電鉄-京都線-桂",
  阪急_大阪梅田:     "scrape-hankyu:阪急電鉄-京都線-大阪梅田",

  // 嵐電（headsign あり ✅）
  嵐電_四条大宮:     "scrape-randen:京福電気鉄道-嵐山本線-四条大宮",
  嵐電_嵐山:         "scrape-randen:京福電気鉄道-嵐山本線-嵐山",

  // JR（headsign あり ✅）
  JR_京都:           "jrwest-tokaido:jrwest-tokaido.station.JR西日本-東海道線-京都",
  JR_大阪:           "jrwest-tokaido:jrwest-tokaido.station.JR西日本-東海道線-大阪",
  JR_野洲:           "jrwest-tokaido:jrwest-tokaido.station.JR西日本-東海道線-野洲",
  JR_近江八幡:       "jrwest-tokaido:jrwest-tokaido.station.JR西日本-東海道線-近江八幡",
  JR嵯峨野_京都:     "jrwest-sanin-east:jrwest-sanin-east.station.JR西日本-山陰線-京都",
  JR嵯峨野_亀岡:     "jrwest-sanin-east:jrwest-sanin-east.station.JR西日本-山陰線-亀岡",
  JR湖西_京都:       "jrwest-kosei:jrwest-kosei.station.JR西日本-湖西線-京都",
  JR湖西_堅田:       "jrwest-kosei:jrwest-kosei.station.JR西日本-湖西線-堅田",

  // 近鉄（headsign なし → 手入力）
  近鉄_京都:         "kintetsu-kyoto-line:近畿日本鉄道-京都線-京都",
} as const;
```

**京都でカバーされている事業者**（`/api/v1/feeds` で確認済み）: 京都市営地下鉄・叡山電鉄・京阪（本線/鴨東線/京津線/石山坂本線）・阪急・嵐電・近鉄京都線・JR東海道本線（京都線/琵琶湖線/神戸線）・JR山陰本線（嵯峨野線）・JR湖西線。

全国では **1,145フィード / 748事業者** が入っています。
