// Firebase Database Cleanup Tool
// Handles duplicate removal, data integrity fixes, and database maintenance
import { FirebaseDatabase, FirebaseLevel, FirebaseUser } from './database.js';

export interface CleanupReport {
  timestamp: string;
  totalLevelsScanned: number;
  totalUsersScanned: number;
  duplicateLevelsRemoved: number;
  duplicateUsersRemoved: number;
  orphanedLevelsRemoved: number;
  invalidDataFixed: number;
  errors: string[];
  warnings: string[];
}

export interface CleanupOptions {
  removeDuplicateLevels?: boolean;
  removeDuplicateUsers?: boolean;
  removeOrphanedLevels?: boolean;
  fixInvalidData?: boolean;
  removeTestData?: boolean;
  dryRun?: boolean; // Preview changes without applying them
}

export class DatabaseCleanup {
  private report: CleanupReport;

  constructor() {
    this.report = {
      timestamp: new Date().toISOString(),
      totalLevelsScanned: 0,
      totalUsersScanned: 0,
      duplicateLevelsRemoved: 0,
      duplicateUsersRemoved: 0,
      orphanedLevelsRemoved: 0,
      invalidDataFixed: 0,
      errors: [],
      warnings: []
    };
  }

  async cleanup(options: CleanupOptions = {}): Promise<CleanupReport> {
    console.log('🧹 Starting Firebase database cleanup...');
    console.log('Options:', options);

    try {
      // Default options
      const opts: Required<CleanupOptions> = {
        removeDuplicateLevels: true,
        removeDuplicateUsers: true,
        removeOrphanedLevels: true,
        fixInvalidData: true,
        removeTestData: true,
        dryRun: false,
        ...options
      };

      if (opts.dryRun) {
        console.log('🔍 DRY RUN MODE - No changes will be applied');
      }

      // Step 1: Clean up duplicate and invalid users
      if (opts.removeDuplicateUsers || opts.fixInvalidData) {
        await this.cleanupUsers(opts);
      }

      // Step 2: Clean up duplicate and orphaned levels
      if (opts.removeDuplicateLevels || opts.removeOrphanedLevels || opts.fixInvalidData) {
        await this.cleanupLevels(opts);
      }

      // Step 3: Remove test data if requested
      if (opts.removeTestData) {
        await this.removeTestData(opts);
      }

      // Step 4: Validate data integrity
      await this.validateDataIntegrity();

      console.log('✅ Database cleanup completed');
      this.printReport();

    } catch (error) {
      this.report.errors.push(`Cleanup failed: ${error}`);
      console.error('❌ Database cleanup failed:', error);
    }

    return this.report;
  }

  private async cleanupUsers(options: Required<CleanupOptions>): Promise<void> {
    console.log('👥 Cleaning up users...');

    try {
      const users = await FirebaseDatabase.getUsers();
      this.report.totalUsersScanned = users.length;

      // Find duplicates by name
      const usersByName = new Map<string, FirebaseUser[]>();
      for (const user of users) {
        const name = user.name?.toLowerCase() || '';
        if (!usersByName.has(name)) {
          usersByName.set(name, []);
        }
        usersByName.get(name)!.push(user);
      }

      // Remove duplicates (keep the oldest one)
      for (const [name, duplicateUsers] of usersByName) {
        if (duplicateUsers.length > 1) {
          // Sort by creation date (oldest first)
          duplicateUsers.sort((a, b) => a.createdAt - b.createdAt);
          
          // Keep the first (oldest), remove the rest
          for (let i = 1; i < duplicateUsers.length; i++) {
            const userToRemove = duplicateUsers[i];
            console.log(`🗑️ Removing duplicate user: ${userToRemove.name} (${userToRemove.id})`);
            
            if (!options.dryRun) {
              await FirebaseDatabase.deleteUser(userToRemove.id);
            }
            this.report.duplicateUsersRemoved++;
          }
        }

        // Fix invalid user data
        for (const user of duplicateUsers) {
          let needsUpdate = false;
          const updates: Partial<FirebaseUser> = {};

          // Ensure required fields
          if (!user.name || user.name.trim() === '') {
            updates.name = `User_${user.id}`;
            needsUpdate = true;
          }

          if (!user.role || !['admin', 'user'].includes(user.role)) {
            updates.role = 'user';
            needsUpdate = true;
          }

          if (typeof user.enabled !== 'boolean') {
            updates.enabled = true;
            needsUpdate = true;
          }

          if (!user.createdAt || user.createdAt <= 0) {
            updates.createdAt = Date.now();
            needsUpdate = true;
          }

          if (needsUpdate && options.fixInvalidData) {
            console.log(`🔧 Fixing invalid user data: ${user.name} (${user.id})`);
            if (!options.dryRun) {
              await FirebaseDatabase.updateUser(user.id, updates);
            }
            this.report.invalidDataFixed++;
          }
        }
      }

    } catch (error) {
      this.report.errors.push(`User cleanup failed: ${error}`);
      console.error('❌ User cleanup failed:', error);
    }
  }

