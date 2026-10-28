// 「下一步」按钮：按刚发生了什么给选项，不按写死的路线（打卡器 v7 的做法）。
// 路线一偏离（折返拿东西、临时换乘）固定模板就会错，所以只看上一条事件。

import type { CheckpointEvent, CoreEvent, Direction, SeatOutcome } from '../data/types';

export type NextOption = {
  event: CoreEvent | string; // 「其他」里也能记自定义节点
  label: string;
  seat?: SeatOutcome;
  transfer?: boolean;
  /** 和上一条必然同站，可以直接带入站名 */
  samePlace: boolean;
};

const LABELS: Record<CoreEvent, { outbound: string; inbound: string }> = {
  DEPART: { outbound: '出门', inbound: '离开公司' },
  GATE_IN: { outbound: '进改札', inbound: '进改札' },
  PLATFORM: { outbound: '到站台', inbound: '到站台' },
  QUEUE_START: { outbound: '开始排队', inbound: '开始排队' },
  BOARD: { outbound: '上车', inbound: '上车' },
  SEATED: { outbound: '坐下', inbound: '坐下' },
  ALIGHT: { outbound: '下车', inbound: '下车' },
  GATE_OUT: { outbound: '出改札', inbound: '出改札' },
  ARRIVE: { outbound: '到公司', inbound: '到家' },
  CHECK_IN: { outbound: '签到', inbound: '签到' },
};

export function eventLabel(event: string, direction: Direction): string {
  const l = LABELS[event as CoreEvent];
  return l ? l[direction] : event;
}

const opt = (
  event: CoreEvent,
  direction: Direction,
  samePlace: boolean,
  extra: Partial<NextOption> = {},
): NextOption => ({ event, label: eventLabel(event, direction), samePlace, ...extra });

/**
 * 一程里按时间排好的事件 → 接下来最可能的几个选项，第一个是大按钮。
 * 一程结束（去程签到、回程到家）后返回空数组。
 */
export function nextOptions(session: CheckpointEvent[], direction: Direction): NextOption[] {
  const last = session.at(-1);
  if (!last) return [opt('DEPART', direction, false)];

  switch (last.event) {
    case 'DEPART':
      return [opt('GATE_IN', direction, false)];
    case 'GATE_IN':
      return [opt('PLATFORM', direction, true), opt('BOARD', direction, true)];
    case 'PLATFORM':
      return [opt('QUEUE_START', direction, true), opt('BOARD', direction, true)];
    case 'QUEUE_START':
      return [opt('BOARD', direction, true)];
    case 'BOARD':
      return [
        { ...opt('SEATED', direction, false, { seat: 'seated' }), label: '坐到了' },
        { ...opt('SEATED', direction, false, { seat: 'none' }), label: '没座' },
        opt('ALIGHT', direction, false),
      ];
    case 'SEATED':
      return last.seat === 'none'
        ? [opt('ALIGHT', direction, false), { ...opt('SEATED', direction, false, { seat: 'midway' }), label: '中途坐下' }]
        : [opt('ALIGHT', direction, false)];
    case 'ALIGHT':
      return [
        opt('GATE_OUT', direction, true),
        { ...opt('BOARD', direction, true, { transfer: true }), label: '换乘上车' },
      ];
    case 'GATE_OUT':
      return [opt('ARRIVE', direction, false)];
    case 'ARRIVE':
      return direction === 'outbound' ? [opt('CHECK_IN', direction, true)] : [];
    case 'CHECK_IN':
      return [];
    default:
      // 自定义节点之后：回到它前面最近的核心事件来判断
      return nextOptions(session.slice(0, -1), direction);
  }
}

/** 这一程是不是已经结束 */
export function sessionEnded(session: CheckpointEvent[], direction: Direction): boolean {
  return session.length > 0 && nextOptions(session, direction).length === 0;
}
