# 作業書 タスク3 — Planner をモックから実データに接続する

> 全体計画: `docs/実装計画_終電ロジック.md`
> 前提: タスク2（`lib/resolveLastTrain.ts`）が完了している。
> 3a（型・calc・buildStations）はタスク2 と並行できる。3b（Planner）はタスク2 完了後。

---

## 0. 何を作るか

今の `components/Planner.tsx` は `data/network.ts` の `STATIONS`（手打ちのダミー値）を import して `rankVenues()` に渡している。
これを「メンバーの自宅駅 × 7 ハブを `resolveLastTrain` で解いた結果」に置き換える。

```
【今】  Planner ── import STATIONS(モック) ──▶ rankVenues()

【後】  Planner ── members ──▶ buildStations(members) ──▶ STATIONS(実データ) ──▶ rankVenues()
                                     │
                                     └─ resolveLastTrain × (メンバー数 × 7 ハブ)
```

`rankVenues()` / `latestLeave()` の式は**変えない**。

---

## 1. 成果物

| ファイル | 種別 | 変更 |
|---|---|---|
| `lib/types.ts` | 変更 | `Route.last: string \| null`、`posted` `postedTo` 削除、`Route.via` `transferCount` 追加 |
| `lib/calc.ts` | 変更 | `latestLeave` で `last === null` → 制約なし。`lieOf()` 削除 |
| `lib/buildStations.ts` | 新規 | メンバー → `STATIONS` を非同期で組む |
| `tests/buildStations.test.ts` | 新規 | `resolveLastTrain` を差し替えて組み立てを検証 |
| `components/Planner.tsx` | 変更 | 実データ接続・ローディング・ラベル・自由入力・footer |
| `data/network.ts` | 変更 | `STATIONS` `STATION_NAMES` `HUBS` 削除。`VENUES` `DEFAULT_MEMBERS` `DEFAULT_VENUE_IDS` は残す |

---

## 2. 3a — 型・calc・buildStations（タスク2 と並行可）

### ステップ1 — `lib/types.ts`

```ts
export interface Route {
  hub: HubId;
  transferMin: number;
  /** ハブ発・自宅駅まで行く最終列車の発時刻 "HH:MM"（24時台は "24:05"）。null = 電車不要（制約なし） */
  last: string | null;
  /** どこから来た値か。UI のラベル用 */
  via: "local" | "transit";
  /** 乗換回数。2 以上は UI で「参考値」 */
  transferCount: number;
}
```

- `posted` `postedTo` を**削除**（「終電の嘘」は作らない決定。`docs/実装計画_終電ロジック.md` §5）
- `Station` `HubCell` `Venue` `Member` `VenueResult` は変えない
- `MemberLeave` に `unavailable?: boolean` は足さない。対応予定のメンバーは `resultFor` に渡さない（下記）

### ステップ2 — `lib/calc.ts`

```ts
const viaBranch = route.last === null ? Infinity : toMin(route.last) - cell.transitMin - route.transferMin;
```

- `last === null`（電車不要）なら支線は縛らない。候補地→ハブの `lastDepart` だけが効く
- `lieOf()` を**削除**（使用箇所なし。`grep -rn lieOf` で確認してから）
- `taxiFare` はそのまま

### ステップ3 — `lib/buildStations.ts`

```ts
export interface BuildResult {
  stations: Record<string, Station>;   // rankVenues に渡す
  unavailable: Member[];               // 全ハブで unavailable だったメンバー（対応予定）
}

export async function buildStations(
  members: Member[],
  dayType: DayType,
  resolve = resolveLastTrain,          // テストで差し替える
  hubs = HUBS,
): Promise<BuildResult>
```

流れ:

```
for 各メンバーの自宅駅 home（重複は 1 回）:
  routes = []
  for 各ハブ hub:
    r = await resolve(hub, home, dayType)
    found         → routes.push({ hub: hub.id, transferMin: hub.transferMin, last: r.time, via: r.via, transferCount: r.transferCount })
    noTrainNeeded → routes.push({ hub: hub.id, transferMin: 0, last: null, via: "local", transferCount: 0 })
    unavailable   → 何もしない
  routes.length > 0 → stations[home] = { name: home, routes, taxiKm: 0 }
  routes.length === 0 → その home のメンバーを unavailable に
```

- **直列**で回す（`resolveLastTrain` 側の 300ms 間隔に任せる）。7 ハブ × N 人
- `taxiKm` は今のモックにしかない値。**0 を入れておく**（タクシー表示はこのタスクの対象外。表示側で `taxiKm === 0` なら出さない）
- 同じ `home` のメンバーが複数いても `resolve` は 1 回

### ステップ4 — `tests/buildStations.test.ts`

`resolve` を偽物にして検証。

| ケース | 偽 resolve の返り | 期待 |
|---|---|---|
| 1 人・7 ハブ全部 found | 全部 `found` | `stations[home].routes.length === 7`、`last` が時刻文字列 |
| 一部のハブが unavailable | 3 つ `unavailable` | `routes.length === 4`、`unavailable` は空 |
| 全部 unavailable | 全部 `unavailable` | `stations` に無い、`unavailable` にそのメンバー |
| 同じ駅がハブ | 1 つ `noTrainNeeded` | その route の `last === null`、`transferMin === 0` |
| 同じ自宅駅のメンバー 2 人 | | `resolve` の呼び出し回数が 7（14 ではない） |
| `latestLeave` に `last: null` の route | | 候補地→ハブの `lastDepart` だけで決まる（`calc.ts` の変更の確認） |

