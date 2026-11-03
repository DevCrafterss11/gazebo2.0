import { ArrowRight, BookOpenCheck, CalendarDays, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { teacherApi } from '../../services/teacherApi';
import type { AdminCourse } from '../../types/admin';
import styles from '../role/RolePages.module.css';

export function TeacherCoursesPage() {
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void teacherApi.listCourses().then((result) => {
      if (active) setCourses(result.items);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : '课程加载失败');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return (
    <div className={styles.rolePage}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}><span className={styles.heroEyebrow}><BookOpenCheck size={14} /> COURSE MANAGEMENT</span><h1>我的课程</h1><p>展示当前账号负责的课程与班级；课程分配由管理员管理。</p></div>
        <div className={styles.heroAction}><span>当前 {courses.length} 个教学班</span></div>
      </section>
      {loading && <p role="status">正在加载课程…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && courses.length === 0 && <p>暂无分配的课程，请联系管理员。</p>}
      <div className={styles.cardGrid}>
        {courses.map((course) => (
          <article className={styles.courseCard} key={course.id}>
            <div className={styles.cardIcon}><BookOpenCheck size={21} /></div>
            <h2>{course.name}</h2><p>{course.className} · {course.semester}</p>
            <div className={styles.cardStats}>
              <span><Users size={12} />学生<strong>{course.studentCount}</strong></span>
              <span><CalendarDays size={12} />实验<strong>{course.experimentCount}</strong></span>
              <span>状态<strong>{course.status}</strong></span>
            </div>
            <div className={styles.cardFooter}><span>编号：{course.code}</span><Link to="/teacher/experiments">查看实验 <ArrowRight size={12} /></Link></div>
          </article>
        ))}
      </div>
    </div>
  );
}
