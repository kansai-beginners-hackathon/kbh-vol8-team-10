"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_MEMBERS, DEFAULT_VENUE_IDS, STATIONS, STATION_NAMES, VENUES } from "@/data/network";
import { rankVenues } from "@/lib/calc";
import { isHHMM, toMin, toStr } from "@/lib/time";
import type { Member } from "@/lib/types";

const MAX_MEMBERS = 8;

/** URL の m= は "名前:駅,名前:駅"。名前を省くと駅名が名前になる */
function parseMembers(raw: string | null): Member[] {
  if (!raw) return DEFAULT_MEMBERS;
  const members = raw
    .split(",")
    .map((token) => {
      const [a, b] = token.split(":");
      const station = (b ?? a).trim();
      const name = b ? a.trim() : station;
      return { name, station };
    })
    .filter((m) => STATIONS[m.station]);
  return members.length ? members : DEFAULT_MEMBERS;
}

function parseVenueIds(raw: string | null): string[] {
  const ids = (raw ?? "").split(",").filter((id) => VENUES.some((v) => v.id === id));
  return ids.length ? ids : DEFAULT_VENUE_IDS;
}

export default function Planner() {
  const params = useSearchParams();
  const [members, setMembers] = useState<Member[]>(() => parseMembers(params.get("m")));
  const [venueIds, setVenueIds] = useState<string[]>(() => parseVenueIds(params.get("v")));
  const [meetAt, setMeetAt] = useState(() => (isHHMM(params.get("t")) ? params.get("t")! : "19:00"));
  const [walk, setWalk] = useState(() => Math.min(15, Math.max(0, Number(params.get("w")) || 5)));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newStation, setNewStation] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 状態は全部 URL に入れる。共有・再訪・ブックマークがこれで済む
  useEffect(() => {
    const q = new URLSearchParams();
    q.set("m", members.map((m) => (m.name === m.station ? m.station : `${m.name}:${m.station}`)).join(","));
    q.set("v", venueIds.join(","));
    q.set("t", meetAt);
    q.set("w", String(walk));
    window.history.replaceState(null, "", `${location.pathname}?${q}`);
  }, [members, venueIds, meetAt, walk]);

  const ranking = useMemo(
    () => rankVenues(VENUES.filter((v) => venueIds.includes(v.id)), members, STATIONS, walk),
    [venueIds, members, walk],
  );
  const alive = ranking.filter((r) => r.ok);
  const dead = ranking.filter((r) => !r.ok);
  const top = alive[0];
  const worst = alive[alive.length - 1];
  const spread = top && worst && top.ok && worst.ok ? top.dissolve - worst.dissolve : 0;
  const selected = alive.find((r) => r.venue.id === selectedId) ?? top;

  function updateMember(index: number, patch: Partial<Member>) {
    setMembers(members.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }
  function addMember(event: React.FormEvent) {
    event.preventDefault();
    const station = newStation.trim().replace(/駅$/, "");
    if (!station || members.length >= MAX_MEMBERS) return;
    if (!STATIONS[station]) {
      setAddError(`「${station}」はまだ入っていません（モックは主要 ${STATION_NAMES.length} 駅のみ）`);
      return;
    }
    setMembers([...members, { name: newName.trim() || station, station }]);
    setNewName("");
    setNewStation("");
    setAddError(null);
  }
  function toggleVenue(id: string) {
    setVenueIds(venueIds.includes(id) ? venueIds.filter((v) => v !== id) : [...venueIds, id]);
  }
  async function share() {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* クリップボードが使えない環境では何もしない */
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbar-left">
          <Link href="/" className="back" aria-label="トップページへ戻る">←<span>戻る</span></Link>
          <Link href="/" className="brand">もうちょっと</Link>
        </div>
        <nav className="topbar-nav">
          <span className="status"><i />京都・平日ダイヤ</span>
          <button className="btn btn-ghost" onClick={share}>{copied ? "コピーしました" : "リンクをコピー"}</button>
        </nav>
      </header>

      <section className="workspace">
        {/* 01 メンバー */}
        <div className="panel pad">
          <div className="heading">
            <div><span className="step">01</span><h2>メンバーの最寄り駅</h2></div>
            <span className="mono note">{members.length} / {MAX_MEMBERS}人</span>
          </div>
          <div className="member-list">
            <div className="member member-head" aria-hidden="true">
              <span />
              <span>メンバー</span>
              <span>最寄り駅（帰る駅）</span>
              <span />
            </div>
            {members.map((member, index) => {
              const isBottleneck = selected?.ok && selected.bottleneck === member;
              return (
                <div className={`member${isBottleneck ? " is-bottleneck" : ""}`} key={index}>
                  <span className="avatar">{member.name.slice(0, 1)}</span>
                  <input aria-label="名前" placeholder="名前" value={member.name} onChange={(e) => updateMember(index, { name: e.target.value || member.station })} />
                  <select aria-label="最寄り駅" value={member.station} onChange={(e) => updateMember(index, { station: e.target.value })}>
                    {STATION_NAMES.map((name) => <option key={name}>{name}</option>)}
                  </select>
                  <button className="remove" aria-label="削除" onClick={() => setMembers(members.filter((_, i) => i !== index))}>×</button>
                </div>
              );
            })}
          </div>
          <form className="member add" onSubmit={addMember}>
            <span className="avatar avatar-add">＋</span>
            <input aria-label="追加する人の名前" placeholder="名前（省略可）" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input aria-label="追加する人の最寄り駅" placeholder="駅名を入力" list="station-list" value={newStation}
              onChange={(e) => { setNewStation(e.target.value); setAddError(null); }} />
            <datalist id="station-list">{STATION_NAMES.map((name) => <option key={name} value={name} />)}</datalist>
            <button type="submit" className="btn btn-primary" disabled={!newStation.trim() || members.length >= MAX_MEMBERS}>追加</button>
          </form>
          {addError && <p className="add-error">{addError}</p>}
        </div>

        {/* 02 候補地 ＋ 03 条件 */}
        <div className="panel pad">
          <div className="heading"><div><span className="step">02</span><h2>候補地（複数えらべる）</h2></div></div>
          <div className="pills">
            {VENUES.map((v) => (
              <button key={v.id} className="pill" aria-pressed={venueIds.includes(v.id)} onClick={() => toggleVenue(v.id)}>{v.name}</button>
            ))}
          </div>
          <div className="heading" style={{ marginTop: 28 }}><div><span className="step">03</span><h2>条件</h2></div></div>
          <div className="cond">
            <label><span>集合</span><input type="time" value={meetAt} onChange={(e) => setMeetAt(e.target.value || "19:00")} /></label>
            <label><span>店から駅までの距離（帰り）</span><input type="range" min={0} max={15} value={walk} onChange={(e) => setWalk(Number(e.target.value))} /><b className="mono">{walk}分</b></label>
          </div>
        </div>
      </section>

      {/* 主役：候補地ランキング */}
      <section className="panel ranking">
        {!top || !top.ok ? (
          <p className="lede">メンバーと候補地を選ぶと、一番長くいられる場所が出ます。</p>
        ) : (
          <>
            <div className="heading">
              <div><span className="step">RESULT</span><h2>この<b>{members.length}人</b>が一番長くいられる場所</h2></div>
              <span className="mono note">全員の最終列車から計算</span>
            </div>

            <div className="winner">
              <div>
                <p className="eyebrow">1位</p>
                <p className="winner-name">{top.venue.name}</p>
                <p className="winner-time">
                  <strong className="mono">{toStr(top.dissolve)}</strong><small>までに出れば、全員帰れます</small>
                </p>
                <p className="note">
                  <span className="mono">{meetAt}</span> 集合なら <span className="mono">{Math.floor((top.dissolve - toMin(meetAt)) / 60)}時間{(top.dissolve - toMin(meetAt)) % 60}分</span> いられる
                </p>
              </div>
              <div className="winner-side">
                {alive.length > 1 && worst.ok && (
                  <p className="reason">{worst.venue.name}より<strong className="mono">+{spread}</strong>分<br />長くいられます</p>
                )}
                <div className="bottleneck"><span className="alert" /><span><b>{top.bottleneck.name}</b>さんの終電時間は <span className="mono">{toStr(top.dissolve)}</span> です。</span></div>
              </div>
            </div>

            {alive.length > 1 && (
              <ol className="rank-list">
                {alive.slice(1).map((r, i) => r.ok && (
                  <li key={r.venue.id}>
                    <button className="rank-row" aria-pressed={selected?.venue.id === r.venue.id} onClick={() => setSelectedId(r.venue.id)}>
                      <span className="rank-no mono">{i + 2}</span>
                      <span className="rank-main">
                        <b>{r.venue.name}</b>
                        <small><span className="mono">{toStr(r.dissolve)}</span> までに出れば、全員帰れます</small>
                      </span>
                      <span className="rank-right">
                        <b className="mono">{toStr(r.dissolve)}</b>
                        <small className="mono diff">−{top.dissolve - r.dissolve}分</small>
                      </span>
                    </button>
                  </li>
                ))}
                {dead.map((r) => !r.ok && (
                  <li key={r.venue.id} className="rank-dead">
                    <span className="rank-no mono">–</span>
                    <span className="rank-main"><b>{r.venue.name}</b><small>{r.deadMember.name}さんは終電で帰れません。</small></span>
                    <span className="rank-right"><small className="diff">帰れない</small></span>
                  </li>
                ))}
              </ol>
            )}
            {alive.length > 1 && spread <= 10 && (
              <p className="flat">このメンバーなら、どこでもほぼ同じです（差は {spread}分）</p>
            )}
          </>
        )}
      </section>

      {selected?.ok && (
        <section className="detail">
          {/* タイムライン */}
          <div className="panel pad">
            <div className="heading"><div><span className="step">—</span><h2>{selected.venue.name}なら、誰が何時まで</h2></div></div>
            {(() => {
              const t0 = Math.floor((selected.rows[0].leave - 20) / 30) * 30;
              const t1 = Math.ceil((selected.rows[selected.rows.length - 1].leave + 20) / 30) * 30;
              return (
                <>
                  <div className="tl">
                    {selected.rows.map((row) => (
                      <div className={`tl-row${row.member === selected.bottleneck ? " is-bottleneck" : ""}`} key={row.member.station + row.member.name}>
                        <span className="tl-name">{row.member.name}</span>
                        <span className="tl-track"><i style={{ width: `${Math.max(2, ((row.leave - t0) / (t1 - t0)) * 100)}%` }} /></span>
                        <span className="tl-time mono">{toStr(row.leave)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="tl-axis mono"><span>{toStr(t0)}</span><span>{toStr((t0 + t1) / 2)}</span><span>{toStr(t1)}</span></div>
                </>
              );
            })()}
          </div>
        </section>
      )}

      <footer>
        <span>⚠️ モック：時刻はダミー値です。本番では各社の公開時刻表の URL と取得日をここに出します</span>
        <span>徒歩・乗換は概算で安全側（早め）に倒しています。遅延・臨時ダイヤは対象外</span>
      </footer>
    </main>
  );
}
