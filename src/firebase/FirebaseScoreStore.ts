// Firebase-based score tracking system
import { FirebaseDatabase, FirebaseScore } from './database.js';

export interface ScoreRecord {
  levelId: string;
  strokes: number;
  timestamp: number;
  courseId?: string;
}

export interface UserScores {
  [levelPath: string]: {
    bestScore: number;
    allScores: number[];
    lastPlayed: number;
  };
}

export class FirebaseScoreStore {
  private initialized = false;
  private cachedScores: Map<string, UserScores> = new Map();

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  // Load user scores
  async loadUserScores(userId: string): Promise<UserScores> {
    try {
      // Check cache first
      if (this.cachedScores.has(userId)) {
        return this.cachedScores.get(userId)!;
      }

      // Load from Firebase
      const firebaseScores = await FirebaseDatabase.getUserScores(userId);
      
      const userScores: UserScores = {};
      
      for (const score of firebaseScores) {
        const levelPath = score.levelId;
        
        if (!userScores[levelPath]) {
          userScores[levelPath] = {
            bestScore: score.strokes,
            allScores: [score.strokes],
            lastPlayed: score.timestamp
          };
        } else {
          userScores[levelPath].allScores.push(score.strokes);
          if (score.strokes < userScores[levelPath].bestScore) {
            userScores[levelPath].bestScore = score.strokes;
          }
          if (score.timestamp > userScores[levelPath].lastPlayed) {
            userScores[levelPath].lastPlayed = score.timestamp;
          }
        }
      }

      // Cache the scores
      this.cachedScores.set(userId, userScores);
      
      return userScores;

    } catch (error) {
      console.error('Failed to load user scores from Firebase:', error);
      return {};
    }
  }

  // Save a score
  async saveScore(userId: string, levelId: string, strokes: number, courseId?: string): Promise<void> {
    try {
      const score: FirebaseScore = {
        userId,
        levelId,
        strokes,
        timestamp: Date.now(),
        courseId
      };

      await FirebaseDatabase.saveScore(score);
      
      // Update cache
      const userScores = this.cachedScores.get(userId) || {};
      
      if (!userScores[levelId]) {
        userScores[levelId] = {
          bestScore: strokes,
          allScores: [strokes],
          lastPlayed: score.timestamp
        };
      } else {
        userScores[levelId].allScores.push(strokes);
        if (strokes < userScores[levelId].bestScore) {
          userScores[levelId].bestScore = strokes;
        }
        userScores[levelId].lastPlayed = score.timestamp;
      }
      
      this.cachedScores.set(userId, userScores);

    } catch (error) {
      console.error('Failed to save score to Firebase:', error);
      throw new Error('Failed to save score to database');
    }
  }

  // Get best score for a level
  async getBestScore(userId: string, levelId: string): Promise<number | null> {
    try {
      const userScores = await this.loadUserScores(userId);
      return userScores[levelId]?.bestScore ?? null;
    } catch (error) {
      console.error('Failed to get best score:', error);
      return null;
    }
  }

  // Get level leaderboard
  async getLevelLeaderboard(levelId: string, limit = 10): Promise<Array<{userId: string, strokes: number, timestamp: number}>> {
    try {
      const scores = await FirebaseDatabase.getLevelScores(levelId);
      return scores
        .slice(0, limit)
        .map(score => ({
          userId: score.userId,
          strokes: score.strokes,
          timestamp: score.timestamp
        }));
    } catch (error) {
      console.error('Failed to get level leaderboard:', error);
      return [];
    }
  }

  // Migration from localStorage
  async migrateFromLocalStorage(userId: string): Promise<void> {
    try {
      // Check if there are existing scores to migrate
      const existingScores = await FirebaseDatabase.getUserScores(userId);
      if (existingScores.length > 0) {
        // Scores already exist in Firebase, skip migration
        return;
      }

      // Try to migrate from localStorage
      const localScoresStr = localStorage.getItem('vp.scores');
      if (!localScoresStr) return;

      const localScores = JSON.parse(localScoresStr);
      const userScores = localScores[userId];
      
      if (!userScores) return;

      console.log('Migrating scores from localStorage to Firebase...');
      
      const migrationPromises: Promise<void>[] = [];
      
      for (const [levelPath, scoreData] of Object.entries(userScores)) {
        const scores = scoreData as any;
        if (scores && Array.isArray(scores.allScores)) {
          // Save each score
          for (const strokes of scores.allScores) {
            migrationPromises.push(
              this.saveScore(userId, levelPath, strokes)
            );
          }
        }
      }
      
      await Promise.all(migrationPromises);
      
      // Clear localStorage after successful migration
      const updatedLocalScores = { ...localScores };
      delete updatedLocalScores[userId];
      
      if (Object.keys(updatedLocalScores).length === 0) {
        localStorage.removeItem('vp.scores');
      } else {
        localStorage.setItem('vp.scores', JSON.stringify(updatedLocalScores));
      }
      
      console.log(`Migrated ${migrationPromises.length} scores successfully`);

    } catch (error) {
      console.error('Failed to migrate scores from localStorage:', error);
    }
  }

  // Clear cache
  clearCache(): void {
    this.cachedScores.clear();
  }
}

const firebaseScoreStore = new FirebaseScoreStore();
export default firebaseScoreStore;
