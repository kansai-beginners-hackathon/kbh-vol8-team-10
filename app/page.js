"use client";

import { useState } from "react";
import timetable from "../data/subway-last-trains.json";

const venues = [
  { id: "shijo", name: "四条", station: "四条", buffer: 8 },
  { id: "kyoto", name: "京都駅", station: "京都", buffer: 12 },
  { id: "karasuma-oike", name: "烏丸御池", station: "烏丸御池", buffer: 5 },
];

const sampleMembers = [
  { name: "田中さん", station: "京都" },
  { name: "佐藤さん", station: "四条" },
  { name: "鈴木さん", station: "烏丸御池" },
];

function toMinutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function formatTime(value) {
  const hour = Math.floor(value / 60);
  return `${hour}:${String(value % 60).padStart(2, "0")}`;
}

function stationLastTrain(stationName) {
  const station = timetable.stations.find((item) => item.name === stationName);
  if (!station) return { time: "23:00", destination: "確認中" };

  const trains = station.lines.flatMap((line) =>
    line.destinations.map((destination) => ({
      time: destination.weekday,
      destination: destination.name,
    })),
  );
  return trains.reduce((latest, train) =>
    toMinutes(train.time) > toMinutes(latest.time) ? train : latest,
  );
}

function calculate(member, venue) {
  const train = stationLastTrain(member.station);
  const leave = toMinutes(train.time) - venue.buffer;
  return { ...member, ...train, leave };
}

export default function Home() {
  const [members, setMembers] = useState(sampleMembers);
  const [venueId, setVenueId] = useState("karasuma-oike");
  const [newStation, setNewStation] = useState("");

  const venue = venues.find((item) => item.id === venueId);
  const results = members.map((member) => calculate(member, venue));
  const bottleneck = results.reduce((earliest, result) =>
    result.leave < earliest.leave ? result : earliest,
  );
  const stations = timetable.stations.map((station) => station.name);

  function addMember(event) {
    event.preventDefault();
    if (!newStation || members.length >= 6) return;
    setMembers([...members, { name: `メンバー${members.length + 1}`, station: newStation }]);
    setNewStation("");
  }

  function removeMember(index) {
    if (members.length <= 1) return;
    setMembers(members.filter((_, memberIndex) => memberIndex !== index));
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark">もうちょっと</div>
        <div className="status"><span /> 京都市営地下鉄・平日ダイヤ</div>
      </header>

      <section className="intro">
        <p className="eyebrow">TONIGHT&apos;S GROUP DECISION</p>
        <h1>みんなでいられる時間を、<em>もうちょっと。</em></h1>
        <p className="lede">最寄り駅を入れると、全員が終電で帰れる解散時刻がわかります。</p>
      </section>

      <section className="workspace">
        <div className="panel members-panel">
          <div className="section-heading">
            <div><span className="step">01</span><h2>メンバーの最寄り駅</h2></div>
            <span className="count">{members.length} / 6人</span>
          </div>
          <div className="member-list">
            {members.map((member, index) => (
              <div className="member-row" key={`${member.name}-${index}`}>
                <span className="avatar">{member.name.slice(0, 1)}</span>
                <input
                  aria-label={`${member.name}の名前`}
                  value={member.name}
                  onChange={(event) => setMembers(members.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
                />
                <select aria-label={`${member.name}の駅`} value={member.station} onChange={(event) => setMembers(members.map((item, itemIndex) => itemIndex === index ? { ...item, station: event.target.value } : item))}>
                  {stations.map((station) => <option key={station}>{station}</option>)}
                </select>
                <button className="remove" onClick={() => removeMember(index)} aria-label={`${member.name}を削除`}>×</button>
              </div>
            ))}
          </div>
          <form className="add-form" onSubmit={addMember}>
            <select value={newStation} onChange={(event) => setNewStation(event.target.value)} aria-label="追加する駅">
              <option value="">駅を追加する</option>
              {stations.map((station) => <option key={station}>{station}</option>)}
            </select>
            <button type="submit">＋ 追加</button>
          </form>
        </div>

        <div className="panel venue-panel">
          <div className="section-heading"><div><span className="step">02</span><h2>候補地を比べる</h2></div></div>
          <div className="venue-tabs">
            {venues.map((item) => <button className={item.id === venueId ? "active" : ""} onClick={() => setVenueId(item.id)} key={item.id}>{item.name}</button>)}
          </div>
          <div className="answer">
            <p className="answer-label">{venue.name}で解散するなら</p>
            <strong>{formatTime(bottleneck.leave)}<small> まで</small></strong>
            <p>に出れば、全員が帰れます。</p>
          </div>
          <div className="bottleneck"><span className="alert-dot" /><span>最初に詰むのは</span><b>{bottleneck.name}</b><span>・{formatTime(bottleneck.leave)}</span></div>
        </div>
      </section>

      <section className="comparison panel">
        <div className="section-heading"><div><span className="step">03</span><h2>場所を変えると、あとどれくらい？</h2></div><span className="muted">全員の最終列車から計算</span></div>
        <div className="comparison-grid">
          {venues.map((item) => {
            const itemResults = members.map((member) => calculate(member, item));
            const leave = Math.min(...itemResults.map((result) => result.leave));
            const difference = leave - bottleneck.leave;
            return <button className={`comparison-item ${item.id === venueId ? "selected" : ""}`} onClick={() => setVenueId(item.id)} key={item.id}><span>{item.name}</span><b>{formatTime(leave)}</b><small>{difference > 0 ? `+${difference}分` : "いまの場所"}</small></button>;
          })}
        </div>
      </section>

      <section className="truth panel">
        <div><p className="eyebrow">THE LAST TRAIN TRUTH</p><h2>「終電」は、駅ごとに違う。</h2><p>行き先によって最終列車が変わるから、駅で見た時刻だけでは帰れる時間を判断できません。</p></div>
        <div className="truth-number"><span>今回のボトルネック</span><b>{bottleneck.name}</b><strong>{bottleneck.time}</strong><small>{bottleneck.destination} 行き</small></div>
      </section>

      <footer><span>データ: 京都市交通局・2026年3月14日改正</span><span>※ 遅延・運休・乗換時間の変動は含みません</span></footer>
    </main>
  );
}
