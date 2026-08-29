import fs from "node:fs";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { BASE_URL, LINES } from "./stations.js";

dotenv.config({ path: ".env.local" });

const PATTERNS = [
  { dayType: "weekday", tr: "tr.time.wektime", hour: "td.heijitsu-tt h3", min: "span.disptnwek" },
  { dayType: "holiday", tr: "tr.time.holtime", hour: "td.kyujitsu-tt h3", min: "span.disptnhol" },
];

function toMinutes(value) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(".env.local に SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください");
  }
  return createClient(url, key);
}

export function parsePage(html, url, lineId, stationId, direction, minimumHour = 21) {
  const $ = cheerio.load(html);
  const diaDate = $("span.timetable-date").first().text().trim();
  const note = $("body").text().replace(/\s+/g, " ").match(/備考.{0,200}/)?.[0] ?? "";
  const rows = [];

  for (const pattern of PATTERNS) {
    $(pattern.tr).each((_, tr) => {
      const hour = $(tr).find(pattern.hour).text().trim();
      if (!hour || Number(hour) < minimumHour) return;

      $(tr).find(pattern.min).each((__, span) => {
        const raw = $(span).text().trim();
        const minute = raw.match(/\d+/)?.[0];
        if (!minute) return;

        rows.push({
          line_id: lineId,
          station_id: stationId,
          direction,
          day_type: pattern.dayType,
          depart_time: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`,
          marker: raw.replace(/\d/g, "").trim(),
          source_url: url,
          dia_date: diaDate,
          note,
        });
      });
    });
  }

  return rows;
}

function destinationName(lineId, direction, marker) {
  if (lineId === "karasuma") {
    if (direction === "down") {
      return marker.includes("奈") ? "近鉄奈良" : marker.includes("新") ? "新田辺" : "竹田";
    }
    return "国際会館";
  }

  if (direction === "up") {
    return marker.includes("浜") ? "びわ湖浜大津" : "六地蔵";
  }
  return "太秦天神川";
}

function createStaticDataset(rows) {
  const stations = LINES.flatMap((line) => line.stations.map((station) => ({
    id: station.stationId,
    name: station.name,
    lines: [],
  })));
  const stationMap = new Map(stations.map((station) => [station.id, station]));

  for (const line of LINES) {
    for (const station of line.stations) {
      const lineRows = rows.filter((row) => row.line_id === line.lineId && row.station_id === station.stationId);
      const destinations = new Map();

      for (const row of lineRows) {
        const name = destinationName(line.lineId, row.direction, row.marker);
        const destination = destinations.get(name) ?? { name, weekday: null, weekend: null };
        const dayKey = row.day_type === "weekday" ? "weekday" : "weekend";
        if (!destination[dayKey] || toMinutes(row.depart_time) > toMinutes(destination[dayKey])) destination[dayKey] = row.depart_time;
        destinations.set(name, destination);
      }

      const sourceRow = lineRows.find((row) => row.source_url);
      stationMap.get(station.stationId).lines.push({
        lineId: line.lineId,
        lineName: line.lineName,
        destinations: [...destinations.values()].filter((destination) => destination.weekday && destination.weekend),
        sourceUrl: sourceRow?.source_url ?? `${BASE_URL}${station.down || station.up}.htm`,
      });
    }
  }

  const diaDate = rows.find((row) => row.dia_date)?.dia_date || "確認中";

  return {
    dataset: "kyoto-city-subway-last-trains",
    updatedAt: new Date().toISOString().slice(0, 10),
    timetableEffectiveFrom: diaDate,
    source: {
      name: "京都市交通局 京都市営地下鉄時刻表",
      url: "https://www2.city.kyoto.lg.jp/kotsu/tikadia/tikatime.htm",
      retrievedAt: new Date().toISOString().slice(0, 10),
      note: "公式HTMLから各駅・方向・行き先別の最終便を抽出。24時台は24時表記を維持する。",
    },
    stations: [...stationMap.values()],
  };
}

async function fetchPage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

async function saveStations(supabase) {
  const rows = LINES.flatMap((line) => line.stations.map((station) => ({
    line_id: line.lineId,
    station_id: station.stationId,
    name: station.name,
    seq: station.seq,
  })));

  const { error } = await supabase.from("line_stations").upsert(rows, { onConflict: "line_id,station_id" });
  if (error) throw new Error(`駅の保存に失敗: ${error.message}`);
  console.log(`駅の一覧を保存... ${rows.length}件 OK\n`);
}

async function processPage(supabase, job, index, total) {
  const url = `${BASE_URL}${job.file}.htm`;
  const label = `[${String(index).padStart(2, "0")}/${total}] ${job.line.lineName} ${job.station.name} (${job.direction})`;
  try {
    const html = await fetchPage(url);
    const rows = parsePage(html, url, job.line.lineId, job.station.stationId, job.direction);
    fs.writeFileSync("data/sample.htm", html);
    const { error } = await supabase.from("last_trains").upsert(rows, {
      onConflict: "line_id,station_id,direction,day_type,depart_time,marker",
    });
    if (error) throw new Error(error.message);
    const weekday = rows.filter((row) => row.day_type === "weekday").length;
    const holiday = rows.filter((row) => row.day_type === "holiday").length;
    console.log(`${label} ... 平日${weekday}件 土日${holiday}件 → 保存OK`);
    return rows.length;
  } catch (error) {
    console.error(`${label} ... 失敗: ${error.message}`);
    return 0;
  }
}

function createJobs() {
  return LINES.flatMap((line) => line.stations.flatMap((station) => [
    station.down && { line, station, direction: "down", file: station.down },
    station.up && { line, station, direction: "up", file: station.up },
  ].filter(Boolean)));
}

/** 路線ごとの駅の並びと through を data/subway-lines.json に書く。ネットワーク不要 */
export function createLinesDataset() {
  return {
    dataset: "kyoto-city-subway-lines",
    updatedAt: new Date().toISOString().slice(0, 10),
    note: "stations は路線の駅順（配列順が並び順）。through は路線外の行き先がこの路線上でどの駅まで通るか。",
    lines: LINES.map((line) => ({
      lineId: line.lineId,
      lineName: line.lineName,
      stations: line.stations.map((station) => station.name),
      through: line.through ?? {},
    })),
  };
}

function exportLines() {
  fs.writeFileSync("data/subway-lines.json", `${JSON.stringify(createLinesDataset(), null, 2)}\n`);
  console.log("路線データを書き出しました: data/subway-lines.json");
}

async function exportStatic() {
  const jobs = createJobs();
  const rows = [];
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    const url = `${BASE_URL}${job.file}.htm`;
    const html = await fetchPage(url);
    rows.push(...parsePage(html, url, job.line.lineId, job.station.stationId, job.direction, 0));
    console.log(`[${index + 1}/${jobs.length}] ${job.line.lineName} ${job.station.name} (${job.direction})`);
  }
  fs.writeFileSync("data/subway-last-trains.json", `${JSON.stringify(createStaticDataset(rows), null, 2)}\n`);
  console.log(`静的データを書き出しました: ${rows.length}件`);
  exportLines();
}

async function main() {
  if (process.argv.includes("--export-static")) {
    await exportStatic();
    return;
  }

  if (process.argv.includes("--export-lines")) {
    exportLines();
    return;
  }

  if (process.argv.includes("--fetch-sample")) {
    const url = `${BASE_URL}022100.htm`;
    const html = await fetchPage(url);
    fs.writeFileSync("data/sample.htm", html);
    console.log(`取得できました: ${url} (${html.length}文字)`);
    return;
  }

  if (process.argv.includes("--parse-only")) {
    const html = fs.readFileSync("data/sample.htm", "utf8");
    const rows = parsePage(html, `${BASE_URL}022100.htm`, "karasuma", "kyoto", "down");
    console.log(`ローカル解析: 平日${rows.filter((row) => row.day_type === "weekday").length}件 土日${rows.filter((row) => row.day_type === "holiday").length}件`);
    for (const row of rows) console.log(`  ${row.depart_time}${row.marker ? ` [${row.marker}]` : ""}`);
    return;
  }

  const supabase = getSupabase();
  const jobs = createJobs();
  await saveStations(supabase);

  let saved = 0;
  for (let index = 0; index < jobs.length; index += 1) {
    saved += await processPage(supabase, jobs[index], index + 1, jobs.length);
    if (index < jobs.length - 1) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log(`\n完了: ${saved.toLocaleString()}件を保存しました`);
}

if (process.argv[1] && process.argv[1].endsWith("main.js")) {
  main().catch((error) => {
    console.error(`停止しました: ${error.message}`);
    process.exitCode = 1;
  });
}