  private async cleanupLevels(options: Required<CleanupOptions>): Promise<void> {
    console.log('🎮 Cleaning up levels...');

    try {
      const levels = await FirebaseDatabase.getLevels();
      this.report.totalLevelsScanned = levels.length;

      // Get all valid users for orphan detection
      const users = await FirebaseDatabase.getUsers();
      const validUserIds = new Set(users.map(u => u.id));

      // Find duplicates by title and author
      const levelsByKey = new Map<string, FirebaseLevel[]>();
      
      for (const level of levels) {
        // Create a key based on title and author
        const key = `${level.title || 'untitled'}_${level.authorId || 'unknown'}`.toLowerCase();
        if (!levelsByKey.has(key)) {
          levelsByKey.set(key, []);
        }
        levelsByKey.get(key)!.push(level);
      }

      // Process each group of levels
      for (const [key, duplicateLevels] of levelsByKey) {
        // Remove duplicates (keep the newest one)
        if (duplicateLevels.length > 1 && options.removeDuplicateLevels) {
          // Sort by creation date (newest first)
          duplicateLevels.sort((a, b) => b.createdAt - a.createdAt);
          
          // Keep the first (newest), remove the rest
          for (let i = 1; i < duplicateLevels.length; i++) {
            const levelToRemove = duplicateLevels[i];
            console.log(`🗑️ Removing duplicate level: ${levelToRemove.title} by ${levelToRemove.authorName} (${levelToRemove.id})`);
            
            if (!options.dryRun) {
              await FirebaseDatabase.deleteLevel(levelToRemove.id);
            }
            this.report.duplicateLevelsRemoved++;
          }
        }

        // Check for orphaned levels and invalid data
        for (const level of duplicateLevels) {
          // Remove orphaned levels (author no longer exists)
          if (options.removeOrphanedLevels && level.authorId && !validUserIds.has(level.authorId)) {
            console.log(`🗑️ Removing orphaned level: ${level.title} (author ${level.authorId} not found)`);
            
            if (!options.dryRun) {
              await FirebaseDatabase.deleteLevel(level.id);
            }
            this.report.orphanedLevelsRemoved++;
            continue;
          }

          // Fix invalid level data
          if (options.fixInvalidData) {
            let needsUpdate = false;
            const updates: Partial<FirebaseLevel> = {};

            // Ensure required fields
            if (!level.title || level.title.trim() === '') {
              updates.title = `Level_${level.id}`;
              needsUpdate = true;
            }

            if (!level.authorName || level.authorName.trim() === '') {
              const author = users.find(u => u.id === level.authorId);
              updates.authorName = author?.name || 'Unknown Author';
              needsUpdate = true;
            }

            if (!level.createdAt || level.createdAt <= 0) {
              updates.createdAt = Date.now();
              needsUpdate = true;
            }

            if (!level.lastModified || level.lastModified <= 0) {
              updates.lastModified = level.createdAt || Date.now();
              needsUpdate = true;
            }

            if (typeof level.isPublic !== 'boolean') {
              updates.isPublic = false;
              needsUpdate = true;
            }

            // Validate level data structure
            if (level.data) {
              const data = level.data;
              let dataFixed = false;

              // Ensure required level components exist
              if (!data.tee) {
                data.tee = { x: 100, y: 100 };
                dataFixed = true;
              }

              if (!data.cup) {
                data.cup = { x: 500, y: 300 };
                dataFixed = true;
              }

              // Ensure arrays exist
              if (!Array.isArray(data.walls)) {
                data.walls = [];
                dataFixed = true;
              }

              if (!Array.isArray(data.wallsPoly)) {
                data.wallsPoly = [];
                dataFixed = true;
              }

              if (!Array.isArray(data.bridges)) {
                data.bridges = [];
                dataFixed = true;
              }

              if (!Array.isArray(data.water)) {
                data.water = [];
                dataFixed = true;
              }

              if (!Array.isArray(data.waterPoly)) {
                data.waterPoly = [];
                dataFixed = true;
              }

              if (!Array.isArray(data.sand)) {
                data.sand = [];
                dataFixed = true;
              }

              if (!Array.isArray(data.sandPoly)) {
                data.sandPoly = [];
                dataFixed = true;
              }

              if (!Array.isArray(data.hills)) {
                data.hills = [];
                dataFixed = true;
              }

              // Ensure course metadata
              if (!data.course) {
                data.course = {
                  index: 1,
                  total: 1,
                  title: level.title || 'Untitled Level',
                  par: 3
                };
                dataFixed = true;
              }

              if (dataFixed) {
                updates.data = data;
                needsUpdate = true;
              }
            }

            if (needsUpdate) {
              console.log(`🔧 Fixing invalid level data: ${level.title} (${level.id})`);
              if (!options.dryRun) {
                await FirebaseDatabase.updateLevel(level.id, updates);
              }
              this.report.invalidDataFixed++;
            }
          }
        }
      }

    } catch (error) {
      this.report.errors.push(`Level cleanup failed: ${error}`);
      console.error('❌ Level cleanup failed:', error);
    }
  }

