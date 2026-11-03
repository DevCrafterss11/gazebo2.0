import { ShieldCheck, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuthPresentation, useAuthStore } from '../../stores/authStore';
import styles from './PlatformPages.module.css';

const roleNames = { admin: '系统管理员', teacher: '教师', student: '学生' } as const;
export function ProfilePage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const changeAccountPassword = useAuthStore((state) => state.changePassword);
  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const current = String(data.get('currentPassword') ?? '');
    const next = String(data.get('newPassword') ?? '');
    if (next !== data.get('confirmPassword')) { setError('两次输入的新密码不一致'); return; }
    setBusy(true); setError('');
    try {
      await changeAccountPassword(current, next);
      form.reset();
      navigate('/login', { replace: true, state: { message: '密码已修改，请重新登录。' } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '修改密码失败'); }
    finally { setBusy(false); }
  };
  const displayName = useAuthStore((state) => state.displayName);
  const username = useAuthStore((state) => state.username);
  const role = useAuthStore((state) => state.role);
  const permissions = useAuthStore((state) => state.permissions);
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><h1>个人信息</h1><p>查看当前登录身份与权限；账号管理由管理员负责。</p></div>
        <span><ShieldCheck size={16} />当前会话</span>
      </header>
      <section className={`${styles.panel} ${styles.profileCard}`}>
        <span className={styles.avatar}><UserRound size={48} /></span>
        <div className={styles.profileInfo}>
          <h2>{displayName}</h2>
          <p>MUVA 无人机教学与安全实验平台 · {roleNames[role]}</p>
          <dl className={styles.definitionList}>
            <div><dt>登录账号</dt><dd>{username}</dd></div>
            <div><dt>账号类型</dt><dd>{roleNames[role]}</dd></div>
            <div><dt>权限编码</dt><dd>{permissions.length ? permissions.join('、') : '未分配'}</dd></div>
            <div><dt>会话范围</dt><dd>当前浏览器标签页</dd></div>
          </dl>
        </div>
      </section>
      {getAuthPresentation().demo ? <p className={styles.profileNote}>演示账号不能修改数据库密码。正式账号请切换数据库认证模式。</p> : (
        <section className={`${styles.panel} ${styles.passwordPanel}`}>
          <h2>修改登录密码</h2>
          <p>修改成功将撤销所有设备上的登录会话，请使用新密码重新登录。</p>
          <form onSubmit={(event) => void changePassword(event)}>
            <label>当前密码<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
            <label>新密码<input name="newPassword" type="password" autoComplete="new-password" minLength={10} maxLength={256} required /></label>
            <label>确认新密码<input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required /></label>
            <button className={styles.primaryButton} disabled={busy} type="submit">{busy ? '修改中…' : '修改密码'}</button>
          </form>
          {error && <p role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
