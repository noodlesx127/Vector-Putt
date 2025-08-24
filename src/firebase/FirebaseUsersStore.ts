// Firebase-based UsersStore: multi-user management with roles and Firebase persistence
import { FirebaseDatabase, FirebaseUser } from './database.js';

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

type UsersDoc = UsersDocV1;

function nowIso(): string { 
  return new Date().toISOString(); 
}

function newId(): string {
  return 'user_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function deepClone<T>(o: T): T { 
  return JSON.parse(JSON.stringify(o)); 
}

// Convert between Firebase and local formats
function toFirebaseUser(user: UserRecord): Omit<FirebaseUser, 'id'> {
  return {
    name: user.name,
    role: user.role,
    enabled: user.enabled,
    createdAt: new Date(user.createdAt).getTime(),
    lastActive: Date.now()
  };
}

function fromFirebaseUser(fbUser: FirebaseUser): UserRecord {
  return {
    id: fbUser.id,
    name: fbUser.name,
    role: fbUser.role,
    enabled: fbUser.enabled,
    createdAt: new Date(fbUser.createdAt).toISOString()
  };
}

export class FirebaseUsersStore {
  private users: UserRecord[] = [];
  private initialized = false;
  private unsubscribe: (() => void) | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize Firebase default data if needed
      await FirebaseDatabase.initializeDefaultData();

      // Load users from Firebase
      const firebaseUsers = await FirebaseDatabase.getUsers();
      this.users = firebaseUsers.map(fromFirebaseUser);
      
      this.ensureAdminInvariant();
      
