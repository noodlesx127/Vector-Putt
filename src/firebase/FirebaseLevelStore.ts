// Firebase-based level persistence system
import { FirebaseDatabase, FirebaseLevel } from './database.js';

// Level interfaces (matching existing types)
export interface Level {
  canvas: { width: number; height: number };
  tee: { x: number; y: number };
  cup: { x: number; y: number };
  walls?: Array<{ x: number; y: number; w: number; h: number; angle?: number }>;
  wallsPoly?: Array<{ points: Array<{ x: number; y: number }> }>;
  posts?: Array<{ x: number; y: number; radius?: number }>;
  bridges?: Array<{ x: number; y: number; w: number; h: number; angle?: number }>;
  water?: Array<{ x: number; y: number; w: number; h: number; angle?: number }>;
  waterPoly?: Array<{ points: Array<{ x: number; y: number }> }>;
  sand?: Array<{ x: number; y: number; w: number; h: number; angle?: number }>;
  sandPoly?: Array<{ points: Array<{ x: number; y: number }> }>;
  hills?: Array<{ x: number; y: number; w: number; h: number; angle?: number; direction?: string }>;
  decorations?: Array<{ x: number; y: number; type: string }>;
  meta?: {
    title?: string;
    authorId?: string;
    authorName?: string;
    par?: number;
    lastModified?: number;
  };
}

export interface LevelEntry {
  name: string;
  title: string;
  author: string;
  data: Level;
  source: 'firebase' | 'localStorage' | 'filesystem';
  lastModified?: number;
}

export class FirebaseLevelStore {
  private initialized = false;
  private cachedLevels: Map<string, FirebaseLevel> = new Map();
  private userLevelsCache: Map<string, FirebaseLevel[]> = new Map();

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  // Get all levels (public + user levels for current user)
  async getAllLevels(currentUserId?: string): Promise<LevelEntry[]> {
    const allLevels: LevelEntry[] = [];

    try {
      // Get public levels
      const publicLevels = await FirebaseDatabase.getLevels();
      for (const level of publicLevels) {
        allLevels.push({
          name: level.id,
          title: level.title || 'Untitled Level',
          author: level.authorName || 'Unknown',
          data: level.data,
          source: 'firebase',
          lastModified: level.lastModified
        });
      }

      // Get user levels if userId provided
      if (currentUserId) {
        const userLevels = await FirebaseDatabase.getUserLevels(currentUserId);
        for (const level of userLevels) {
          allLevels.push({
            name: level.id,
            title: level.title || 'Untitled Level',
            author: level.authorName || 'Unknown',
            data: level.data,
            source: 'firebase',
            lastModified: level.lastModified
          });
        }
      }

      // Cache the results
      for (const level of [...publicLevels, ...(currentUserId ? await FirebaseDatabase.getUserLevels(currentUserId) : [])]) {
        this.cachedLevels.set(level.id, level);
      }

    } catch (error) {
      console.error('Failed to load levels from Firebase:', error);
    }

    return allLevels.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
  }