---

## 3. 3b — Planner 接続（タスク2 完了後）

### ステップ5 — データの持ち方

```ts
const [stations, setStations] = useState<Record<string, Station>>({});
const [unavailable, setUnavailable] = useState<Member[]>([]);
const [building, setBuilding] = useState(false);

useEffect(() => {
  let cancelled = false;
  setBuilding(true);
  buildStations(members, todayType()).then((r) => {
    if (cancelled) return;
    setStations(r.stations);
    setUnavailable(r.unavailable);
    setBuilding(false);
  });
  return () => { cancelled = true; };
}, [members]);
```

- **計算中は前回の結果を表示したまま**、ヘッダに「更新中…」バッジ。空にしない（チラつき防止）
- `members` の変更で毎回走るが、`resolveLastTrain` がキャッシュしているので 2 回目以降は速い
- `rankVenues(VENUES..., members.filter(m => !unavailable.includes(m)), stations, walk)` — **対応予定のメンバーは順位計算から外す**

### ステップ6 — 表示

| 場所 | 変更 |
|---|---|
| ランキング行 | `bottleneck` のメンバーの route が `via === "transit" && transferCount >= 2` なら「参考値」小ラベル |
| メンバー一覧 | `unavailable` に入っている人に「この駅は対応予定」バッジ。順位には影響しないことが分かる文言 |
| footer | 「⚠️ モック：時刻はダミー値です」→ **「時刻データは非公式APIおよび公式時刻表による参考値です。実際の乗車前に各交通事業者の公式情報をご確認ください。」**（規約 9 章①） |
| タクシー | `taxiKm === 0` なら表示しない |

### ステップ7 — 自宅駅の入力

今: `<select>` で `STATION_NAMES`（モック 18 駅）から選ぶ。
後: `<input list="stations">` + `<datalist>`。候補は:

- `data/subway-last-trains.json` の `stations[].name`（31 駅）
- `DEFAULT_MEMBERS` の駅名
- 将来さすけくんの JSON が増えたら同じ要領で足す

候補に無い駅名も入力できる（Transit に回る）。`parseMembers` / `addMember` の `STATIONS[m.station]` による存在チェックは**外す**（存在しない駅は `unavailable` になるだけ）。

### ステップ8 — `data/network.ts` の整理

- `STATIONS` `STATION_NAMES` `HUBS` を削除（`HUBS` は `data/hubs.ts` に移った）
- 先頭コメント（「モック用のダミーデータ」）を「`VENUES` は候補地→ハブの所要・最終。実測値に置き換え予定」に書き換え
- `VENUES` `DEFAULT_MEMBERS` `DEFAULT_VENUE_IDS` は残す
- `grep -rn "STATIONS\|STATION_NAMES\|HUBS" --include=*.ts --include=*.tsx` で参照が残っていないことを確認

### ステップ9 — `DEFAULT_MEMBERS` の見直し（最後に判断）

今の既定メンバーの駅: 鞍馬・びわ湖浜大津・大阪梅田・国際会館・太秦天神川・枚方市。
このうち **鞍馬（叡電）・大阪梅田（阪急）は現状 unavailable** になる（Transit の feed 欠損、さすけくんの JSON 待ち）。
デモで「対応予定」が 2 人出るのは避けたいので、実データで出る駅（例: 五条・山科・宇治・三ノ宮）に差し替えるかを**このステップで判断**する。差し替えるなら LP（`app/page.tsx`）の文言と齟齬が出ないか確認。

---

## 4. 完了条件

- [ ] `npm test` 全通過、`npx tsc --noEmit` エラーなし
- [ ] `npm run dev` → Planner で DEFAULT_MEMBERS の順位が実データで出る
- [ ] メンバーを追加・変更すると再計算され、計算中も前の結果が消えない
- [ ] 存在しない駅名を入れても画面が壊れず「対応予定」になる
- [ ] ネットワークを切っても（Transit 不通）ローカルで解ける駅の順位は出る
- [ ] footer が非公式表示に置き換わっている
- [ ] `data/network.ts` に `STATIONS` が残っていない

---

## 5. やらないこと

- `VENUES[].toHub`（候補地→ハブ）の実測化 — 別メンバー
- タクシー料金の実データ化（`taxiKm`）
- 日付選択 UI（今日固定）
- 「終電の嘘」カード
- Supabase 連携（今回は全部ローカル + Transit）

---

## 6. ハマりそうなところ

- `useEffect` の非同期で古い結果が新しい結果を上書きする → `cancelled` フラグで防ぐ（ステップ5 のコード）
- `members` を毎レンダーで新しい配列にすると `useEffect` が無限に走る。`setMembers` 経由でしか変えないこと
- `Route.last` が `null` の route を `toMin()` に渡すと `NaN`。`calc.ts` の変更（ステップ2）が先
- Next の `"use client"` コンポーネントで `localStorage` を使うのは OK だが、SSR 中は無い。`resolveLastTrain` 側で守っている前提
- `parseMembers` の存在チェックを外すと URL パラメータに変な駅名が来ても通る。それは `unavailable` 表示で受ける設計なので OK
