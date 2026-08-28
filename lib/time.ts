/** "24:05" → 1445。24 時台は分に直して比較する。文字列比較は禁止 */
export function toMin(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** 1445 → "00:05"。表示用 */
export function toStr(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = ((min % 60) + 60) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function isHHMM(value: string | null): value is string {
  return !!value && /^\d{1,2}:\d{2}$/.test(value);
}