  // Get user-created levels only
  async getUserLevels(userId: string): Promise<LevelEntry[]> {
    try {
      const userLevels = await FirebaseDatabase.getUserLevels(userId);
      this.userLevelsCache.set(userId, userLevels);

      return userLevels.map(level => ({
        name: level.id,
        title: level.title || 'Untitled Level',
        author: level.authorName || 'Unknown',
        data: level.data,
        source: 'firebase' as const,
        lastModified: level.lastModified
      })).sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));

    } catch (error) {
      console.error('Failed to load user levels from Firebase:', error);
      return [];
    }
  }

  // Save a level
  async saveLevel(levelData: Level, levelId?: string, userId?: string): Promise<string> {
    try {
      const firebaseLevel: Omit<FirebaseLevel, 'id'> = {
        title: levelData.meta?.title || 'Untitled Level',
        authorId: userId || levelData.meta?.authorId || 'unknown',
        authorName: levelData.meta?.authorName || 'Unknown',
        data: levelData,
        createdAt: Date.now(),
        lastModified: Date.now(),
        isPublic: false // User levels are private by default
      };

      let savedId: string;

      if (levelId) {
        // Update existing level
        await FirebaseDatabase.updateLevel(levelId, firebaseLevel, userId);
        savedId = levelId;
      } else {
        // Create new level
        savedId = await FirebaseDatabase.saveLevel(firebaseLevel, true);
      }

      // Update cache
      this.cachedLevels.set(savedId, { id: savedId, ...firebaseLevel });
      
      // Clear user cache to force refresh
      if (userId) {
        this.userLevelsCache.delete(userId);
      }

      return savedId;

    } catch (error) {
      console.error('Failed to save level to Firebase:', error);
      if (error instanceof Error) {
        // Preserve original error so callers/tests can assert specific messages
        throw error;
      }
      throw new Error('Failed to save level to database');
    }
  }

  // Load a specific level
  async loadLevel(levelId: string, userId?: string): Promise<Level | null> {
    try {
      // Check cache first
      if (this.cachedLevels.has(levelId)) {
        return this.cachedLevels.get(levelId)!.data;
      }

      // Load from Firebase
      const level = await FirebaseDatabase.getLevel(levelId, userId);
      if (!level) return null;

      // Cache the result
      this.cachedLevels.set(levelId, level);
      
      return level.data;

    } catch (error) {
      console.error('Failed to load level from Firebase:', error);
      return null;
    }
  }

  // Delete a level
  async deleteLevel(levelId: string, userId?: string): Promise<void> {
    try {
      await FirebaseDatabase.deleteLevel(levelId, userId);
      
      // Remove from cache
      this.cachedLevels.delete(levelId);
      
      // Clear user cache to force refresh
      if (userId) {
        this.userLevelsCache.delete(userId);
      }

    } catch (error) {
      console.error('Failed to delete level from Firebase:', error);
      throw new Error('Failed to delete level from database');
    }
  }

  // Check if user can edit a level
  canEditLevel(level: LevelEntry, userId: string, userRole: 'admin' | 'user'): boolean {
    // Admins can edit any level
    if (userRole === 'admin') return true;
    
    // Users can only edit their own levels
    const levelData = this.cachedLevels.get(level.name);
    return levelData?.authorId === userId;
  }

  // Check if user can delete a level
  canDeleteLevel(level: LevelEntry, userId: string, userRole: 'admin' | 'user'): boolean {
    return this.canEditLevel(level, userId, userRole);
  }

  // Migration helpers
  async migrateFromLocalStorage(): Promise<void> {
    try {
      const LS_LEVELS_KEY = 'vp.levels.v1';
      const localData = localStorage.getItem(LS_LEVELS_KEY);
      
      if (localData) {
        console.log('Migrating levels from localStorage to Firebase...');
        const doc = JSON.parse(localData);
        
        if (doc && doc.version === 1 && Array.isArray(doc.levels)) {
          const migrationPromises: Promise<string>[] = [];
          
          for (const savedLevel of doc.levels) {
            if (savedLevel && savedLevel.level && savedLevel.id) {
              const level = savedLevel.level;
              
              // Ensure meta exists
              if (!level.meta) level.meta = {};
              level.meta.title = level.meta.title || savedLevel.id;
              level.meta.authorName = level.meta.authorName || 'Migrated User';
              level.meta.lastModified = Date.now();
              
              migrationPromises.push(this.saveLevel(level));
            }
          }
          
          await Promise.all(migrationPromises);
          
          // Clear localStorage after successful migration
          localStorage.removeItem(LS_LEVELS_KEY);
          console.log(`Migrated ${migrationPromises.length} levels successfully`);
        }
      }

      // Also migrate legacy single level
      const legacyLevel = localStorage.getItem('vp.editor.level');
      if (legacyLevel) {
        try {
          const parsed = JSON.parse(legacyLevel);
          if (parsed && parsed.tee && parsed.cup) {
            if (!parsed.meta) parsed.meta = {};
            parsed.meta.title = parsed.meta.title || 'Legacy Level';
            parsed.meta.authorName = parsed.meta.authorName || 'Migrated User';
            parsed.meta.lastModified = Date.now();
            
            await this.saveLevel(parsed);
            localStorage.removeItem('vp.editor.level');
            console.log('Migrated legacy level successfully');
          }
        } catch (e) {
          console.error('Failed to migrate legacy level:', e);
        }
      }

    } catch (error) {
      console.error('Failed to migrate levels from localStorage:', error);
    }
  }

  // Clear cache
  clearCache(): void {
    this.cachedLevels.clear();
    this.userLevelsCache.clear();
  }
}

const firebaseLevelStore = new FirebaseLevelStore();
export default firebaseLevelStore;
