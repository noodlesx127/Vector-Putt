// UsersStore: multi-user management with roles and persistence
// Source of truth at runtime is localStorage (browser). On first run, fall back to /data/users.json.

export type UserRole = 'admin' | 'user';
export interface UserRecord {
  id: string;
  name: string;
  role: UserRole;
  enabled: boolean;
  createdAt: string; // ISO string
}

interface UsersDocV1 {
  version: 1;
  users: UserRecord[];
}

type UsersDoc = UsersDocV1; // future-proof

function nowIso(): string { return new Date().toISOString(); }

function newId(): string {
  return 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function deepClone<T>(o: T): T { return JSON.parse(JSON.stringify(o)); }

const LS_KEY = 'vp.users';

export class UsersStore {
  private users: UserRecord[] = [];
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    // Try localStorage first
    const ls = this.loadFromLocal();
    if (ls) {
      this.users = ls.users;
      this.ensureAdminInvariant();
      this.initialized = true;
      return;
    }
    // Fallback to bundled JSON
    try {
      const res = await fetch('/data/users.json', { cache: 'no-store' });
      if (res.ok) {
        const doc = (await res.json()) as UsersDoc;
        this.applyImportedDoc(doc);
        this.saveToLocal();
        this.initialized = true;
        return;
      }
    } catch {}
    // Last resort: create a default admin
    this.users = [{ id: 'admin', name: 'admin', role: 'admin', enabled: true, createdAt: nowIso() }];
    this.saveToLocal();
    this.initialized = true;
  }

  private loadFromLocal(): UsersDoc | null {
    try {
      const s = localStorage.getItem(LS_KEY);
      if (!s) return null;
      const doc = JSON.parse(s) as UsersDoc;
      if (!doc || (doc as any).version !== 1 || !Array.isArray((doc as any).users)) return null;
      // Basic sanitize
      const users = (doc as any).users.filter((u: any) => u && typeof u.id === 'string' && typeof u.name === 'string');
      return { version: 1, users };
    } catch {
      return null;
    }
  }

  private saveToLocal(): void {
    try {
      const doc: UsersDoc = { version: 1, users: this.users };
      localStorage.setItem(LS_KEY, JSON.stringify(doc));
    } catch {}
  }

  private countEnabledAdmins(): number {
    return this.users.filter(u => u.role === 'admin' && u.enabled).length;
  }

  private ensureAdminInvariant(): void {
    if (this.countEnabledAdmins() === 0) {
      // Promote the earliest user or create default admin
      if (this.users.length > 0) {
        this.users[0].role = 'admin';
        this.users[0].enabled = true;
      } else {
        this.users.push({ id: 'admin', name: 'admin', role: 'admin', enabled: true, createdAt: nowIso() });
      }
    }
  }

  getAll(): UserRecord[] { return deepClone(this.users).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }

  addUser(name: string, role: UserRole = 'user'): UserRecord {
    const n = (name || '').trim();
    if (!n) throw new Error('Name cannot be empty');
    const rec: UserRecord = { id: newId(), name: n, role, enabled: true, createdAt: nowIso() };
    this.users.push(rec);
    this.saveToLocal();
    return deepClone(rec);
  }

  removeUser(id: string): void {
    const idx = this.users.findIndex(u => u.id === id);
    if (idx < 0) return;
    const wasAdmin = this.users[idx].role === 'admin' && this.users[idx].enabled;
    if (wasAdmin && this.countEnabledAdmins() <= 1) {
      throw new Error('Cannot remove the last enabled admin');
    }
    this.users.splice(idx, 1);
    this.ensureAdminInvariant();
    this.saveToLocal();
  }

  setEnabled(id: string, enabled: boolean): void {
    const u = this.users.find(u => u.id === id);
    if (!u) return;
    if (u.role === 'admin' && u.enabled && !enabled && this.countEnabledAdmins() <= 1) {
      throw new Error('Cannot disable the last enabled admin');
    }
    u.enabled = !!enabled;
    this.ensureAdminInvariant();
    this.saveToLocal();
  }

  toggleRole(id: string, currentActiveId?: string): UserRole {
    const u = this.users.find(u => u.id === id);
    if (!u) throw new Error('User not found');
    if (u.role === 'admin') {
      // Demote
      if (this.countEnabledAdmins() <= 1) throw new Error('Cannot demote the last enabled admin');
      if (currentActiveId && u.id === currentActiveId && this.countEnabledAdmins() <= 1) {
        throw new Error('Cannot self-demote when you are the last enabled admin');
      }
      u.role = 'user';
    } else {
      u.role = 'admin';
      u.enabled = true;
    }
    this.saveToLocal();
    return u.role;
  }

  renameUser(id: string, newName: string): void {
    const u = this.users.find(u => u.id === id);
    if (!u) throw new Error('User not found');
    const n = (newName || '').trim();
    if (!n) throw new Error('Name cannot be empty');
    u.name = n;
    this.saveToLocal();
  }

  importFromJsonString(json: string): void {
    let doc: UsersDoc;
    try { doc = JSON.parse(json); } catch { throw new Error('Invalid JSON'); }
    this.applyImportedDoc(doc);
    this.saveToLocal();
  }

  private applyImportedDoc(doc: UsersDoc): void {
    if (!doc || (doc as any).version !== 1 || !Array.isArray((doc as any).users)) throw new Error('Unsupported users document');
    const users: UserRecord[] = [];
    for (const raw of (doc as any).users) {
      if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string') continue;
      const role: UserRole = raw.role === 'admin' ? 'admin' : 'user';
      const enabled = !!raw.enabled;
      const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : nowIso();
      users.push({ id: raw.id, name: raw.name, role, enabled, createdAt });
    }
    this.users = users;
    this.ensureAdminInvariant();
  }

  exportToJsonString(pretty = true): string {
    const doc: UsersDoc = { version: 1, users: this.users };
    return JSON.stringify(doc, null, pretty ? 2 : 0);
  }
}

const usersStore = new UsersStore();
export default usersStore;
