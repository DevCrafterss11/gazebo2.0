import { Beaker, FilePenLine, Plus, Rocket } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../../components/common/Modal/Modal';
import { teacherApi } from '../../services/teacherApi';
import { teachingExperimentApi, type TeachingExperiment } from '../../services/teachingExperimentApi';
import type { AdminCourse } from '../../types/admin';
import styles from '../role/RolePages.module.css';

export function TeacherExperimentsPage() {
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [experiments, setExperiments] = useState<TeachingExperiment[]>([]);
  const [editing, setEditing] = useState<TeachingExperiment | 'new' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void Promise.all([teacherApi.listCourses(), teachingExperimentApi.listMine()]).then(([c, e]) => {
      if (active) { setCourses(c.items); setExperiments(e.items); }
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '实验数据加载失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const maxAltitude = Number(form.get('maxAltitude'));
    const duration = Number(form.get('duration'));
    if (!name || !Number.isInteger(maxAltitude) || !Number.isInteger(duration) || maxAltitude < 2 || maxAltitude > 120 || duration < 5 || duration > 240) {
      setError('请填写实验名称、2–120 米高度及 5–240 分钟时长。'); return;
    }
    setBusy(true);
    try {
      if (editing === 'new') {
        const created = await teachingExperimentApi.create({ courseId: String(form.get('courseId')), name, description, maxAltitude, duration });
        setExperiments((items) => [created, ...items]);
      } else {
        const updated = await teachingExperimentApi.update(editing.id, { name, description, maxAltitude, duration });
        setExperiments((items) => items.map((item) => item.id === updated.id ? updated : item));
      }
      setEditing(null); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const advance = async (item: TeachingExperiment) => {
    setBusy(true);
    try {
      const updated = await teachingExperimentApi.update(item.id, { status: item.status === '草稿' ? '已发布' : '已结束' });
      setExperiments((items) => items.map((entry) => entry.id === updated.id ? updated : entry));
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '状态更新失败'); }
    finally { setBusy(false); }
  };
  return (
    <div className={styles.rolePage}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}><span className={styles.heroEyebrow}><Beaker size={14} /> EXPERIMENT DESIGN</span><h1>实验管理</h1><p>为本人课程创建实验定义，保存草稿后发布；定义不等于学生已完成的实验记录。</p></div>
        <div className={styles.heroAction}><button className={styles.primaryButton} type="button" disabled={!courses.length || busy} onClick={() => { setEditing('new'); setError(''); }}><Plus size={14} />创建实验</button><span>草稿 → 已发布 → 已结束</span></div>
      </section>
      {error && <div className={styles.pageMessage} role="alert">{error}</div>}
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div className={styles.panelTitle}><Beaker size={18} />我的实验定义</div><span className={styles.panelSubtle}>{experiments.length} 项 · 仅本人课程</span></div>
        <div className={styles.dataTable}>
          <div className={`${styles.tableHead} ${styles.experiments}`}><span>实验名称</span><span>所属课程</span><span>状态</span><span>版本</span><span>安全上限</span><span>操作</span></div>
          {loading ? <div className={styles.emptyHint}>正在加载实验…</div> : experiments.map((item) => (
            <div className={`${styles.tableRow} ${styles.experiments}`} key={item.id}>
              <strong>{item.name}</strong><span>{item.courseName}</span><span className={styles.statusPill}>{item.status}</span><span>V{item.version}</span><span>{item.maxAltitude} m / {item.duration} min</span>
              <div className={styles.rowActions}>
                {item.status !== '已结束' && <button className={styles.ghostButton} type="button" disabled={busy} onClick={() => setEditing(item)}><FilePenLine size={12} />编辑</button>}
                {item.status !== '已结束' && <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void advance(item)}><Rocket size={12} />{item.status === '草稿' ? '发布' : '结束'}</button>}
              </div>
            </div>
          ))}
          {!loading && experiments.length === 0 && <div className={styles.emptyHint}>暂无实验定义；先分配课程，再创建实验。</div>}
        </div>
      </section>
      {editing && <Modal title={editing === 'new' ? '创建实验草稿' : `编辑 · ${editing.name}`} description="实验定义会保存到当前数据源；发布仅改变定义状态，不会自动启动无人机或产生学生成绩。" onClose={() => setEditing(null)}>
        <form className={styles.adminForm} onSubmit={(event) => void save(event)}>
          <div className={styles.formGrid}>
            {editing === 'new' ? <label>所属课程<select name="courseId" required>{courses.map((course) => <option value={course.id} key={course.id}>{course.name} · {course.className}</option>)}</select></label> : <label>所属课程<input value={editing.courseName} disabled /></label>}
            <label>实验名称<input name="name" required maxLength={120} defaultValue={editing === 'new' ? '' : editing.name} /></label>
            <label>高度上限（米）<input name="maxAltitude" type="number" min={2} max={120} required defaultValue={editing === 'new' ? 20 : editing.maxAltitude} /></label>
            <label>计划时长（分钟）<input name="duration" type="number" min={5} max={240} required defaultValue={editing === 'new' ? 30 : editing.duration} /></label>
            <label className={styles.formSpanTwo}>教学说明<input name="description" maxLength={2000} defaultValue={editing === 'new' ? '' : editing.description} /></label>
          </div>
          <div className={styles.formActions}><button className={styles.ghostButton} type="button" onClick={() => setEditing(null)}>取消</button><button className={styles.primaryButton} disabled={busy} type="submit">{busy ? '保存中…' : '保存定义'}</button></div>
        </form>
      </Modal>}
    </div>
  );
}
