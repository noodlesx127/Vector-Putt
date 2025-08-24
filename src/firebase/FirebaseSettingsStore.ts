// Firebase-based settings persistence
import { FirebaseDatabase, FirebaseSettings } from './database.js';

export interface GameSettings {
  volume: number;
  muted: boolean;
  lastUsername?: string;
  [key: string]: any;
}

export class FirebaseSettingsStore {
  private initialized = false;
  private cachedSettings: Map<string, GameSettings> = new Map();

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  // Load user settings
  async loadUserSettings(userId: string): Promise<GameSettings> {
    try {
      // Check cache first
      if (this.cachedSettings.has(userId)) {
        return this.cachedSettings.get(userId)!;
      }

      // Load from Firebase
      const firebaseSettings = await FirebaseDatabase.getUserSettings(userId);
      
      const settings: GameSettings = firebaseSettings ? {
        volume: firebaseSettings.volume,
        muted: firebaseSettings.muted,
        lastUsername: firebaseSettings.lastUsername
      } : {
        volume: 0.7,
        muted: false
      };

      // Cache the settings
      this.cachedSettings.set(userId, settings);
      
      return settings;

    } catch (error) {
      console.error('Failed to load user settings from Firebase:', error);
      // Return default settings
      return {
        volume: 0.7,
        muted: false
      };
    }
  }

  // Save user settings
  async saveUserSettings(userId: string, settings: GameSettings): Promise<void> {
    try {
      const firebaseSettings: FirebaseSettings = {
        userId,
        volume: settings.volume,
        muted: settings.muted,
        lastUsername: settings.lastUsername
      };

      await FirebaseDatabase.saveUserSettings(firebaseSettings);
      
      // Update cache
      this.cachedSettings.set(userId, settings);

    } catch (error) {
      console.error('Failed to save user settings to Firebase:', error);
      throw new Error('Failed to save settings to database');
    }
  }

  // Backward-compatible aliases used by some tests/integration code
  async saveSettings(userId: string, settings: GameSettings): Promise<void> {
    return this.saveUserSettings(userId, settings);
  }

  async getSettings(userId: string): Promise<GameSettings> {
    return this.loadUserSettings(userId);
  }

  // Update specific setting
  async updateSetting(userId: string, key: string, value: any): Promise<void> {
    try {
      const currentSettings = await this.loadUserSettings(userId);
      currentSettings[key] = value;
      await this.saveUserSettings(userId, currentSettings);
    } catch (error) {
      console.error('Failed to update setting:', error);
      throw new Error('Failed to update setting');
    }
  }

  // Migration from localStorage
  async migrateFromLocalStorage(userId: string): Promise<void> {
    try {
      // Check if there are existing settings to migrate
      const existingSettings = await FirebaseDatabase.getUserSettings(userId);
      if (existingSettings) {
        // Settings already exist in Firebase, skip migration
        return;
      }

      // Try to migrate from localStorage
      const localSettings: GameSettings = {
        volume: 0.7,
        muted: false
      };

      // Check for existing localStorage settings patterns
      const volumeStr = localStorage.getItem('vp.volume');
      if (volumeStr) {
        const volume = parseFloat(volumeStr);
        if (!isNaN(volume)) localSettings.volume = volume;
      }

      const mutedStr = localStorage.getItem('vp.muted');
      if (mutedStr) {
        localSettings.muted = mutedStr === 'true';
      }

      const lastUsername = localStorage.getItem('vp.lastUsername');
      if (lastUsername) {
        localSettings.lastUsername = lastUsername;
      }

      // Save migrated settings to Firebase
      await this.saveUserSettings(userId, localSettings);
      
      // Clean up localStorage
      localStorage.removeItem('vp.volume');
      localStorage.removeItem('vp.muted');
      localStorage.removeItem('vp.lastUsername');
      
      console.log('Migrated user settings to Firebase successfully');

    } catch (error) {
      console.error('Failed to migrate settings from localStorage:', error);
    }
  }

  // Clear cache
  clearCache(): void {
    this.cachedSettings.clear();
  }
}

const firebaseSettingsStore = new FirebaseSettingsStore();
export default firebaseSettingsStore;
