import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import firebaseManager from '../firebase';
import { FirebaseDatabase } from '../firebase/database';

// Mock Firebase config to avoid real connections during tests
vi.mock('../firebase/config', () => ({
  firebaseConfig: {
    apiKey: 'test-api-key',
    authDomain: 'test-project.firebaseapp.com',
    databaseURL: 'https://test-project-default-rtdb.firebaseio.com/',
    projectId: 'test-project',
    storageBucket: 'test-project.appspot.com',
    messagingSenderId: '123456789',
    appId: 'test-app-id'
  }
}));

vi.mock('../firebase/database', () => ({
  FirebaseDatabase: {
    // Levels
    saveLevel: vi.fn(),
    updateLevel: vi.fn(),
    deleteLevel: vi.fn(),
    getLevels: vi.fn(),
    getUserLevels: vi.fn(),
    getLevel: vi.fn(),
    // Users
    createUser: vi.fn(),
    getUsers: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    // Scores
    saveScore: vi.fn(),
    getUserScores: vi.fn(),
    getLevelScores: vi.fn(),
    // Settings
    saveUserSettings: vi.fn(),
    getUserSettings: vi.fn(),
    // Utilities
    initializeDefaultData: vi.fn(),
    migrateFromLocalStorage: vi.fn()
  }
}));

// Sample test data
const sampleLevel = {
  tee: { x: 100, y: 100 },
  cup: { x: 500, y: 300 },
  walls: [],
  wallsPoly: [],
  bridges: [],
  water: [],
  waterPoly: [],
  sand: [],
  sandPoly: [],
  hills: [],
  meta: {
    authorId: 'test-user-123',
    authorName: 'Test User',
    title: 'Test Level',
    created: new Date().toISOString(),
    modified: new Date().toISOString()
  }
} as any;

const sampleUser = {
  id: 'test-user-123',
  name: 'Test User',
  role: 'user' as const,
  enabled: true,
  createdAt: new Date().toISOString()
};

