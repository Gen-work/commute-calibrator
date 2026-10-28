import { describe, expect, it } from 'vitest';
import { upgrade } from '../data/migrate';
import type { CheckpointEvent } from '../data/types';
import { toJson, toTsv } from './export';
import { nextOptions, sessionEnded } from './next';
import {
  buildRow,
  currentSession,
  defaultDirection,
  isDuplicate,
  localClock,
  localTimeToIso,
  newSessionId,
  topTags,
} from './session';

// 假日期：2000-01-01。当地 07:20 ＝ UTC 前一天 22:20
const T0 = Date.parse('1999-12-31T22:20:00.000Z');
const min = 60_000;

function tap(event: string, atMs: number, extra: Partial<Parameters<typeof buildRow>[0]> = {}): CheckpointEvent {
  return upgrade(buildRow({ sessionId: 'S', direction: 'outbound', event, nowMs: atMs, ...extra }));
}

describe('nextOptions：按刚发生了什么给下一步', () => {
  const opts = (events: CheckpointEvent[], dir: 'outbound' | 'inbound' = 'outbound') =>
    nextOptions(events, dir).map((o) => o.label);

  it('一条都没有 → 出门／离开公司', () => {
    expect(opts([])).toEqual(['出门']);
    expect(opts([], 'inbound')).toEqual(['离开公司']);
  });

  it('上车之后：坐到了／没座／下车', () => {
    expect(opts([tap('BOARD', T0)])).toEqual(['坐到了', '没座', '下车']);
  });

  it('没座之后还能中途坐下', () => {
    expect(opts([tap('BOARD', T0), tap('SEATED', T0 + min, { seat: 'none' })])).toEqual(['下车', '中途坐下']);
  });

  it('下车之后：出改札／换乘上车，都和上一条同站', () => {
    const o = nextOptions([tap('ALIGHT', T0)], 'outbound');
    expect(o.map((x) => x.label)).toEqual(['出改札', '换乘上车']);
    expect(o.every((x) => x.samePlace)).toBe(true);
    expect(o[1]?.transfer).toBe(true);
  });

  it('去程到公司之后要签到，签到后结束；回程到家就结束', () => {
    expect(opts([tap('ARRIVE', T0)])).toEqual(['签到']);
    expect(sessionEnded([tap('CHECK_IN', T0)], 'outbound')).toBe(true);
    expect(sessionEnded([tap('ARRIVE', T0)], 'inbound')).toBe(true);
  });

  it('自定义节点之后，按它前面的核心事件继续', () => {
    expect(opts([tap('GATE_IN', T0), tap('buy-water', T0 + min)])).toEqual(['到站台', '上车']);
  });
});

describe('一程的划分', () => {
  it('sessionId 用当地时间：YYYYMMDD-AM-HHMM', () => {
    expect(newSessionId(T0, 'outbound')).toBe('20000101-AM-0720');
    expect(newSessionId(T0, 'inbound')).toBe('20000101-PM-0720');
  });

  it('当地中午前默认去程', () => {
    expect(defaultDirection(T0)).toBe('outbound');
    expect(defaultDirection(T0 + 11 * 60 * min)).toBe('inbound');
  });

  it('3 小时内、没结束的同方向那一程继续用', () => {
    const rows = [tap('DEPART', T0), tap('GATE_IN', T0 + 7 * min)];
    expect(currentSession(rows, 'outbound', T0 + 30 * min)?.sessionId).toBe('S');
  });

  it('超过 3 小时就开新的一程', () => {
    expect(currentSession([tap('DEPART', T0)], 'outbound', T0 + 181 * min)).toBeNull();
  });

  it('已经签到结束的一程不再接', () => {
    expect(currentSession([tap('ARRIVE', T0), tap('CHECK_IN', T0 + min)], 'outbound', T0 + 5 * min)).toBeNull();
  });

  it('方向不同的不接', () => {
    expect(currentSession([tap('DEPART', T0)], 'inbound', T0 + min)).toBeNull();
  });
});

