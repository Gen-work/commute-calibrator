// 导入旧记录：先「检查」给出预览，确认后才写进库。写进去的是原样的行，读出时再升级。

import { useState } from 'react';
import type { EventStore } from './data/db';
import { parseImport, planImport, type ImportPlan, type ImportProblem } from './import/importer';

type Preview = { plan: ImportPlan; problems: ImportProblem[] };

export function ImportPanel({ store, onImported }: { store: EventStore; onImported: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(input: string) {
    setDone(null);
    const { rows, problems } = parseImport(input);
    setPreview({ plan: planImport(rows, await store.raw()), problems });
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    setPreview(null); // 先清掉上一个文件的预览，免得看错
    const content = await file.text();
    setText(content);
    await check(content);
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    let added = 0;
    const failed: string[] = [];
    for (const row of preview.plan.add) {
      try {
        await store.add(row);
        added += 1;
      } catch (e) {
        failed.push(`${row.id}：${String(e)}`);
      }
    }
    setBusy(false);
    setPreview(null);
    setText('');
    setDone(`导入了 ${added} 条。${failed.length ? `没导进去 ${failed.length} 条：${failed.slice(0, 3).join('；')}` : ''}`);
    await onImported();
  }

  const p = preview?.plan;

  return (
    <div className="import">
      <label className="file">
        选文件（JSON／TSV）
        <input
          type="file"
          accept=".json,.tsv,.txt,application/json,text/plain"
          onChange={(e) => {
            void readFile(e.target.files?.[0]);
            e.target.value = ''; // 清空，再选同一个文件也会触发
          }}
        />
      </label>
      <textarea
        aria-label="粘贴记录"
        placeholder="或者把「复制全部记录」的内容粘贴在这里"
        rows={3}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
      />
      <button disabled={!text.trim()} onClick={() => void check(text)}>
        检查
      </button>

      {preview && p && (
        <div className="preview" role="status">
          <p>
            新的 <strong>{p.add.length}</strong> 条 · 已有、一样的 {p.same} 条
            {p.differ.length > 0 && <> · 已有、但内容不同的 {p.differ.length} 条（保留现有的）</>}
            {preview.problems.length > 0 && <> · 读不了的 {preview.problems.length} 条</>}
          </p>
          {p.differ.length > 0 && (
            <ul>
              {p.differ.slice(0, 5).map((d) => (
                <li key={d.id}>
                  {d.id}：{d.fields.join('、')}
                </li>
              ))}
            </ul>
          )}
          {preview.problems.length > 0 && (
            <ul>
              {preview.problems.slice(0, 5).map((x) => (
                <li key={x.where}>
                  {x.where}：{x.reason}
                </li>
              ))}
            </ul>
          )}
          {p.unknownTags.length > 0 && (
            <p className="hint">
              标签表里没有的标签（照原样保存）：{p.unknownTags.map(([t, n]) => `${t} ×${n}`).join('、')}
            </p>
          )}
          <button className="go" disabled={busy || p.add.length === 0} onClick={() => void commit()}>
            导入 {p.add.length} 条
          </button>
        </div>
      )}
      {done && <p role="status">{done}</p>}
    </div>
  );
}
