import { describe, expect, it } from 'vitest';
import { addMinutes, fromMinutes, toMinutes } from './time';

describe('toMinutes', () => {
  it('把 HH:MM 换成分钟数', () => {
    expect(toMinutes('07:37')).toBe(457);
    expect(toMinutes('00:00')).toBe(0);
    expect(toMinutes('23:59')).toBe(1439);
  });

  it('格式不对就抛错', () => {
    expect(() => toMinutes('7時37分')).toThrow();
    expect(() => toMinutes('24:00')).toThrow();
    expect(() => toMinutes('07:60')).toThrow();
  });
});

describe('fromMinutes', () => {
  it('分钟数换回 HH:MM，补零', () => {
    expect(fromMinutes(457)).toBe('07:37');
    expect(fromMinutes(0)).toBe('00:00');
  });

  it('四舍五入到分钟', () => {
    expect(fromMinutes(457.4)).toBe('07:37');
    expect(fromMinutes(457.6)).toBe('07:38');
  });
});

describe('addMinutes', () => {
  // 实例 A：T2 时刻表 08:17 + 默认延误 5 分
  it('时刻表时刻加默认延误', () => {
    expect(addMinutes('08:17', 5)).toBe('08:22');
  });
});
