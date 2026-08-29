/**
 * 叡電の「標準発車時刻表」PDF から、行き先別の終電と終電一本前を取り出して JSON に書く。
 *
 *   node scripts/import-eizan-last-two.mjs            # 既定（出町柳）
 *   node scripts/import-eizan-last-two.mjs 出町柳 岩倉  # 駅を指定
 *
 * 公式ページ https://eizandensha.co.jp/information/<slug>/?di=<n> は HTML ではなく
 * Excel 由来の PDF を直接返す。poppler も PDF ライブラリも使えない前提なので、
 * 必要な範囲だけ自前で読む: FlateDecode を zlib で展開 → ToUnicode CMap で文字を復元 →
 * テキストの描画位置 (x, y) で表のセルを組み直す。
 *
 * 時刻表の 1 セルは 2 段になっている（上段 = 行先の略号 + 発車番線、下段 = 分）。
 * 「時」の数字はその間に縦中央で置かれるので、時の y を基準に上下を拾って対応づける。
 *   例) 上段 y=94「八②」 / 時 y=86「23」 / 下段 y=82「02」 → 23:02 八瀬比叡山口ゆき 2番線
 *
 * 左半分が平日、右半分が土曜・休日。x の範囲で振り分ける。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// ---- 収録する駅（URL は data/eizan-last-trains.json の sourceUrl と同じもの）

/** 駅名 → 公式ページ。di は方面別 PDF の番号 */
const STATIONS = {
  出町柳: { slug: "demachiyanagi", di: 2 },
  元田中: { slug: "mototanaka", di: 1 },
  "茶山・京都芸術大学": { slug: "chayama", di: 1 },
  一乗寺: { slug: "ichijoji", di: 1 },
  修学院: { slug: "syugakuin", di: 1 },
  宝ケ池: { slug: "takaragaike", di: 1 },
  三宅八幡: { slug: "miyake-hachiman", di: 3 },
  八瀬比叡山口: { slug: "yase-hieizanguchi", di: 5 },
  八幡前: { slug: "hachiman-mae", di: 4 },
  岩倉: { slug: "iwakura", di: 4 },
  木野: { slug: "kino", di: 4 },
  京都精華大前: { slug: "kyoto-seikadai-mae", di: 4 },
  二軒茶屋: { slug: "nikenchaya", di: 4 },
  市原: { slug: "ichihara", di: 4 },
  二ノ瀬: { slug: "ninose", di: 4 },
  貴船口: { slug: "kibuneguchi", di: 5 },
  鞍馬: { slug: "kurama", di: 5 },
};

const url = (st) => `https://eizandensha.co.jp/information/${st.slug}/?di=${st.di}`;

/** 時刻表の凡例（行先の 1 文字略号）。ページ内の「凡例 / Legend」に載っているもの */
const DEST = { 修: "修学院", 八: "八瀬比叡山口", 軒: "二軒茶屋", 市: "市原", 鞍: "鞍馬", 出: "出町柳", 池: "宝ケ池" };
const TRACK = { "①": 1, "②": 2, "③": 3, "④": 4 };

// ---- PDF を読む（必要な最小限）

function loadPdf(buf) {
  const s = buf.toString("latin1");
  const offsets = new Map();
  for (const m of s.matchAll(/(?:^|[\r\n>\s])(\d+) 0 obj\b/g)) offsets.set(+m[1], m.index + m[0].indexOf(m[1]));
  return { buf, s, offsets };
}

function getObj(pdf, n) {
  const i = pdf.offsets.get(n);
  if (i === undefined) return null;
  const body = pdf.s.slice(i, pdf.s.indexOf("endobj", i));
  const sIdx = body.indexOf("stream");
  const dict = sIdx >= 0 ? body.slice(0, sIdx) : body;
  let stream = null;
  if (sIdx >= 0) {
    let start = i + sIdx + 6;
    if (pdf.s[start] === "\r") start++;
    if (pdf.s[start] === "\n") start++;
    const len = dict.match(/\/Length\s+(\d+)/);
    const raw = len ? pdf.buf.subarray(start, start + +len[1]) : pdf.buf.subarray(start, pdf.s.indexOf("endstream", start));
    stream = /\/FlateDecode/.test(dict) ? zlib.inflateSync(raw) : raw;
  }
  return { dict, stream };
}

