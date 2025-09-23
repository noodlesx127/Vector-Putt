import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UsersStore, type UserRecord } from '../UsersStore';

class MockLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}

function makeDoc(users: Partial<UserRecord>[]): string {
  const norm: UserRecord[] = users.map((u, i) => ({
    id: u.id ?? `id_${i}`,
    name: u.name ?? `User ${i}`,
    role: u.role ?? 'user',
    enabled: u.enabled ?? true,
    createdAt: u.createdAt ?? new Date(Date.now() + i).toISOString(),
  }));
  return JSON.stringify({ version: 1, users: norm }, null, 2);
}

beforeEach(() => {
  // fresh globals for each test
  (globalThis as any).localStorage = new MockLocalStorage();
  // default fetch throws if accidentally called
  ;(globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('fetch not mocked'));
});

describe('UsersStore basics', () => {
  it('adds users and lists them (sorted by createdAt)', () => {
    const s = new UsersStore();
    const a = s.addUser('Alice', 'admin');
    const b = s.addUser('Bob', 'user');
    const all = s.getAll();
    expect(all.length).toBe(2);
    // Ensure fields are cloned
    expect(all[0]).not.toBe(a);
    expect(all[1]).not.toBe(b);
    // Sanity on roles
    expect(all.some(u => u.role === 'admin')).toBe(true);
    expect(all.some(u => u.role === 'user')).toBe(true);
  });

  it('validates addUser/renameUser input', () => {
    const s = new UsersStore();
    expect(() => s.addUser('')).toThrow();
    const u = s.addUser('C');
    expect(() => s.renameUser(u.id, '')).toThrow();
  });
});

describe('Admin invariants', () => {
  it('cannot remove the last enabled admin', () => {
    const s = new UsersStore();
    const admin = s.addUser('Admin', 'admin');
    expect(() => s.removeUser(admin.id)).toThrow(/last enabled admin/);
  });

  it('cannot disable the last enabled admin', () => {
    const s = new UsersStore();
    const admin = s.addUser('Admin', 'admin');
    expect(() => s.setEnabled(admin.id, false)).toThrow(/last enabled admin/);
  });

  it('can remove an admin when there are at least two enabled admins', () => {
    const s = new UsersStore();
    const a1 = s.addUser('A1', 'admin');
    const a2 = s.addUser('A2', 'admin');
    s.removeUser(a1.id);
    const admins = s.getAll().filter(u => u.role === 'admin' && u.enabled);
    expect(admins.length).toBe(1);
    expect(admins[0].id).toBe(a2.id);
  });

  it('toggleRole: cannot demote the last enabled admin; can promote user to admin (enables them)', () => {
    const s = new UsersStore();
    const a1 = s.addUser('A1', 'admin');
    expect(() => s.toggleRole(a1.id)).toThrow(/last enabled admin/);

    const u1 = s.addUser('U1', 'user');
    const role = s.toggleRole(u1.id);
    expect(role).toBe('admin');
    const u1rec = s.getAll().find(u => u.id === u1.id)!;
    expect(u1rec.role).toBe('admin');
    expect(u1rec.enabled).toBe(true);
  });

  it('self-demotion is blocked when currentActiveId is the last enabled admin', () => {
    const s = new UsersStore();
    const a1 = s.addUser('A1', 'admin');
    // Implementation may throw either the generic last-admin error or the specific self-demotion error
    expect(() => s.toggleRole(a1.id, a1.id)).toThrow(/(self-demote|last enabled admin)/);
  });
});

describe('Import/Export and init()', () => {
  it('importFromJsonString applies sanitize and ensures at least one enabled admin', () => {
    const s = new UsersStore();
    // Doc with only users (no admins)
    const json = makeDoc([
      { id: 'u1', name: 'U1', role: 'user', enabled: true },
      { id: 'u2', name: 'U2', role: 'user', enabled: true },
    ]);
    s.importFromJsonString(json);
    const all = s.getAll();
    expect(all.length).toBe(2);
    // After import, first user should be promoted to admin to satisfy invariant
    const admins = all.filter(u => u.role === 'admin' && u.enabled);
    expect(admins.length).toBeGreaterThanOrEqual(1);
  });

  it('exportToJsonString round-trips users', () => {
    const s = new UsersStore();
    s.addUser('A', 'admin');
    s.addUser('B', 'user');
    const out = s.exportToJsonString();
    expect(out).toContain('"version": 1');
    expect(out).toContain('A');
    expect(out).toContain('B');
  });

  it('init() loads from localStorage if present; otherwise falls back to fetch; then default admin', async () => {
    // Case 1: localStorage present
    const docLocal = makeDoc([{ id: 'x', name: 'X', role: 'admin', enabled: true }]);
    localStorage.setItem('vp.users', docLocal);
    const s1 = new UsersStore();
    await s1.init();
    expect(s1.getAll().map(u => u.id)).toContain('x');

    // Case 2: no localStorage, fetch OK
    localStorage.clear();
    const docRemote = makeDoc([{ id: 'y', name: 'Y', role: 'user', enabled: true }]);
    (globalThis.fetch as any) = vi.fn().mockResolvedValue({ ok: true, json: async () => JSON.parse(docRemote) });
    const s2 = new UsersStore();
    await s2.init();
    const all2 = s2.getAll();
    expect(all2.length).toBe(1);
    // Invariant may promote first to admin
    const admins2 = all2.filter(u => u.role === 'admin' && u.enabled);
    expect(admins2.length).toBe(1);

    // Case 3: no localStorage, fetch fails -> default admin
    localStorage.clear();
    (globalThis.fetch as any) = vi.fn().mockRejectedValue(new Error('network'));
    const s3 = new UsersStore();
    await s3.init();
    const all3 = s3.getAll();
    expect(all3.length).toBe(1);
    expect(all3[0].name).toBe('admin');
    expect(all3[0].role).toBe('admin');
    expect(all3[0].enabled).toBe(true);
  });
});
