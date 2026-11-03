import { Search, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { teacherApi } from '../../services/teacherApi';
import type { AdminUser } from '../../types/admin';
import styles from '../role/RolePages.module.css';

export function TeacherStudentsPage() {
  const [students, setStudents] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void teacherApi.listStudents().then((result) => { if (active) setStudents(result.items); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '学生名单加载失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const filtered = useMemo(() => students.filter((student) =>
    `${student.name}${student.username}${student.organization}`.toLowerCase().includes(search.trim().toLowerCase())), [search, students]);
  return (
    <div className={styles.rolePage}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}><span className={styles.heroEyebrow}><Users size={14} /> STUDENT MANAGEMENT</span><h1>学生管理</h1><p>仅展示当前教师授课课程的学生；名单由管理员在课程管理中维护。</p></div>
        <div className={styles.heroAction}><span>当前 {students.length} 人</span></div>
      </section>
      <div className={styles.toolbar}><div className={styles.filters}><label className={styles.search}><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="按姓名 / 账号搜索" /></label></div></div>
      {error && <p role="alert">{error}</p>}
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div className={styles.panelTitle}><Users size={18} />课程学生</div><span className={styles.panelSubtle}>已显示 {filtered.length} / {students.length} 人</span></div>
        <div className={styles.dataTable}>
          <div className={`${styles.tableHead} ${styles.students}`}><span>学生</span><span>登录账号</span><span>所属班级</span><span>账号状态</span><span>课程范围</span><span>来源</span></div>
          {loading ? <div className={styles.emptyHint}>正在加载学生…</div> : filtered.map((student) => (
            <div className={`${styles.tableRow} ${styles.students}`} key={student.id}>
              <div className={styles.studentIdentity}><div className={styles.avatar}>{student.name.slice(0, 1)}</div><div className={styles.identityCopy}><strong>{student.name}</strong><span>{student.id}</span></div></div>
              <strong>{student.username}</strong><span>{student.organization}</span><span>{student.status === 'active' ? '正常' : '已停用'}</span><span>我的课程</span><span>课程名单</span>
            </div>
          ))}
          {!loading && !filtered.length && <div className={styles.emptyHint}>暂无符合条件的学生</div>}
        </div>
      </section>
    </div>
  );
}
