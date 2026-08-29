"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import ChatImport, { type ParsedChat } from "@/components/ChatImport";
import { DEFAULT_MEMBERS, VENUES } from "@/data/network";
import prebuiltJson from "@/data/prebuilt-stations.json";
import subwayLastTrains from "@/data/subway-last-trains.json";
import { buildStations } from "@/lib/buildStations";
import type { DayType } from "@/lib/lastTrain";
import { bestRoute, rankVenues } from "@/lib/calc";
import { isHHMM, toMin, toStr } from "@/lib/time";
import type { Member, Station, VenueResult } from "@/lib/types";

const MAX_MEMBERS = 8;

/** 自宅駅の入力候補。ローカル JSON に入っている駅 + デモ用の駅。候補に無い駅名も入力できる（Transit に回る） */
const STATION_CANDIDATES = [
  ...new Set([...subwayLastTrains.stations.map((s) => s.name), ...DEFAULT_MEMBERS.map((m) => m.station)]),
];

const normalizeStation = (raw: string) => raw.trim().replace(/駅$/, "");

/**
 * 事前に解いておいた自宅駅（scripts/export-prebuilt-stations.ts）。
 * デモ／既定メンバーの駅はここから即表示して、Transit を待たない。無い駅だけ buildStations に回す。
 */
const PREBUILT = prebuiltJson as unknown as { stations: Record<DayType, Record<string, Station>>; unavailable: Record<DayType, string[]> };
function prebuiltFor(members: Member[], dayType: DayType) {
  const stations: Record<string, Station> = {};
  const unavailable = new Set<string>();
  const remaining: Member[] = [];
  for (const m of members) {
    const hit = PREBUILT.stations[dayType][m.station];
    if (hit) stations[m.station] = hit;
    else if (PREBUILT.unavailable[dayType].includes(m.station)) unavailable.add(m.station);
    else remaining.push(m);
  }
  return { stations, unavailable, remaining };
}

/**
 * URL の m= は "名前:駅,名前:駅"。名前を省くと駅名が名前になる。駅の存在チェックはしない（無い駅は「対応予定」表示で受ける）。
 * m= が無ければ空で始める（「始める」から来た人はメンバー 0 人から）。サンプル入りは LP の「例を見る」が URL に載せる。
 */
function parseMembers(raw: string | null): Member[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((token) => {
      const [a, b] = token.split(":");
      const station = normalizeStation(b ?? a);
      const name = b ? a.trim() : station;
      return { name: name || station, station };
    })
    .filter((m) => m.station);
}

/** URL の d= は "weekday" | "weekend"。無ければ未選択（null）。③条件でユーザーが選ぶまで計算しない */
function parseDayType(raw: string | null): DayType | null {
  return raw === "weekday" || raw === "weekend" ? raw : null;
}

/** URL の v= 。無ければ候補地は未選択で始める（「始める」から来た人は自分で選ぶ）。デモは LP が URL に載せる */
function parseVenueIds(raw: string | null): string[] {
  return (raw ?? "").split(",").filter((id) => VENUES.some((v) => v.id === id));
}

const EMPTY_PREBUILT = { stations: {} as Record<string, Station>, unavailable: new Set<string>(), remaining: [] as Member[] };
/** dayType 未選択のときは何も無い扱い */
const prebuiltOrEmpty = (members: Member[], dayType: DayType | null) => (dayType ? prebuiltFor(members, dayType) : EMPTY_PREBUILT);

/** 分 → 表示。Infinity（終電の制約なし）は "—" */
const fmt = (min: number) => (Number.isFinite(min) ? toStr(min) : "—");

