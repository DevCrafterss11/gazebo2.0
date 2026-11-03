import { Beaker, FilePenLine, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../../components/common/Modal/Modal';
import { teachingExperimentApi, type TeachingExperiment } from '../../services/teachingExperimentApi';
import styles from '../role/RolePages.module.css';

export function AdminExperimentsPage() {
  const [experiments, setExperiments] = useState<TeachingExperiment[]>([]);
  const [editing, setEditing] = useState<TeachingExperiment | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void teachingExperimentApi.listAll().then((result) => { if (active) setExperiments(result.items); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '加载实验定义失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const updated = await teachingExperimentApi.update(editing.id, {
        name: String(form.get('name') ?? '').trim(),
        maxAltitude: Number(form.get('maxAltitude')),
        duration: Number(form.get('duration')),
      });
      setExperiments((items) => items.map((item) => item.id === updated.id ? updated : item));
      setEditing(null); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '修改实验定义失败'); }
    finally { setBusy(false); }
  };
  return (
    <section className={styles.rolePage}>
      <header className={styles.compactHeader}><div><h1>实验定义</h1><p>维护教师创建的课程实验定义；不访问学生个人报告、成绩或航迹。</p></div><span><ShieldCheck size={14} />管理视图</span></header>
      {error && <p role="alert" className={styles.pageMessage}>{error}</p>}
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div className={styles.panelTitle}><Beaker size={18} />全部课程实验</div><span className={styles.panelSubtle}>{experiments.length} 项</span></div>
        <div className={styles.dataTable}>
          <div className={`${styles.tableHead} ${styles.experiments}`}><span>实验</span><span>课程</span><span>状态</span><span>版本</span><span>高度上限</span><span>操作</span></div>
          {loading ? <div className={styles.emptyHint}>正在加载…</div> : experiments.map((item) => (
            <div className={`${styles.tableRow} ${styles.experiments}`} key={item.id}>
              <strong>{item.name}</strong><span>{item.courseName}</span><span>{item.status}</span><span>V{item.version}</span><span>{item.maxAltitude} m / {item.duration} min</span>
              <div>{item.status !== '已结束' && <button className={styles.ghostButton} type="button" onClick={() => { setError(''); setEditing(item); }}><FilePenLine size={12} />编辑</button>}</div>
            </div>
          ))}
          {!loading && !experiments.length && <div className={styles.emptyHint}>暂无实验定义；教师可从本人课程中创建。</div>}
        </div>
      </section>
      {editing && <Modal title={`编辑实验 · ${editing.name}`} description={`所属课程：${editing.courseName} · 保存后生成下一版本。`} onClose={() => setEditing(null)}>
        <form className={styles.adminForm} onSubmit={(event) => void save(event)}>
          <div className={styles.formGrid}>
            <label>实验名称<input name="name" required maxLength={120} defaultValue={editing.name} /></label>
            <label>高度上限（米）<input name="maxAltitude" type="number" min={2} max={120} required defaultValue={editing.maxAltitude} /></label>
            <label>计划时长（分钟）<input name="duration" type="number" min={5} max={240} required defaultValue={editing.duration} /></label>
          </div>
          <div className={styles.formActions}><button className={styles.ghostButton} type="button" onClick={() => setEditing(null)}>取消</button><button className={styles.primaryButton} type="submit" disabled={busy}>保存定义</button></div>
        </form>
      </Modal>}
    </section>
  );
}
