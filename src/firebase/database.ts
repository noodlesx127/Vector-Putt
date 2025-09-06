// Firebase Realtime Database service layer
import { database } from './config.js';
import { ref, set, get, push, remove, update, onValue, off, DataSnapshot } from 'firebase/database';

// Database paths
const PATHS = {
  users: 'users',
  levels: 'levels',
  userLevels: 'userLevels',
  scores: 'scores',
  settings: 'settings',
  courses: 'courses'
} as const;

// User data interface
export interface FirebaseUser {
  id: string;
  name: string;
  role: 'admin' | 'user';
  enabled: boolean;
  createdAt: number;
  lastActive?: number;
}

// Level data interface
export interface FirebaseLevel {
  id: string;
  title: string;
  authorId: string;
  authorName: string;
  data: any; // Level JSON data
  createdAt: number;
  lastModified: number;
  isPublic: boolean;
}

// Score data interface
export interface FirebaseScore {
  userId: string;
  levelId: string;
  strokes: number;
  timestamp: number;
  courseId?: string;
}

// Course data interface
export interface FirebaseCourse {
  id: string;
  title: string;
  levelIds: string[];
  createdAt: number;
  lastModified: number;
  isPublic?: boolean;
}

// Settings data interface
export interface FirebaseSettings {
  userId: string;
  volume: number;
  muted: boolean;
  lastUsername?: string;
  [key: string]: any;
}

// Generic database operations
export class FirebaseDatabase {
  // Users
  static async getUsers(): Promise<FirebaseUser[]> {
    const snapshot = await get(ref(database, PATHS.users));
    if (!snapshot.exists()) return [];
    
    const users = snapshot.val();
    return Object.keys(users).map(id => ({ id, ...users[id] }));
  }

  static async getUser(userId: string): Promise<FirebaseUser | null> {
    const snapshot = await get(ref(database, `${PATHS.users}/${userId}`));
    if (!snapshot.exists()) return null;
    
    return { id: userId, ...snapshot.val() };
  }

  static async createUser(user: Omit<FirebaseUser, 'id'>): Promise<string> {
    const userRef = push(ref(database, PATHS.users));
    const userId = userRef.key!;
    
    await set(userRef, {
      ...user,
      createdAt: Date.now()
    });
    
    return userId;
  }

  static async updateUser(userId: string, updates: Partial<FirebaseUser>): Promise<void> {
    await update(ref(database, `${PATHS.users}/${userId}`), {
      ...updates,
      lastActive: Date.now()
    });
  }

  static async deleteUser(userId: string): Promise<void> {
    await remove(ref(database, `${PATHS.users}/${userId}`));
  }

  // Levels
  static async getLevels(): Promise<FirebaseLevel[]> {
    const snapshot = await get(ref(database, PATHS.levels));
    if (!snapshot.exists()) return [];
    
    const levels = snapshot.val();
    return Object.keys(levels).map(id => ({ id, ...levels[id] }));
  }

  static async getUserLevels(userId: string): Promise<FirebaseLevel[]> {
    const snapshot = await get(ref(database, `${PATHS.userLevels}/${userId}`));
    if (!snapshot.exists()) return [];
    
    const levels = snapshot.val();
    return Object.keys(levels).map(id => ({ id, ...levels[id] }));
  }

  // Admin helper: fetch all user levels across all users
  static async getAllUserLevels(): Promise<FirebaseLevel[]> {
    const snapshot = await get(ref(database, PATHS.userLevels));
    if (!snapshot.exists()) return [];

    const byUser = snapshot.val();
    const result: FirebaseLevel[] = [];
    Object.keys(byUser).forEach((userId) => {
      const levels = byUser[userId];
      Object.keys(levels).forEach((levelId) => {
        result.push({ id: levelId, ...levels[levelId] });
      });
    });

    return result;
  }

  static async getLevel(levelId: string, userId?: string): Promise<FirebaseLevel | null> {
    // Try user levels first if userId provided
    if (userId) {
      const userSnapshot = await get(ref(database, `${PATHS.userLevels}/${userId}/${levelId}`));
      if (userSnapshot.exists()) {
        return { id: levelId, ...userSnapshot.val() };
      }
    }
    
    // Try public levels
    const snapshot = await get(ref(database, `${PATHS.levels}/${levelId}`));
    if (!snapshot.exists()) return null;
    
    return { id: levelId, ...snapshot.val() };
  }

  static async saveLevel(level: Omit<FirebaseLevel, 'id'>, isUserLevel = true): Promise<string> {
    const path = isUserLevel ? `${PATHS.userLevels}/${level.authorId}` : PATHS.levels;
    const levelRef = push(ref(database, path));
    const levelId = levelRef.key!;
    
    await set(levelRef, {
      ...level,
      createdAt: level.createdAt || Date.now(),
      lastModified: Date.now()
    });
    
    return levelId;
  }

  static async updateLevel(levelId: string, updates: Partial<FirebaseLevel>, userId?: string): Promise<void> {
    // First, try to determine if this is a public level or user level
    let path: string;
    
    // Check if level exists in public levels first
    const publicSnapshot = await get(ref(database, `${PATHS.levels}/${levelId}`));
    if (publicSnapshot.exists()) {
      path = `${PATHS.levels}/${levelId}`;
      console.log(`Updating public level at path: ${path}`);
    } else if (userId) {
      // Check if level exists in user levels
      const userSnapshot = await get(ref(database, `${PATHS.userLevels}/${userId}/${levelId}`));
      if (userSnapshot.exists()) {
        path = `${PATHS.userLevels}/${userId}/${levelId}`;
        console.log(`Updating user level at path: ${path}`);
      } else {
        throw new Error(`Level ${levelId} not found in public or user levels`);
      }
    } else {
      // Fallback to public levels path if no userId provided
      path = `${PATHS.levels}/${levelId}`;
      console.log(`Fallback: updating at public path: ${path}`);
    }
    
    await update(ref(database, path), {
      ...updates,
      lastModified: Date.now()
    });
    
    console.log(`Successfully updated level ${levelId} at ${path}`);
  }

