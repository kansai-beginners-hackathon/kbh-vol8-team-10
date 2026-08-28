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

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(".env.local に SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください");
  }
  return createClient(url, key);
}

export function parsePage(html, url, lineId, stationId, direction) {
  const $ = cheerio.load(html);
  const diaDate = $("span.timetable-date").first().text().trim();
  const note = $("body").text().replace(/\s+/g, " ").match(/備考.{0,200}/)?.[0] ?? "";
  const rows = [];

  for (const pattern of PATTERNS) {
    $(pattern.tr).each((_, tr) => {
      const hour = $(tr).find(pattern.hour).text().trim();
      if (!hour || Number(hour) < 21) return;

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

async function main() {
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