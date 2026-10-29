// 导出：JSON 是库里的原样（不丢任何字段），TSV 是升级后给人看、给表格用的

import { effectiveTime } from '../data/db';
import type { CheckpointEvent, StoredRow } from '../data/types';

export function toJson(raw: StoredRow[], exportedAt: string): string {
  return JSON.stringify({ meta: { exportedAt, rows: raw.length }, events: raw }, null, 2);
}

const COLUMNS: { name: string; get: (e: CheckpointEvent) => unknown }[] = [
  { name: 'id', get: (e) => e.id },
  { name: 'sessionId', get: (e) => e.sessionId },
  { name: 'direction', get: (e) => e.direction },
  { name: 'event', get: (e) => e.event },
  { name: 'effectiveAt', get: (e) => effectiveTime(e) },
  { name: 'tappedAt', get: (e) => e.tappedAt },
  { name: 'reportedAt', get: (e) => e.reportedAt },
  { name: 'reportedPrecision', get: (e) => e.reportedPrecision },
  { name: 'reportedSource', get: (e) => e.reportedSource },
  { name: 'place', get: (e) => e.place },
  { name: 'placeSource', get: (e) => e.placeSource },
  { name: 'car', get: (e) => e.car },
  { name: 'seat', get: (e) => e.seat },
  { name: 'transfer', get: (e) => e.transfer },
  { name: 'context', get: (e) => e.context?.join(',') },
  { name: 'contextAdded', get: (e) => e.contextAdded?.join(',') },
  { name: 'serviceStatus', get: (e) => e.serviceStatus },
  { name: 'serviceStatusCorrected', get: (e) => e.serviceStatusCorrected },
  { name: 'observer', get: (e) => e.observer },
  { name: 'recordedBy', get: (e) => e.recordedBy },
  { name: 'note', get: (e) => e.note },
];

/** 制表符和换行换成空格，免得把一行拆成几行；数字一律当文字，不会被表格软件吃掉前导 0 */
function cell(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\t\r\n]+/g, ' ');
}

export function toTsv(events: CheckpointEvent[]): string {
  const header = COLUMNS.map((c) => c.name).join('\t');
  const lines = events.map((e) => COLUMNS.map((c) => cell(c.get(e))).join('\t'));
  return [header, ...lines].join('\n') + '\n';
}
