// 时刻工具：引擎内部一律用「当天 0 点起的分钟数」计算，进出时转成 "HH:MM"

const HHMM = /^(\d{1,2}):(\d{2})$/;

/** "07:37" → 457。格式不对或超出 0:00〜23:59 时抛错，不悄悄给错值 */
export function toMinutes(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  if (!m) throw new Error(`时刻格式应为 HH:MM：${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`时刻超出范围：${hhmm}`);
  return h * 60 + min;
}

/** 457 → "07:37"。小数按四舍五入到分钟 */
export function fromMinutes(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 0 || total >= 24 * 60) throw new Error(`分钟数超出一天：${minutes}`);
  const h = Math.floor(total / 60);
  const min = total % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** 时刻加上分钟数，如 addMinutes("08:17", 5) → "08:22" */
export function addMinutes(hhmm: string, delta: number): string {
  return fromMinutes(toMinutes(hhmm) + delta);
}
