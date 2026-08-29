// LINEの会話を受け取って、参加者と最寄り駅を返すAPI

import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

// APIキーは .env.local の OPENAI_API_KEY から自動で読まれる（コードに書かない）
// モジュール直下で new すると next build の時点でキーが無いと落ちるので、最初のリクエストで作る
let client;
const getClient = () => (client ??= new OpenAI());

// AIへの指示。ここの質が出力の質を決める
const SYSTEM_PROMPT = `
あなたは日本語のグループチャットから、飲み会の参加者情報を抜き出す専門家です。

【抜き出すもの】
1. venue   : 集合場所（駅名または地名）。書かれていなければ null
2. meetAt  : 集合時刻。必ず "HH:MM" の形にする（例 "19:00"）。書かれていなければ null
3. members : 参加する人の配列。各要素は { name, station }

【members のルール】
- 参加すると言っている人だけ入れる。「行けない」「今回はパス」の人は入れない
- 最寄り駅が書かれていない人は members に入れない（駅が分からないと計算できないため）
- name は発言者の名前。名前が分からなければ駅名をそのまま name にする

【駅名のルール（厳守）】
- 「駅」を付けない。「鞍馬駅」→「鞍馬」
- 略さず正式名称にする。「河原町」→「京都河原町」
- 漢字で書く。「からすまおいけ」→「烏丸御池」
- 駅名でないもの（「北の方」など）は members に入れない

【紛らわしい駅の対応表】
- 「四条」「四条烏丸」    → 四条
- 「河原町」「四条河原町」→ 京都河原町
- 「三条」                → 三条
- 「三条京阪」            → 三条京阪
- 「京都駅」「京都」      → 京都
- 「百万遍」「出町柳」    → 出町柳

【出力形式】
JSONだけを返す。説明文やコードブロックの記号は付けない。

【例３】
入力:
19時に四条
田中: 行きます
佐藤: 桂から行く

出力:
{"venue":"四条","meetAt":"19:00","members":[{"name":"佐藤","station":"桂"}]}

【例2】
入力:
河原町でいい？
佐藤: からすまおいけです

出力:
{"venue":"京都河原町","meetAt":null,"members":[{"name":"佐藤","station":"烏丸御池"}]}

【例】
入力:
今日19時に三条集合ー
田中: 行きます！鞍馬から向かいます
佐藤: 私も行く 桂です
鈴木: ごめん今日いけない

出力:
{"venue":"三条","meetAt":"19:00","members":[{"name":"田中","station":"鞍馬"},{"name":"佐藤","station":"桂"}]}
`;


// 出力の形を定義する。AIはこの形以外を返せなくなる
const ParsedSchema = z.object({
  venue: z.string().nullable(),
  meetAt: z.string().nullable(),
  members: z.array(
    z.object({
      name: z.string(),
      station: z.string(),
    })
  ),
});

export async function POST(request) {
  try {
    // ⓪ サーバー側の設定漏れ。原因が分かるメッセージで返す（catch に落ちると「サーバー側でエラー」しか出ない）
    if (!process.env.OPENAI_API_KEY) {
      console.error("parse API: OPENAI_API_KEY が未設定です（.env.local か Vercel の環境変数に設定してください）");
      return Response.json(
        { error: "AI の設定が完了していません（OPENAI_API_KEY 未設定）。管理者に連絡してください" },
        { status: 503 }
      );
    }

    const body = await request.json();
    const text = body.text;

    // ① 入力が無い・空っぽ
    if (!text || text.trim().length === 0) {
      return Response.json(
        { error: "LINEの会話を貼り付けてください" },
        { status: 400 }
      );
    }

    // ② 長すぎる（AIの費用が跳ねるのを防ぐ）
    if (text.length > 10000) {
      return Response.json(
        { error: "文字数が多すぎます。1万文字以内にしてください" },
        { status: 400 }
      );
    }

    const response = await getClient().chat.completions.parse({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      response_format: zodResponseFormat(ParsedSchema, "parsed"),
    });

    const parsed = response.choices[0].message.parsed;

    // ③ AIが形を返せなかった
    if (!parsed) {
      return Response.json(
        { error: "会話を読み取れませんでした。もう一度試してください" },
        { status: 502 }
      );
    }

    const normalizedMembers = Array.isArray(parsed.members)
      ? parsed.members.filter(
          (member) =>
            member &&
            typeof member.name === "string" &&
            member.name.trim() !== "" &&
            typeof member.station === "string" &&
            member.station.trim() !== ""
        )
      : [];

    return Response.json({
      venue: typeof parsed.venue === "string" && parsed.venue.trim() !== "" ? parsed.venue : null,
      meetAt: typeof parsed.meetAt === "string" && parsed.meetAt.trim() !== "" ? parsed.meetAt : null,
      members: normalizedMembers,
    });

  } catch (e) {
    // ④ 想定外のエラー全部
    console.error("parse APIでエラー:", e);
    return Response.json(
      { error: "サーバー側でエラーが起きました" },
      { status: 500 }
    );
  }
}