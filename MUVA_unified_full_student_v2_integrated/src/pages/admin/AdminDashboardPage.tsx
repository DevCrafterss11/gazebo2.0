import { AlertTriangle, BookOpenCheck, ChevronRight, Clock3, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../../services/adminApi';
import type { AdminCourse, AdminUser } from '../../types/admin';
import styles from '../platform/PlatformPages.module.css';

export function AdminDashboardPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.all([adminApi.listUsers(), adminApi.listCourses()]).then(([userResult, courseResult]) => {
      if (active) { setUsers(userResult.items); setCourses(courseResult.items); }
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '数据加载失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const count = (role: AdminUser['role']) => users.filter((user) => user.role === role).length;
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><h1>系统总览</h1><p>账号与课程统计来自当前管理数据源；仿真资源与实验统计尚未接入。</p></div>
        <span><Clock3 size={15} />{new Date().toLocaleDateString('zh-CN')}</span>
      </header>
      {loading && <p role="status">正在加载管理数据…</p>}
      {error && <p role="alert">{error}</p>}
      <div className={styles.dashboardGrid}>
        <section className={`${styles.panel} ${styles.statusPanel}`}>
          <h2><Users size={18} />账号与课程</h2>
          <div className={styles.statusGrid}>
            <div className={styles.statusCard}><span>平台注册用户</span><strong>{loading ? '—' : users.length}</strong><i>已启用 {users.filter((u) => u.status === 'active').length}</i></div>
            <div className={styles.statusCard}><span>教师 / 学生</span><strong>{loading ? '—' : `${count('teacher')} / ${count('student')}`}</strong><i>管理员 {count('admin')}</i></div>
            <div className={styles.statusCard}><span>开放课程</span><strong>{loading ? '—' : courses.filter((c) => c.status === '进行中').length}</strong><i>总计 {courses.length} 门</i></div>
            <div className={styles.statusCard}><span>课程成员</span><strong>{loading ? '—' : courses.reduce((sum, c) => sum + c.studentCount, 0)}</strong><i>按选课人数累计</i></div>
          </div>
        </section>
        <section className={`${styles.panel} ${styles.currentPanel}`}>
          <h2><ShieldCheck size={18} />管理范围</h2>
          <div className={styles.currentExperiment}>
            <span>PLATFORM ADMINISTRATION</span>
            <strong>账号与课程管理</strong>
            <small>创建教师、学生账号并配置授课课程；其他教学模块仍处于演示阶段。</small>
            <Link className={styles.primaryButton} to="/admin/users">管理账号 <ChevronRight size={15} /></Link>
          </div>
        </section>
        <section className={`${styles.panel} ${styles.alertsPanel}`}>
          <h2><AlertTriangle size={18} />快捷入口</h2>
          <div className={styles.alertList}>
            <Link to="/admin/users"><Users size={14} />用户管理</Link>
            <Link to="/admin/courses"><BookOpenCheck size={14} />课程与选课名单</Link>
            <Link to="/admin/logs"><ShieldCheck size={14} />账号及课程操作审计</Link>
            <span><AlertTriangle size={14} />资源监控尚未接入；不展示虚假的运行状态。</span>
          </div>
        </section>
      </div>
    </div>
  );
}
