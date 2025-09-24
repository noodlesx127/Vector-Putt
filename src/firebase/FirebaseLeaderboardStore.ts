// Firebase-based leaderboard management system
import {
  FirebaseDatabase,
  LeaderboardKind,
  FirebaseLeaderboardEntry,
  FirebaseLeaderboardBoard,
  FirebaseLeaderboardSettings
} from './database.js';

export interface LeaderboardEntry extends FirebaseLeaderboardEntry {}
export interface LeaderboardBoard extends FirebaseLeaderboardBoard {}
export interface LeaderboardSettings extends FirebaseLeaderboardSettings {}

export interface RecordLevelResultOptions {
  levelId: string;
  userId: string;
  username: string;
  strokes: number;
  timeMs?: number;
}

export interface RecordCourseResultOptions {
  courseId: string;
  userId: string;
  username: string;
  totalStrokes: number;
  totalTimeMs?: number;
}

const DEFAULT_SETTINGS: LeaderboardSettings = {
  resetsEnabled: true,
  retentionDays: 365,
  visibility: 'public',
  allowTies: false,
  maxEntriesPerBoard: 100,
  lastModified: 0
};

function shouldReplaceEntry(existing: LeaderboardEntry | undefined, candidate: LeaderboardEntry, allowTies: boolean): boolean {
  if (!existing) return true;
  if (candidate.bestStrokes < existing.bestStrokes) return true;
  if (candidate.bestStrokes > existing.bestStrokes) return false;
  const candidateTime = candidate.bestTimeMs ?? Number.MAX_SAFE_INTEGER;
  const existingTime = existing.bestTimeMs ?? Number.MAX_SAFE_INTEGER;
  if (candidateTime < existingTime) return true;
  if (!allowTies) return false;
  // When ties allowed and candidate time equals existing time, keep earliest (existing)
  return false;
}

function sortEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (a.bestStrokes !== b.bestStrokes) return a.bestStrokes - b.bestStrokes;
    const aTime = a.bestTimeMs ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.bestTimeMs ?? Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
    return (a.lastUpdated ?? 0) - (b.lastUpdated ?? 0);
  });
}

export class FirebaseLeaderboardStore {
  private initialized = false;
  private boardCache: Map<string, LeaderboardBoard> = new Map();
  private settingsCache: LeaderboardSettings | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  async getSettings(): Promise<LeaderboardSettings> {
    if (this.settingsCache) return this.settingsCache;
    const fromDb = await FirebaseDatabase.getLeaderboardSettings();
    this.settingsCache = fromDb ? { ...DEFAULT_SETTINGS, ...fromDb } : { ...DEFAULT_SETTINGS };
    return this.settingsCache;
  }

  async saveSettings(settings: Partial<LeaderboardSettings>): Promise<void> {
    const merged = { ...(await this.getSettings()), ...settings, lastModified: Date.now() };
    await FirebaseDatabase.saveLeaderboardSettings(merged);
    this.settingsCache = merged;
  }

  async reloadSettings(): Promise<LeaderboardSettings> {
    this.settingsCache = null;
    return this.getSettings();
  }

  async ensureLevelBoard(levelId: string): Promise<void> {
    await FirebaseDatabase.ensureLeaderboard('levels', levelId);
  }

  async ensureCourseBoard(courseId: string): Promise<void> {
    await FirebaseDatabase.ensureLeaderboard('courses', courseId);
  }

  async getBoard(kind: LeaderboardKind, id: string, useCache = true): Promise<LeaderboardBoard | null> {
    const cacheKey = `${kind}:${id}`;
    if (useCache && this.boardCache.has(cacheKey)) {
      return this.boardCache.get(cacheKey)!;
    }
    const board = await FirebaseDatabase.getLeaderboard(kind, id);
    if (board) this.boardCache.set(cacheKey, board);
    return board;
  }

  async listBoards(kind: LeaderboardKind): Promise<LeaderboardBoard[]> {
    const boards = await FirebaseDatabase.getLeaderboards(kind);
    return Object.values(boards).map(board => ({
      ...board,
      entries: board.entries ?? {}
    }));
  }

  async getTopEntries(kind: LeaderboardKind, id: string, limit = 10): Promise<LeaderboardEntry[]> {
    const board = await this.getBoard(kind, id, false);
    if (!board) return [];
    return sortEntries(Object.values(board.entries)).slice(0, limit);
  }

