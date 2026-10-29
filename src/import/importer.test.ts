import { describe, expect, it } from 'vitest';
import { upgrade } from '../data/migrate';
import { V2_COLUMNS, parseImport, planImport } from './importer';

// 脱敏样本：站名 H／O／T1，假日期 2000-01-02（当地）
const AT = '2000-01-02T07:20:23+09:00';
const AT_MS = Date.parse(AT);
const v2 = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  observer: 'self',
  observedAt: AT,
  sessionId: '20000102-AM-0720',
  direction: 'AM',
  event: 'DEPART',
  place: 'H',
  context: [],
  serviceStatus: 'normal',
  id: `20000102-AM-0720-${AT_MS}`,
  ...over,
});

describe('JSON：Drive 上的 raw 导出', () => {
  it('{meta, events} 和纯数组都认', () => {
    const rows = [v2(), v2({ id: 'b', event: 'GATE_IN', observedAt: '2000-01-02T07:27:06+09:00' })];
    expect(parseImport(JSON.stringify({ meta: { 条数: 2 }, events: rows })).rows).toHaveLength(2);
    expect(parseImport(JSON.stringify(rows)).rows).toHaveLength(2);
  });

  it('原样保留，不在导入时改写（读出时才升级）', () => {
    const { rows } = parseImport(JSON.stringify([v2({ context: ['同行'] })]));
    expect(rows[0]).toMatchObject({ schemaVersion: 2, direction: 'AM', observedAt: AT, context: ['同行'] });
  });

  it('坏行单独报出来，其余照常导入', () => {
    const { rows, problems } = parseImport(
      JSON.stringify([v2(), v2({ id: 'x', direction: 'NOON' }), v2({ id: 'y', event: '' }), 'hello']),
    );
    expect(rows).toHaveLength(1);
    expect(problems.map((p) => p.where)).toEqual(['第 2 条', '第 3 条', '第 4 条']);
    expect(problems[0]?.reason).toContain('direction');
    expect(problems[1]?.reason).toContain('event');
  });

  it('不是 JSON、没有列表，都给出原因', () => {
    expect(parseImport('{oops').problems[0]?.reason).toContain('JSON');
    expect(parseImport('{"a":1}').problems[0]?.reason).toContain('列表');
    expect(parseImport('  ').problems[0]?.reason).toBe('是空的');
  });
});

describe('TSV：「复制全部记录」', () => {
  const header = 'schemaVersion\tobserver\tobservedAt\tsessionId\tdirection\tevent\tplace\tcar\tcontext\tserviceStatus\tnote';

  it('有表头时按表头读；数字、标签列表都转好；空格子不写', () => {
    const line = `2\tself\t${AT}\t20000102-AM-0720\tAM\tBOARD\tH\t\t同行、回消息\tnormal\t0718`;
    const { rows, problems } = parseImport(`${header}\r\n${line}\r\n`);
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ schemaVersion: 2, event: 'BOARD', context: ['同行', '回消息'], note: '0718' });
    expect('car' in rows[0]!).toBe(false);
  });

  it('没有表头时按 v2 的列顺序读', () => {
    const line = V2_COLUMNS.map((c) => String(v2()[c as keyof ReturnType<typeof v2>] ?? '')).join('\t');
    const { rows } = parseImport(line);
    expect(rows[0]).toMatchObject({ event: 'DEPART', place: 'H', sessionId: '20000102-AM-0720' });
  });

  it('TSV 没有 id 时按「sessionId-按键毫秒」生成，和 JSON 里同一行的 id 一样', () => {
    const line = `2\tself\t${AT}\t20000102-AM-0720\tAM\tDEPART\tH\t\t\tnormal\t`;
    expect(parseImport(`${header}\n${line}`).rows[0]?.id).toBe(v2().id);
  });

  it('表头多出来的新列（v6／v7 字段）也读进来', () => {
    const h = `${header}\tseat\treportedOffsetSec\ttransfer`;
    const line = `2\tself\t${AT}\t20000102-AM-0720\tAM\tSEATED\tO\t\t\tnormal\t\tnone\t-30\ttrue`;
    expect(parseImport(`${h}\n${line}`).rows[0]).toMatchObject({ seat: 'none', reportedOffsetSec: -30, transfer: true });
  });

  it('本 app 自己导出的 TSV 不当备份读，提示改用 JSON', () => {
    const { rows, problems } = parseImport('id\tsessionId\tdirection\tevent\teffectiveAt\ttappedAt\nx\ts\toutbound\tDEPART\t\t');
    expect(rows).toEqual([]);
    expect(problems[0]?.reason).toContain('JSON');
  });

  it('本 app 导出的 JSON 能原样导回', () => {
    const raw = [v2(), { ...v2({ id: 'b' }), schemaVersion: 3, tappedAt: '2000-01-01T22:21:00.000Z', direction: 'outbound', updatedAt: 'x', rev: 1, recordedBy: 'self' }];
    const { rows, problems } = parseImport(JSON.stringify({ meta: { exportedAt: 'x', rows: 2 }, events: raw }));
    expect(problems).toEqual([]);
    expect(planImport(rows, raw).same).toBe(2);
  });

  it('表格软件加的引号去掉', () => {
    const line = `2\tself\t${AT}\t20000102-AM-0720\tAM\tDEPART\tH\t\t\tnormal\t"说了""等等"""`;
    expect(parseImport(`${header}\n${line}`).rows[0]?.note).toBe('说了"等等"');
  });
});

describe('和库里已有的比对', () => {
  it('新的追加，一样的跳过，同一次导入里重复的只算一次', () => {
    const a = v2();
    const b = v2({ id: 'b', event: 'GATE_IN' });
    const plan = planImport([a, b, b], [a]);
    expect(plan.add.map((r) => r.id)).toEqual(['b']);
    expect(plan.same).toBe(1);
    expect(plan.differ).toEqual([]);
  });

  it('同一个 id 但内容不同：保留库里的，列出不同的字段', () => {
    const plan = planImport([v2({ note: '后来补的备注' })], [v2()]);
    expect(plan.add).toEqual([]);
    expect(plan.differ).toEqual([{ id: v2().id, fields: ['note'] }]);
  });

  it('库里在 app 里事后追加过的字段，不算不同', () => {
    const stored = { ...v2(), reportedAt: '1999-12-31T22:18:00.000Z', rev: 2 };
    expect(planImport([v2()], [stored]).same).toBe(1);
  });

  it('表外的标签数出来，给本人决定要不要收进标签表', () => {
    const plan = planImport(
      [v2({ id: 'a', context: ['同行', '被挤'] }), v2({ id: 'b', context: ['被挤', '闷热'] })],
      [],
    );
    expect(plan.unknownTags).toEqual([
      ['被挤', 2],
      ['闷热', 1],
    ]);
  });

  it('导入的行读出来就是 v3', () => {
    const { rows } = parseImport(JSON.stringify([v2({ context: ['同行'] })]));
    expect(upgrade(rows[0]!)).toMatchObject({ direction: 'outbound', context: ['accompanied'], tappedAt: '2000-01-01T22:20:23.000Z' });
  });
});
