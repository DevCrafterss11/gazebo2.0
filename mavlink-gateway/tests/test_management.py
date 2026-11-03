import os

from fastapi import FastAPI
from fastapi.testclient import TestClient

from muva_gateway.management import bootstrap_admin, init_schema, router, db


def test_account_course_flow_and_role_isolation(tmp_path, monkeypatch):
    monkeypatch.setenv('MUVA_DATABASE_URL', f'sqlite:///{tmp_path / "accounts.db"}')
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    init_schema()
    bootstrap_admin('root', 'secure-admin-password')
    assert client.post('/api/auth/login', json={'username': 'root', 'password': 'bad', 'role': 'admin'}).status_code == 401
    admin_token = client.post('/api/auth/login', json={'username': 'root', 'password': 'secure-admin-password', 'role': 'admin'}).json()['token']
    admin = {'Authorization': f'Bearer {admin_token}'}
    assert client.get('/api/auth/me', headers=admin).json()['role'] == 'admin'
    assert client.post('/api/admin/users', json={'name': 'bad', 'username': 'bad', 'password': '123', 'role': 'teacher', 'organization': 'school'}, headers=admin).status_code == 422
    teacher = client.post('/api/admin/users', json={'name': '张老师', 'username': 'teacher1', 'password': 'teacher-password', 'role': 'teacher', 'organization': 'school'}, headers=admin)
    assert teacher.status_code == 201
    teacher_id = teacher.json()['id']
    student = client.post('/api/admin/users', json={'name': '学生', 'username': 'student1', 'password': 'student-password', 'role': 'student', 'organization': 'class'}, headers=admin).json()
    assert client.post('/api/auth/login', json={'username': 'teacher1', 'password': 'teacher-password', 'role': 'admin'}).status_code == 401
    teacher_token = client.post('/api/auth/login', json={'username': 'teacher1', 'password': 'teacher-password', 'role': 'teacher'}).json()['token']
    teacher_headers = {'Authorization': f'Bearer {teacher_token}'}
    assert client.get('/api/admin/users', headers=teacher_headers).status_code == 403
    assert client.get('/api/admin/users').status_code == 401
    payload = {'code': 'UAV-2026', 'name': '飞行控制', 'teacherId': teacher_id, 'teacherName': '伪造姓名', 'className': '1班', 'semester': '秋季', 'status': '进行中'}
    assert client.post('/api/admin/courses', json=payload, headers=teacher_headers).status_code == 403
    course = client.post('/api/admin/courses', json=payload, headers=admin)
    assert course.status_code == 201
    assert course.json()['teacherName'] == '张老师'
    course_id = course.json()['id']
    assert client.put(f'/api/admin/courses/{course_id}/students', json={'studentIds': [teacher_id]}, headers=admin).status_code == 400
    assert client.put(f'/api/admin/courses/{course_id}/students', json={'studentIds': [student['id'], student['id']]}, headers=admin).json()['studentIds'] == [student['id']]
    assert client.get('/api/teacher/courses', headers=teacher_headers).json()['items'][0]['studentCount'] == 1
    assert client.get('/api/teacher/students', headers=teacher_headers).json()['items'][0]['username'] == 'student1'
    assert client.get('/api/admin/simulation-resources', headers=teacher_headers).status_code == 403
    assert client.get('/api/admin/simulation-resources', headers=admin).status_code == 501
    changed = client.patch(f'/api/admin/users/{student["id"]}', json={'password': 'student-password-new'}, headers=admin)
    assert changed.status_code == 200
    assert client.post('/api/auth/login', json={'username': 'student1', 'password': 'student-password', 'role': 'student'}).status_code == 401
    assert client.post('/api/auth/login', json={'username': 'student1', 'password': 'student-password-new', 'role': 'student'}).status_code == 200
    assert client.get('/api/teacher/courses', headers=admin).status_code == 403
    assert client.patch(f'/api/admin/users/{teacher_id}', json={'status': 'disabled'}, headers=admin).status_code == 200
    assert client.get('/api/teacher/courses', headers=teacher_headers).status_code == 401
    assert client.post('/api/auth/login', json={'username': 'teacher1', 'password': 'teacher-password', 'role': 'teacher'}).status_code == 401
    draft = client.post('/api/teacher/experiments', json={'courseId': course_id, 'name': '航点训练', 'maxAltitude': 30}, headers=teacher_headers)
    # Teacher has been disabled above: old session must no longer be able to publish.
    assert draft.status_code == 401
    assert client.get('/api/admin/experiments', headers=admin).json()['total'] == 0
    assert client.get('/api/admin/audit-logs', headers=admin).json()['total'] >= 4
    assert client.post('/api/auth/logout', headers=admin).status_code == 200
    assert client.get('/api/auth/me', headers=admin).status_code == 401
    with db() as conn:
        assert 'teacher-password' not in conn.one('SELECT password_hash FROM users WHERE id=?', (teacher_id,))['password_hash']


