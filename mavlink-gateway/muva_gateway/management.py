"""Account and course management, isolated from the flight-control runtime.

Set MUVA_DATABASE_URL to a PostgreSQL URL (or sqlite:/// for local tests).
No tables or demo credentials are created unless explicitly initialized.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix='/api')
ROLES = {'admin', 'teacher', 'student'}
PERMISSIONS = {
    'admin': ['user:manage', 'course:manage', 'experiment:definition', 'resource:manage', 'audit:view'],
    'teacher': ['course:view', 'experiment:manage', 'student:records', 'grade:manage', 'simulation:demo'],
    'student': ['course:view', 'experiment:execute', 'record:self', 'report:self', 'grade:self'],
}


def database_url() -> str:
    url = os.getenv('MUVA_DATABASE_URL', '')
    if not url:
        raise HTTPException(503, '未配置 MUVA_DATABASE_URL；请先启动数据库并初始化管理员')
    return url


@contextmanager
def db():
    url = database_url()
    if url.startswith('sqlite:///'):
        conn = sqlite3.connect(url.removeprefix('sqlite:///'))
        conn.row_factory = sqlite3.Row
        pg = False
    elif url.startswith(('postgresql://', 'postgres://')):
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise RuntimeError('PostgreSQL 需要安装 psycopg[binary]') from exc
        conn = psycopg.connect(url, row_factory=dict_row)
        pg = True
    else:
        raise RuntimeError('MUVA_DATABASE_URL 必须是 postgresql:// 或 sqlite:///')
    try:
        yield Connection(conn, pg)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


class Connection:
    def __init__(self, conn, pg: bool):
        self.conn, self.pg = conn, pg

    def execute(self, sql: str, params: tuple = ()):
        return self.conn.execute(sql.replace('?', '%s') if self.pg else sql, params)

    def one(self, sql: str, params: tuple = ()):
        row = self.execute(sql, params).fetchone()
        return dict(row) if row else None

    def all(self, sql: str, params: tuple = ()):
        return [dict(row) for row in self.execute(sql, params).fetchall()]


def init_schema():
    with db() as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
            role TEXT NOT NULL, organization TEXT NOT NULL, status TEXT NOT NULL,
            password_hash TEXT NOT NULL, created_at TEXT NOT NULL)''')
        conn.execute('''CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
            expires_at TEXT NOT NULL)''')
        conn.execute('''CREATE TABLE IF NOT EXISTS courses (
            id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
            teacher_id TEXT NOT NULL REFERENCES users(id), class_name TEXT NOT NULL,
            semester TEXT NOT NULL, status TEXT NOT NULL)''')
        conn.execute('''CREATE TABLE IF NOT EXISTS course_members (
            course_id TEXT NOT NULL REFERENCES courses(id), student_id TEXT NOT NULL REFERENCES users(id),
            PRIMARY KEY(course_id, student_id))''')
        conn.execute('''CREATE TABLE IF NOT EXISTS teaching_experiments (
            id TEXT PRIMARY KEY, course_id TEXT NOT NULL REFERENCES courses(id),
            name TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL,
            version INTEGER NOT NULL, max_altitude INTEGER NOT NULL,
            duration INTEGER NOT NULL, updated_at TEXT NOT NULL)''')
        conn.execute('''CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY, time TEXT NOT NULL, account TEXT NOT NULL,
            module TEXT NOT NULL, action TEXT NOT NULL, result TEXT NOT NULL, ip TEXT NOT NULL)''')


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 310_000)
    return f'pbkdf2_sha256$310000${salt.hex()}${digest.hex()}'


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt, digest = encoded.split('$')
        if algorithm != 'pbkdf2_sha256':
            return False
        candidate = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(candidate, bytes.fromhex(digest))
    except (ValueError, TypeError):
        return False


def utc_now():
    return datetime.now(timezone.utc)


def audit(conn: Connection, account: str, module: str, action: str):
    conn.execute('INSERT INTO audit_logs VALUES (?, ?, ?, ?, ?, ?, ?)',
                 (str(uuid4()), utc_now().isoformat(), account, module, action, '成功', '--'))


def public_user(user: dict):
    return {key: user[key] for key in ('id', 'username', 'name', 'role', 'organization', 'status', 'created_at')}


def admin_user(user: dict):
    return {**{key: user[key] for key in ('id', 'username', 'name', 'role', 'organization', 'status')},
            'createdAt': user['created_at']}


def identity(user: dict):
    return {'id': user['id'], 'username': user['username'], 'displayName': user['name'],
            'role': user['role'], 'permissions': PERMISSIONS[user['role']]}


def current_user(authorization: str | None = Header(default=None)):
    token = authorization.removeprefix('Bearer ') if authorization and authorization.startswith('Bearer ') else ''
    if not token:
        raise HTTPException(401, '请登录')
    with db() as conn:
        user = conn.one('''SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
                           WHERE s.token_hash=? AND s.expires_at>? AND u.status='active' ''',
                        (hashlib.sha256(token.encode()).hexdigest(), utc_now().isoformat()))
    if not user:
        raise HTTPException(401, '登录已过期或账号已停用')
    return user


def require(*roles):
    def check(user=Depends(current_user)):
        if user['role'] not in roles:
            raise HTTPException(403, '无权访问')
        return user
    return check


class Login(BaseModel):
    username: str
    password: str
    role: str


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    username: str = Field(min_length=3, max_length=64, pattern=r'^[A-Za-z0-9_.-]+$')
    password: str = Field(min_length=10, max_length=256)
    role: str
    organization: str = Field(min_length=1, max_length=120)


class UserUpdate(BaseModel):
    password: str | None = Field(default=None, min_length=10, max_length=256)
    name: str | None = None
    role: str | None = None
    organization: str | None = None
    status: str | None = None


class CourseCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    teacherId: str
    teacherName: str = ''  # supplied by UI, never trusted
    className: str = Field(min_length=1, max_length=120)
    semester: str = Field(min_length=1, max_length=80)
    status: str = '未开始'


class CourseUpdate(BaseModel):
    name: str | None = None
    teacherId: str | None = None
    teacherName: str | None = None
    className: str | None = None
    semester: str | None = None
    status: str | None = None


class Members(BaseModel):
    studentIds: list[str]


def check_role(role):
    if role not in ROLES:
        raise HTTPException(400, '无效角色')


def check_status(status):
    if status not in ('active', 'disabled'):
        raise HTTPException(400, '无效状态')


def check_course_status(status):
    if status not in ('未开始', '进行中', '已结束'):
        raise HTTPException(400, '无效课程状态')


@router.post('/auth/login')
def login(body: Login):
    check_role(body.role)
    with db() as conn:
        user = conn.one('SELECT * FROM users WHERE username=?', (body.username.strip(),))
        if not user or not verify_password(body.password, user['password_hash']) or user['role'] != body.role or user['status'] != 'active':
            raise HTTPException(401, '账号、密码或角色不正确，或账号已停用')
        token = secrets.token_urlsafe(32)
        conn.execute('DELETE FROM sessions WHERE expires_at<=?', (utc_now().isoformat(),))
        conn.execute('INSERT INTO sessions VALUES (?, ?, ?)',
                     (hashlib.sha256(token.encode()).hexdigest(), user['id'], (utc_now() + timedelta(hours=8)).isoformat()))
        audit(conn, user['username'], '身份认证', '登录')
        return {'token': token, 'user': identity(user)}


@router.get('/auth/me')
def me(user=Depends(current_user)):
    return identity(user)

class PasswordChange(BaseModel):
    currentPassword: str
    newPassword: str = Field(min_length=10, max_length=256)


@router.post('/auth/change-password')
def change_password(body: PasswordChange, user=Depends(current_user)):
    if not verify_password(body.currentPassword, user['password_hash']):
        raise HTTPException(400, '当前密码不正确')
    if body.currentPassword == body.newPassword:
        raise HTTPException(400, '新密码不能与当前密码相同')
    with db() as conn:
        conn.execute('UPDATE users SET password_hash=? WHERE id=?', (password_hash(body.newPassword), user['id']))
        conn.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
        audit(conn, user['username'], '身份认证', '修改密码并撤销所有会话')
    return {'ok': True}



@router.post('/auth/logout')
def logout(authorization: str | None = Header(default=None), user=Depends(current_user)):
    token = authorization.removeprefix('Bearer ')
    with db() as conn:
        conn.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),))
        audit(conn, user['username'], '身份认证', '退出')
    return {'ok': True}


@router.get('/admin/users')
def list_users(keyword: str = '', role: str = 'all', status: str = 'all', user=Depends(require('admin'))):
    with db() as conn:
        users = [admin_user(row) for row in conn.all('SELECT * FROM users ORDER BY created_at DESC')]
    items = [u for u in users if (not keyword or keyword.lower() in (u['name'] + u['username'] + u['organization']).lower())
             and (role == 'all' or u['role'] == role) and (status == 'all' or u['status'] == status)]
    return {'items': items, 'total': len(items)}


@router.post('/admin/users', status_code=201)
def create_user(body: UserCreate, actor=Depends(require('admin'))):
    check_role(body.role)
    with db() as conn:
        if conn.one('SELECT id FROM users WHERE username=?', (body.username,)):
            raise HTTPException(409, '账号已存在')
        user_id = str(uuid4())
        created = utc_now().isoformat()
        conn.execute('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                     (user_id, body.username, body.name, body.role, body.organization, 'active', password_hash(body.password), created))
        audit(conn, actor['username'], '用户管理', f'创建账号 {body.username}')
        return admin_user(conn.one('SELECT * FROM users WHERE id=?', (user_id,)))


@router.patch('/admin/users/{user_id}')
def update_user(user_id: str, body: UserUpdate, actor=Depends(require('admin'))):
    with db() as conn:
        target = conn.one('SELECT * FROM users WHERE id=?', (user_id,))
        if not target:
            raise HTTPException(404, '用户不存在')
        if target['role'] == 'admin':
            raise HTTPException(403, '系统管理员账号不能通过此接口修改')
        values = body.model_dump(exclude_none=True)
        if 'role' in values:
            check_role(values['role'])
        if 'status' in values:
            check_status(values['status'])
        if values.get('role') and values['role'] != target['role']:
            if conn.one('SELECT id FROM courses WHERE teacher_id=?', (user_id,)) or conn.one('SELECT course_id FROM course_members WHERE student_id=?', (user_id,)):
                raise HTTPException(409, '该账号已关联课程，不能变更角色')
        for field in ('name', 'role', 'organization', 'status'):
            if field in values:
                if not str(values[field]).strip():
                    raise HTTPException(400, '字段不能为空')
                conn.execute(f'UPDATE users SET {field}=? WHERE id=?', (values[field], user_id))
        if 'password' in values:
            conn.execute('UPDATE users SET password_hash=? WHERE id=?', (password_hash(values['password']), user_id))
            conn.execute('DELETE FROM sessions WHERE user_id=?', (user_id,))
        if values.get('status') == 'disabled':
            conn.execute('DELETE FROM sessions WHERE user_id=?', (user_id,))
        audit(conn, actor['username'], '用户管理', f'修改账号 {target["username"]}')
        return admin_user(conn.one('SELECT * FROM users WHERE id=?', (user_id,)))


def course_view(conn, row):
    teacher = conn.one('SELECT name FROM users WHERE id=?', (row['teacher_id'],))
    count = conn.one('SELECT COUNT(*) AS n FROM course_members WHERE course_id=?', (row['id'],))['n']
    experiment_count = conn.one('SELECT COUNT(*) AS n FROM teaching_experiments WHERE course_id=?', (row['id'],))['n']
    return {'id': row['id'], 'code': row['code'], 'name': row['name'], 'teacherId': row['teacher_id'],
            'teacherName': teacher['name'], 'className': row['class_name'], 'semester': row['semester'],
            'status': row['status'], 'studentCount': count, 'experimentCount': experiment_count}


def course_or_404(conn, course_id):
    row = conn.one('SELECT * FROM courses WHERE id=?', (course_id,))
    if not row:
        raise HTTPException(404, '课程不存在')
    return row


def assert_teacher(conn, teacher_id):
    teacher = conn.one('SELECT id FROM users WHERE id=? AND role=? AND status=?', (teacher_id, 'teacher', 'active'))
    if not teacher:
        raise HTTPException(400, '授课教师不存在或已停用')


@router.get('/admin/courses')
def list_courses(keyword: str = '', semester: str = 'all', status: str = 'all', actor=Depends(require('admin'))):
    with db() as conn:
        items = [course_view(conn, row) for row in conn.all('SELECT * FROM courses ORDER BY code')]
    items = [c for c in items if (not keyword or keyword.lower() in (c['code'] + c['name'] + c['teacherName'] + c['className']).lower())
             and (semester == 'all' or c['semester'] == semester) and (status == 'all' or c['status'] == status)]
    return {'items': items, 'total': len(items)}


@router.post('/admin/courses', status_code=201)
def create_course(body: CourseCreate, actor=Depends(require('admin'))):
    check_course_status(body.status)
    with db() as conn:
        assert_teacher(conn, body.teacherId)
        if conn.one('SELECT id FROM courses WHERE code=?', (body.code,)):
            raise HTTPException(409, '课程编号已存在')
        course_id = str(uuid4())
        conn.execute('INSERT INTO courses VALUES (?, ?, ?, ?, ?, ?, ?)',
                     (course_id, body.code, body.name, body.teacherId, body.className, body.semester, body.status))
        audit(conn, actor['username'], '课程管理', f'创建课程 {body.code}')
        return course_view(conn, course_or_404(conn, course_id))


@router.patch('/admin/courses/{course_id}')
def update_course(course_id: str, body: CourseUpdate, actor=Depends(require('admin'))):
    with db() as conn:
        course_or_404(conn, course_id)
        values = body.model_dump(exclude_none=True)
        if 'teacherId' in values:
            assert_teacher(conn, values['teacherId'])
        if 'status' in values:
            check_course_status(values['status'])
        fields = {'name': 'name', 'teacherId': 'teacher_id', 'className': 'class_name', 'semester': 'semester', 'status': 'status'}
        for key, column in fields.items():
            if key in values:
                if not str(values[key]).strip():
                    raise HTTPException(400, '课程字段不能为空')
                conn.execute(f'UPDATE courses SET {column}=? WHERE id=?', (values[key], course_id))
        audit(conn, actor['username'], '课程管理', f'修改课程 {course_id}')
        return course_view(conn, course_or_404(conn, course_id))


@router.get('/admin/courses/{course_id}/students')
def list_members(course_id: str, actor=Depends(require('admin'))):
    with db() as conn:
        course_or_404(conn, course_id)
        return {'studentIds': [r['student_id'] for r in conn.all('SELECT student_id FROM course_members WHERE course_id=?', (course_id,))]}


@router.put('/admin/courses/{course_id}/students')
def update_members(course_id: str, body: Members, actor=Depends(require('admin'))):
    ids = list(dict.fromkeys(body.studentIds))
    with db() as conn:
        course_or_404(conn, course_id)
        for student_id in ids:
            if not conn.one('SELECT id FROM users WHERE id=? AND role=? AND status=?', (student_id, 'student', 'active')):
                raise HTTPException(400, f'学生 {student_id} 不存在或已停用')
        conn.execute('DELETE FROM course_members WHERE course_id=?', (course_id,))
        for student_id in ids:
            conn.execute('INSERT INTO course_members VALUES (?, ?)', (course_id, student_id))
        audit(conn, actor['username'], '课程管理', f'更新课程成员 {course_id}')
    return {'studentIds': ids}


@router.get('/admin/audit-logs')
def list_logs(keyword: str = '', module: str = 'all', result: str = 'all', actor=Depends(require('admin'))):
    with db() as conn:
        logs = conn.all('SELECT * FROM audit_logs ORDER BY time DESC LIMIT 500')
    items = [log for log in logs if (not keyword or keyword.lower() in (log['account'] + log['module'] + log['action']).lower())
             and (module == 'all' or log['module'] == module) and (result == 'all' or log['result'] == result)]
    return {'items': items, 'total': len(items)}


@router.get('/admin/simulation-resources')
def resources(actor=Depends(require('admin'))):
    raise HTTPException(501, '仿真资源控制尚未连接运行时；当前不可用')


@router.post('/admin/simulation-resources/{resource_id}/restart')
def restart_resource(resource_id: str, actor=Depends(require('admin'))):
    raise HTTPException(501, '仿真资源控制尚未连接运行时；当前不可用')


@router.post('/admin/simulation-resources/{resource_id}/stop')
def stop_resource(resource_id: str, actor=Depends(require('admin'))):
    raise HTTPException(501, '仿真资源控制尚未连接运行时；当前不可用')


@router.get('/teacher/students')
def teacher_students(actor=Depends(require('teacher'))):
    with db() as conn:
        students = conn.all('''SELECT DISTINCT u.id, u.name, u.username, u.role, u.organization,
            u.status, u.created_at FROM users u
            JOIN course_members m ON m.student_id=u.id
            JOIN courses c ON c.id=m.course_id
            WHERE c.teacher_id=? ORDER BY u.name''', (actor['id'],))
        items = [admin_user(student) for student in students]
    return {'items': items, 'total': len(items)}


@router.get('/teacher/courses')
def teacher_courses(actor=Depends(require('teacher'))):
    with db() as conn:
        rows = conn.all('SELECT * FROM courses WHERE teacher_id=? ORDER BY code', (actor['id'],))
        items = [course_view(conn, row) for row in rows]
    return {'items': items, 'total': len(items)}


class ExperimentCreate(BaseModel):
    courseId: str
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default='', max_length=2000)
    maxAltitude: int = Field(default=20, ge=2, le=120)
    duration: int = Field(default=30, ge=5, le=240)


class ExperimentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    maxAltitude: int | None = Field(default=None, ge=2, le=120)
    duration: int | None = Field(default=None, ge=5, le=240)
    status: str | None = None


def experiment_view(conn, row):
    course = course_or_404(conn, row['course_id'])
    return {'id': row['id'], 'courseId': row['course_id'], 'courseName': course['name'],
            'name': row['name'], 'description': row['description'], 'status': row['status'],
            'version': row['version'], 'maxAltitude': row['max_altitude'],
            'duration': row['duration'], 'updatedAt': row['updated_at']}


def experiment_or_404(conn, experiment_id):
    row = conn.one('SELECT * FROM teaching_experiments WHERE id=?', (experiment_id,))
    if not row:
        raise HTTPException(404, '实验定义不存在')
    return row


@router.get('/teacher/experiments')
def teacher_experiments(actor=Depends(require('teacher'))):
    with db() as conn:
        rows = conn.all('SELECT e.* FROM teaching_experiments e JOIN courses c ON c.id=e.course_id WHERE c.teacher_id=? ORDER BY e.updated_at DESC', (actor['id'],))
        items = [experiment_view(conn, row) for row in rows]
    return {'items': items, 'total': len(items)}


@router.post('/teacher/experiments', status_code=201)
def create_experiment(body: ExperimentCreate, actor=Depends(require('teacher'))):
    with db() as conn:
        course = course_or_404(conn, body.courseId)
        if course['teacher_id'] != actor['id']:
            raise HTTPException(403, '不能为其他教师创建实验')
        if not body.name.strip():
            raise HTTPException(400, '实验名称不能为空')
        if course['status'] == '已结束':
            raise HTTPException(409, '已结束课程不能创建实验')
        experiment_id = str(uuid4())
        conn.execute('INSERT INTO teaching_experiments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                     (experiment_id, body.courseId, body.name, body.description, '草稿', 1,
                      body.maxAltitude, body.duration, utc_now().isoformat()))
        audit(conn, actor['username'], '实验定义', f'创建草稿 {body.name}')
        return experiment_view(conn, experiment_or_404(conn, experiment_id))


@router.patch('/teacher/experiments/{experiment_id}')
def update_experiment(experiment_id: str, body: ExperimentUpdate, actor=Depends(require('teacher', 'admin'))):
    with db() as conn:
        current = experiment_or_404(conn, experiment_id)
        course = course_or_404(conn, current['course_id'])
        if actor['role'] == 'teacher' and course['teacher_id'] != actor['id']:
            raise HTTPException(403, '不能修改其他教师的实验')
        values = body.model_dump(exclude_none=True)
        if 'name' in values and not values['name'].strip():
            raise HTTPException(400, '实验名称不能为空')
        if 'status' in values:
            allowed = {'草稿': ('已发布',), '已发布': ('已结束',), '已结束': ()}
            if values['status'] not in allowed[current['status']]:
                raise HTTPException(409, '实验阶段不允许该状态变更')
        if current['status'] == '已结束' and any(key != 'status' for key in values):
            raise HTTPException(409, '已结束实验不可修改')
        fields = {'name': 'name', 'description': 'description', 'maxAltitude': 'max_altitude',
                  'duration': 'duration', 'status': 'status'}
        for key, column in fields.items():
            if key in values:
                conn.execute(f'UPDATE teaching_experiments SET {column}=? WHERE id=?', (values[key], experiment_id))
        if values:
            conn.execute('UPDATE teaching_experiments SET version=version+1, updated_at=? WHERE id=?',
                         (utc_now().isoformat(), experiment_id))
            audit(conn, actor['username'], '实验定义', f'更新实验 {experiment_id}')
        return experiment_view(conn, experiment_or_404(conn, experiment_id))


@router.get('/admin/experiments')
def admin_experiments(actor=Depends(require('admin'))):
    with db() as conn:
        items = [experiment_view(conn, row) for row in conn.all('SELECT * FROM teaching_experiments ORDER BY updated_at DESC')]
    return {'items': items, 'total': len(items)}


def bootstrap_admin(username: str, password: str, name='系统管理员'):
    if len(password) < 10:
        raise ValueError('管理员密码至少 10 个字符')
    init_schema()
    with db() as conn:
        if conn.one('SELECT id FROM users WHERE username=?', (username,)):
            raise ValueError('账号已存在；不会覆盖已有密码')
        conn.execute('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                     (str(uuid4()), username, name, 'admin', '平台运维', 'active', password_hash(password), utc_now().isoformat()))


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['init', 'bootstrap-admin'])
    parser.add_argument('--username', default='admin01')
    args = parser.parse_args()
    if args.command == 'init':
        init_schema()
    else:
        import getpass
        bootstrap_admin(args.username, getpass.getpass('管理员初始密码（至少 10 位）：'))