  static async deleteLevel(levelId: string, userId?: string): Promise<void> {
    // Prefer deleting from public levels if it exists there
    const publicPath = `${PATHS.levels}/${levelId}`;
    const publicRef = ref(database, publicPath);
    const publicSnapshot = await get(publicRef);
    if (publicSnapshot.exists()) {
      console.log(`Deleting public level at path: ${publicPath}`);
      await remove(publicRef);
      console.log(`Deleted level ${levelId} from public levels`);
      return;
    }

    // Otherwise, delete from user levels if userId provided
    if (userId) {
      const userPath = `${PATHS.userLevels}/${userId}/${levelId}`;
      console.log(`Deleting user level at path: ${userPath}`);
      await remove(ref(database, userPath));
      console.log(`Deleted level ${levelId} for user ${userId}`);
      return;
    }

    // Fallback: attempt public path removal even if not found (no-op if absent)
    console.warn(`deleteLevel fallback: level ${levelId} not found in public and no userId provided; attempting public removal anyway`);
    await remove(publicRef);
  }

  // Courses
  static async getCourses(): Promise<FirebaseCourse[]> {
    const snapshot = await get(ref(database, PATHS.courses));
    if (!snapshot.exists()) return [];

    const courses = snapshot.val();
    return Object.keys(courses).map(id => ({ id, ...courses[id] }));
  }

  static async getCourse(courseId: string): Promise<FirebaseCourse | null> {
    const snapshot = await get(ref(database, `${PATHS.courses}/${courseId}`));
    if (!snapshot.exists()) return null;

    return { id: courseId, ...snapshot.val() };
  }

  static async saveCourse(course: Omit<FirebaseCourse, 'id'>): Promise<string> {
    const courseRef = push(ref(database, PATHS.courses));
    const courseId = courseRef.key!;

    await set(courseRef, {
      ...course,
      createdAt: course.createdAt || Date.now(),
      lastModified: Date.now()
    });

    return courseId;
  }

  static async updateCourse(courseId: string, updates: Partial<FirebaseCourse>): Promise<void> {
    await update(ref(database, `${PATHS.courses}/${courseId}`), {
      ...updates,
      lastModified: Date.now()
    });
  }

  static async deleteCourse(courseId: string): Promise<void> {
    await remove(ref(database, `${PATHS.courses}/${courseId}`));
  }

  // Scores
  static async getUserScores(userId: string): Promise<FirebaseScore[]> {
    const snapshot = await get(ref(database, `${PATHS.scores}/${userId}`));
    if (!snapshot.exists()) return [];
    
    const scores = snapshot.val();
    return Object.keys(scores).map(id => scores[id]);
  }

  static async getLevelScores(levelId: string): Promise<FirebaseScore[]> {
    // This requires a more complex query - for now, get all scores and filter
    const snapshot = await get(ref(database, PATHS.scores));
    if (!snapshot.exists()) return [];
    
    const allScores: FirebaseScore[] = [];
    const users = snapshot.val();
    
    Object.keys(users).forEach(userId => {
      const userScores = users[userId];
      Object.keys(userScores).forEach(scoreId => {
        const score = userScores[scoreId];
        if (score.levelId === levelId) {
          allScores.push(score);
        }
      });
    });
    
    return allScores.sort((a, b) => a.strokes - b.strokes);
  }

  static async saveScore(score: FirebaseScore): Promise<void> {
    const scoreRef = push(ref(database, `${PATHS.scores}/${score.userId}`));
    await set(scoreRef, {
      ...score,
      timestamp: Date.now()
    });
  }

  // Settings
  static async getUserSettings(userId: string): Promise<FirebaseSettings | null> {
    const snapshot = await get(ref(database, `${PATHS.settings}/${userId}`));
    if (!snapshot.exists()) return null;
    
    return { userId, ...snapshot.val() };
  }

  static async saveUserSettings(settings: FirebaseSettings): Promise<void> {
    await set(ref(database, `${PATHS.settings}/${settings.userId}`), settings);
  }

  // Real-time listeners
  static onUsersChange(callback: (users: FirebaseUser[]) => void): () => void {
    const usersRef = ref(database, PATHS.users);
    
    const unsubscribe = onValue(usersRef, (snapshot) => {
      if (!snapshot.exists()) {
        callback([]);
        return;
      }
      
      const users = snapshot.val();
      const userList = Object.keys(users).map(id => ({ id, ...users[id] }));
      callback(userList);
    });
    
    return () => off(usersRef, 'value', unsubscribe);
  }

  static onUserLevelsChange(userId: string, callback: (levels: FirebaseLevel[]) => void): () => void {
    const levelsRef = ref(database, `${PATHS.userLevels}/${userId}`);
    
    const unsubscribe = onValue(levelsRef, (snapshot) => {
      if (!snapshot.exists()) {
        callback([]);
        return;
      }
      
      const levels = snapshot.val();
      const levelList = Object.keys(levels).map(id => ({ id, ...levels[id] }));
      callback(levelList);
    });
    
    return () => off(levelsRef, 'value', unsubscribe);
  }

  // Utility methods
  static async initializeDefaultData(): Promise<void> {
    // Check if admin user exists
    const users = await this.getUsers();
    const adminExists = users.some(user => user.role === 'admin');
    
    if (!adminExists) {
      // Create default admin user
      await this.createUser({
        name: 'admin',
        role: 'admin',
        enabled: true,
        createdAt: Date.now()
      });
    }
  }

}