/** ToUnicode CMap → Map<コード, 文字列> */
function parseToUnicode(text) {
  const map = new Map();
  const hex = (h) => {
    let out = "";
    for (let i = 0; i < h.length; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    return out;
  };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) map.set(parseInt(m[1], 16), hex(m[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16), dst = parseInt(m[3], 16);
      for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(dst + (c - lo)));
    }
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
      const lo = parseInt(m[1], 16);
      [...m[3].matchAll(/<([0-9A-Fa-f]*)>/g)].forEach((x, k) => map.set(lo + k, hex(x[1])));
    }
  }
  return map;
}

function buildFonts(pdf, pageDict) {
  const fonts = new Map();
  const fm = pageDict.match(/\/Font\s*<<([\s\S]*?)>>/);
  if (!fm) return fonts;
  for (const m of fm[1].matchAll(/\/(\w+)\s+(\d+) 0 R/g)) {
    const fo = getObj(pdf, +m[2]);
    if (!fo) continue;
    const tu = fo.dict.match(/\/ToUnicode\s+(\d+) 0 R/);
    const to = tu ? getObj(pdf, +tu[1]) : null;
    fonts.set(m[1], {
      cmap: to?.stream ? parseToUnicode(to.stream.toString("latin1")) : null,
      bytes: /\/Identity-H/.test(fo.dict) ? 2 : 1, // Identity-H は 2 バイト 1 文字
    });
  }
  return fonts;
}

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

