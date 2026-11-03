import {
  BookOpenCheck,
  CheckCircle2,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  LockKeyhole,
  School,
  ShieldCheck,
  UserRound,
  Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import mainStyles from '../../layouts/MainLayout/MainLayout.module.css';
import { getAuthPresentation, getDemoAccount, getRoleHomePath, type UserRole, useAuthStore } from '../../stores/authStore';
import styles from './LoginPage.module.css';

type RoleMeta = {
  title: string;
  shortDescription: string;
  description: string;
  icon: ReactNode;
  capabilities: string[];
};

const roleMeta: Record<UserRole, RoleMeta> = {
  admin: {
    title: '管理员',
    shortDescription: '平台配置与教学资源管理',
    description: '管理账号、课程与实验定义；资源运维目前仅演示。',
    icon: <ShieldCheck size={22} />,
    capabilities: ['账号与课程管理', '实验定义维护', '资源功能仅演示'],
  },
  teacher: {
    title: '教师',
    shortDescription: '课程实验与教学过程管理',
    description: '管理本人课程实验定义；监控和成绩目前仅演示。',
    icon: <School size={22} />,
    capabilities: ['本人课程与学生名单', '实验定义发布', '监控与成绩仅演示'],
  },
  student: {
    title: '学生',
    shortDescription: '实验学习与无人机仿真训练',
    description: '进入课程实验，完成无人机仿真操作并查看个人学习结果。',
    icon: <GraduationCap size={22} />,
    capabilities: ['实验中心', '实时飞控训练', '个人记录与成绩'],
  },
};

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as { message?: string } | null)?.message;
  const login = useAuthStore((state) => state.login);
  const [role, setRole] = useState<UserRole>('student');
  const initial = useMemo(() => getDemoAccount(role), [role]);
  const presentation = getAuthPresentation();
  const demo = presentation.demo;
  const [username, setUsername] = useState(demo ? initial.username : '');
  const [password, setPassword] = useState(demo ? initial.password : '');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedMeta = roleMeta[role];

  const selectRole = (nextRole: UserRole) => {
    const account = getDemoAccount(nextRole);
    setRole(nextRole);
    setUsername(demo ? account.username : '');
    setPassword(demo ? account.password : '');
    setError('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const result = await login({ username, password, role });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message ?? '登录失败');
      return;
    }
    navigate(getRoleHomePath(useAuthStore.getState().role), { replace: true });
  };

  return (
    <div className={styles.loginRoot}>
      <header className={`${mainStyles.topHeader} ${styles.loginTopHeader}`}>
        <div className={mainStyles.brand} aria-label="MUVA 平台">
          <span className={mainStyles.brandMark} aria-hidden="true"><i /><i /><i /></span>
          <strong>MUVA</strong>
          <span>无人机教学与安全实验平台</span>
        </div>
        <div className={mainStyles.slogan}>探索天空 · 安全飞行 · 智能未来</div>
        <div className={styles.headerRight}>
          <span className={styles.entryBadge}><LockKeyhole size={14} />教学平台入口</span>
          <time className={mainStyles.headerTime} dateTime={now.toISOString()}>
            <span>{now.toLocaleDateString('zh-CN')}&nbsp;&nbsp;{now.toLocaleTimeString('zh-CN', { hour12: false })}</span>
            <small>{now.toLocaleDateString('zh-CN', { weekday: 'long' })}</small>
          </time>
        </div>
      </header>

      <main className={styles.loginPage}>
        <section className={styles.loginFrame} aria-label="MUVA 登录">
          <header className={styles.frameHeader}>
            <div>
              <span className={styles.sectionEyebrow}><KeyRound size={15} />身份认证</span>
              <h1>选择角色登录</h1>
              <p>请选择与账号对应的身份，登录后系统将进入相应的教学工作台。</p>
            </div>
            <div className={styles.authStatus}>
              <span>认证方式</span>
              <strong><CheckCircle2 size={14} />{presentation.label}</strong>
            </div>
          </header>

          <div className={styles.loginContent}>
            <aside className={styles.roleSection} aria-label="登录角色">
              <div className={styles.sectionHeading}>
                <span>登录角色</span>
                <small>ROLE SELECTION</small>
              </div>

              <div className={styles.roleList}>
                {(Object.keys(roleMeta) as UserRole[]).map((itemRole) => {
                  const meta = roleMeta[itemRole];
                  const active = itemRole === role;
                  return (
                    <button
                      key={itemRole}
                      type="button"
                      className={`${styles.roleCard} ${active ? styles.roleCardActive : ''}`}
                      aria-pressed={active}
                      onClick={() => selectRole(itemRole)}
                    >
                      <span className={styles.roleIcon}>{meta.icon}</span>
                      <span className={styles.roleCopy}>
                        <strong>{meta.title}</strong>
                        <small>{meta.shortDescription}</small>
                      </span>
                      <span className={styles.roleState}>{active ? '已选择' : '选择'}</span>
                    </button>
                  );
                })}
              </div>

              <div className={styles.roleScope}>
                <div className={styles.roleScopeTitle}><BookOpenCheck size={14} />当前角色功能</div>
                {selectedMeta.capabilities.map((item) => <span key={item}>• {item}</span>)}
              </div>
            </aside>

            <form className={styles.authSection} onSubmit={submit}>
              <div className={styles.selectedRoleHeader}>
                <span className={styles.selectedRoleIcon}>{selectedMeta.icon}</span>
                <div>
                  <span>当前登录身份</span>
                  <strong>{selectedMeta.title}</strong>
                  <small>{selectedMeta.description}</small>
                </div>
              </div>

              <div className={styles.formFields}>
                <label>
                  <span>账号</span>
                  <div className={styles.inputWrap}>
                    <UserRound size={17} />
                    <input
                      autoFocus
                      autoComplete="username"
                      value={username}
                      placeholder="请输入登录账号"
                      onChange={(event) => { setUsername(event.target.value); setError(''); }}
                    />
                  </div>
                </label>

                <label>
                  <span>密码</span>
                  <div className={styles.inputWrap}>
                    <LockKeyhole size={17} />
                    <input
                      autoComplete="current-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      placeholder="请输入登录密码"
                      onChange={(event) => { setPassword(event.target.value); setError(''); }}
                    />
                    <button type="button" aria-label="显示或隐藏密码" onClick={() => setShowPassword((value) => !value)}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </label>
              </div>

              {notice && !error ? <div role="status" className={styles.loginHelp}>{notice}</div> : null}
              {error ? <div role="alert" className={styles.loginError}>{error}</div> : null}

              <button className={styles.loginButton} type="submit" disabled={submitting}>
                {submitting ? '身份验证中…' : `登录${selectedMeta.title}端`}
              </button>

              {demo && <div className={styles.demoAccount}>
                <Wrench size={13} />
                <span>开发联调账号</span>
                <strong>{getDemoAccount(role).username}</strong>
                <i>/</i>
                <strong>{getDemoAccount(role).password}</strong>
              </div>}

              <p className={styles.loginHelp}>{presentation.help}</p>
            </form>
          </div>

          <footer className={styles.frameFooter}>
            <span>MUVA 教学平台 V1.0</span>
            <span>{presentation.footer}</span>
            <span>仅限授权用户访问</span>
          </footer>
        </section>

        <footer className={styles.pageFooter}>无人机教学与安全实验平台 · 虚拟仿真实验教学环境</footer>
      </main>
    </div>
  );
}
