import { httpClient } from './http/client';
import { teacherApi } from './teacherApi';
import type { AdminListResult } from '../types/admin';

export interface TeachingExperiment {
  id: string;
  courseId: string;
  courseName: string;
  name: string;
  description: string;
  status: '草稿' | '已发布' | '已结束';
  version: number;
  maxAltitude: number;
  duration: number;
  updatedAt: string;
}
export type ExperimentDraft = Pick<TeachingExperiment, 'courseId' | 'name' | 'description' | 'maxAltitude' | 'duration'>;
export type ExperimentChanges = Partial<Pick<TeachingExperiment, 'name' | 'description' | 'maxAltitude' | 'duration' | 'status'>>;
export interface TeachingExperimentApi {
  listMine(): Promise<AdminListResult<TeachingExperiment>>;
  listAll(): Promise<AdminListResult<TeachingExperiment>>;
  create(input: ExperimentDraft): Promise<TeachingExperiment>;
  update(id: string, input: ExperimentChanges): Promise<TeachingExperiment>;
}
let mockExperiments: TeachingExperiment[] = [];
const mockApi: TeachingExperimentApi = {
  async listMine() {
    const courses = await teacherApi.listCourses();
    const ids = new Set(courses.items.map((course) => course.id));
    const items = mockExperiments.filter((item) => ids.has(item.courseId));
    return { items, total: items.length };
  },
  async listAll() { return { items: [...mockExperiments], total: mockExperiments.length }; },
  async create(input) {
    const courses = await teacherApi.listCourses();
    const course = courses.items.find((item) => item.id === input.courseId);
    if (!course) throw new Error('只能为自己的课程创建实验');
    const item: TeachingExperiment = { ...input, id: crypto.randomUUID(), courseName: course.name,
      status: '草稿', version: 1, updatedAt: new Date().toISOString() };
    mockExperiments = [item, ...mockExperiments];
    return item;
  },
  async update(id, changes) {
    const item = mockExperiments.find((entry) => entry.id === id);
    if (!item) throw new Error('实验不存在');
    if (changes.status && !((item.status === '草稿' && changes.status === '已发布') || (item.status === '已发布' && changes.status === '已结束'))) throw new Error('无效状态变更');
    const updated = { ...item, ...changes, version: item.version + 1, updatedAt: new Date().toISOString() };
    mockExperiments = mockExperiments.map((entry) => entry.id === id ? updated : entry);
    return updated;
  },
};
const api: TeachingExperimentApi = {
  async listMine() { const { data } = await httpClient.get<AdminListResult<TeachingExperiment>>('/teacher/experiments'); return data; },
  async listAll() { const { data } = await httpClient.get<AdminListResult<TeachingExperiment>>('/admin/experiments'); return data; },
  async create(input) { const { data } = await httpClient.post<TeachingExperiment>('/teacher/experiments', input); return data; },
  async update(id, input) { const { data } = await httpClient.patch<TeachingExperiment>(`/teacher/experiments/${id}`, input); return data; },
};
export const teachingExperimentApi = import.meta.env.VITE_AUTH_DATA_SOURCE === 'api' ? api : mockApi;