def test_experiment_owned_by_teacher(tmp_path, monkeypatch):
    monkeypatch.setenv('MUVA_DATABASE_URL', f'sqlite:///{tmp_path / "experiments.db"}')
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    bootstrap_admin('root', 'secure-admin-password')
    admin = {'Authorization': 'Bearer ' + client.post('/api/auth/login', json={'username': 'root', 'password': 'secure-admin-password', 'role': 'admin'}).json()['token']}
    teachers = []
    for n in (1, 2):
        teachers.append(client.post('/api/admin/users', json={'name': f'Teacher {n}', 'username': f'teacher{n}', 'password': 'teacher-password', 'role': 'teacher', 'organization': 'school'}, headers=admin).json())
    course = client.post('/api/admin/courses', json={'code': 'C1', 'name': '控制', 'teacherId': teachers[0]['id'], 'className': '1班', 'semester': '秋季'}, headers=admin).json()
    tokens = [{'Authorization': 'Bearer ' + client.post('/api/auth/login', json={'username': f'teacher{n}', 'password': 'teacher-password', 'role': 'teacher'}).json()['token']} for n in (1, 2)]
    payload = {'courseId': course['id'], 'name': '航点训练', 'maxAltitude': 30}
    assert client.post('/api/teacher/experiments', json=payload, headers=tokens[1]).status_code == 403
    draft = client.post('/api/teacher/experiments', json=payload, headers=tokens[0])
    assert draft.status_code == 201
    eid = draft.json()['id']
    assert draft.json()['status'] == '草稿'
    assert client.get('/api/teacher/experiments', headers=tokens[1]).json()['total'] == 0
    assert client.patch(f'/api/teacher/experiments/{eid}', json={'status': '已发布'}, headers=tokens[1]).status_code == 403
    assert client.patch(f'/api/teacher/experiments/{eid}', json={'status': '已结束'}, headers=tokens[0]).status_code == 409
    published = client.patch(f'/api/teacher/experiments/{eid}', json={'status': '已发布'}, headers=tokens[0])
    assert published.json()['version'] == 2
    assert client.get('/api/admin/experiments', headers=admin).json()['total'] == 1
    assert client.get('/api/admin/experiments', headers=tokens[0]).status_code == 403


