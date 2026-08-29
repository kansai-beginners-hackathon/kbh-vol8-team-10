"use client";

import { useRef, useState } from "react";

/** /api/parse の成功レスポンス（app/api/parse/route.js の契約） */
export interface ParsedChat {
  venue: string | null;
  meetAt: string | null;
  members: { name: string; station: string }[];
}

const PLACEHOLDER = `今日19時に三条集合ー
田中: 行きます！鞍馬から向かいます
佐藤: 私も行く 桂です
鈴木: ごめん今日いけない`;

/**
 * LINE のグループ会話を貼り付けて、参加者・最寄り駅・集合時刻・集合場所を自動で埋める（仮 UI）。
 * 読み取り自体はサーバー側 /api/parse（gpt-4o-mini）。ここは投げて結果を親に渡すだけ。
 * onApply は反映した内容の一言（"2人を追加" など）を返す。
 */
export default function ChatImport({ onApply }: { onApply: (parsed: ParsedChat) => string }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // API の応答を待つ数秒の間に親の state（メンバー等）が変わっても、反映は最新の onApply で行う
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/parse/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      // API キー未設定などでルート自体が落ちると JSON でないレスポンスが返るので、その場合も拾う
      const data: (Partial<ParsedChat> & { error?: string }) | null = await res.json().catch(() => null);
      if (!res.ok || !data || !Array.isArray(data.members)) {
        setError(data?.error ?? `読み取りに失敗しました（${res.status}）。少し待ってもう一度試してください`);
        return;
      }
      const note = onApplyRef.current({ venue: data.venue ?? null, meetAt: data.meetAt ?? null, members: data.members });
      setDone(note);
      setText("");
    } catch {
      setError("通信に失敗しました。ネットワークを確認してもう一度試してください");
    } finally {
      setLoading(false);
    }
  }

  return (
    <details className="chat-import">
      <summary>LINE の会話を貼り付けて、まとめて入れる</summary>
      <form onSubmit={submit}>
        <textarea
          aria-label="LINE の会話"
          rows={5}
          placeholder={PLACEHOLDER}
          value={text}
          onChange={(e) => { setText(e.target.value); if (done) setDone(null); }}
          maxLength={10000}
          disabled={loading}
        />
        <div className="chat-import-actions">
          <button type="submit" className="btn btn-primary" disabled={!text.trim() || loading}>
            {loading ? "読み取り中…" : "読み取って追加"}
          </button>
          {error && <span className="chat-import-error" role="alert">{error}</span>}
          {done && !error && <span className="chat-import-done" aria-live="polite">{done}</span>}
          {!error && !done && <span className="note">「行けない」と言っている人と、駅が書かれていない人は入りません</span>}
        </div>
      </form>
    </details>
  );
}
