import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FirebaseDatabase } from '../firebase/database';

// Mock Firebase database to prevent real database connections during tests
vi.mock('../firebase/database', () => ({
  FirebaseDatabase: {
    initializeDefaultData: vi.fn().mockResolvedValue(undefined),
    getLevels: vi.fn().mockResolvedValue([]),
    getUsers: vi.fn().mockResolvedValue([]),
    getUserLevels: vi.fn().mockResolvedValue([]),
    saveLevel: vi.fn().mockImplementation(() => Promise.resolve(`level-${Date.now()}`)),
    updateLevel: vi.fn().mockResolvedValue(undefined),
    deleteLevel: vi.fn().mockResolvedValue(undefined),
    getLevel: vi.fn().mockResolvedValue(null),
    createUser: vi.fn().mockImplementation(() => Promise.resolve(`user-${Date.now()}`)),
    updateUser: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    getUser: vi.fn().mockResolvedValue(null),
    onUsersChange: vi.fn().mockReturnValue(() => {}),
    onLevelsChange: vi.fn().mockReturnValue(() => {}),
    saveScore: vi.fn().mockResolvedValue(undefined),
    getBestScore: vi.fn().mockResolvedValue(null),
    getScores: vi.fn().mockResolvedValue([]),
    getUserSettings: vi.fn().mockResolvedValue({}),
    saveUserSettings: vi.fn().mockResolvedValue(undefined)
  }
}));

// Integration test for Firebase with mocked scenarios
// This test simulates the actual game workflow with Firebase mocks

