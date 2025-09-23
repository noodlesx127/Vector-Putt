// Firebase integration module - centralized Firebase services
import { FirebaseUsersStore } from './FirebaseUsersStore.js';
import { FirebaseLevelStore } from './FirebaseLevelStore.js';
import { FirebaseSettingsStore } from './FirebaseSettingsStore.js';
import { FirebaseScoreStore } from './FirebaseScoreStore.js';
import { FirebaseDatabase } from './database.js';
import { FirebaseCourseStore } from './FirebaseCourseStore.js';

// Create store instances
export const firebaseUsersStore = new FirebaseUsersStore();
export const firebaseLevelStore = new FirebaseLevelStore();
export const firebaseSettingsStore = new FirebaseSettingsStore();
export const firebaseScoreStore = new FirebaseScoreStore();
export const firebaseCourseStore = new FirebaseCourseStore();

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
        firebaseScoreStore.init(),
        firebaseCourseStore.init()
      ]);

      this.initialized = true;
      console.log('Firebase services initialized successfully');

    } catch (error) {
      console.error('Failed to initialize Firebase services:', error);
      throw error;
    }
  }

  // Note: per policy, user data migration has been removed.

  // Getters for stores
  get users() { return firebaseUsersStore; }
  get levels() { return firebaseLevelStore; }
  get settings() { return firebaseSettingsStore; }
  get scores() { return firebaseScoreStore; }
  get courses() { return firebaseCourseStore; }

  // Cleanup
  destroy(): void {
    firebaseUsersStore.destroy();
    firebaseLevelStore.clearCache();
    firebaseSettingsStore.clearCache();
    firebaseScoreStore.clearCache();
    firebaseCourseStore.clearCache();
    this.initialized = false;
  }
}

export const firebaseManager = new FirebaseManager();
export default firebaseManager;

// Stores are already exported above
