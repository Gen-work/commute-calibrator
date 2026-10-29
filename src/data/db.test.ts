import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openEventStore, type EventStore } from './db';
import type { StoredRow } from './types';

const SESSION = '20000101-AM-0732';
let store: EventStore;
let dbCount = 0;

beforeEach(async () => {
  // 每个测试用一个新库，互不影响
  store = await openEventStore(`test-${++dbCount}`);
});

afterEach(() => store.close());

function v2Row(event: string, observedAt: string, extra: Record<string, unknown> = {}): StoredRow {
  return {
    id: `${SESSION}-${Date.parse(observedAt)}`,
    schemaVersion: 2,
    observer: 'self',
    sessionId: SESSION,
    direction: 'AM',
    event,
    observedAt,
    ...extra,
  };
}

describe('追加', () => {
  it('写进去的行读出来已升级到 v3', async () => {
    await store.add(v2Row('DEPART', '2000-01-01T22:05:00.000Z'));
    const [row] = await store.all();
    expect(row?.tappedAt).toBe('2000-01-01T22:05:00.000Z');
    expect(row?.direction).toBe('outbound');
  });

  it('同 id 再写一次会被拒绝，原行不变', async () => {
    const row = v2Row('DEPART', '2000-01-01T22:05:00.000Z');
    await store.add(row);
    await expect(store.add({ ...row, event: 'BOARD' })).rejects.toThrow();
    expect((await store.get(row.id))?.event).toBe('DEPART');
  });

  it('库里存的是原样，不是升级后的', async () => {
    await store.add(v2Row('DEPART', '2000-01-01T22:05:00.000Z'));
    const [raw] = await store.raw();
    expect(raw?.schemaVersion).toBe(2);
    expect(raw?.observedAt).toBe('2000-01-01T22:05:00.000Z');
    expect(raw?.direction).toBe('AM');
  });
});

describe('读取顺序', () => {
  it('按有效时刻排：自报时刻优先于按键时刻', async () => {
    // 「坐下」7:56 才按，但备注说 7:44 就坐下了；排在 7:50 的事件前面
    await store.add(v2Row('PLATFORM', '2000-01-01T22:50:00.000Z'));
    await store.add(v2Row('SEATED', '2000-01-01T22:56:00.000Z', { note: '0744' }));
    const rows = await store.session(SESSION);
    expect(rows.map((r) => r.event)).toEqual(['SEATED', 'PLATFORM']);
  });
});

describe('事后追加', () => {
  const id = `${SESSION}-${Date.parse('2000-01-01T22:56:00.000Z')}`;

  beforeEach(async () => {
    await store.add(v2Row('SEATED', '2000-01-01T22:56:00.000Z', { serviceStatus: 'normal' }));
  });

  it('可以追加自报时刻，rev 加一、updatedAt 更新', async () => {
    const now = '2000-01-01T23:30:00.000Z';
    const row = await store.annotate(
      id,
      { reportedAt: '2000-01-01T22:51:00.000Z', reportedPrecision: 'approx', reportedSource: 'tap-adjust' },
      now,
    );
    expect(row.reportedAt).toBe('2000-01-01T22:51:00.000Z');
    expect(row.rev).toBe(2);
    expect(row.updatedAt).toBe(now);
    expect(row.tappedAt).toBe('2000-01-01T22:56:00.000Z'); // 按键时刻没被动
  });

  it('运行状况更正写进 serviceStatusCorrected，原值不变', async () => {
    const row = await store.annotate(
      id,
      {
        serviceStatusCorrected: 'disrupted',
        correctionSource: 'self-report',
        correctedBy: 'self',
        correctedAt: '2000-01-01T23:30:00.000Z',
      },
      '2000-01-01T23:30:00.000Z',
    );
    expect(row.serviceStatus).toBe('normal');
    expect(row.serviceStatusCorrected).toBe('disrupted');
  });

  it('按完补的标签写进 contextAdded；context 是原值，改不了', async () => {
    const row = await store.annotate(id, { contextAdded: ['accompanied'] }, '2000-01-01T23:30:00.000Z');
    expect(row.contextAdded).toEqual(['accompanied']);
    await expect(
      store.annotate(id, { context: ['alone'] } as never, '2000-01-01T23:30:00.000Z'),
    ).rejects.toThrow(/原值/);
  });

  it('想改原值字段会被拒绝，什么都不写', async () => {
    await expect(
      store.annotate(id, { event: 'BOARD' } as never, '2000-01-01T23:30:00.000Z'),
    ).rejects.toThrow(/原值/);
    const row = await store.get(id);
    expect(row?.event).toBe('SEATED');
    expect(row?.rev).toBe(1);
  });

  it('找不到的行报错', async () => {
    await expect(store.annotate('nope', { reportedAt: 'x' }, 'y')).rejects.toThrow();
  });
});

describe('时区写法不同的行', () => {
  it('+09:00 和 Z 混在一起也按真实时刻排序', async () => {
    // 07:41（+09:00 写法）比 22:40Z（＝当地 07:40）晚一分钟
    await store.add({ ...v2Row('BOARD', '2000-01-02T07:41:00+09:00'), id: `${SESSION}-b` });
    await store.add({ ...v2Row('GATE_IN', '2000-01-01T22:40:00.000Z'), id: `${SESSION}-a` });
    const rows = await store.session(SESSION);
    expect(rows.map((r) => r.event)).toEqual(['GATE_IN', 'BOARD']);
  });
});