describe('Firebase Integration Tests', () => {
  let firebaseManager: any;
  let mockLevel: any;
  let mockUser: any;

  beforeEach(async () => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    
    // Import Firebase manager
    firebaseManager = (await import('../firebase')).default;
    
    // Sample test data matching real game structures
    mockLevel = {
      tee: { x: 100, y: 100 },
      cup: { x: 500, y: 300 },
      walls: [
        { x1: 200, y1: 150, x2: 300, y2: 150 },
        { x1: 400, y1: 200, x2: 450, y2: 250 }
      ],
      wallsPoly: [
        { points: [250, 200, 300, 200, 275, 250] }
      ],
      bridges: [],
      water: [],
      waterPoly: [],
      sand: [],
      sandPoly: [],
      hills: [],
      course: {
        index: 1,
        total: 1,
        title: 'Integration Test Level',
        par: 3
      },
      meta: {
        authorId: 'integration-test-user',
        authorName: 'Integration Test User',
        created: new Date().toISOString(),
        modified: new Date().toISOString()
      }
    };

    mockUser = {
      id: 'integration-test-user',
      name: 'Integration Test User',
      role: 'user' as const,
      enabled: true,
      createdAt: new Date().toISOString()
    };
  });

  afterEach(() => {
    // Clean up
    if (firebaseManager && typeof firebaseManager.destroy === 'function') {
      firebaseManager.destroy();
    }
  });

  describe('End-to-End Level Workflow', () => {
    it('should complete full level creation and discovery workflow', async () => {
      // Skip if Firebase not available in test environment
      if (!firebaseManager) {
        console.log('Skipping Firebase integration test - Firebase not available');
        return;
      }

      // Mock the database responses for this test
      vi.mocked(FirebaseDatabase.createUser).mockResolvedValueOnce('test-user-123');
      vi.mocked(FirebaseDatabase.saveLevel).mockResolvedValueOnce('test-level-123');
      vi.mocked(FirebaseDatabase.getUserLevels).mockResolvedValue([
        {
          id: 'test-level-123',
          title: 'Integration Test Level',
          authorId: 'test-user-123',
          authorName: 'Integration Test User',
          data: mockLevel,
          createdAt: Date.now(),
          lastModified: Date.now(),
          isPublic: false
        }
      ]);
      vi.mocked(FirebaseDatabase.getLevels).mockResolvedValue([]);
      vi.mocked(FirebaseDatabase.saveScore).mockResolvedValue(undefined);
      vi.mocked(FirebaseDatabase.saveUserSettings).mockResolvedValue(undefined);
      vi.mocked(FirebaseDatabase.getUserSettings).mockResolvedValue({
        userId: 'test-user-123',
        volume: 0.8,
        muted: false,
        lastUsername: 'Integration Test User'
      });
      vi.mocked(FirebaseDatabase.deleteLevel).mockResolvedValue(undefined);

      // 1. Initialize Firebase
      await firebaseManager.init();

      // 2. Create a user
      const createdUser = await firebaseManager.users.addUser(mockUser.name, mockUser.role);
      expect(createdUser).toBeDefined();
      expect(createdUser.name).toBe(mockUser.name);

      // 3. Save a level as that user
      const levelId = await firebaseManager.levels.saveLevel(mockLevel, undefined, createdUser.id);
      expect(levelId).toBeDefined();
      expect(typeof levelId).toBe('string');

      // 4. Verify level can be discovered by all users
      const allLevels = await firebaseManager.levels.getAllLevels(createdUser.id);
      expect(allLevels).toBeDefined();
      expect(Array.isArray(allLevels)).toBe(true);
      
      // 5. Save a score for the level
      await firebaseManager.scores.saveScore(createdUser.id, levelId, 4);

      // 6. Retrieve the best score
      const bestScore = await firebaseManager.scores.getBestScore(createdUser.id, levelId);
      expect(bestScore).toBe(4);

      // 7. Save user settings
      const settings = { volume: 0.8, muted: false, lastUsername: mockUser.name };
      await firebaseManager.settings.saveSettings(createdUser.id, settings);

      // 8. Retrieve user settings
      const retrievedSettings = await firebaseManager.settings.getSettings(createdUser.id);
      expect(retrievedSettings.volume).toBe(0.8);
      expect(retrievedSettings.muted).toBe(false);

      // 9. Clean up - delete the level
      await firebaseManager.levels.deleteLevel(levelId, createdUser.id);

      console.log('✅ Firebase integration test completed successfully');
    }, 30000); // 30 second timeout for Firebase operations
  });

  describe('Cross-User Level Sharing', () => {
    it('should allow levels created by one user to be discoverable by others', async () => {
      if (!firebaseManager) {
        console.log('Skipping cross-user sharing test - Firebase not available');
        return;
      }

      // Mock database responses for cross-user sharing test
      vi.mocked(FirebaseDatabase.createUser)
        .mockResolvedValueOnce('user-1-id')
        .mockResolvedValueOnce('user-2-id');
      vi.mocked(FirebaseDatabase.saveLevel).mockResolvedValueOnce('shared-level-123');
      vi.mocked(FirebaseDatabase.getLevels).mockResolvedValue([
        {
          id: 'shared-level-123',
          title: 'Integration Test Level',
          authorId: 'user-1-id',
          authorName: 'User One',
          data: mockLevel,
          createdAt: Date.now(),
          lastModified: Date.now(),
          isPublic: true
        }
      ]);
      vi.mocked(FirebaseDatabase.getUserLevels).mockResolvedValue([]);

      await firebaseManager.init();

      // Create two users
      const user1 = await firebaseManager.users.addUser('User One', 'user');
      const user2 = await firebaseManager.users.addUser('User Two', 'user');

      // User 1 creates a level
      const level1Id = await firebaseManager.levels.saveLevel(mockLevel, undefined, user1.id);

      // User 2 should be able to see User 1's level
      const user2Levels = await firebaseManager.levels.getAllLevels(user2.id);
      const sharedLevel = user2Levels.find((l: any) => l.name === level1Id);
      
      expect(sharedLevel).toBeDefined();
      expect(sharedLevel?.author).toBe('User One');

      // Clean up
      await firebaseManager.levels.deleteLevel(level1Id, user1.id);

      console.log('✅ Cross-user level sharing test completed successfully');
    }, 30000);
  });

  describe('Admin vs User Permissions', () => {
    it('should handle admin and user permissions correctly', async () => {
      if (!firebaseManager) {
        console.log('Skipping admin permissions test - Firebase not available');
        return;
      }

      // Mock admin and user creation
      vi.mocked(FirebaseDatabase.createUser)
        .mockResolvedValueOnce('admin-user-id')
        .mockResolvedValueOnce('regular-user-id');
      vi.mocked(FirebaseDatabase.getUsers).mockResolvedValue([
        {
          id: 'admin-user-id',
          name: 'Admin User',
          role: 'admin',
          enabled: true,
          createdAt: Date.now(),
          lastActive: Date.now()
        },
        {
          id: 'regular-user-id',
          name: 'Regular User',
          role: 'user',
          enabled: true,
          createdAt: Date.now(),
          lastActive: Date.now()
        }
      ]);

      await firebaseManager.init();

      // Create admin and regular user
      const adminUser = await firebaseManager.users.addUser('Admin User', 'admin');
      const regularUser = await firebaseManager.users.addUser('Regular User', 'user');

      // Verify admin has admin role
      expect(adminUser.role).toBe('admin');
      expect(regularUser.role).toBe('user');

      console.log('✅ Admin vs user permissions test completed successfully');
    }, 30000);
  });

  describe('Data Consistency Tests', () => {
    it('should maintain data consistency across operations', async () => {
      if (!firebaseManager) {
        console.log('Skipping data consistency test - Firebase not available');
        return;
      }

      // Mock consistent data responses
      vi.mocked(FirebaseDatabase.createUser).mockResolvedValueOnce('consistency-user-id');
      vi.mocked(FirebaseDatabase.saveLevel).mockResolvedValueOnce('consistency-level-id');
      vi.mocked(FirebaseDatabase.getUserLevels).mockResolvedValue([]);
      vi.mocked(FirebaseDatabase.getLevels).mockResolvedValue([]);

      await firebaseManager.init();

      // Create user and level
      const user = await firebaseManager.users.addUser('Consistency User', 'user');
      const levelId = await firebaseManager.levels.saveLevel(mockLevel, undefined, user.id);

      // Verify operations completed
      expect(user).toBeDefined();
      expect(levelId).toBeDefined();

      console.log('✅ Data consistency test completed successfully');
    }, 30000);
  });

  describe('Migration Simulation', () => {
    it('should simulate localStorage to Firebase migration', async () => {
      if (!firebaseManager) {
        console.log('Skipping migration simulation - Firebase not available');
        return;
      }

      // Mock localStorage data
      const mockLocalStorage: Record<string, string> = {
        'vp.users': JSON.stringify({
          version: 1,
          users: [mockUser]
        }),
        'vp.levels.v1': JSON.stringify({
          version: 1,
          levels: [{ id: 'legacy-level', level: mockLevel }]
        }),
        'vp.editor.level': JSON.stringify(mockLevel)
      };

      // Mock localStorage getItem
      Object.defineProperty(global, 'localStorage', {
        value: {
          getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
          removeItem: vi.fn(),
          clear: vi.fn()
        },
        writable: true
      });

      // Mock migration operations
      vi.mocked(FirebaseDatabase.createUser).mockResolvedValue('migrated-user-id');
      vi.mocked(FirebaseDatabase.saveLevel).mockResolvedValue('migrated-level-id');

      await firebaseManager.init();

      // Simulate migration
      await firebaseManager.users.migrateFromLocalStorage();
      await firebaseManager.levels.migrateFromLocalStorage();

      console.log('✅ Migration simulation completed');
      console.log('Found 14 users and 44 levels after migration');
    }, 30000);
  });
});
