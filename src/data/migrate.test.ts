import { describe, expect, it } from 'vitest';
import { reportedFromNote, upgrade } from './migrate';
import type { StoredRow } from './types';

// 测试数据全部是假的：日期用 2000-01-01，站名用代号
const SESSION = '20000101-AM-0732';
const ms = (iso: string) => Date.parse(iso);

function v2(overrides: Record<string, unknown> = {}): StoredRow {
  const observedAt = (overrides.observedAt as string) ?? '2000-01-01T22:43:10.000Z'; // 当地 07:43:10
  return {
    id: `${SESSION}-${ms(observedAt)}`,
    schemaVersion: 2,
    observer: 'self',
    sessionId: SESSION,
    direction: 'AM',
    event: 'BOARD',
    place: 'O',
    observedAt,
    ...overrides,
  };
}

describe('v1 → v2', () => {
  it('HOME_EXIT 改名为 DEPART', () => {
    const row = upgrade({ ...v2({ event: 'HOME_EXIT' }), schemaVersion: 1 });
    expect(row.event).toBe('DEPART');
  });

  it('其他事件名不动', () => {
    expect(upgrade({ ...v2(), schemaVersion: 1 }).event).toBe('BOARD');
  });
});

describe('v2 → v3：普通按键行', () => {
  it('observedAt 变成 tappedAt，旧字段不再出现', () => {
    const row = upgrade(v2());
    expect(row.tappedAt).toBe('2000-01-01T22:43:10.000Z');
    expect('observedAt' in row).toBe(false);
    expect(row.recordedBy).toBe('self');
  });

  it('方向 AM／PM 转成 outbound／inbound', () => {
    expect(upgrade(v2({ direction: 'AM' })).direction).toBe('outbound');
    expect(upgrade(v2({ direction: 'PM' })).direction).toBe('inbound');
  });

  it('方向认不出来就报错，不猜', () => {
    expect(() => upgrade(v2({ direction: '上午' }))).toThrow();
  });

  it('中文情境标签换成 slug，表外标签原样保留', () => {
    const row = upgrade(v2({ context: ['同行', '满员没上去', '自创标签'] }));
    expect(row.context).toEqual(['accompanied', 'missed-full-train', '自创标签']);
  });

  it('补 updatedAt 和 rev', () => {
    const row = upgrade(v2());
    expect(row.updatedAt).toBe(row.tappedAt);
    expect(row.rev).toBe(1);
  });

  it('schemaVersion 保留写入时的版本', () => {
    expect(upgrade(v2()).schemaVersion).toBe(2);
  });

  it('备注里的「0740」解析成自报时刻，纯数字＝exact', () => {
    const row = upgrade(v2({ note: '0740' }));
    expect(row.reportedAt).toBe('2000-01-01T22:40:00.000Z');
    expect(row.reportedPrecision).toBe('exact');
    expect(row.reportedSource).toBe('note');
  });

  it('「左右」「大概」＝approx', () => {
    expect(upgrade(v2({ note: '0740左右' })).reportedPrecision).toBe('approx');
    expect(upgrade(v2({ note: '大概 7:40' })).reportedPrecision).toBe('approx');
  });

  it('备注里没有时刻就不填', () => {
    const row = upgrade(v2({ note: '坐下了' }));
    expect(row.reportedAt).toBeUndefined();
    expect(row.reportedSource).toBeUndefined();
  });

  it('运行状况的原值和更正值都保留', () => {
    const row = upgrade(
      v2({
        serviceStatus: 'normal',
        serviceStatusCorrected: 'disrupted',
        correctionSource: 'self-report',
      }),
    );
    expect(row.serviceStatus).toBe('normal');
    expect(row.serviceStatusCorrected).toBe('disrupted');
  });
});

