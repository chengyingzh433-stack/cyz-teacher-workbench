import { useState } from 'react';
import { ErrorText } from './Modal';
import type { ClassRecord, Snapshot } from '../app/model';

export function ClassForm({
  snapshot,
  current,
  submit,
}: {
  snapshot: Snapshot;
  current?: ClassRecord;
  submit: (name: string, school: string, term: string) => Promise<void>;
}) {
  const [name, setName] = useState(current?.name || '');
  const [school, setSchool] = useState(current?.school || '');
  const [term, setTerm] = useState(current?.termLabel || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const duplicate = snapshot.data.classes.some((c) => c.id !== current?.id && c.name === name.trim());

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try { await submit(name, school, term); }
        catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
      }}
    >
      <label>班级名称<input required autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：高一（3）班" /></label>
      {duplicate && <div className="alert tone-warning">已有同名班级，仍可创建；建议填写下方学校或学期区分。</div>}
      <div className="form-row">
        <label>学校（选填）<input maxLength={200} value={school} onChange={(e) => setSchool(e.target.value)} placeholder="如：第一中学" /></label>
        <label>学期（选填）<input maxLength={100} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="如：2026 秋" /></label>
      </div>
      <ErrorText message={error} />
      <div className="dialog-actions">
        <button className="primary" disabled={busy}>{busy ? '保存中…' : current ? '保存班级' : '创建班级'}</button>
      </div>
    </form>
  );
}