  async recordLevelResult(options: RecordLevelResultOptions): Promise<void> {
    const { levelId, userId, username, strokes, timeMs } = options;
    await this.ensureLevelBoard(levelId);
    await this.updateBoard('levels', levelId, userId, username, strokes, timeMs);
  }

  async recordCourseResult(options: RecordCourseResultOptions): Promise<void> {
    const { courseId, userId, username, totalStrokes, totalTimeMs } = options;
    await this.ensureCourseBoard(courseId);
    await this.updateBoard('courses', courseId, userId, username, totalStrokes, totalTimeMs);
  }

  async resetBoard(kind: LeaderboardKind, id: string): Promise<void> {
    await FirebaseDatabase.removeLeaderboard(kind, id);
    this.boardCache.delete(`${kind}:${id}`);
  }

  async pruneBoardBySettings(kind: LeaderboardKind, id: string): Promise<void> {
    const settings = await this.getSettings();
    await this.pruneBoard(kind, id, settings.maxEntriesPerBoard);
    this.boardCache.delete(`${kind}:${id}`);
  }

  async applyRetentionPolicy(kind: LeaderboardKind, id: string): Promise<number> {
    const settings = await this.getSettings();
    const retentionDays = settings.retentionDays ?? 0;
    if (retentionDays <= 0) return 0;
    const board = await FirebaseDatabase.getLeaderboard(kind, id);
    if (!board) return 0;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const entry of Object.values(board.entries)) {
      const lastUpdated = entry.lastUpdated ?? 0;
      if (lastUpdated > 0 && lastUpdated < cutoff) {
        try {
          await FirebaseDatabase.removeLeaderboardEntry(kind, id, entry.userId);
          removed += 1;
        } catch (err) {
          console.warn(`Failed to remove expired leaderboard entry ${entry.userId} from ${kind}/${id}`, err);
        }
      }
    }
    if (removed > 0) {
      await FirebaseDatabase.ensureLeaderboard(kind, id);
      this.boardCache.delete(`${kind}:${id}`);
    }
    return removed;
  }

  clearCache(): void {
    this.boardCache.clear();
    this.settingsCache = null;
  }

  private async updateBoard(
    kind: LeaderboardKind,
    boardId: string,
    userId: string,
    username: string,
    strokes: number,
    timeMs?: number
  ): Promise<void> {
    const settings = await this.getSettings();
    const entries = await FirebaseDatabase.getLeaderboardEntries(kind, boardId);
    const now = Date.now();

    const existing = entries[userId];
    const candidate: LeaderboardEntry = {
      userId,
      username,
      bestStrokes: strokes,
      bestTimeMs: timeMs,
      attempts: (existing?.attempts ?? 0) + 1,
      lastUpdated: now
    };

    let entryToStore: LeaderboardEntry;
    if (shouldReplaceEntry(existing, candidate, settings.allowTies)) {
      entryToStore = candidate;
    } else {
      entryToStore = {
        ...existing!,
        attempts: existing!.attempts + 1,
        lastUpdated: now
      };
    }

    await FirebaseDatabase.upsertLeaderboardEntry(kind, boardId, userId, entryToStore);
    await this.pruneBoard(kind, boardId, settings.maxEntriesPerBoard);
    this.boardCache.delete(`${kind}:${boardId}`);
  }

  private async pruneBoard(kind: LeaderboardKind, boardId: string, maxEntries: number): Promise<void> {
    if (maxEntries <= 0) return;
    const board = await FirebaseDatabase.getLeaderboard(kind, boardId);
    if (!board) return;
    const sorted = sortEntries(Object.values(board.entries));
    if (sorted.length <= maxEntries) return;

    const toKeep = new Set(sorted.slice(0, maxEntries).map(entry => entry.userId));
    for (const userId of Object.keys(board.entries)) {
      if (!toKeep.has(userId)) {
        try {
          await FirebaseDatabase.removeLeaderboardEntry(kind, boardId, userId);
        } catch (err) {
          console.warn(`Failed to prune leaderboard entry ${userId} from ${kind}/${boardId}`, err);
        }
      }
    }
  }
}

const firebaseLeaderboardStore = new FirebaseLeaderboardStore();
export default firebaseLeaderboardStore;