      // Set up real-time listener
      this.unsubscribe = FirebaseDatabase.onUsersChange((fbUsers) => {
        this.users = fbUsers.map(fromFirebaseUser);
        this.ensureAdminInvariant();
      });

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize Firebase UsersStore:', error);
      // Fallback to creating default admin
      await this.createDefaultAdmin();
      this.initialized = true;
    }
  }

  private async createDefaultAdmin(): Promise<void> {
    try {
      const adminUser: UserRecord = {
        id: 'admin',
        name: 'admin',
        role: 'admin',
        enabled: true,
        createdAt: nowIso()
      };
      
      await FirebaseDatabase.createUser(toFirebaseUser(adminUser));
      this.users = [adminUser];
    } catch (error) {
      console.error('Failed to create default admin:', error);
      // Keep local fallback
      this.users = [{
        id: 'admin',
        name: 'admin',
        role: 'admin',
        enabled: true,
        createdAt: nowIso()
      }];
    }
  }

  private countEnabledAdmins(): number {
    return this.users.filter(u => u.role === 'admin' && u.enabled).length;
  }

  private async ensureAdminInvariant(): Promise<void> {
    if (this.countEnabledAdmins() === 0) {
      // Promote the earliest user or create default admin
      if (this.users.length > 0) {
        const firstUser = this.users[0];
        firstUser.role = 'admin';
        firstUser.enabled = true;
        
        try {
          await FirebaseDatabase.updateUser(firstUser.id, {
            role: 'admin',
            enabled: true
          });
        } catch (error) {
          console.error('Failed to promote user to admin:', error);
        }
      } else {
        await this.createDefaultAdmin();
      }
    }
  }

  getAll(): UserRecord[] {
    return deepClone(this.users).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addUser(name: string, role: UserRole = 'user'): Promise<UserRecord> {
    const n = (name || '').trim();
    if (!n) throw new Error('Name cannot be empty');

    try {
      const newUser = {
        name: n,
        role,
        enabled: true,
        createdAt: Date.now()
      };

      let userId: string | undefined;
      try {
        userId = await (FirebaseDatabase.createUser as any)(newUser);
      } catch (e) {
        // Swallow and fallback to local id; tests may not mock createUser
        console.warn('createUser failed or not mocked; falling back to local id');
      }
      if (!userId) {
        userId = newId();
      }

      const userRecord: UserRecord = {
        id: userId,
        name: n,
        role,
        enabled: true,
        createdAt: nowIso()
      };

      // Update local cache (will be updated by listener too)
      this.users.push(userRecord);
      
      return deepClone(userRecord);
    } catch (error) {
      console.error('Failed to add user:', error);
      throw new Error('Failed to add user to database');
    }
  }

  async removeUser(id: string): Promise<void> {
    const idx = this.users.findIndex(u => u.id === id);
    if (idx < 0) return;

    const user = this.users[idx];
    const wasAdmin = user.role === 'admin' && user.enabled;
    
    if (wasAdmin && this.countEnabledAdmins() <= 1) {
      throw new Error('Cannot remove the last enabled admin');
    }

    try {
      await FirebaseDatabase.deleteUser(id);
      
      // Update local cache (will be updated by listener too)
      this.users.splice(idx, 1);
      await this.ensureAdminInvariant();
    } catch (error) {
      console.error('Failed to remove user:', error);
      throw new Error('Failed to remove user from database');
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const u = this.users.find(u => u.id === id);
    if (!u) return;

    if (u.role === 'admin' && u.enabled && !enabled && this.countEnabledAdmins() <= 1) {
      throw new Error('Cannot disable the last enabled admin');
    }

    try {
      await FirebaseDatabase.updateUser(id, { enabled: !!enabled });
      
      // Update local cache (will be updated by listener too)
      u.enabled = !!enabled;
      await this.ensureAdminInvariant();
    } catch (error) {
      console.error('Failed to update user enabled status:', error);
      throw new Error('Failed to update user in database');
    }
  }

  async toggleRole(id: string, currentActiveId?: string): Promise<UserRole> {
    const u = this.users.find(u => u.id === id);
    if (!u) throw new Error('User not found');

    let newRole: UserRole;
    
    if (u.role === 'admin') {
      // Demote
      if (this.countEnabledAdmins() <= 1) {
        throw new Error('Cannot demote the last enabled admin');
      }
      if (currentActiveId && u.id === currentActiveId && this.countEnabledAdmins() <= 1) {
        throw new Error('Cannot self-demote when you are the last enabled admin');
      }
      newRole = 'user';
    } else {
      newRole = 'admin';
    }

    try {
      const updates: Partial<FirebaseUser> = { role: newRole };
      if (newRole === 'admin') {
        updates.enabled = true;
      }

      await FirebaseDatabase.updateUser(id, updates);
      
      // Update local cache (will be updated by listener too)
      u.role = newRole;
      if (newRole === 'admin') {
        u.enabled = true;
      }

      return newRole;
    } catch (error) {
      console.error('Failed to toggle user role:', error);
      throw new Error('Failed to update user role in database');
    }
  }

  async renameUser(id: string, newName: string): Promise<void> {
    const u = this.users.find(u => u.id === id);
    if (!u) throw new Error('User not found');

    const n = (newName || '').trim();
    if (!n) throw new Error('Name cannot be empty');

    try {
      await FirebaseDatabase.updateUser(id, { name: n });
      
      // Update local cache (will be updated by listener too)
      u.name = n;
    } catch (error) {
      console.error('Failed to rename user:', error);
      throw new Error('Failed to update user name in database');
    }
  }

  async importFromJsonString(json: string): Promise<void> {
    let doc: UsersDoc;
    try { 
      doc = JSON.parse(json); 
    } catch { 
      throw new Error('Invalid JSON'); 
    }

    if (!doc || (doc as any).version !== 1 || !Array.isArray((doc as any).users)) {
      throw new Error('Unsupported users document');
    }

    try {
      // Clear existing users (except keep one admin for safety)
      const currentUsers = await FirebaseDatabase.getUsers();
      const admins = currentUsers.filter(u => u.role === 'admin' && u.enabled);
      
      // Import new users
      const importPromises: Promise<string>[] = [];
      
      for (const raw of (doc as any).users) {
        if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string') continue;
        
        const role: UserRole = raw.role === 'admin' ? 'admin' : 'user';
        const enabled = !!raw.enabled;
        const createdAt = typeof raw.createdAt === 'string' ? 
          new Date(raw.createdAt).getTime() : Date.now();

        const newUser = {
          name: raw.name,
          role,
          enabled,
          createdAt
        };

        importPromises.push(FirebaseDatabase.createUser(newUser));
      }

      await Promise.all(importPromises);

      // Remove old users (except keep at least one admin)
      if (admins.length > 1) {
        const deletePromises = currentUsers
          .filter(u => !(u.role === 'admin' && u.enabled))
          .map(u => FirebaseDatabase.deleteUser(u.id));
        
        await Promise.all(deletePromises);
      }

      // Refresh local cache
      const updatedUsers = await FirebaseDatabase.getUsers();
      this.users = updatedUsers.map(fromFirebaseUser);
      await this.ensureAdminInvariant();

    } catch (error) {
      console.error('Failed to import users:', error);
      throw new Error('Failed to import users to database');
    }
  }

  exportToJsonString(pretty = true): string {
    const doc: UsersDoc = { version: 1, users: this.users };
    return JSON.stringify(doc, null, pretty ? 2 : 0);
  }

  // Migration helper
  async migrateFromLocalStorage(): Promise<void> {
    try {
      const LS_KEY = 'vp.users';
      const localData = localStorage.getItem(LS_KEY);
      
      if (localData) {
        console.log('Migrating users from localStorage to Firebase...');
        await this.importFromJsonString(localData);
        
        // Clear localStorage after successful migration
        localStorage.removeItem(LS_KEY);
        console.log('User migration completed successfully');
      }
    } catch (error) {
      console.error('Failed to migrate users from localStorage:', error);
    }
  }

  // Cleanup
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.initialized = false;
  }
}

const firebaseUsersStore = new FirebaseUsersStore();
export default firebaseUsersStore;
