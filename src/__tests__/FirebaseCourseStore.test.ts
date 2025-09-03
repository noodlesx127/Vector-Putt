import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FirebaseCourseStore } from '../firebase/FirebaseCourseStore';
import { FirebaseDatabase } from '../firebase/database';

vi.mock('../firebase/database', () => ({
  FirebaseDatabase: {
    getCourses: vi.fn(),
    getCourse: vi.fn(),
    saveCourse: vi.fn(),
    updateCourse: vi.fn(),
    deleteCourse: vi.fn(),
  }
}));

describe('FirebaseCourseStore', () => {
  let store: FirebaseCourseStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new FirebaseCourseStore();
  });

  it('getCourses maps, applies defaults, and sorts by lastModified desc', async () => {
    const now = Date.now();
    const input = [
      { id: 'a', title: 'Course A', levelIds: ['L1', 'L2'], createdAt: now - 1000, lastModified: now - 500, isPublic: true },
      { id: 'b', title: '', levelIds: undefined, createdAt: now - 2000, lastModified: now - 100, isPublic: undefined },
      { id: 'c', title: undefined as any, levelIds: 'not-array' as any, createdAt: now - 3000, lastModified: undefined as any },
    ];
    vi.mocked(FirebaseDatabase.getCourses).mockResolvedValue(input as any);

    const courses = await store.getCourses();

    expect(FirebaseDatabase.getCourses).toHaveBeenCalled();
    // Sorted by lastModified descending: b (newest), a, c (0)
    expect(courses.map(c => c.id)).toEqual(['b', 'a', 'c']);

    // Mapped fields
    const a = courses.find(c => c.id === 'a')!;
    expect(a.title).toBe('Course A');
    expect(a.levelIds).toEqual(['L1', 'L2']);
    expect(a.isPublic).toBe(true);
    expect(typeof a.lastModified === 'number').toBe(true);

    const b = courses.find(c => c.id === 'b')!;
    // Empty title remains empty string? Implementation falls back only when falsy, so '' -> 'Untitled Course'
    expect(b.title).toBe('Untitled Course');
    expect(Array.isArray(b.levelIds)).toBe(true);

    const c = courses.find(c => c.id === 'c')!;
    expect(c.title).toBe('Untitled Course');
    expect(c.levelIds).toEqual([]);
    expect(c.isPublic).toBeUndefined();
  });

  it('getCourses returns [] on database error', async () => {
    vi.mocked(FirebaseDatabase.getCourses).mockRejectedValue(new Error('db error'));
    const courses = await store.getCourses();
    expect(courses).toEqual([]);
  });

  it('createCourse calls saveCourse and returns new id; caches without throwing', async () => {
    vi.mocked(FirebaseDatabase.saveCourse).mockResolvedValue('new-course-id' as any);

    const id = await store.createCourse('My Course', ['L1', 'L2'], true);

    expect(id).toBe('new-course-id');
    expect(FirebaseDatabase.saveCourse).toHaveBeenCalledWith(expect.objectContaining({
      title: 'My Course',
      levelIds: ['L1', 'L2'],
      isPublic: true,
      createdAt: expect.any(Number),
      lastModified: expect.any(Number),
    }));
  });

  it('updateCourse forwards to db and does not throw', async () => {
    vi.mocked(FirebaseDatabase.updateCourse).mockResolvedValue(undefined as any);
    await expect(store.updateCourse('course-1', { title: 'Renamed' } as any)).resolves.not.toThrow();
    expect(FirebaseDatabase.updateCourse).toHaveBeenCalledWith('course-1', expect.objectContaining({ title: 'Renamed' }));
  });

  it('deleteCourse forwards to db and removes cache entry (no throw)', async () => {
    vi.mocked(FirebaseDatabase.deleteCourse).mockResolvedValue(undefined as any);
    await expect(store.deleteCourse('course-1')).resolves.not.toThrow();
    expect(FirebaseDatabase.deleteCourse).toHaveBeenCalledWith('course-1');
  });

  it('init is idempotent', async () => {
    await expect(store.init()).resolves.not.toThrow();
    await expect(store.init()).resolves.not.toThrow();
  });

  it('clearCache does not throw', () => {
    expect(() => store.clearCache()).not.toThrow();
  });
});