  private async removeTestData(options: Required<CleanupOptions>): Promise<void> {
    console.log('🧪 Removing test data...');

    try {
      // Remove test users
      const users = await FirebaseDatabase.getUsers();
      for (const user of users) {
        if (this.isTestData(user.name) || this.isTestData(user.id)) {
          console.log(`🗑️ Removing test user: ${user.name} (${user.id})`);
          if (!options.dryRun) {
            await FirebaseDatabase.deleteUser(user.id);
          }
          this.report.duplicateUsersRemoved++;
        }
      }

      // Remove test levels
      const levels = await FirebaseDatabase.getLevels();
      for (const level of levels) {
        if (this.isTestData(level.title) || 
            this.isTestData(level.authorName) || 
            this.isTestData(level.authorId) ||
            this.isTestData(level.id)) {
          console.log(`🗑️ Removing test level: ${level.title} (${level.id})`);
          if (!options.dryRun) {
            await FirebaseDatabase.deleteLevel(level.id);
          }
          this.report.duplicateLevelsRemoved++;
        }
      }

    } catch (error) {
      this.report.errors.push(`Test data removal failed: ${error}`);
      console.error('❌ Test data removal failed:', error);
    }
  }

  private isTestData(value: string): boolean {
    if (!value) return false;
    
    const testPatterns = [
      /test/i,
      /integration/i,
      /mock/i,
      /dummy/i,
      /sample/i,
      /temp/i,
      /temporary/i,
      /debug/i,
      /dev/i,
      /development/i,
      /-test-/i,
      /_test_/i,
      /^test-/i,
      /^integration-/i
    ];

    return testPatterns.some(pattern => pattern.test(value));
  }

  private async validateDataIntegrity(): Promise<void> {
    console.log('🔍 Validating data integrity...');

    try {
      const users = await FirebaseDatabase.getUsers();
      const levels = await FirebaseDatabase.getLevels();

      // Check for admin users
      const adminUsers = users.filter(u => u.role === 'admin' && u.enabled);
      if (adminUsers.length === 0) {
        this.report.warnings.push('No enabled admin users found');
      }

      // Check for levels without valid authors
      const validUserIds = new Set(users.map(u => u.id));
      const orphanedLevels = levels.filter(l => l.authorId && !validUserIds.has(l.authorId));
      if (orphanedLevels.length > 0) {
        this.report.warnings.push(`${orphanedLevels.length} levels have invalid author references`);
      }

      // Check for duplicate user names
      const userNames = users.map(u => u.name?.toLowerCase()).filter(Boolean);
      const duplicateNames = userNames.filter((name, index) => userNames.indexOf(name) !== index);
      if (duplicateNames.length > 0) {
        this.report.warnings.push(`${duplicateNames.length} duplicate user names found`);
      }

      console.log('✅ Data integrity validation completed');

    } catch (error) {
      this.report.errors.push(`Data integrity validation failed: ${error}`);
      console.error('❌ Data integrity validation failed:', error);
    }
  }

  private printReport(): void {
    console.log('\n📊 CLEANUP REPORT');
    console.log('==================');
    console.log(`Timestamp: ${this.report.timestamp}`);
    console.log(`Users scanned: ${this.report.totalUsersScanned}`);
    console.log(`Levels scanned: ${this.report.totalLevelsScanned}`);
    console.log(`Duplicate users removed: ${this.report.duplicateUsersRemoved}`);
    console.log(`Duplicate levels removed: ${this.report.duplicateLevelsRemoved}`);
    console.log(`Orphaned levels removed: ${this.report.orphanedLevelsRemoved}`);
    console.log(`Invalid data fixed: ${this.report.invalidDataFixed}`);
    
    if (this.report.warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:');
      this.report.warnings.forEach(warning => console.log(`  - ${warning}`));
    }
    
    if (this.report.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      this.report.errors.forEach(error => console.log(`  - ${error}`));
    }
    
    console.log('==================\n');
  }

  // Quick cleanup presets
  static async quickCleanup(): Promise<CleanupReport> {
    const cleanup = new DatabaseCleanup();
    return cleanup.cleanup({
      removeDuplicateLevels: true,
      removeDuplicateUsers: true,
      removeOrphanedLevels: true,
      fixInvalidData: true,
      removeTestData: true,
      dryRun: false
    });
  }

  static async dryRunCleanup(): Promise<CleanupReport> {
    const cleanup = new DatabaseCleanup();
    return cleanup.cleanup({
      removeDuplicateLevels: true,
      removeDuplicateUsers: true,
      removeOrphanedLevels: true,
      fixInvalidData: true,
      removeTestData: true,
      dryRun: true
    });
  }

  static async removeTestDataOnly(): Promise<CleanupReport> {
    const cleanup = new DatabaseCleanup();
    return cleanup.cleanup({
      removeDuplicateLevels: false,
      removeDuplicateUsers: false,
      removeOrphanedLevels: false,
      fixInvalidData: false,
      removeTestData: true,
      dryRun: false
    });
  }
}

export default DatabaseCleanup;