/** content stream → [{ x, y, text }]。文字送りは概算（列の判定には効かない粒度） */
function extractText(content, fonts) {
  const toks = [];
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === "(") {
      let depth = 1, j = i + 1, s = "";
      while (j < content.length && depth > 0) {
        if (content[j] === "\\") { s += content[j] + content[j + 1]; j += 2; continue; }
        if (content[j] === "(") depth++;
        else if (content[j] === ")" && --depth === 0) break;
        s += content[j++];
      }
      toks.push({ t: "str", v: s });
      i = j;
    } else if (c === "<" && content[i + 1] !== "<") {
      const j = content.indexOf(">", i);
      toks.push({ t: "hex", v: content.slice(i + 1, j) });
      i = j;
    } else if (c === "[" || c === "]") toks.push({ t: c });
    else if (c === "<" || c === ">") continue; // << >> は読み飛ばす
    else if (/\s/.test(c)) continue;
    else {
      let j = i;
      while (j < content.length && !/[\s()<>[\]]/.test(content[j])) j++;
      if (j === i) continue;
      const w = content.slice(i, j);
      i = j - 1;
      if (/^[-+.\d]+$/.test(w)) toks.push({ t: "num", v: parseFloat(w) });
      else if (w[0] === "/") toks.push({ t: "name", v: w.slice(1) }); // /F1 は演算子ではなく引数
      else toks.push({ t: "op", v: w });
    }
  }

  const out = [];
  let tm = null, tlm = null, ctm = [1, 0, 0, 1, 0, 0], leading = 0, font = null, size = 0;
  const stack = [];
  const decode = (raw, isHex) => {
    let codes = [];
    if (isHex) {
      const h = raw.replace(/\s/g, "");
      const step = (font?.bytes ?? 1) * 2;
      for (let i = 0; i < h.length; i += step) codes.push(parseInt(h.slice(i, i + step).padEnd(step, "0"), 16));
    } else {
      const bytes = [];
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] !== "\\") { bytes.push(raw.charCodeAt(i)); continue; }
        const oct = raw.slice(i + 1).match(/^[0-7]{1,3}/);
        if (oct) { bytes.push(parseInt(oct[0], 8)); i += oct[0].length; continue; }
        bytes.push({ n: 10, r: 13, t: 9, b: 8, f: 12 }[raw[i + 1]] ?? raw.charCodeAt(i + 1));
        i++;
      }
      if ((font?.bytes ?? 1) === 2) for (let i = 0; i < bytes.length; i += 2) codes.push((bytes[i] << 8) | (bytes[i + 1] ?? 0));
      else codes = bytes;
    }
    return codes.map((c) => font?.cmap?.get(c) ?? (font?.bytes === 2 ? "" : String.fromCharCode(c))).join("");
  };
  const show = (text) => {
    if (!text || !tm) return;
    const m = mul(tm, ctm);
    out.push({ x: +m[4].toFixed(2), y: +m[5].toFixed(2), text });
    tm = mul([1, 0, 0, 1, text.length * size * 0.6, 0], tm);
  };

  let args = [];
  for (const tk of toks) {
    if (tk.t !== "op") { args.push(tk); continue; }
    const op = tk.v;
    const nums = args.filter((a) => a.t === "num").map((a) => a.v);
    if (op === "q") stack.push([...ctm]);
    else if (op === "Q") ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (op === "cm") ctm = mul(nums.slice(0, 6), ctm);
    else if (op === "BT") { tm = [1, 0, 0, 1, 0, 0]; tlm = [...tm]; }
    else if (op === "ET") { tm = null; tlm = null; }
    else if (op === "Tf") { font = fonts.get(args.find((a) => a.t === "name")?.v ?? "") ?? font; size = nums[0] ?? size; }
    else if (op === "TL") leading = nums[0];
    else if (op === "Td") { tlm = mul([1, 0, 0, 1, nums[0], nums[1]], tlm); tm = [...tlm]; }
    else if (op === "TD") { leading = -nums[1]; tlm = mul([1, 0, 0, 1, nums[0], nums[1]], tlm); tm = [...tlm]; }
    else if (op === "Tm") { tlm = nums.slice(0, 6); tm = [...tlm]; }
    else if (op === "T*") { tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = [...tlm]; }
    else if (op === "Tj" || op === "'" || op === '"') {
      if (op !== "Tj") { tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = [...tlm]; }
      const a = args.filter((x) => x.t === "str" || x.t === "hex").pop();
      if (a) show(decode(a.v, a.t === "hex"));
    } else if (op === "TJ") {
      show(args.filter((a) => a.t === "str" || a.t === "hex").map((a) => decode(a.v, a.t === "hex")).join(""));
    }
    args = [];
  }
  return out;
}

// ---- 時刻表の組み立て

/** 左 = 平日、右 = 土曜・休日。hourX は「時」の列、cellX は時刻の列 */
const BLOCKS = [
  { dayType: "weekday", hourX: [20, 40], cellX: [45, 380] },
  { dayType: "weekend", hourX: [375, 395], cellX: [400, 740] },
];