describe('Firebase Connection Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    firebaseManager.destroy();
  });

  describe('Firebase Manager Initialization', () => {
    it('should initialize Firebase manager successfully', async () => {
      vi.mocked(FirebaseDatabase.getLevels).mockResolvedValue([] as any);
      vi.mocked(FirebaseDatabase.getUsers).mockResolvedValue([] as any);
      
      await expect(firebaseManager.init()).resolves.not.toThrow();
      expect(firebaseManager.users).toBeDefined();
      expect(firebaseManager.levels).toBeDefined();
      expect(firebaseManager.settings).toBeDefined();
      expect(firebaseManager.scores).toBeDefined();
    });

    it('should handle Firebase initialization errors gracefully', async () => {
      // Reset the manager to uninitialized state
      firebaseManager.destroy();
      
      // Mock the database methods to fail, including the fallback methods
      vi.mocked(FirebaseDatabase.getLevels).mockRejectedValue(new Error('Firebase connection failed'));
      vi.mocked(FirebaseDatabase.getUsers).mockRejectedValue(new Error('Firebase connection failed'));
      vi.mocked(FirebaseDatabase.initializeDefaultData).mockRejectedValue(new Error('Firebase connection failed'));
      vi.mocked(FirebaseDatabase.createUser).mockRejectedValue(new Error('Firebase connection failed'));
      
      await expect(firebaseManager.init()).rejects.toThrow('Firebase connection failed');
    });
  });

  describe('Level Storage Tests', () => {
    beforeEach(async () => {
      vi.mocked(FirebaseDatabase.getLevels).mockResolvedValue([] as any);
      vi.mocked(FirebaseDatabase.getUsers).mockResolvedValue([] as any);
      await firebaseManager.init();
    });

    it('should save a level to Firebase', async () => {
      const levelId = 'test-level-123';
      vi.mocked(FirebaseDatabase.saveLevel).mockResolvedValue(levelId as any);

      const savedId = await firebaseManager.levels.saveLevel(sampleLevel, undefined, 'test-user-123');
      
      expect(FirebaseDatabase.saveLevel).toHaveBeenCalled();
      expect(savedId).toBe(levelId);
    });

    it('should retrieve all levels from Firebase', async () => {
      const mockLevels = [
        {
          id: 'level-1',
          title: 'Level 1',
          authorId: 'user-1',
          authorName: 'User One',
          data: sampleLevel,
          createdAt: Date.now(),
          lastModified: Date.now(),
          isPublic: true
        }
      ];
      
      vi.mocked(FirebaseDatabase.getLevels).mockResolvedValue(mockLevels as any);
      vi.mocked(FirebaseDatabase.getUserLevels).mockResolvedValue([] as any);

      const levels = await firebaseManager.levels.getAllLevels('test-user-123');
      
      expect(FirebaseDatabase.getLevels).toHaveBeenCalled();
      expect(levels).toHaveLength(1);
      expect(levels[0].name).toBe('level-1');
      expect(levels[0].source).toBe('firebase');
    });

    it('should delete a level from Firebase', async () => {
      vi.mocked(FirebaseDatabase.deleteLevel).mockResolvedValue(undefined as any);

      await firebaseManager.levels.deleteLevel('test-level-123', 'test-user-123');
      
      expect(FirebaseDatabase.deleteLevel).toHaveBeenCalledWith('test-level-123', 'test-user-123');
    });

    it('should handle cross-user level discovery', async () => {
      const publicLevels = [
        {
          id: 'public-level-1',
          title: 'Public Level',
          authorId: 'user-1',
          authorName: 'User One',
          data: sampleLevel,
          createdAt: Date.now(),
          lastModified: Date.now(),
          isPublic: true
        }
      ];
      
      const userLevels = [
        {
          id: 'user-level-1',
          title: 'User Level',
          authorId: 'test-user-123',
          authorName: 'Test User',
          data: sampleLevel,
          createdAt: Date.now(),
          lastModified: Date.now(),
          isPublic: false
        }
      ];

      vi.mocked(FirebaseDatabase.getLevels).mockResolvedValue(publicLevels as any);
      vi.mocked(FirebaseDatabase.getUserLevels).mockResolvedValue(userLevels as any);

      const allLevels = await firebaseManager.levels.getAllLevels('test-user-123');
      
      expect(allLevels).toHaveLength(2);
      expect(allLevels.some(l => l.name === 'public-level-1')).toBe(true);
      expect(allLevels.some(l => l.name === 'user-level-1')).toBe(true);
    });
  });

  describe('User Management Tests', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      vi.mocked(FirebaseDatabase.getLevels).mockResolvedValue([] as any);
      vi.mocked(FirebaseDatabase.getUsers).mockResolvedValue([] as any);
      await firebaseManager.init();
    });

    it('should retrieve all users from Firebase', async () => {
      const mockUsers = [sampleUser];
      vi.mocked(FirebaseDatabase.getUsers).mockResolvedValue(mockUsers as any);

      const users = firebaseManager.users.getAll();
      
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('admin');
    });

    it('should delete a user from Firebase', async () => {
      // Add a user to the store first so it can be removed
      const testUser = await firebaseManager.users.addUser('Test User', 'user');
      vi.mocked(FirebaseDatabase.deleteUser).mockResolvedValue(undefined as any);
      
      await firebaseManager.users.removeUser(testUser.id);

      expect(FirebaseDatabase.deleteUser).toHaveBeenCalledWith(testUser.id);
    });
  });

  describe('Score System Tests', () => {
    beforeEach(async () => {
      vi.mocked(FirebaseDatabase.getLevels).mockResolvedValue([] as any);
      vi.mocked(FirebaseDatabase.getUsers).mockResolvedValue([] as any);
      await firebaseManager.init();
    });

    it('should save a score to Firebase', async () => {
      vi.mocked(FirebaseDatabase.saveScore).mockResolvedValue(undefined as any);

      await firebaseManager.scores.saveScore('test-user-123', 'test-level-123', 3);
      
      expect(FirebaseDatabase.saveScore).toHaveBeenCalled();
    });

    it('should retrieve best score from Firebase', async () => {
      const mockScores = [
        { userId: 'test-user-123', levelId: 'test-level-123', strokes: 2, timestamp: Date.now() }
      ];
      vi.mocked(FirebaseDatabase.getUserScores).mockResolvedValue(mockScores as any);

      const bestScore = await firebaseManager.scores.getBestScore('test-user-123', 'test-level-123');
      
      expect(FirebaseDatabase.getUserScores).toHaveBeenCalledWith('test-user-123');
      expect(bestScore).toBe(2);
    });

    it('should handle missing scores gracefully', async () => {
      vi.mocked(FirebaseDatabase.getUserScores).mockResolvedValue([] as any);

      const bestScore = await firebaseManager.scores.getBestScore('test-user-123', 'nonexistent-level');
      
      expect(bestScore).toBeNull();
    });
  });

  describe('Settings System Tests', () => {
    beforeEach(async () => {
      vi.mocked(FirebaseDatabase.getLevels).mockResolvedValue([] as any);
      vi.mocked(FirebaseDatabase.getUsers).mockResolvedValue([] as any);
      await firebaseManager.init();
    });

    it('should save settings to Firebase', async () => {
      const settings = { volume: 0.8, muted: false, lastUsername: 'TestUser' };
      vi.mocked(FirebaseDatabase.saveUserSettings).mockResolvedValue(undefined as any);

      await firebaseManager.settings.saveUserSettings('test-user-123', settings as any);
      
      expect(FirebaseDatabase.saveUserSettings).toHaveBeenCalled();
    });

    it('should retrieve settings from Firebase', async () => {
      const mockSettings = { volume: 0.7, muted: true, lastUsername: 'TestUser' };
      vi.mocked(FirebaseDatabase.getUserSettings).mockResolvedValue({ userId: 'test-user-123', ...mockSettings } as any);

      const settings = await firebaseManager.settings.loadUserSettings('test-user-123');
      
      expect(FirebaseDatabase.getUserSettings).toHaveBeenCalledWith('test-user-123');
      expect(settings.volume).toBe(0.7);
      expect(settings.muted).toBe(true);
    });
  });

  describe('Data Migration Tests', () => {
    beforeEach(async () => {
      vi.mocked(FirebaseDatabase.getLevels).mockResolvedValue([] as any);
      vi.mocked(FirebaseDatabase.getUsers).mockResolvedValue([] as any);
      await firebaseManager.init();
    });

    it('should migrate localStorage data to Firebase', async () => {
      // Mock localStorage data
      const mockLocalStorage: Record<string, string> = {
        'vp.users': JSON.stringify({
          version: 1,
          users: [sampleUser]
        }),
        'vp.levels.v1': JSON.stringify({
          version: 1,
          levels: [{ id: 'test-level', level: sampleLevel }]
        })
      };

      // Mock localStorage
      Object.defineProperty(global, 'localStorage', {
        value: {
          getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
          removeItem: vi.fn(),
          setItem: vi.fn(),
          clear: vi.fn()
        },
        writable: true
      });

      vi.mocked(FirebaseDatabase.createUser).mockResolvedValue(sampleUser.id as any);
      vi.mocked(FirebaseDatabase.saveLevel).mockResolvedValue('migrated-level-id' as any);

      // Trigger migration
      await firebaseManager.users.migrateFromLocalStorage();
      await firebaseManager.levels.migrateFromLocalStorage();

      expect(FirebaseDatabase.createUser).toHaveBeenCalled();
      expect(FirebaseDatabase.saveLevel).toHaveBeenCalled();
    });

    it('should handle migration errors gracefully', async () => {
      vi.mocked(FirebaseDatabase.createUser).mockRejectedValue(new Error('Migration failed'));

      // Should not throw, but log error
      await expect(firebaseManager.users.migrateFromLocalStorage()).resolves.not.toThrow();
    });
  });

  describe('Real-time Synchronization Tests', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      firebaseManager.destroy();
      vi.mocked(FirebaseDatabase.getLevels).mockResolvedValue([] as any);
      vi.mocked(FirebaseDatabase.getUsers).mockResolvedValue([] as any);
      await firebaseManager.init();
    });

    it('should handle concurrent level operations', async () => {
      // Clear mocks again to ensure clean state for this specific test
      vi.mocked(FirebaseDatabase.saveLevel).mockClear();
      vi.mocked(FirebaseDatabase.saveLevel).mockResolvedValueOnce('level-1' as any);
      vi.mocked(FirebaseDatabase.saveLevel).mockResolvedValueOnce('level-2' as any);

      const promises = [
        firebaseManager.levels.saveLevel(sampleLevel, undefined, 'user-1'),
        firebaseManager.levels.saveLevel(sampleLevel, undefined, 'user-2')
      ];

      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(2);
      expect(FirebaseDatabase.saveLevel).toHaveBeenCalledTimes(2);
    });

    it('should maintain data consistency during concurrent operations', async () => {
      const level1 = { ...sampleLevel, meta: { ...(sampleLevel as any).meta, title: 'Level 1' } };
      const level2 = { ...sampleLevel, meta: { ...(sampleLevel as any).meta, title: 'Level 2' } };

      vi.mocked(FirebaseDatabase.saveLevel).mockImplementation((levelData: any) => {
        return Promise.resolve(`level-${levelData.title?.split(' ')[1].toLowerCase()}` as any);
      });

      const [id1, id2] = await Promise.all([
        firebaseManager.levels.saveLevel(level1, undefined, 'user-1'),
        firebaseManager.levels.saveLevel(level2, undefined, 'user-2')
      ]);

      expect(id1).toBe('level-1');
      expect(id2).toBe('level-2');
    });
  });

  describe('Error Handling Tests', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      vi.mocked(FirebaseDatabase.getLevels).mockResolvedValue([] as any);
      vi.mocked(FirebaseDatabase.getUsers).mockResolvedValue([] as any);
      await firebaseManager.init();
    });

    it('should handle network errors gracefully', async () => {
      vi.mocked(FirebaseDatabase.saveLevel).mockRejectedValue(new Error('Network error'));

      await expect(firebaseManager.levels.saveLevel(sampleLevel, undefined, 'test-user'))
        .rejects.toThrow('Network error');
    });

    it('should handle invalid data gracefully', async () => {
      const invalidLevel = { ...sampleLevel, tee: null } as any;
      vi.mocked(FirebaseDatabase.saveLevel).mockRejectedValue(new Error('Invalid data'));

      await expect(firebaseManager.levels.saveLevel(invalidLevel, undefined, 'test-user'))
        .rejects.toThrow('Invalid data');
    });

    it('should handle authentication errors', async () => {
      vi.mocked(FirebaseDatabase.saveLevel).mockRejectedValue(new Error('Authentication failed'));

      await expect(firebaseManager.levels.saveLevel(sampleLevel, undefined, 'invalid-user'))
        .rejects.toThrow('Authentication failed');
    });
  });
});
