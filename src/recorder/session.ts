// 一程的划分、90 秒去重、写入一行、常用标签

import { effectiveTime } from '../data/db';
import {
  CONTEXT_SLUGS,
  CURRENT_SCHEMA_VERSION,
  type CheckpointEvent,
  type Direction,
  type PlaceSource,
  type SeatOutcome,
  type StoredRow,
} from '../data/types';
import { sessionEnded } from './next';

export const UI_VERSION = 'app-0.1';
export const DEDUPE_MS = 90_000;
export const SESSION_GAP_MS = 3 * 60 * 60_000; // 3 小时内的打卡算同一程
const TZ_OFFSET_MIN = 9 * 60; // 日本时间，无夏令时

function local(ms: number): Date {
  return new Date(ms + TZ_OFFSET_MIN * 60_000);
}
const pad = (n: number) => String(n).padStart(2, '0');

/** 早上 12 点前默认去程 */
export function defaultDirection(nowMs: number): Direction {
  return local(nowMs).getUTCHours() < 12 ? 'outbound' : 'inbound';
}

/** 沿用临时记录器的格式：YYYYMMDD-AM-HHMM（AM＝去程，PM＝回程） */
export function newSessionId(nowMs: number, direction: Direction): string {
  const d = local(nowMs);
  const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const hm = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  return `${ymd}-${direction === 'outbound' ? 'AM' : 'PM'}-${hm}`;
}

/** 按 sessionId 分组，每组按有效时刻排序 */
export function groupSessions(rows: CheckpointEvent[]): Map<string, CheckpointEvent[]> {
  const map = new Map<string, CheckpointEvent[]>();
  for (const r of rows) {
    const list = map.get(r.sessionId) ?? [];
    list.push(r);
    map.set(r.sessionId, list);
  }
  for (const list of map.values()) list.sort((a, b) => timeMs(a) - timeMs(b));
  return map;
}

function timeMs(e: CheckpointEvent): number {
  const t = effectiveTime(e);
  return t ? Date.parse(t) : Number.POSITIVE_INFINITY;
}

/**
 * 现在这一下该接在哪一程后面：同方向、没结束、最后一条在 3 小时内的那一程。
 * 没有就返回 null，由调用方开新的一程。
 */
export function currentSession(
  rows: CheckpointEvent[],
  direction: Direction,
  nowMs: number,
): { sessionId: string; events: CheckpointEvent[] } | null {
  let best: { sessionId: string; events: CheckpointEvent[]; lastMs: number } | null = null;
  for (const [sessionId, events] of groupSessions(rows)) {
    if (events[0]?.direction !== direction) continue;
    const tapped = events.map((e) => (e.tappedAt ? Date.parse(e.tappedAt) : NaN)).filter(Number.isFinite);
    const lastMs = Math.max(...tapped, ...events.map(timeMs).filter(Number.isFinite));
    if (!Number.isFinite(lastMs) || nowMs - lastMs > SESSION_GAP_MS) continue;
    if (sessionEnded(events, direction)) continue;
    if (!best || lastMs > best.lastMs) best = { sessionId, events, lastMs };
  }
  return best ? { sessionId: best.sessionId, events: best.events } : null;
}

/**
 * 最近按的一下就是同一事件、且在 90 秒内 → 视为重复（连按、手抖）。
 * 只看最近一下：中间隔了别的事件（上车→下车→换乘上车）就不是连按。
 */
export function isDuplicate(session: CheckpointEvent[], event: string, nowMs: number, seat?: SeatOutcome): boolean {
  let last: CheckpointEvent | undefined;
  for (const e of session) {
    if (e.tappedAt && (!last?.tappedAt || Date.parse(e.tappedAt) >= Date.parse(last.tappedAt))) last = e;
  }
  if (!last?.tappedAt || last.event !== event) return false;
  if (seat !== undefined && last.seat !== seat) return false;
  const dt = nowMs - Date.parse(last.tappedAt);
  return dt >= 0 && dt < DEDUPE_MS;
}

export type TapInput = {
  sessionId: string;
  direction: Direction;
  event: string;
  nowMs: number;
  place?: string;
  placeSource?: PlaceSource;
  seat?: SeatOutcome;
  transfer?: boolean;
  context?: string[];
  note?: string;
};

/** 按一下 → 一行 v3 原始记录 */
export function buildRow(input: TapInput): StoredRow {
  const tappedAt = new Date(input.nowMs).toISOString();
  const row: StoredRow = {
    id: `${input.sessionId}-${input.nowMs}`,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    observer: 'self',
    recordedBy: 'self',
    sessionId: input.sessionId,
    direction: input.direction,
    event: input.event,
    tappedAt,
    updatedAt: tappedAt,
    rev: 1,
    uiVersion: UI_VERSION,
  };
  if (input.place) row.place = input.place;
  if (input.place && input.placeSource) row.placeSource = input.placeSource;
  if (input.seat) row.seat = input.seat;
  if (input.transfer) row.transfer = true;
  if (input.context && input.context.length > 0) row.context = [...input.context];
  if (input.note) row.note = input.note;
  return row;
}

const DEFAULT_TAGS = Object.values(CONTEXT_SLUGS);

/** 按过去用过的次数排出常用标签，取前 n 个；用得少时用默认顺序补齐 */
export function topTags(rows: CheckpointEvent[], n = 5): string[] {
  const count = new Map<string, number>();
  for (const r of rows) for (const c of r.context ?? []) count.set(c, (count.get(c) ?? 0) + 1);
  const used = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  const rest = DEFAULT_TAGS.filter((t) => !used.includes(t));
  return [...used, ...rest].slice(0, n);
}

const LABEL_BY_SLUG = Object.fromEntries(Object.entries(CONTEXT_SLUGS).map(([label, slug]) => [slug, label]));

export function tagLabel(slug: string): string {
  return LABEL_BY_SLUG[slug] ?? slug;
}

/** 当地时刻 HH:MM:SS，给界面显示 */
export function localClock(iso: string | null): string {
  if (!iso) return '--:--';
  const d = local(Date.parse(iso));
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** 把界面上改的「HH:MM」或「HH:MM:SS」换成那一天的 ISO 时刻（以按键时刻所在的当地日期为准） */
export function localTimeToIso(hhmmss: string, sameDayAsIso: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hhmmss);
  if (!m) return null;
  const [h, min, sec] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 23 || min > 59 || sec > 59) return null;
  const base = local(Date.parse(sameDayAsIso));
  const midnightUtc =
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()) - TZ_OFFSET_MIN * 60_000;
  return new Date(midnightUtc + ((h * 60 + min) * 60 + sec) * 1000).toISOString();
}
