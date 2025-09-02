// Firebase-based course persistence system
import { FirebaseDatabase, FirebaseCourse } from './database.js';

export interface CourseEntry {
  id: string;
  title: string;
  levelIds: string[];
  isPublic?: boolean;
  lastModified?: number;
}

export class FirebaseCourseStore {
  private initialized = false;
  private cachedCourses: Map<string, FirebaseCourse> = new Map();

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  async getCourses(): Promise<CourseEntry[]> {
    try {
      const courses = await FirebaseDatabase.getCourses();
      // cache
      for (const c of courses) this.cachedCourses.set(c.id, c);
      return courses
        .map(c => ({
          id: c.id,
          title: c.title || 'Untitled Course',
          levelIds: Array.isArray((c as any).levelIds) ? (c as any).levelIds : [],
          isPublic: (c as any).isPublic,
          lastModified: (c as any).lastModified,
        }))
        .sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
    } catch (e) {
      console.error('Failed to fetch courses:', e);
      return [];
    }
  }

  async createCourse(title: string, levelIds: string[] = [], isPublic = true): Promise<string> {
    const course: Omit<FirebaseCourse, 'id'> = {
      title: title || 'Untitled Course',
      levelIds: [...levelIds],
      createdAt: Date.now(),
      lastModified: Date.now(),
      isPublic,
    } as any;
    const id = await FirebaseDatabase.saveCourse(course);
    this.cachedCourses.set(id, { id, ...course });
    return id;
  }

  async updateCourse(courseId: string, updates: Partial<FirebaseCourse>): Promise<void> {
    await FirebaseDatabase.updateCourse(courseId, updates as any);
    const existing = this.cachedCourses.get(courseId) || ({ id: courseId } as any);
    const merged = { ...existing, ...updates, lastModified: Date.now() } as FirebaseCourse;
    this.cachedCourses.set(courseId, merged);
  }

  async deleteCourse(courseId: string): Promise<void> {
    await FirebaseDatabase.deleteCourse(courseId);
    this.cachedCourses.delete(courseId);
  }

  clearCache(): void {
    this.cachedCourses.clear();
  }
}

const firebaseCourseStore = new FirebaseCourseStore();
export default firebaseCourseStore;