describe('90 秒去重', () => {
  const session = [tap('BOARD', T0)];

  it('89 秒内同一事件算重复', () => {
    expect(isDuplicate(session, 'BOARD', T0 + 89_000)).toBe(true);
  });

  it('91 秒后不算', () => {
    expect(isDuplicate(session, 'BOARD', T0 + 91_000)).toBe(false);
  });

  it('不同事件不算', () => {
    expect(isDuplicate(session, 'ALIGHT', T0 + 10_000)).toBe(false);
  });

  it('上车→下车→换乘上车，90 秒内也不算重复（中间隔了别的事件）', () => {
    const s = [tap('BOARD', T0), tap('ALIGHT', T0 + 30_000)];
    expect(isDuplicate(s, 'BOARD', T0 + 60_000)).toBe(false);
  });

  it('只看按键时刻：改过时刻的行不影响连按判断', () => {
    const s = [tap('BOARD', T0)];
    const edited = { ...s[0]!, reportedAt: '1999-12-31T22:00:00.000Z' };
    expect(isDuplicate([edited], 'BOARD', T0 + 10_000)).toBe(true);
  });

  it('「没座」之后马上「中途坐下」不算重复', () => {
    const s = [tap('SEATED', T0, { seat: 'none' })];
    expect(isDuplicate(s, 'SEATED', T0 + 30_000, 'seated')).toBe(false);
    expect(isDuplicate(s, 'SEATED', T0 + 30_000, 'none')).toBe(true);
  });
});

describe('写入的一行', () => {
  it('是 v3，原值齐全', () => {
    const row = buildRow({
      sessionId: 'S',
      direction: 'outbound',
      event: 'BOARD',
      nowMs: T0,
      place: 'H',
      placeSource: 'same-as-prev',
      context: ['accompanied'],
    });
    expect(row).toMatchObject({
      id: `S-${T0}`,
      schemaVersion: 3,
      observer: 'self',
      recordedBy: 'self',
      tappedAt: '1999-12-31T22:20:00.000Z',
      rev: 1,
      place: 'H',
      placeSource: 'same-as-prev',
      context: ['accompanied'],
    });
  });

  it('没填的字段不写', () => {
    const row = buildRow({ sessionId: 'S', direction: 'outbound', event: 'DEPART', nowMs: T0 });
    expect('place' in row || 'context' in row || 'seat' in row).toBe(false);
  });
});

describe('常用标签', () => {
  it('按用过的次数排，不够 5 个用默认补齐', () => {
    const rows = [
      tap('BOARD', T0, { context: ['missed-full-train'] }),
      tap('BOARD', T0 + min, { context: ['missed-full-train', 'accompanied'] }),
    ];
    const tags = topTags(rows);
    expect(tags.slice(0, 2)).toEqual(['missed-full-train', 'accompanied']);
    expect(tags).toHaveLength(5);
  });
});

describe('时刻显示与修改', () => {
  it('显示当地 HH:MM:SS', () => {
    expect(localClock('1999-12-31T22:20:05.000Z')).toBe('07:20:05');
  });

  it('改成 07:18 → 同一个当地日的 ISO', () => {
    expect(localTimeToIso('07:18', '1999-12-31T22:20:05.000Z')).toBe('1999-12-31T22:18:00.000Z');
  });

  it('格式不对返回 null', () => {
    expect(localTimeToIso('7点18', '1999-12-31T22:20:05.000Z')).toBeNull();
  });
});

describe('导出', () => {
  it('TSV：表头一行，备注里的换行变空格，0743 原样保留', () => {
    const row = upgrade({ ...buildRow({ sessionId: 'S', direction: 'outbound', event: 'BOARD', nowMs: T0 }), note: '0743\n上车' });
    const tsv = toTsv([row]);
    const [header, line] = tsv.trim().split('\n');
    expect(header?.split('\t')[0]).toBe('id');
    expect(line).toContain('0743 上车');
  });

  it('JSON 是原样，带导出时刻', () => {
    const raw = buildRow({ sessionId: 'S', direction: 'outbound', event: 'BOARD', nowMs: T0 });
    const parsed = JSON.parse(toJson([raw], '2000-01-01T00:00:00.000Z'));
    expect(parsed.events[0]).toEqual(raw);
    expect(parsed.meta.rows).toBe(1);
  });
});
