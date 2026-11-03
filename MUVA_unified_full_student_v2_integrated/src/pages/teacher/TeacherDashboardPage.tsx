import { BookOpenCheck, ChevronRight, Clock3, GraduationCap, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { teacherApi } from '../../services/teacherApi';
import type { AdminCourse, AdminUser } from '../../types/admin';
import styles from '../platform/PlatformPages.module.css';

export function TeacherDashboardPage() {
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [students, setStudents] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.all([teacherApi.listCourses(), teacherApi.listStudents()]).then(([courseResult, studentResult]) => {
      if (active) { setCourses(courseResult.items); setStudents(studentResult.items); }
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '教学数据加载失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><h1>教师工作台</h1><p>只统计当前教师所负责的课程及学生；实验监控和成绩尚未连接真实教学数据。</p></div>
        <span><Clock3 size={15} />{new Date().toLocaleDateString('zh-CN')}</span>
      </header>
      {loading && <p role="status">正在加载教学数据…</p>}
      {error && <p role="alert">{error}</p>}
      <div className={styles.dashboardGrid}>
        <section className={`${styles.panel} ${styles.statusPanel}`}>
          <h2><GraduationCap size={18} />教学概览</h2>
          <div className={styles.statusGrid}>
            <div className={styles.statusCard}><span>我的课程</span><strong>{loading ? '—' : courses.length}</strong><i>由管理员分配</i></div>
            <div className={styles.statusCard}><span>学生人数</span><strong>{loading ? '—' : students.length}</strong><i>跨课程去重</i></div>
            <div className={styles.statusCard}><span>进行中课程</span><strong>{loading ? '—' : courses.filter((c) => c.status === '进行中').length}</strong><i>按课程状态统计</i></div>
            <div className={styles.statusCard}><span>已停用学生</span><strong>{loading ? '—' : students.filter((s) => s.status === 'disabled').length}</strong><i>请联系管理员处理</i></div>
          </div>
        </section>
        <section className={`${styles.panel} ${styles.currentPanel}`}>
          <h2><BookOpenCheck size={18} />教学入口</h2>
          <div className={styles.currentExperiment}>
            <span>MY COURSES</span><strong>{courses[0]?.name ?? '暂无授课课程'}</strong>
            <small>{courses[0] ? `${courses[0].className} · ${courses[0].semester}` : '请联系管理员分配课程'}</small>
            <Link className={styles.primaryButton} to="/teacher/courses">查看课程 <ChevronRight size={15} /></Link>
          </div>
        </section>
        <section className={`${styles.panel} ${styles.alertsPanel}`}>
          <h2><Users size={18} />我的课程</h2>
          <div className={styles.alertList}>
            {courses.map((course) => <Link key={course.id} to="/teacher/courses"><BookOpenCheck size={14} />{course.name} · {course.className}（{course.studentCount} 人）</Link>)}
            {!courses.length && !loading && <span>暂无课程</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