function parseTimetable(buf) {
  const pdf = loadPdf(buf);
  const pageRef = pdf.s.match(/\/Kids\[\s*(\d+) 0 R/);
  const page = getObj(pdf, pageRef ? +pageRef[1] : 4);
  const fonts = buildFonts(pdf, page.dict);
  const contentRef = page.dict.match(/\/Contents\s+(\d+) 0 R/);
  const items = extractText(getObj(pdf, +contentRef[1]).stream.toString("latin1"), fonts).filter((i) => i.text.trim());

  const departures = [];
  for (const b of BLOCKS) {
    const hours = items
      .filter((i) => i.x >= b.hourX[0] && i.x <= b.hourX[1] && /^\d{1,2}$/.test(i.text.trim()))
      .map((i) => ({ hour: +i.text.trim(), y: i.y }));
    const cells = items.filter((i) => i.x >= b.cellX[0] && i.x <= b.cellX[1]);
    for (const h of hours) {
      const marks = cells.filter((i) => i.y > h.y + 3 && i.y < h.y + 15 && /^[修八軒市鞍出池][①-④]?$/.test(i.text.trim()));
      const mins = cells.filter((i) => i.y < h.y && i.y > h.y - 10 && /^\d{2}$/.test(i.text.trim()));
      for (const m of mins) {
        const mark = marks.find((k) => Math.abs(k.x - m.x) < 3)?.text.trim();
        if (!mark) throw new Error(`行先が読めない: ${b.dayType} ${h.hour}:${m.text}`);
        departures.push({ dayType: b.dayType, hour: h.hour, min: +m.text, dest: DEST[mark[0]], track: TRACK[mark[1]] ?? null });
      }
    }
  }
  departures.sort((a, b) => a.hour - b.hour || a.min - b.min);
  return {
    title: items.find((i) => i.text.includes("標準発車時刻表"))?.text.trim() ?? "",
    effectiveFrom: items.find((i) => /^\d{4}年\d{1,2}月\d{1,2}日/.test(i.text))?.text.replace(/\s+/g, "") ?? "",
    departures,
  };
}

/** "23:50"。0〜2 時台は 24 時台表記にする（このリポジトリの約束） */
const hhmm = (d) => `${String(d.hour < 3 ? d.hour + 24 : d.hour).padStart(2, "0")}:${String(d.min).padStart(2, "0")}`;

async function collect(name) {
  const st = STATIONS[name];
  if (!st) throw new Error(`知らない駅: ${name}`);
  const res = await fetch(url(st));
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 4).toString("latin1") !== "%PDF") throw new Error(`${name}: PDF が返ってこない`);
  const { title, effectiveFrom, departures } = parseTimetable(buf);

  const dests = [...new Set(departures.map((d) => d.dest))];
  const byDestination = dests.map((dest) => {
    const row = { name: dest };
    for (const dayType of ["weekday", "weekend"]) {
      const times = departures.filter((d) => d.dayType === dayType && d.dest === dest);
      // 末尾 2 本を「一本前, 終電」の順で入れる（1 日 1 本しか無い行き先は 1 要素）
      row[dayType] = times.slice(-2).map(hhmm);
      row[`${dayType}Track`] = times.at(-1)?.track ?? null;
    }
    return row;
  });
  const lastTwoDepartures = Object.fromEntries(
    ["weekday", "weekend"].map((dayType) => [dayType, departures.filter((d) => d.dayType === dayType).slice(-2).map(hhmm)]),
  );
  const count = Object.fromEntries(
    ["weekday", "weekend"].map((dayType) => [dayType, departures.filter((d) => d.dayType === dayType).length]),
  );
  return { name, direction: title.replace(/\s*標準発車時刻表\s*$/, ""), timetableEffectiveFrom: effectiveFrom, count, byDestination, lastTwoDepartures, sourceUrl: url(st) };
}

const names = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const targets = names.length > 0 ? names : ["出町柳"];
const stations = [];
for (const name of targets) {
  stations.push(await collect(name));
  console.log(`取得: ${name}`);
}

const today = new Date();
const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
const out = {
  dataset: "eizan-last-two",
  updatedAt: iso,
  source: {
    name: "叡山電鉄 標準発車時刻表（各駅ページの PDF）",
    url: "https://eizandensha.co.jp/guide/",
    retrievedAt: iso,
    note:
      "各駅ページが返す PDF から、行き先別の終電と終電一本前を取り出したもの。" +
      "weekday / weekend は [終電一本前, 終電] の順（1 日 1 本しか無い行き先は 1 要素）。" +
      "track は終電の発車番線（時刻表の凡例「行先 / 発車番線」の丸数字）。" +
      "lastTwoDepartures は行き先を問わないその駅の終発 2 本。",
  },
  stations,
};
const dest = path.join("data", "eizan-last-two.json");
fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
console.log(`書き出しました: ${dest}`);
