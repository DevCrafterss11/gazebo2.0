import { httpClient } from './http/client';
import { adminApi } from './adminApi';
import { useAuthStore } from '../stores/authStore';
import type { AdminCourse, AdminListResult, AdminUser } from '../types/admin';

export interface TeacherApi {
  listCourses(): Promise<AdminListResult<AdminCourse>>;
  listStudents(): Promise<AdminListResult<AdminUser>>;
}

const mockTeacherApi: TeacherApi = {
  async listStudents() {
    const [courses, users] = await Promise.all([mockTeacherApi.listCourses(), adminApi.listUsers({ role: 'student' })]);
    const memberLists = await Promise.all(courses.items.map((course) => adminApi.listCourseMembers(course.id)));
    const ids = new Set(memberLists.flat());
    const items = users.items.filter((user) => ids.has(user.id));
    return { items, total: items.length };
  },
  async listCourses() {
    const result = await adminApi.listCourses();
    const { userId, username } = useAuthStore.getState();
    const teacherId = username === 'teacher01' ? 'u-teacher-01' : userId;
    const items = result.items.filter((course) => course.teacherId === teacherId);
    return { items, total: items.length };
  },
};
const apiTeacherApi: TeacherApi = {
  async listStudents() {
    const { data } = await httpClient.get<AdminListResult<AdminUser>>('/teacher/students');
    return data;
  },
  async listCourses() {
    const { data } = await httpClient.get<AdminListResult<AdminCourse>>('/teacher/courses');
    return data;
  },
};
export const teacherApi = import.meta.env.VITE_AUTH_DATA_SOURCE === 'api' ? apiTeacherApi : mockTeacherApi;
