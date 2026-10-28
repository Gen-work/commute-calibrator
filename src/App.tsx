// 记录器界面：底部拇指区是「下一步」大按钮，上面是这一程已经记下的事件。
// 逻辑都在 src/recorder/ 里（有测试），这里只管接线和显示。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { openEventStore, type EventStore } from './data/db';
import { CORE_EVENTS, type CheckpointEvent, type Direction, type SeatOutcome } from './data/types';
import { toJson, toTsv } from './recorder/export';
import { eventLabel, nextOptions, sessionEnded, type NextOption } from './recorder/next';
import {
  SESSION_GAP_MS,
  buildRow,
  currentSession,
  defaultDirection,
  groupSessions,
  isDuplicate,
  localClock,
  localTimeToIso,
  newSessionId,
  tagLabel,
  topTags,
} from './recorder/session';
import { effectiveTime } from './data/db';
import './App.css';

type Pending = { option: NextOption; atMs: number };

const SEAT_LABEL: Record<SeatOutcome, string> = { seated: '坐到了', none: '没座', midway: '中途坐下' };

export function App() {
  const [store, setStore] = useState<EventStore | null>(null);
  const [rows, setRows] = useState<CheckpointEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>(() => defaultDirection(Date.now()));
  const [tags, setTags] = useState<string[]>([]);
  const [place, setPlace] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [customNode, setCustomNode] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let s: EventStore | undefined;
    openEventStore()
      .then(async (opened) => {
        s = opened;
        setStore(opened);
        setRows(await opened.all());
        // 请浏览器别在空间紧张时清掉这里的数据（不保证批准）
        void navigator.storage?.persist?.();
      })
      .catch((e: unknown) => setError(`打不开本机数据库：${String(e)}`));
    return () => s?.close();
  }, []);

  // 每 30 秒刷新一次「现在」，让超过 3 小时的一程自动结束
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const reload = useCallback(async () => {
    if (store) setRows(await store.all());
  }, [store]);

  const active = useMemo(() => currentSession(rows, direction, now), [rows, direction, now]);

  // 没有进行中的一程时，把 3 小时内刚结束的那一程留在屏幕上，方便改时刻
  const shown = useMemo(() => {
    if (active) return { ...active, ended: false };
    let recent: { sessionId: string; events: CheckpointEvent[] } | null = null;
    let recentMs = -Infinity;
    for (const [sessionId, events] of groupSessions(rows)) {
      if (events[0]?.direction !== direction) continue;
      const t = Date.parse(events.at(-1)?.tappedAt ?? '');
      if (Number.isFinite(t) && now - t <= SESSION_GAP_MS && t > recentMs) {
        recent = { sessionId, events };
        recentMs = t;
      }
    }
    return recent ? { ...recent, ended: sessionEnded(recent.events, direction) } : null;
  }, [active, rows, direction, now]);

  const events = active?.events ?? [];
  const options = nextOptions(events, direction);
  // 「同上」只带上一条的站名；上一条没填就不猜（下车那站没写时，不能把出发站带过去）
  const prevPlace = events.at(-1)?.place;
  const chips = useMemo(() => topTags(rows), [rows]);

  async function record(option: NextOption, atMs: number) {
    if (!store) return;
    const sessionId = active?.sessionId ?? newSessionId(atMs, direction);
    const typed = place.trim();
    const carried = !typed && option.samePlace ? prevPlace : undefined;
    const row = buildRow({
      sessionId,
      direction,
      event: option.event,
      nowMs: atMs,
      place: typed || carried,
      placeSource: typed ? 'manual' : carried ? 'same-as-prev' : undefined,
      seat: option.seat,
      transfer: option.transfer,
      context: tags,
      note: note.trim() || undefined,
    });
    try {
      await store.add(row);
    } catch (e) {
      setError(`没记上：${String(e)}`);
      return;
    }
    setTags([]);
    setPlace('');
    setNote('');
    setPending(null);
    await reload();
  }

  function tap(option: NextOption) {
    const atMs = Date.now(); // 按下的那一刻就定下时间，确认框不影响它
    setNow(atMs);
    if (isDuplicate(events, option.event, atMs, option.seat)) {
      setPending({ option, atMs });
      return;
    }
    void record(option, atMs);
  }

  async function saveEdit() {
    if (!store || !editing) return;
    const row = rows.find((r) => r.id === editing.id);
    const base = row ? effectiveTime(row) : null;
    const iso = base ? localTimeToIso(editing.value.trim(), base) : null;
    if (!iso) {
      setError('时刻写成 07:43 或 07:43:20');
      return;
    }
    await store.annotate(
      editing.id,
      { reportedAt: iso, reportedPrecision: 'exact', reportedSource: 'manual-edit' },
      new Date().toISOString(),
    );
    setEditing(null);
    setError(null);
    await reload();
  }

  async function exportAs(kind: 'json' | 'tsv') {
    if (!store) return;
    const stamp = new Date().toISOString();
    const body = kind === 'json' ? toJson(await store.raw(), stamp) : toTsv(await store.all());
    const type = kind === 'json' ? 'application/json' : 'text/tab-separated-values';
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `commute-${stamp.slice(0, 10)}.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const [primary, ...secondary] = options;

  return (
    <div className="app">
      <header className="top">
        <h1>出门助手</h1>
        <div className="seg" role="group" aria-label="方向">
          {(['outbound', 'inbound'] as const).map((d) => (
            <button key={d} aria-pressed={direction === d} onClick={() => setDirection(d)}>
              {d === 'outbound' ? '去程' : '回程'}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <p className="error" role="alert" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <section className="log" aria-label="这一程">
        {!shown && <p className="hint">还没开始。按下面的「{primary?.label}」开始这一程。</p>}
        {shown && (
          <>
            <p className="session">
              {shown.sessionId}
              {shown.ended && '　这一程已结束'}
            </p>
            <ol>
              {shown.events.map((e) => (
                <li key={e.id}>
                  {editing?.id === e.id ? (
                    <input
                      className="time-edit"
                      autoFocus
                      inputMode="numeric"
                      value={editing.value}
                      onChange={(ev) => setEditing({ id: e.id, value: ev.target.value })}
                      onBlur={() => void saveEdit()}
                      onKeyDown={(ev) => ev.key === 'Enter' && void saveEdit()}
                    />
                  ) : (
                    <button
                      className="time"
                      title="点一下改时刻"
                      onClick={() => setEditing({ id: e.id, value: localClock(effectiveTime(e)) })}
                    >
                      {localClock(effectiveTime(e))}
                      {e.reportedAt && <span className="mark">改</span>}
                    </button>
                  )}
                  <span className="what">
                    {e.event === 'SEATED' ? SEAT_LABEL[e.seat ?? 'seated'] : eventLabel(e.event, e.direction)}
                    {e.transfer && '（换乘）'}
                  </span>
                  {e.place && <span className="place">{e.place}</span>}
                  {e.context?.map((c) => (
                    <span key={c} className="tag">
                      {tagLabel(c)}
                    </span>
                  ))}
                  {e.note && <span className="note">{e.note}</span>}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <details className="tools">
        <summary>导出</summary>
        <button onClick={() => void exportAs('json')}>JSON（原样）</button>
        <button onClick={() => void exportAs('tsv')}>TSV（表格用）</button>
      </details>

      <footer className="thumb">
        {pending && (
          <div className="confirm" role="alertdialog">
            <span>90 秒内刚记过「{pending.option.label}」。</span>
            <button onClick={() => void record(pending.option, pending.atMs)}>仍然记</button>
            <button onClick={() => setPending(null)}>算了</button>
          </div>
        )}

        <div className="chips" role="group" aria-label="情境（只加在下一下）">
          {chips.map((c) => (
            <button
              key={c}
              aria-pressed={tags.includes(c)}
              onClick={() => setTags((t) => (t.includes(c) ? t.filter((x) => x !== c) : [...t, c]))}
            >
              {tagLabel(c)}
            </button>
          ))}
        </div>

        <div className="fields">
          <input
            aria-label="站名"
            placeholder={prevPlace ? `站名（同上：${prevPlace}）` : '站名（可空）'}
            value={place}
            onChange={(e) => setPlace(e.target.value)}
          />
          <input aria-label="备注" placeholder="备注（可空）" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {secondary.length > 0 && (
          <div className="secondary">
            {secondary.map((o) => (
              <button key={o.label} onClick={() => tap(o)} disabled={!store}>
                {o.label}
              </button>
            ))}
          </div>
        )}

        {primary ? (
          <button className="primary" onClick={() => tap(primary)} disabled={!store}>
            {primary.label}
          </button>
        ) : (
          <p className="hint">这一程结束了。切换方向，或者等下一程。</p>
        )}

        <details className="other">
          <summary>其他</summary>
          <div className="all">
            {CORE_EVENTS.map((ev) => (
              <button
                key={ev}
                disabled={!store}
                onClick={() => tap({ event: ev, label: eventLabel(ev, direction), samePlace: false })}
              >
                {eventLabel(ev, direction)}
              </button>
            ))}
          </div>
          <div className="custom">
            <input
              aria-label="自定义节点"
              placeholder="自定义节点，如 buy-water"
              value={customNode}
              onChange={(e) => setCustomNode(e.target.value)}
            />
            <button
              disabled={!store || !customNode.trim()}
              onClick={() => {
                tap({ event: customNode.trim(), label: customNode.trim(), samePlace: true });
                setCustomNode('');
              }}
            >
              记
            </button>
          </div>
        </details>
      </footer>
    </div>
  );
}