def test_admin_edit_and_membership_atomicity(tmp_path, monkeypatch):
    monkeypatch.setenv('MUVA_DATABASE_URL', f'sqlite:///{tmp_path / "admin-edit.db"}')
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    bootstrap_admin('root', 'secure-admin-password')

    def headers(username, password, role):
        response = client.post('/api/auth/login', json={'username': username, 'password': password, 'role': role})
        assert response.status_code == 200
        return {'Authorization': 'Bearer ' + response.json()['token']}

    admin = headers('root', 'secure-admin-password', 'admin')
    teacher = client.post('/api/admin/users', json={
        'name': '教师', 'username': 'teacher3', 'password': 'teacher-password', 'role': 'teacher', 'organization': '学院',
    }, headers=admin).json()
    student = client.post('/api/admin/users', json={
        'name': '学生', 'username': 'student3', 'password': 'student-password', 'role': 'student', 'organization': '学院',
    }, headers=admin).json()
    course = client.post('/api/admin/courses', json={
        'code': 'T3', 'name': '飞行教学', 'teacherId': teacher['id'], 'className': '三班', 'semester': '秋季',
    }, headers=admin).json()
    cid = course['id']
    assert client.put(f'/api/admin/courses/{cid}/students', json={'studentIds': [student['id']]}, headers=admin).status_code == 200
    assert client.put(f'/api/admin/courses/{cid}/students', json={'studentIds': ['unknown']}, headers=admin).status_code == 400
    assert client.get(f'/api/admin/courses/{cid}/students', headers=admin).json()['studentIds'] == [student['id']]
    assert client.get('/api/admin/courses', headers=admin).json()['items'][0]['studentCount'] == 1

    owner = headers('teacher3', 'teacher-password', 'teacher')
    assert client.post('/api/teacher/experiments', json={'courseId': cid, 'name': '   '}, headers=owner).status_code == 400
    created = client.post('/api/teacher/experiments', json={'courseId': cid, 'name': '航点训练'}, headers=owner)
    assert created.status_code == 201
    eid = created.json()['id']
    assert client.patch(f'/api/teacher/experiments/{eid}', json={'name': '  '}, headers=admin).status_code == 400
    edited = client.patch(f'/api/teacher/experiments/{eid}', json={
        'name': '航点训练（修订）', 'maxAltitude': 45,
    }, headers=admin)
    assert edited.status_code == 200
    assert edited.json()['version'] == 2
    assert edited.json()['maxAltitude'] == 45
    assert client.get('/api/teacher/experiments', headers=owner).json()['items'][0]['name'] == '航点训练（修订）'
    published = client.patch(f'/api/teacher/experiments/{eid}', json={'status': '已发布'}, headers=owner).json()
    assert published['version'] == 3
    assert client.patch(f'/api/teacher/experiments/{eid}', json={'status': '已结束'}, headers=owner).status_code == 200
    assert client.patch(f'/api/teacher/experiments/{eid}', json={'name': '不允许'}, headers=admin).status_code == 409
    assert client.patch(f'/api/admin/courses/{cid}', json={'status': '已结束'}, headers=admin).status_code == 200
    assert client.post('/api/teacher/experiments', json={'courseId': cid, 'name': '新实验'}, headers=owner).status_code == 409


def test_self_password_change_revokes_all_sessions(tmp_path, monkeypatch):
    monkeypatch.setenv('MUVA_DATABASE_URL', f'sqlite:///{tmp_path / "password.db"}')
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    bootstrap_admin('root', 'secure-admin-password')
    def login(password):
        return client.post('/api/auth/login', json={
            'username': 'root', 'password': password, 'role': 'admin',
        })
    first = {'Authorization': 'Bearer ' + login('secure-admin-password').json()['token']}
    second = {'Authorization': 'Bearer ' + login('secure-admin-password').json()['token']}
    endpoint = '/api/auth/change-password'
    assert client.post(endpoint, json={'currentPassword': 'wrong', 'newPassword': 'new-secure-password'}, headers=first).status_code == 400
    assert client.post(endpoint, json={'currentPassword': 'secure-admin-password', 'newPassword': 'short'}, headers=first).status_code == 422
    assert client.get('/api/auth/me', headers=second).status_code == 200
    assert client.post(endpoint, json={'currentPassword': 'secure-admin-password', 'newPassword': 'new-secure-password'}, headers=first).status_code == 200
    assert client.get('/api/auth/me', headers=first).status_code == 401
    assert client.get('/api/auth/me', headers=second).status_code == 401
    assert login('secure-admin-password').status_code == 401
    assert login('new-secure-password').status_code == 200
