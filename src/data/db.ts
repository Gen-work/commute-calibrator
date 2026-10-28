// IndexedDB 封装。原则：原始行只追加；事后的更正只写进追加字段，并升 rev

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { upgrade, type MigrateOptions } from './migrate';
import {
  ANNOTATION_FIELDS,
  type Annotation,
  type CheckpointEvent,
  type StoredRow,
} from './types';

const DB_NAME = 'commute-calibrator';
const DB_VERSION = 1; // IndexedDB 自己的结构版本，和记录的 schemaVersion 无关

interface CalibratorDB extends DBSchema {
  events: {
    key: string;
    value: StoredRow;
    indexes: { bySession: string };
  };
}

export type EventStore = {
  /** 追加一行。同 id 已存在时报错，不覆盖 */
  add(row: StoredRow): Promise<void>;
  /** 读一行，升级到当前版本 */
  get(id: string): Promise<CheckpointEvent | undefined>;
  /** 读全部，升级到当前版本，按有效时刻排序 */
  all(): Promise<CheckpointEvent[]>;
  /** 读一程 */
  session(sessionId: string): Promise<CheckpointEvent[]>;
  /** 事后追加字段（自报时刻、运行状况更正等）。原值字段改不了 */
  annotate(id: string, patch: Annotation, now: string): Promise<CheckpointEvent>;
  /** 原样读出库里的行（导出、调试用） */
  raw(): Promise<StoredRow[]>;
  close(): void;
};

export async function openEventStore(
  name: string = DB_NAME,
  migrate: Partial<MigrateOptions> = {},
): Promise<EventStore> {
  const db: IDBPDatabase<CalibratorDB> = await openDB<CalibratorDB>(name, DB_VERSION, {
    upgrade(database) {
      const store = database.createObjectStore('events', { keyPath: 'id' });
      store.createIndex('bySession', 'sessionId');
    },
  });

  const up = (row: StoredRow) => upgrade(row, migrate);

  return {
    async add(row) {
      if (typeof row.id !== 'string' || row.id === '') throw new Error('记录缺少 id');
      // add（不是 put）：同 id 已存在时 IndexedDB 会拒绝，正好保证只追加
      await db.add('events', row);
    },

    async get(id) {
      const row = await db.get('events', id);
      return row ? up(row) : undefined;
    },

    async all() {
      const rows = await db.getAll('events');
      return rows.map(up).sort(byEffectiveTime);
    },

    async session(sessionId) {
      const rows = await db.getAllFromIndex('events', 'bySession', sessionId);
      return rows.map(up).sort(byEffectiveTime);
    },

    async annotate(id, patch, now) {
      const illegal = Object.keys(patch).filter(
        (k) => !(ANNOTATION_FIELDS as readonly string[]).includes(k),
      );
      if (illegal.length > 0) {
        throw new Error(`这些字段是原值，不能事后改：${illegal.join('、')}`);
      }
      const tx = db.transaction('events', 'readwrite');
      const stored = await tx.store.get(id);
      if (!stored) throw new Error(`找不到这一行：${id}`);
      const current = up(stored);
      const next: StoredRow = { ...stored, ...patch, updatedAt: now, rev: current.rev + 1 };
      await tx.store.put(next);
      await tx.done;
      return up(next);
    },

    async raw() {
      return db.getAll('events');
    },

    close() {
      db.close();
    },
  };
}

/** 有效时刻：拟合（置信度够时，阈值未定，先不用）＞ 自报 ＞ 按键 */
export function effectiveTime(e: CheckpointEvent): string | null {
  return e.reportedAt ?? e.tappedAt;
}

/** 按时刻值比较，不按字符串：时区写法不同的字符串顺序不可靠。时刻未知的排最后 */
function byEffectiveTime(a: CheckpointEvent, b: CheckpointEvent): number {
  const ta = effectiveTime(a);
  const tb = effectiveTime(b);
  return (ta ? Date.parse(ta) : Infinity) - (tb ? Date.parse(tb) : Infinity);
}
