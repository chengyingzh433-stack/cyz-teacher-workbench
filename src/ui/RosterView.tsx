import { useMemo, useState } from 'react';
import type { Membership, SeatPlan, Snapshot, Student } from '../app/model';
import { Avatar } from '../scene/Art';
import { Icon } from './Icons';
import { Badge } from './Primitives';

type Filter = 'all' | 'male' | 'female' | 'unspecified' | 'unseated';

export function RosterView({
  snapshot: s,
  classId,
  members,
  studentMap,
  plan,
  archived,
  busy,
  onProfile,
  onEdit,
  onAdd,
  onImport,
  onRemove,
  onRestore,
}: {
  snapshot: Snapshot;
  classId: string;
  members: Membership[];
  studentMap: Map<string, Student>;
  plan?: SeatPlan;
  archived: boolean;
  busy: boolean;
  onProfile: (m: Membership) => void;
  onEdit: (m: Membership) => void;
  onAdd: () => void;
  onImport: () => void;
  onRemove: (m: Membership) => void;
  onRestore: (m: Membership, name: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'order' | 'number' | 'name'>('order');
  const [filter, setFilter] = useState<Filter>('all');
  const [showRemoved, setShowRemoved] = useState(false);

  const seated = useMemo(() => new Set(plan?.assignments.map((a) => a.membershipId) || []), [plan?.assignments]);
  const removedCount = s.data.memberships.filter((m) => m.classId === classId && m.status === 'removed').length;

  const counts = useMemo(() => {
    let male = 0, female = 0, unspecified = 0, unseated = 0;
    for (const m of members) {
      const g = studentMap.get(m.studentId)?.gender;
      if (g === 'male') male++;
      else if (g === 'female') female++;
      else unspecified++;
      if (!seated.has(m.id)) unseated++;
    }
    return { male, female, unspecified, unseated };
  }, [members, studentMap, seated]);

  const rows = useMemo(
    () =>
      s.data.memberships
        .filter((m) => m.classId === classId && m.status === (showRemoved ? 'removed' : 'active'))
        .filter((m) => {
          const st = studentMap.get(m.studentId)!;
          if (!showRemoved) {
            if (filter === 'male' && st.gender !== 'male') return false;
            if (filter === 'female' && st.gender !== 'female') return false;
            if (filter === 'unspecified' && st.gender !== 'unspecified') return false;
            if (filter === 'unseated' && seated.has(m.id)) return false;
          }
          return !search || st.name.includes(search) || m.rosterNo.includes(search);
        })
        .sort((a, b) =>
          sort === 'name'
            ? studentMap.get(a.studentId)!.name.localeCompare(studentMap.get(b.studentId)!.name, 'zh-CN')
            : sort === 'number'
              ? a.rosterNo.localeCompare(b.rosterNo, 'zh-CN', { numeric: true })
              : a.order - b.order,
        ),
    [s, classId, showRemoved, filter, search, sort, studentMap, seated],
  );

  const pills: [Filter, string][] = [
    ['all', `全部 ${members.length}`],
    ['male', `男 ${counts.male}`],
    ['female', `女 ${counts.female}`],
    ...(counts.unspecified ? ([['unspecified', `待填性别 ${counts.unspecified}`]] as [Filter, string][]) : []),
    ...(counts.unseated ? ([['unseated', `未排座 ${counts.unseated}`]] as [Filter, string][]) : []),
  ];

  return (
    <section className="col">
      <div className="row between">
        <div className="seg compact" role="tablist" aria-label="名单状态">
          <button type="button" role="tab" aria-selected={!showRemoved} onClick={() => setShowRemoved(false)}>
            在读学生（{members.length}）
          </button>
          <button type="button" role="tab" aria-selected={showRemoved} onClick={() => setShowRemoved(true)}>
            已移出（{removedCount}）
          </button>
        </div>
        <div className="row">
          <button type="button" disabled={archived || busy} onClick={onAdd}>
            <Icon name="plus" size={15} />添加单个学生
          </button>
          <button type="button" className="primary" disabled={archived || busy} onClick={onImport}>
            <Icon name="upload" size={15} />批量导入名单
          </button>
        </div>
      </div>

      <div className="row">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input aria-label="查找学生" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="姓名或编号…" />
          {search && <button type="button" className="clear-btn" aria-label="清除搜索" onClick={() => setSearch('')}><Icon name="x" size={13} /></button>}
        </div>
        {!showRemoved && (
          <div className="row" role="group" aria-label="筛选条件">
            {pills.map(([k, label]) => (
              <button type="button" key={k} className={`pill ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="spacer" />
        <label className="inline-field">
          <span>排序</span>
          <select aria-label="显示排序" value={sort} onChange={(e) => setSort(e.target.value as 'order' | 'number' | 'name')}>
            <option value="order">按录入顺序</option>
            <option value="number">按班内编号</option>
            <option value="name">按姓名拼音</option>
          </select>
        </label>
      </div>

      <div className="card table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>学生</th><th>班内编号</th><th>档案性别</th><th>当前座位</th><th style={{ width: 155 }}>操作</th></tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const st = studentMap.get(m.studentId)!;
                const seat = plan?.assignments.find((x) => x.membershipId === m.id);
                return (
                  <tr key={m.id}>
                    <td>
                      <div className="student-cell">
                        <Avatar gender={st.gender} characterId={st.characterId} size={36} />
                        <button type="button" className="name-link" onClick={() => onProfile(m)}>{st.name}</button>
                      </div>
                    </td>
                    <td className="num">{m.rosterNo || <span className="muted">—</span>}</td>
                    <td>
                      <Badge tone={st.gender === 'male' ? 'info' : st.gender === 'female' ? 'success' : 'warning'}>
                        {st.gender === 'male' ? '男' : st.gender === 'female' ? '女' : '待补全'}
                      </Badge>
                    </td>
                    <td>
                      {seat ? <span className="num">第 {seat.row + 1} 行 · 第 {seat.col + 1} 列</span> : <Badge>{showRemoved ? '已移出' : '未排座'}</Badge>}
                    </td>
                    <td>
                      <div className="row">
                        {showRemoved ? (
                          <button type="button" className="sm" disabled={archived || busy} onClick={() => onRestore(m, st.name)}>恢复到本班</button>
                        ) : (
                          <>
                            <button type="button" className="sm" disabled={archived || busy} aria-label={`编辑 ${st.name} ${m.rosterNo}`} onClick={() => onEdit(m)}>编辑</button>
                            <button type="button" className="sm ghost-danger" disabled={archived || busy} aria-label={`移出 ${st.name} ${m.rosterNo}`} onClick={() => onRemove(m)}>移出</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && (
            <div className="empty-box">
              <p className="muted">
                {showRemoved ? '目前没有已移出的学生。' : search || filter !== 'all' ? '当前筛选条件下没有匹配的学生。' : '本班还没有学生名单，可以粘贴表格或逐个添加。'}
              </p>
              {!showRemoved && !search && filter === 'all' && !archived && (
                <div className="row center" style={{ marginTop: 12 }}>
                  <button className="primary" onClick={onImport}><Icon name="upload" size={15} />批量导入名单</button>
                  <button onClick={onAdd}>添加单个学生</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
