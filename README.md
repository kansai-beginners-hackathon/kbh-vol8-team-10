# プロダクト名

> 一言でどんなプロダクトか（30字以内）

## デモ
- デモURL：
- 動画：

## 課題
誰の、どんな困りごとを解決しますか？

## 解決方法
- 
- 
- 

## 使用技術
| 領域 | 技術 |
| --- | --- |
| フロントエンド |  |
| バックエンド |  |
| その他 |  |

## 動かし方
```bash
npm install
npm run dev
```

時刻表データは `data/subway-last-trains.json` をビルドへ同梱しているため、API サーバーなしで動作します。現在は京都市営地下鉄31駅の行き先別終電を収録しています。

公式時刻表から静的データを更新する場合は `npm run data:export` を実行してください。これはビルド時・実行時には外部サイトへアクセスしません。

本番ビルドの確認：

```bash
npm run build
npm run start
```

`/api/parse`（LINE の会話の読み取り）と `/api/return-home` はサーバー側で動く Route Handler のため、静的エクスポート（`output: "export"`）は使えません。デプロイ先は Vercel（Next.js サーバー実行）で、`OPENAI_API_KEY` を Environment Variables に設定します。ローカルは `.env.local` に同じキーを置きます（`.env.example` 参照）。

## チーム
| 役割 | 名前 | GitHub |
| --- | --- | --- |
|  |  | @ |

---
関西ビギナーズハッカソン vol.8 (2026/08/28-30)