// 读时迁移（upcasting）：库里的原始行永远不改，读出来时一级一级升到当前版本。
// 规则见 docs/FIELDS.md「v2 → v3 读时映射」

import {
  CONTEXT_SLUGS,
  CURRENT_SCHEMA_VERSION,
  type CheckpointEvent,
  type Direction,
  type StoredRow,
  type TimePrecision,
} from './types';

export type MigrateOptions = {
  /** 备注里的「0743」按哪个时区理解。日本没有夏令时，固定 +09:00 */
  tzOffsetMinutes: number;
};

const DEFAULTS: MigrateOptions = { tzOffsetMinutes: 9 * 60 };

const BACKFILL_MARK = '事后补记';

/** 任意版本的原始行 → 当前版本的 CheckpointEvent */
export function upgrade(raw: StoredRow, options: Partial<MigrateOptions> = {}): CheckpointEvent {
  const opts = { ...DEFAULTS, ...options };
  let row: Record<string, unknown> = { ...raw };
  const version = Number(row.schemaVersion);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`无法识别的 schemaVersion：${String(row.schemaVersion)}（id=${raw.id}）`);
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`这一行来自更新的版本 v${version}，本程序只认到 v${CURRENT_SCHEMA_VERSION}`);
  }
  if (version < 2) row = v1ToV2(row);
  if (version < 3) row = v2ToV3(row, opts);
  // 迁移不改写 schemaVersion：它记的是这一行写入时的版本
  return row as CheckpointEvent;
}

/** v1 → v2：HOME_EXIT 改名为 DEPART */
export function v1ToV2(row: Record<string, unknown>): Record<string, unknown> {
  return row.event === 'HOME_EXIT' ? { ...row, event: 'DEPART' } : { ...row };
}

/** v2 → v3：observedAt 拆成 tappedAt／reportedAt，方向和标签换成英文值，补 updatedAt／rev */
export function v2ToV3(row: Record<string, unknown>, opts: MigrateOptions = DEFAULTS): Record<string, unknown> {
  const { observedAt, ...rest } = row;
  const observed = typeof observedAt === 'string' ? observedAt : null;
  const note = typeof row.note === 'string' ? row.note : '';
  const out: Record<string, unknown> = { ...rest };

  out.direction = toDirection(row.direction);
  if (Array.isArray(row.context)) {
    // 表外的标签原样保留，不丢数据
    out.context = row.context.map((c) => (typeof c === 'string' ? (CONTEXT_SLUGS[c] ?? c) : c));
  }

  // 已经有 v3 字段的（事后追加过的）以已有值为准，迁移只补空位
  const setIfAbsent = (key: string, value: unknown) => {
    if (out[key] === undefined && value !== undefined) out[key] = value;
  };

  if (note.startsWith(BACKFILL_MARK)) {
    // 事后补记的行：observedAt 存的是本人报的时刻，写入时刻在 id 尾部毫秒
    const writtenMs = idTailMs(String(row.id));
    const observedMs = observed ? Date.parse(observed) : NaN;
    const synthetic = writtenMs === null || writtenMs === observedMs;
    setIfAbsent('tappedAt', synthetic ? null : new Date(writtenMs).toISOString());
    setIfAbsent('reportedAt', observed ? toUtcIso(observed) : undefined);
    setIfAbsent('reportedPrecision', backfillPrecision(note));
    setIfAbsent('reportedSource', 'oral-report');
    setIfAbsent('recordedBy', synthetic ? null : note.includes('雨会代记') ? '雨会' : 'self');
  } else {
    setIfAbsent('tappedAt', observed ? toUtcIso(observed) : null);
    const fromNote = observed ? reportedFromNote(note, observed, opts.tzOffsetMinutes) : null;
    if (fromNote) {
      setIfAbsent('reportedAt', fromNote.at);
      setIfAbsent('reportedPrecision', fromNote.precision);
      setIfAbsent('reportedSource', 'note');
    }
    setIfAbsent('recordedBy', 'self');
  }

  setIfAbsent('updatedAt', (out.tappedAt as string | null) ?? (observed ? toUtcIso(observed) : undefined));
  setIfAbsent('rev', 1);
  return out;
}

function toDirection(value: unknown): Direction {
  if (value === 'AM' || value === 'outbound') return 'outbound';
  if (value === 'PM' || value === 'inbound') return 'inbound';
  throw new Error(`无法识别的 direction：${String(value)}`);
}

/** id 形如 `${sessionId}-${毫秒}`，取尾部毫秒；取不到返回 null */
function idTailMs(id: string): number | null {
  const tail = id.slice(id.lastIndexOf('-') + 1);
  return /^\d{10,}$/.test(tail) ? Number(tail) : null;
}

function backfillPrecision(note: string): TimePrecision | undefined {
  if (note.includes('分精度')) return 'exact';
  if (note.includes('时刻约')) return 'approx';
  return undefined; // FIELDS.md 没规定时不猜
}

/** 带时区的 ISO（如 +09:00）统一成 UTC 的 Z 形式，排序和比较才不会出错 */
function toUtcIso(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`无法解析的时刻：${iso}`);
  return new Date(ms).toISOString();
}

/** 自报时刻相对按键时刻的合理范围：最多早 90 分（事后才按），最多晚 5 分（先按后做） */
const WINDOW_BEFORE_MS = 90 * 60_000;
const WINDOW_AFTER_MS = 5 * 60_000;

/**
 * 从备注里找本人报的时刻。认这几种写法：
 * - 「0743」「743」「7:43」「18:41:48」，可带「左右」「大概」「约」
 * - 「—40s」「-40s」：实际比按键早 40 秒
 * 不认：两位数字、「11号车」、后面跟「的车／发」的车次时刻（如「1948的车」）。
 * 解析出的时刻离按键太远（早 90 分以上、晚 5 分以上）就当作不是自报时刻。
 * 日期取按键时刻在当地时区的那一天。
 */
export function reportedFromNote(
  note: string,
  tappedAtIso: string,
  tzOffsetMinutes: number,
): { at: string; precision: TimePrecision } | null {
  const tapped = Date.parse(tappedAtIso);
  if (Number.isNaN(tapped)) return null;

  const offsetMatch = /(?:^|\s)[—–-](\d{1,4})s(?![a-z])/.exec(note);
  if (offsetMatch) {
    const at = tapped - Number(offsetMatch[1]) * 1000;
    return { at: new Date(at).toISOString(), precision: 'exact' };
  }

  const re = /(?<![\d:])(\d{1,2}):?(\d{2})(?::(\d{2}))?(?![\d:号])(?!\s*(?:的车|的電車|发|発))/g;
  for (const m of note.matchAll(re)) {
    const hasColon = m[0].includes(':');
    if (!hasColon && m[0].length < 3) continue;
    const h = Number(m[1]);
    const min = Number(m[2]);
    const sec = m[3] === undefined ? 0 : Number(m[3]);
    if (h > 23 || min > 59 || sec > 59) continue;

    const offsetMs = tzOffsetMinutes * 60_000;
    const local = new Date(tapped + offsetMs);
    const localMidnightUtc =
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMs;
    const at = localMidnightUtc + ((h * 60 + min) * 60 + sec) * 1000;
    if (at < tapped - WINDOW_BEFORE_MS || at > tapped + WINDOW_AFTER_MS) continue;

    const approx = /左右|大概|约/.test(note);
    return { at: new Date(at).toISOString(), precision: approx ? 'approx' : 'exact' };
  }
  return null;
}