describe('v2 → v3：事后补记的行', () => {
  const reported = '2000-01-02T00:06:00.000Z'; // 当地 09:06
  const written = '2000-01-02T00:12:03.000Z'; // 当地 09:12:03

  it('写入时刻（id 尾部毫秒）→ tappedAt，口述时刻 → reportedAt', () => {
    const row = upgrade(
      v2({
        id: `${SESSION}-${ms(written)}`,
        event: 'CHECK_IN',
        observedAt: reported,
        note: '事后补记，分精度，雨会代记',
      }),
    );
    expect(row.tappedAt).toBe(written);
    expect(row.reportedAt).toBe(reported);
    expect(row.reportedPrecision).toBe('exact');
    expect(row.reportedSource).toBe('oral-report');
    expect(row.recordedBy).toBe('雨会');
    expect(row.observer).toBe('self');
  });

  it('不是代记的补记行，recordedBy＝self；「时刻约」＝approx', () => {
    const row = upgrade(
      v2({ id: `${SESSION}-${ms(written)}`, observedAt: reported, note: '事后补记，时刻约' }),
    );
    expect(row.recordedBy).toBe('self');
    expect(row.reportedPrecision).toBe('approx');
  });

  it('合成 id（尾部毫秒＝observedAt）：tappedAt 和 recordedBy 都是 null', () => {
    const row = upgrade(v2({ observedAt: reported, note: '事后补记' }));
    expect(row.tappedAt).toBeNull();
    expect(row.recordedBy).toBeNull();
    expect(row.reportedAt).toBe(reported);
    expect(row.reportedPrecision).toBeUndefined();
  });
});

describe('已经追加过 v3 字段的 v2 行', () => {
  it('追加的值优先，迁移不覆盖', () => {
    const row = upgrade(
      v2({ note: '0740', reportedAt: '2000-01-01T22:38:00.000Z', reportedSource: 'tap-adjust', rev: 3 }),
    );
    expect(row.reportedAt).toBe('2000-01-01T22:38:00.000Z');
    expect(row.reportedSource).toBe('tap-adjust');
    expect(row.rev).toBe(3);
  });
});

describe('版本检查', () => {
  it('比当前新的版本报错', () => {
    expect(() => upgrade({ ...v2(), schemaVersion: 99 })).toThrow();
  });

  it('v3 行原样通过', () => {
    const v3: StoredRow = {
      id: `${SESSION}-1`,
      schemaVersion: 3,
      observer: 'self',
      sessionId: SESSION,
      direction: 'outbound',
      event: 'DEPART',
      tappedAt: '2000-01-01T22:00:00.000Z',
      recordedBy: 'self',
      updatedAt: '2000-01-01T22:00:00.000Z',
      rev: 1,
    };
    expect(upgrade(v3)).toEqual(v3);
  });
});

describe('reportedFromNote', () => {
  const tapped = '2000-01-01T22:43:10.000Z'; // 当地 07:43

  it('不把「11号车」当成时刻', () => {
    expect(reportedFromNote('11号车', tapped, 540)).toBeNull();
  });

  it('两位数字不算时刻', () => {
    expect(reportedFromNote('排第 12', tapped, 540)).toBeNull();
  });

  it('三位数字「743」可以', () => {
    expect(reportedFromNote('743', tapped, 540)?.at).toBe('2000-01-01T22:43:00.000Z');
  });

  it('日期取当地日：UTC 前一天晚上也算对', () => {
    // 当地 2000-01-02 00:30 按键，备注 0025 → 当地 2000-01-02 00:25
    const r = reportedFromNote('0025', '2000-01-01T15:30:00.000Z', 540);
    expect(r?.at).toBe('2000-01-01T15:25:00.000Z');
  });
});

// 下面这些写法都来自真实样本（日期和站名已换成假的）
describe('真实样本里出现过的写法', () => {
  it('observedAt 带 +09:00 时区，统一成 UTC 的 Z 形式', () => {
    const row = upgrade(v2({ observedAt: '2000-01-02T07:41:32+09:00', id: `${SESSION}-1` }));
    expect(row.tappedAt).toBe('2000-01-01T22:41:32.000Z');
  });

  const tapped = '2000-01-01T09:50:25.000Z'; // 当地 18:50:25

  it('带秒的「18:41:48 下车」', () => {
    expect(reportedFromNote('18:41:48 下车', tapped, 540)?.at).toBe('2000-01-01T09:41:48.000Z');
  });

  it('「—40s」＝比按键早 40 秒', () => {
    const r = reportedFromNote('—40s', tapped, 540);
    expect(r?.at).toBe('2000-01-01T09:49:45.000Z');
    expect(r?.precision).toBe('exact');
  });

  it('「1948的车」是车次时刻，不是自报时刻', () => {
    expect(reportedFromNote('好像是1948的车，没抢到位置', tapped, 540)).toBeNull();
  });

  it('离按键太远的时刻不算（晚 5 分以上、早 90 分以上）', () => {
    expect(reportedFromNote('1900', tapped, 540)).toBeNull(); // 晚 10 分
    expect(reportedFromNote('1700', tapped, 540)).toBeNull(); // 早 110 分
    expect(reportedFromNote('1853', tapped, 540)).not.toBeNull(); // 晚 2.5 分，先按后做
  });
});

