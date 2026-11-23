import { useEffect, useState } from 'react';
import type { ClassRecord, Gender, TeacherProfile } from '../../shared/types';
import { characterPool } from '../../shared/characters';
import { Avatar } from '../features/classroom/SpriteArt';
import { Button, Input, Modal, Select } from './ui/primitives';

export function ClassAndTeacherModals({
  classModal,
  onClassModalChange,
  currentClass,
  onClassCreated,
  onClassUpdated,
  teacherOpen,
  onTeacherOpenChange,
  teacher,
  onTeacherSaved,
  onNotify,
}: {
  classModal: 'new' | 'edit' | null;
  onClassModalChange: (mode: 'new' | 'edit' | null) => void;
  currentClass?: ClassRecord;
  onClassCreated: (createdId: string) => Promise<void>;
  onClassUpdated: (classId: string) => Promise<void>;
  teacherOpen: boolean;
  onTeacherOpenChange: (open: boolean) => void;
  teacher: TeacherProfile;
  onTeacherSaved: (saved: TeacherProfile) => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [cName, setCName] = useState('');
  const [cSchool, setCSchool] = useState('');
  const [cTerm, setCTerm] = useState('');

  const [tName, setTName] = useState('');
  const [tGender, setTGender] = useState<Gender>('unspecified');
  const [tCharId, setTCharId] = useState<string | null>(null);

  useEffect(() => {
    if (!classModal) return;
    if (classModal === 'edit' && currentClass) {
      setCName(currentClass.name);
      setCSchool(currentClass.school);
      setCTerm(currentClass.termLabel);
    } else {
      setCName('');
      setCSchool('');
      setCTerm('2026-2027 上学期');
    }
  }, [classModal, currentClass]);

  useEffect(() => {
    if (!teacherOpen) return;
    setTName(teacher.name);
    setTGender(teacher.gender);
    setTCharId(teacher.characterId);
  }, [teacherOpen, teacher]);

  return (
    <>
      {/* Class Create / Edit Modal */}
      <Modal
        open={Boolean(classModal)}
        onOpenChange={(o) => !o && onClassModalChange(null)}
        title={classModal === 'edit' ? '修改班级信息' : '新建班级'}
        size="sm"
        footer={
          <>
            <Button onClick={() => onClassModalChange(null)}>取消</Button>
            <Button
              variant="primary"
              disabled={!cName.trim()}
              onClick={async () => {
                try {
                  if (classModal === 'edit' && currentClass) {
                    await window.workbenchApi.classes.update(currentClass.id, {
                      name: cName,
                      school: cSchool,
                      termLabel: cTerm,
                    });
                    await onClassUpdated(currentClass.id);
                    onNotify('已更新班级信息');
                  } else {
                    const created = await window.workbenchApi.classes.create({
                      name: cName,
                      school: cSchool,
                      termLabel: cTerm,
                    });
                    await onClassCreated(created.id);
                    onNotify(`已创建班级「${created.name}」`);
                  }
                  onClassModalChange(null);
                } catch (e) {
                  onNotify((e as Error).message, 'err');
                }
              }}
            >
              保存
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            班级名称 *
            <Input autoFocus value={cName} onChange={(e) => setCName(e.target.value)} placeholder="如：高二（5）班" />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            学校（可选）
            <Input value={cSchool} onChange={(e) => setCSchool(e.target.value)} placeholder="如：实验中学" />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            学期（可选）
            <Input value={cTerm} onChange={(e) => setCTerm(e.target.value)} placeholder="如：2026-2027 上学期" />
          </label>
        </div>
      </Modal>

      {/* Teacher Profile Modal */}
      <Modal
        open={teacherOpen}
        onOpenChange={onTeacherOpenChange}
        title="教师称呼与讲台像素形象"
        size="md"
        footer={
          <>
            <Button onClick={() => onTeacherOpenChange(false)}>取消</Button>
            <Button
              variant="primary"
              onClick={async () => {
                const saved = await window.workbenchApi.teacher.save({
                  name: tName,
                  gender: tGender,
                  characterId: tGender === 'unspecified' ? null : tCharId,
                });
                onTeacherSaved(saved);
                onTeacherOpenChange(false);
                onNotify('已更新教师形象与称呼');
              }}
            >
              保存设置
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              教师称呼
              <Input value={tName} onChange={(e) => setTName(e.target.value)} placeholder="如：陈老师 / cyz" />
            </label>
            <div className="flex flex-col gap-1 text-[13px] font-medium">
              讲台角色性别
              <Select
                value={tGender}
                onValueChange={(v) => {
                  const g = v as Gender;
                  setTGender(g);
                  if (g === 'unspecified') setTCharId(null);
                  else {
                    const p = characterPool(g);
                    if (!p.some((c) => c.id === tCharId)) setTCharId(p[0]?.id || null);
                  }
                }}
                className="w-full h-9"
                options={[
                  { value: 'male', label: '男教师角色' },
                  { value: 'female', label: '女教师角色' },
                  { value: 'unspecified', label: '不设形象' },
                ]}
              />
            </div>
          </div>
          {tGender !== 'unspecified' && (
            <div className="grid grid-cols-5 gap-2 max-h-60 overflow-y-auto p-1">
              {characterPool(tGender).map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => setTCharId(ch.id)}
                  className={`flex flex-col items-center gap-1 p-2 rounded-xl border cursor-pointer ${
                    tCharId === ch.id
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <Avatar gender={tGender} characterId={ch.id} size={46} />
                  <span className="text-[11px] font-medium text-center">{ch.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
