// 导入临时记录器的旧记录。原样存进库（只追加），读出时由 migrate.ts 升级。
// 认两种输入：Drive 上的 raw JSON（{meta, events} 或数组），以及「复制全部记录」的 TSV。

import { upgrade } from '../data/migrate';
import { CONTEXT_SLUGS, type StoredRow } from '../data/types';

/** 临时记录器 v2 的 TSV 列顺序（没有表头时按这个读） */
export const V2_COLUMNS = [
  'schemaVersion',
  'observer',
  'observedAt',
  'sessionId',
  'direction',
  'event',
  'place',
  'car',
  'context',
  'serviceStatus',
  'note',
] as const;

const NUMBER_FIELDS = new Set(['schemaVersion', 'rev', 'reportedOffsetSec', 'confidence']);
const BOOLEAN_FIELDS = new Set(['transfer', 'placeGuessed']);
const LIST_FIELDS = new Set(['context', 'contextAdded']);

export type ImportProblem = { where: string; reason: string };
export type Parsed = { rows: StoredRow[]; problems: ImportProblem[] };

/** 文本 → 原始行。读不了的行记进 problems，不中断其余行 */
export function parseImport(text: string): Parsed {
  const trimmed = text.replace(/^﻿/, '').trim();
  if (trimmed === '') return { rows: [], problems: [{ where: '整体', reason: '是空的' }] };
  return trimmed.startsWith('{') || trimmed.startsWith('[') ? parseJson(trimmed) : parseTsv(trimmed);
}

function parseJson(text: string): Parsed {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { rows: [], problems: [{ where: '整体', reason: `不是有效的 JSON：${(e as Error).message}` }] };
  }
  const list = Array.isArray(data) ? data : (data as { events?: unknown })?.events;
  if (!Array.isArray(list)) {
    return { rows: [], problems: [{ where: '整体', reason: '找不到记录列表（应是数组，或带 events 的对象）' }] };
  }
  return collect(list.map((item, i) => [`第 ${i + 1} 条`, item] as const));
}

function parseTsv(text: string): Parsed {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const first = lines[0]?.split('\t').map((c) => c.trim()) ?? [];
  if (first.includes('effectiveAt')) {
    // 本 app 导出的 TSV 是升级后、给表格看的，少了 schemaVersion 等原值，不能当备份导回
    return { rows: [], problems: [{ where: '整体', reason: '这是本 app 导出的 TSV（给表格看的）。要恢复数据，请导入 JSON' }] };
  }
  const hasHeader = first.includes('event') && (first.includes('observedAt') || first.includes('tappedAt'));
  const columns: readonly string[] = hasHeader ? first : V2_COLUMNS;
  const body = hasHeader ? lines.slice(1) : lines;
  const offset = hasHeader ? 2 : 1;
  return collect(
    body.map((line, i) => {
      const cells = line.split('\t');
      const row: Record<string, unknown> = {};
      columns.forEach((name, j) => {
        const value = cell(name, cells[j]);
        if (value !== undefined) row[name] = value;
      });
      return [`第 ${i + offset} 行`, row] as const;
    }),
  );
}

/** 一格文字 → 字段值。空格子不写，免得把「没有」变成「空字符串」 */
function cell(name: string, raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  let v = raw.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/""/g, '"');
  if (v === '') return undefined;
  if (NUMBER_FIELDS.has(name)) return Number.isFinite(Number(v)) ? Number(v) : v;
  if (BOOLEAN_FIELDS.has(name)) return v === 'true' || v === '1';
  if (LIST_FIELDS.has(name)) return v.split(/[、,，;；|]/).map((t) => t.trim()).filter(Boolean);
  return v;
}

function collect(items: (readonly [string, unknown])[]): Parsed {
  const rows: StoredRow[] = [];
  const problems: ImportProblem[] = [];
  for (const [where, item] of items) {
    const result = toRow(item);
    if (typeof result === 'string') problems.push({ where, reason: result });
    else rows.push(result);
  }
  return { rows, problems };
}

/** 检查一行能不能用；能用就补 id、返回原样的行，不能用返回原因 */
function toRow(item: unknown): StoredRow | string {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return '不是一条记录';
  const row = { ...(item as Record<string, unknown>) };
  if (typeof row.schemaVersion === 'string') row.schemaVersion = Number(row.schemaVersion);
  if (typeof row.sessionId !== 'string' || row.sessionId === '') return '缺 sessionId';
  if (typeof row.event !== 'string' || row.event === '') return '缺 event';
  if (typeof row.id !== 'string' || row.id === '') {
    // 和记录器的 id 规则一致：sessionId-按键毫秒。这样同一行从 TSV 和 JSON 各导一次也认得出是同一行
    const at = typeof row.observedAt === 'string' ? row.observedAt : row.tappedAt;
    const ms = typeof at === 'string' ? Date.parse(at) : NaN;
    if (Number.isNaN(ms)) return '缺 id，也没有能用来生成 id 的时刻';
    row.id = `${row.sessionId}-${ms}`;
  }
  const stored = row as StoredRow;
  try {
    upgrade(stored);
  } catch (e) {
    return (e as Error).message;
  }
  return stored;
}

export type ImportPlan = {
  /** 库里没有、要追加的行 */
  add: StoredRow[];
  /** 库里已有、内容一样的行数 */
  same: number;
  /** 库里已有、但内容不同的行：保留库里的，列出不同的字段给本人看 */
  differ: { id: string; fields: string[] }[];
  /** 这次导入里出现、但不在标签表里的标签及次数 */
  unknownTags: [string, number][];
};

/** 和库里已有的行比对。同一个 id 只认第一次出现的 */
export function planImport(incoming: StoredRow[], existing: StoredRow[]): ImportPlan {
  const byId = new Map(existing.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const plan: ImportPlan = { add: [], same: 0, differ: [], unknownTags: [] };
  const known = new Set(Object.values(CONTEXT_SLUGS));
  const unknown = new Map<string, number>();

  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const old = byId.get(row.id);
    if (!old) {
      plan.add.push(row);
      for (const tag of upgrade(row).context ?? []) {
        if (!known.has(tag)) unknown.set(tag, (unknown.get(tag) ?? 0) + 1);
      }
      continue;
    }
    const fields = differingFields(old, row);
    if (fields.length === 0) plan.same += 1;
    else plan.differ.push({ id: row.id, fields });
  }
  plan.unknownTags = [...unknown.entries()].sort((a, b) => b[1] - a[1]);
  return plan;
}

/**
 * 导入的行里有值、但和库里不一样的字段。
 * 只在库里有的字段（在 app 里事后追加的更正、rev 等）不算不同。
 */
function differingFields(stored: Record<string, unknown>, incoming: Record<string, unknown>): string[] {
  return Object.keys(incoming)
    .filter((k) => JSON.stringify(stored[k]) !== JSON.stringify(incoming[k]))
    .sort();
}