/** 自宅駅の入力。1 文字ごとに再計算しないよう、確定（blur / Enter）でだけ親に返す */
function StationInput({ value, onCommit }: { value: string; onCommit: (station: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const station = normalizeStation(draft);
    if (!station) { setDraft(value); return; }
    if (station !== value) onCommit(station);
    else setDraft(station);
  };
  return (
    <input
      aria-label="最寄り駅"
      list="station-list"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
    />
  );
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
  const [copied, setCopied] = useState(false);

  // ハブ → 自宅駅の終電（実データ）。計算中は前回の結果を表示したまま building だけ立てる
  // ダイヤ区分は平日 / 土日の 2 択。初期値は URL の d、無ければ未選択（null）。③条件で選ぶまで終電は調べない
  const [dayType, setDayType] = useState<DayType | null>(() => parseDayType(params.get("d")));
  // 初期値は事前計算ぶん。デモ URL はこれだけで全員揃うので、開いた瞬間に答えが出る
  const [stations, setStations] = useState<Record<string, Station>>(() => prebuiltOrEmpty(members, dayType).stations);
  const [unavailableStations, setUnavailableStations] = useState<Set<string>>(() => prebuiltOrEmpty(members, dayType).unavailable);
  const [building, setBuilding] = useState(() => prebuiltOrEmpty(members, dayType).remaining.length > 0);

  useEffect(() => {
    let cancelled = false;
    if (!dayType) { setBuilding(false); return; }
    const pre = prebuiltFor(members, dayType);
    setStations((prev) => ({ ...prev, ...pre.stations }));
    setUnavailableStations((prev) => new Set([...prev, ...pre.unavailable]));
    if (pre.remaining.length === 0) { setBuilding(false); return; }
    setBuilding(true);
    // 自宅駅ごとに解けた順で画面に足していく。全員揃うのを待たない
    const onProgress = (home: string, station: Station | null) => {
      if (cancelled) return;
      if (station) {
        setStations((prev) => ({ ...prev, [home]: station }));
        setUnavailableStations((prev) => { if (!prev.has(home)) return prev; const next = new Set(prev); next.delete(home); return next; });
      } else {
        setStations((prev) => { if (!(home in prev)) return prev; const next = { ...prev }; delete next[home]; return next; });
        setUnavailableStations((prev) => new Set(prev).add(home));
      }
    };
    buildStations(pre.remaining, dayType, undefined, undefined, onProgress).then((r) => {
      if (cancelled) return;
      setStations((prev) => ({ ...prev, ...r.stations }));
      setUnavailableStations((prev) => new Set([...prev, ...r.unavailable.map((m) => m.station)]));
      setBuilding(false);
    });
    return () => { cancelled = true; };
  }, [members, dayType]);

  // 状態は全部 URL に入れる。共有・再訪・ブックマークがこれで済む
  useEffect(() => {
    const q = new URLSearchParams();
    q.set("m", members.map((m) => (m.name === m.station ? m.station : `${m.name}:${m.station}`)).join(","));
    q.set("v", venueIds.join(","));
    q.set("t", meetAt);
    q.set("w", String(walk));
    if (dayType) q.set("d", dayType);
    window.history.replaceState(null, "", `${location.pathname}?${q}`);
  }, [members, venueIds, meetAt, walk, dayType]);

  /** メンバーの状態: ready = 順位に入る / unavailable = 対応予定 / pending = 計算中（まだ結果が無い） / waiting = ダイヤ未選択で未計算 */
  const statusOf = (m: Member): "ready" | "unavailable" | "pending" | "waiting" =>
    !dayType ? "waiting" : stations[m.station] ? "ready" : unavailableStations.has(m.station) ? "unavailable" : "pending";
  const ranked = members.filter((m) => statusOf(m) === "ready");
  const unavailable = members.filter((m) => statusOf(m) === "unavailable");

  const ranking = useMemo(
    () => rankVenues(VENUES.filter((v) => venueIds.includes(v.id)), ranked, stations, walk),
    // ranked は members/stations から決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [venueIds, members, stations, unavailableStations, walk],
  );
  const alive = ranking.filter((r) => r.ok);
  const dead = ranking.filter((r) => !r.ok);
  const top = alive[0];
  const worst = alive[alive.length - 1];
  const spread = top && worst && top.ok && worst.ok && Number.isFinite(top.dissolve - worst.dissolve) ? top.dissolve - worst.dissolve : 0;
  const selected = alive.find((r) => r.venue.id === selectedId) ?? top;

  /** その候補地のボトルネックが Transit の乗換 2 回以上の経路で決まっている → 参考値 */
  const isReference = (r: VenueResult) => {
    if (!r.ok) return false;
    const station = stations[r.bottleneck.station];
    const route = station ? bestRoute(station, r.venue)?.route : undefined;
    return route?.via === "transit" && route.transferCount >= 2;
  };

  function updateMember(index: number, patch: Partial<Member>) {
    setMembers(members.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }
  function addMember(event: React.FormEvent) {
    event.preventDefault();
    const station = normalizeStation(newStation);
    if (!station || members.length >= MAX_MEMBERS) return;
    setMembers([...members, { name: newName.trim() || station, station }]);
    setNewName("");
    setNewStation("");
  }
  /**
   * 貼り付けたテキストから読み取った結果を反映する（仮）。
   * メンバーは今いる人に追記（同じ名前＋駅は飛ばす、上限 MAX_MEMBERS 人まで）、集合時刻と候補地は読めたときだけ上書き・追加。
   * 戻り値は ChatImport が表示する一言。
   */
  function applyParsed(parsed: ParsedChat): string {
    const incoming = parsed.members
      .map((m) => ({ station: normalizeStation(m.station), name: m.name.trim() }))
      .filter((m) => m.station)
      .map((m) => ({ ...m, name: m.name || m.station }));
    const isDup = (a: Member, b: Member) => a.station === b.station && a.name === b.name;
    const added: Member[] = [];
    for (const m of incoming) {
      if (members.length + added.length >= MAX_MEMBERS) break;
      if (members.some((x) => isDup(x, m)) || added.some((x) => isDup(x, m))) continue;
      added.push(m);
    }
    if (added.length) setMembers([...members, ...added]);

    // "9:00" → "09:00"。<input type="time"> は 2 桁でないと空欄になる
    const meet = parsed.meetAt?.replace(/^(\d):/, "0$1:") ?? null;
    const meetOk = isHHMM(meet) && /^\d{2}:\d{2}$/.test(meet);
    if (meetOk) setMeetAt(meet);

    const venueName = parsed.venue ? normalizeStation(parsed.venue) : "";
    const venue = venueName ? VENUES.find((v) => normalizeStation(v.name) === venueName) : undefined;
    if (venue && !venueIds.includes(venue.id)) setVenueIds([...venueIds, venue.id]);

    const parts: string[] = [];
    parts.push(added.length ? `${added.map((m) => m.name).join("・")} を追加` : "追加できる人はいませんでした");
    if (incoming.length > added.length) parts.push(`${incoming.length - added.length}人は重複か上限（${MAX_MEMBERS}人）で入れていません`);
    if (meetOk) parts.push(`集合 ${meet}`);
    if (venue) parts.push(`候補地に${venue.name}`);
    else if (parsed.venue) parts.push(`「${parsed.venue}」は候補地に無いので選んでいません`);
    return parts.join("。");
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

  const stayMin = top?.ok && Number.isFinite(top.dissolve) ? top.dissolve - toMin(meetAt) : null;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbar-left">
          <Link href="/" className="back" aria-label="トップページへ戻る">←<span>戻る</span></Link>
          <Link href="/" className="brand">もうちょっと</Link>
        </div>
        <nav className="topbar-nav">
          {dayType
            ? <span className="status"><i />京都・{dayType === "weekend" ? "土日" : "平日"}ダイヤ</span>
            : <span className="status status-unset"><i />ダイヤ未選択</span>}
          {building && <span className="status status-building" aria-live="polite"><i />更新中…</span>}
          <button className="btn btn-ghost" onClick={share}>{copied ? "コピーしました" : "リンクをコピー"}</button>
        </nav>
      </header>

      <section className="workspace">
        {/* 01 メンバー */}
        <div className="panel pad">
          <div className="heading">
            <div><span className="step">①</span><h2>メンバーの最寄り駅</h2></div>
            <span className="num note">{members.length} / {MAX_MEMBERS}人</span>
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
              const status = statusOf(member);
              return (
                <div className={`member${isBottleneck ? " is-bottleneck" : ""}${status === "unavailable" || status === "pending" ? " is-unavailable" : ""}`} key={index}>
                  <span className="avatar">{member.name.slice(0, 1)}</span>
                  <input aria-label="名前" placeholder="名前" value={member.name} onChange={(e) => updateMember(index, { name: e.target.value || member.station })} />
                  <span className={`station-cell${status !== "ready" ? " has-state" : ""}`}>
                    <StationInput value={member.station} onCommit={(station) => updateMember(index, { station, name: member.name === member.station ? station : member.name })} />
                    {/* 状態は入力欄の中（右端）に出す。下に出すと行の高さが変わって画面がずれる */}
                    {status === "unavailable" && (
                      <small className="state state-unavailable" title="この駅の終電データはまだ入っていません。順位計算には入れていません">対応予定</small>
                    )}
                    {status === "pending" && <small className="state state-pending" aria-live="polite">確認中…</small>}
                  </span>
                  <button className="remove" aria-label="削除" onClick={() => setMembers(members.filter((_, i) => i !== index))}>×</button>
                </div>
              );
            })}
          </div>
          <form className="member add" onSubmit={addMember}>
            <span className="avatar avatar-add">＋</span>
            <input aria-label="追加する人の名前" placeholder="名前（省略可）" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input aria-label="追加する人の最寄り駅" placeholder="駅名を入力" list="station-list" value={newStation}
              onChange={(e) => setNewStation(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={!newStation.trim() || members.length >= MAX_MEMBERS}>追加</button>
          </form>
          <datalist id="station-list">{STATION_CANDIDATES.map((name) => <option key={name} value={name} />)}</datalist>
          <ChatImport onApply={applyParsed} />
        </div>

        {/* 02 候補地 ＋ 03 条件 */}
        <div className="panel pad">
          <div className="heading"><div><span className="step">②</span><h2>候補地（複数えらべる）</h2></div></div>
          <div className="pills">
            {VENUES.map((v) => (
              <button key={v.id} className="pill" aria-pressed={venueIds.includes(v.id)} onClick={() => toggleVenue(v.id)}>{v.name}</button>
            ))}
          </div>
          <div className="heading" style={{ marginTop: 28 }}><div><span className="step">③</span><h2>条件</h2></div></div>
          <div className="cond">
            <div className="cond-row" role="group" aria-label="ダイヤ">
              <span>ダイヤ</span>
              <div className="pills">
                <button type="button" className="pill" aria-pressed={dayType === "weekday"} onClick={() => setDayType("weekday")}>平日</button>
                <button type="button" className="pill" aria-pressed={dayType === "weekend"} onClick={() => setDayType("weekend")}>土日</button>
              </div>
            </div>
            <label><span>集合</span><input type="time" value={meetAt} onChange={(e) => setMeetAt(e.target.value || "19:00")} /></label>
            <label><span>店から駅までの距離（帰り）</span><input type="range" min={0} max={15} value={walk} onChange={(e) => setWalk(Number(e.target.value))} /><b className="num">{walk}分</b></label>
          </div>
        </div>
      </section>

      {/* 主役：候補地ランキング */}
      <section className="panel ranking">
        {!top || !top.ok ? (
          <p className="lede">
            {members.length === 0
              ? "①でメンバーの最寄り駅を追加すると、一番長くいられる場所が出ます。"
              : !dayType
                ? "③で平日か土日を選ぶと、終電を調べます。"
                : building && ranked.length === 0
                  ? "終電を調べています…"
                  : ranked.length === 0
                    ? "終電データのある駅のメンバーがいません。駅名を変えてみてください。"
                    : venueIds.length === 0
                      ? "②で候補地を選ぶと、一番長くいられる場所が出ます。"
                      : "メンバーと候補地を選ぶと、一番長くいられる場所が出ます。"}
          </p>
        ) : (
          <>
            <div className="heading">
              <div><span className="step">結果</span><h2>この<b>{ranked.length}人</b>が一番長くいられる場所</h2></div>
              <span className="num note">全員の最終列車から計算{unavailable.length > 0 && `（対応予定 ${unavailable.length}人を除く）`}</span>
            </div>

            <div className="winner">
              <div>
                <p className="eyebrow">1位{isReference(top) && <small className="badge badge-ref">参考値</small>}</p>
                <p className="winner-name">{top.venue.name}</p>
                <p className="winner-time">
                  {Number.isFinite(top.dissolve)
                    ? <><strong className="num">{toStr(top.dissolve)}</strong><small>までに出れば、全員帰れます</small></>
                    : <><strong>終電の制約なし</strong><small>全員この駅が最寄りです</small></>}
                </p>
                {stayMin !== null && (
                  <p className="note">
                    <span className="num">{meetAt}</span> 集合なら <span className="num">{Math.floor(stayMin / 60)}時間{stayMin % 60}分</span> いられる
                  </p>
                )}
              </div>
              <div className="winner-side">
                {alive.length > 1 && worst.ok && spread > 0 && (
                  <p className="reason">{worst.venue.name}より<strong className="num">+{spread}</strong>分<br />長くいられます</p>
                )}
                {Number.isFinite(top.dissolve) && (
                  <div className="bottleneck"><span className="alert" /><span><b>{top.bottleneck.name}</b>さんの終電時間は <span className="num">{toStr(top.dissolve)}</span> です。</span></div>
                )}
              </div>
            </div>

            {(alive.length > 1 || dead.length > 0) && (
              <ol className="rank-list">
                {alive.slice(1).map((r, i) => r.ok && (
                  <li key={r.venue.id}>
                    <button className="rank-row" aria-pressed={selected?.venue.id === r.venue.id} onClick={() => setSelectedId(r.venue.id)}>
                      <span className="rank-no num">{i + 2}</span>
                      <span className="rank-main">
                        <b>{r.venue.name}{isReference(r) && <small className="badge badge-ref">参考値</small>}</b>
                        <small><span className="num">{fmt(r.dissolve)}</span> までに出れば、全員帰れます</small>
                      </span>
                      <span className="rank-right">
                        <b className="num">{fmt(r.dissolve)}</b>
                        {Number.isFinite(top.dissolve - r.dissolve) && <small className="num diff">−{top.dissolve - r.dissolve}分</small>}
                      </span>
                    </button>
                  </li>
                ))}
                {dead.map((r) => !r.ok && (
                  <li key={r.venue.id} className="rank-dead">
                    <span className="rank-no num">–</span>
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

      {selected?.ok && selected.rows.some((row) => Number.isFinite(row.leave)) && (
        <section className="detail">
          {/* タイムライン */}
          <div className="panel pad">
            <div className="heading"><div><h2>{selected.venue.name}なら、誰が何時まで</h2></div></div>
            {(() => {
              const finite = selected.rows.filter((row) => Number.isFinite(row.leave));
              const t0 = Math.floor((finite[0].leave - 20) / 30) * 30;
              const t1 = Math.ceil((finite[finite.length - 1].leave + 20) / 30) * 30;
              return (
                <>
                  <div className="tl">
                    {selected.rows.map((row) => (
                      <div className={`tl-row${row.member === selected.bottleneck ? " is-bottleneck" : ""}`} key={row.member.station + row.member.name}>
                        <span className="tl-name">{row.member.name}</span>
                        <span className="tl-track"><i style={{ width: `${Number.isFinite(row.leave) ? Math.max(2, ((row.leave - t0) / (t1 - t0)) * 100) : 100}%` }} /></span>
                        <span className="tl-time num">{fmt(row.leave)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="tl-axis num"><span>{toStr(t0)}</span><span>{toStr((t0 + t1) / 2)}</span><span>{toStr(t1)}</span></div>
                </>
              );
            })()}
          </div>
        </section>
      )}

      <footer>
        <span>時刻データは非公式APIおよび公式時刻表による参考値です。実際の乗車前に各交通事業者の公式情報をご確認ください。</span>
        <span>徒歩・乗換は概算で安全側（早め）に倒しています。遅延・臨時ダイヤは対象外</span>
      </footer>
    </main>
  );
}
