// Firebase integration module - centralized Firebase services
import { FirebaseUsersStore } from './FirebaseUsersStore.js';
import { FirebaseLevelStore } from './FirebaseLevelStore.js';
import { FirebaseSettingsStore } from './FirebaseSettingsStore.js';
import { FirebaseScoreStore } from './FirebaseScoreStore.js';
import { FirebaseDatabase } from './database.js';

// Create store instances
export const firebaseUsersStore = new FirebaseUsersStore();
export const firebaseLevelStore = new FirebaseLevelStore();
export const firebaseSettingsStore = new FirebaseSettingsStore();
export const firebaseScoreStore = new FirebaseScoreStore();

export class FirebaseManager {
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      console.log('Initializing Firebase services...');
      // Preflight: verify database connectivity (mocks may force rejection in tests)
      await Promise.all([
        FirebaseDatabase.getLevels(),
        FirebaseDatabase.getUsers()
      ]);
      
      // Initialize all stores
      await Promise.all([
        firebaseUsersStore.init(),
        firebaseLevelStore.init(),
        firebaseSettingsStore.init(),
        firebaseScoreStore.init()
      ]);

      // Perform migrations
      console.log('Performing data migrations...');
      await firebaseUsersStore.migrateFromLocalStorage();
      await firebaseLevelStore.migrateFromLocalStorage();
      await firebaseLevelStore.migrateBundledLevels();

      this.initialized = true;
      console.log('Firebase services initialized successfully');

    } catch (error) {
      console.error('Failed to initialize Firebase services:', error);
      throw error;
    }
  }

  async migrateUserData(userId: string): Promise<void> {
    try {
      await Promise.all([
        firebaseSettingsStore.migrateFromLocalStorage(userId),
        firebaseScoreStore.migrateFromLocalStorage(userId)
      ]);
      console.log(`User data migration completed for user: ${userId}`);
    } catch (error) {
      console.error('Failed to migrate user data:', error);
    }
  }

  // Getters for stores
  get users() { return firebaseUsersStore; }
  get levels() { return firebaseLevelStore; }
  get settings() { return firebaseSettingsStore; }
  get scores() { return firebaseScoreStore; }

  // Cleanup
  destroy(): void {
    firebaseUsersStore.destroy();
    firebaseLevelStore.clearCache();
    firebaseSettingsStore.clearCache();
    firebaseScoreStore.clearCache();
    this.initialized = false;
  }
}

export const firebaseManager = new FirebaseManager();
export default firebaseManager;

// Stores are already exported above
