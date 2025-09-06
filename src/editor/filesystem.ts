// Filesystem utilities for Level Editor persistence
// Supports File System Access API and fallback download/upload

export interface LevelFile {
  name: string;
  path: string;
  data: any;
  source: 'filesystem' | 'bundled' | 'user';
  lastModified?: number;
}

export interface FileSystemOptions {
  username?: string;
  useUserDirectory?: boolean;
}

// Check if File System Access API is supported
export function isFileSystemAccessSupported(): boolean {
  return 'showDirectoryPicker' in window && 'showSaveFilePicker' in window;
}

// Get User_Levels directory handle or create it
let userLevelsDirectoryHandle: FileSystemDirectoryHandle | null = null;

export async function getUserLevelsDirectory(username: string): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) return null;
  
  try {
    if (!userLevelsDirectoryHandle) {
      // Try to get existing directory handle from storage
      const stored = localStorage.getItem('vp.userLevelsDirectory');
      if (stored) {
        try {
          userLevelsDirectoryHandle = await (navigator.storage as any).getDirectory?.();
        } catch (e) {
          console.warn('Failed to restore directory handle:', e);
        }
      }
      
      // If no handle, prompt user to select User_Levels directory
      if (!userLevelsDirectoryHandle) {
        userLevelsDirectoryHandle = await (window as any).showDirectoryPicker({
          mode: 'readwrite',
          startIn: 'documents'
        });
        localStorage.setItem('vp.userLevelsDirectory', 'selected');
      }
    }
    
    // Get or create username subdirectory
    if (userLevelsDirectoryHandle) {
      const userDir = await userLevelsDirectoryHandle.getDirectoryHandle(username, { create: true });
      return userDir;
    }
    return null;
  } catch (error) {
    console.error('Failed to access User_Levels directory:', error);
    return null;
  }
}

// Save level to filesystem
export async function saveLevelToFilesystem(
  levelData: any, 
  filename: string, 
  options: FileSystemOptions = {}
): Promise<boolean> {
  if (!isFileSystemAccessSupported()) {
    return saveLevelAsDownload(levelData, filename);
  }
  
  try {
    let directoryHandle: FileSystemDirectoryHandle | null = null;
    
    if (options.useUserDirectory && options.username) {
      directoryHandle = await getUserLevelsDirectory(options.username);
    }
    
    if (!directoryHandle) {
      // Use File System Access API to save directly
      const fileHandle = await (window as any).showSaveFilePicker({
        suggestedName: filename.endsWith('.json') ? filename : `${filename}.json`,
        types: [{
          description: 'Level files',
          accept: { 'application/json': ['.json'] }
        }]
      });
      
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(levelData, null, 2));
      await writable.close();
      return true;
    } else {
      // Save to User_Levels/<username>/
      const fileName = filename.endsWith('.json') ? filename : `${filename}.json`;
      const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(levelData, null, 2));
      await writable.close();
      return true;
    }
  } catch (error) {
    console.error('Failed to save to filesystem:', error);
    return false;
  }
}

// Fallback: save as download
export function saveLevelAsDownload(levelData: any, filename: string): boolean {
  try {
    const blob = new Blob([JSON.stringify(levelData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.error('Failed to download level:', error);
    return false;
  }
}

// Load levels from filesystem
export async function loadLevelsFromFilesystem(options: FileSystemOptions = {}): Promise<LevelFile[]> {
  const levels: LevelFile[] = [];
  
  // Load from bundled levels/ directory (if accessible)
  try {
    const bundledLevels = await loadBundledLevels();
    levels.push(...bundledLevels);
  } catch (error) {
    console.warn('Could not load bundled levels:', error);
  }
  
  // Load from User_Levels/<username>/ if available
  if (options.useUserDirectory && options.username && isFileSystemAccessSupported()) {
    try {
      const userLevels = await loadUserLevels(options.username);
      levels.push(...userLevels);
    } catch (error) {
      console.warn('Could not load user levels:', error);
    }
  }
  
  return levels;
}

// Load bundled levels from levels/ directory
async function loadBundledLevels(): Promise<LevelFile[]> {
  const levels: LevelFile[] = [];
  
  // Try to fetch level files - this works in dev mode
  const levelFiles = ['level1.json', 'level2.json', 'level3.json', 'level4.json', 'level5.json', 'level6.json', 'level7.json', 'level8.json'];
  
  for (const filename of levelFiles) {
    try {
      const response = await fetch(`/levels/${filename}`);
      if (response.ok) {
        const data = await response.json();
        levels.push({
          name: data.course?.title || filename.replace('.json', ''),
          path: `/levels/${filename}`,
          data,
          source: 'bundled'
        });
      }
    } catch (error) {
      // File doesn't exist or can't be loaded, skip
    }
  }
  
  return levels;
}

// Load user levels from User_Levels/<username>/
async function loadUserLevels(username: string): Promise<LevelFile[]> {
  const levels: LevelFile[] = [];
  
  try {
    const userDir = await getUserLevelsDirectory(username);
    if (!userDir) return levels;
    
    for await (const [name, handle] of userDir.entries()) {
      if (handle.kind === 'file' && name.endsWith('.json')) {
        try {
          const fileHandle = handle as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          const text = await file.text();
          const data = JSON.parse(text);
          
          levels.push({
            name: data.course?.title || name.replace('.json', ''),
            path: `User_Levels/${username}/${name}`,
            data,
            source: 'user',
            lastModified: file.lastModified
          });
        } catch (error) {
          console.warn(`Failed to load user level ${name}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Failed to load user levels:', error);
  }
  
  return levels;
}

// Import level from file upload with validation
export async function importLevelFromFile(): Promise<any | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.multiple = false;
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        // Validate the level data
        const validation = validateLevelData(data);
        if (!validation.valid) {
          console.error('Invalid level data:', validation.errors);
          alert(`Invalid level file:\n${validation.errors.join('\n')}`);
          resolve(null);
          return;
        }
        
        resolve(data);
      } catch (error) {
        console.error('Failed to import level:', error);
        alert('Failed to import level: Invalid JSON file');
        resolve(null);
      }
    };
    input.click();
  });
}

// Import multiple levels from file upload with validation
export async function importMultipleLevelsFromFiles(): Promise<Array<{name: string, data: any, source: string}> | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (files.length === 0) {
        resolve(null);
        return;
      }
      
      const results: Array<{name: string, data: any, source: string}> = [];
      const errors: string[] = [];
      
      for (const file of files) {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          
          // Validate the level data
          const validation = validateLevelData(data);
          if (!validation.valid) {
            errors.push(`${file.name}: ${validation.errors.join(', ')}`);
            continue;
          }
          
          // Apply automatic fix-ups
          const fixedData = applyLevelDataFixups(data);
          
          results.push({
            name: file.name.replace('.json', ''),
            data: fixedData,
            source: 'import'
          });
        } catch (error) {
          errors.push(`${file.name}: Invalid JSON file`);
        }
      }
      
      if (errors.length > 0) {
        console.warn('Import errors:', errors);
        alert(`Import completed with errors:\n${errors.join('\n')}`);
      }
      
      resolve(results.length > 0 ? results : null);
    };
    input.click();
  });
}

// Validate level data schema
export function validateLevelData(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!data || typeof data !== 'object') {
    errors.push('Level data must be an object');
    return { valid: false, errors };
  }
  
  // Check required fields
  if (!data.tee || typeof data.tee.x !== 'number' || typeof data.tee.y !== 'number') {
    errors.push('Level must have a valid tee position');
  }
  
  if (!data.cup || typeof data.cup.x !== 'number' || typeof data.cup.y !== 'number') {
    errors.push('Level must have a valid cup position');
  }
  
  if (!data.canvas || typeof data.canvas.width !== 'number' || typeof data.canvas.height !== 'number') {
    errors.push('Level must have valid canvas dimensions');
  }
  // Canvas bounds per firebase.md
  if (data.canvas && typeof data.canvas.width === 'number' && typeof data.canvas.height === 'number') {
    const w = data.canvas.width;
    const h = data.canvas.height;
    if (w < 400 || w > 1920) errors.push('Canvas width must be between 400 and 1920');
    if (h < 300 || h > 1080) errors.push('Canvas height must be between 300 and 1080');

    // Tee/Cup must be within canvas
    if (data.tee && (data.tee.x < 0 || data.tee.x > w || data.tee.y < 0 || data.tee.y > h)) {
      errors.push('Tee must be within canvas bounds');
    }
    if (data.cup && (data.cup.x < 0 || data.cup.x > w || data.cup.y < 0 || data.cup.y > h)) {
      errors.push('Cup must be within canvas bounds');
    }
  }

  // Par must be a positive integer 1-20
  if (data.par !== undefined) {
    if (typeof data.par !== 'number' || !Number.isInteger(data.par) || data.par < 1 || data.par > 20) {
      errors.push('Par must be an integer between 1 and 20');
    }
  }

  // Check arrays
  const arrayFields = ['walls', 'wallsPoly', 'posts', 'bridges', 'water', 'waterPoly', 'sand', 'sandPoly', 'hills', 'decorations'];
  for (const field of arrayFields) {
    if (data[field] && !Array.isArray(data[field])) {
      errors.push(`${field} must be an array`);
    }
  }

  // Validate object-specific dimensions
  const ensurePositive = (v: any) => typeof v === 'number' && v > 0;
  if (Array.isArray(data.walls)) {
    data.walls.forEach((o: any, i: number) => {
      if (!ensurePositive(o.w) || !ensurePositive(o.h)) errors.push(`walls[${i}] must have positive width/height`);
    });
  }
  if (Array.isArray(data.bridges)) {
    data.bridges.forEach((o: any, i: number) => {
      if (!ensurePositive(o.w) || !ensurePositive(o.h)) errors.push(`bridges[${i}] must have positive width/height`);
    });
  }
  if (Array.isArray(data.water)) {
    data.water.forEach((o: any, i: number) => {
      if (!ensurePositive(o.w) || !ensurePositive(o.h)) errors.push(`water[${i}] must have positive width/height`);
    });
  }
  if (Array.isArray(data.sand)) {
    data.sand.forEach((o: any, i: number) => {
      if (!ensurePositive(o.w) || !ensurePositive(o.h)) errors.push(`sand[${i}] must have positive width/height`);
    });
  }
  if (Array.isArray(data.posts)) {
    data.posts.forEach((o: any, i: number) => {
      if (!ensurePositive(o.r)) errors.push(`posts[${i}] must have positive radius`);
    });
  }
  if (data.cup && !ensurePositive(data.cup.r)) {
    errors.push('Cup radius must be positive');
  }
  if (data.tee && data.tee.r !== undefined && !ensurePositive(data.tee.r)) {
    errors.push('Tee radius must be positive when provided');
  }

  const checkPoly = (arr: any[], name: string) => {
    arr.forEach((o: any, i: number) => {
      if (!o || !Array.isArray(o.points) || o.points.length < 6 || o.points.length % 2 !== 0) {
        errors.push(`${name}[${i}].points must be an even-length number[] with at least 3 points`);
      } else if (!o.points.every((n: any) => typeof n === 'number' && isFinite(n))) {
        errors.push(`${name}[${i}].points must contain only numbers`);
      }
    });
  };
  if (Array.isArray(data.wallsPoly)) checkPoly(data.wallsPoly, 'wallsPoly');
  if (Array.isArray(data.waterPoly)) checkPoly(data.waterPoly, 'waterPoly');
  if (Array.isArray(data.sandPoly)) checkPoly(data.sandPoly, 'sandPoly');
  
  return { valid: errors.length === 0, errors };
}

// Apply automatic fix-ups to level data where safe
export function applyLevelDataFixups(data: any): any {
  const fixed = JSON.parse(JSON.stringify(data)); // Deep clone
  
  // Ensure all required arrays exist
  const arrayFields = ['walls', 'wallsPoly', 'posts', 'bridges', 'water', 'waterPoly', 'sand', 'sandPoly', 'hills', 'decorations'];
  for (const field of arrayFields) {
    if (!fixed[field]) {
      fixed[field] = [];
    }
  }
  
  // Ensure canvas dimensions are valid
  if (!fixed.canvas) {
    fixed.canvas = { width: 800, height: 600 };
  }
  if (typeof fixed.canvas.width !== 'number' || fixed.canvas.width <= 0) {
    fixed.canvas.width = 800;
  }
  if (typeof fixed.canvas.height !== 'number' || fixed.canvas.height <= 0) {
    fixed.canvas.height = 600;
  }
  
  // Ensure par is valid
  if (typeof fixed.par !== 'number' || fixed.par <= 0) {
    fixed.par = 3;
  }
  
  // Ensure course metadata exists
  if (!fixed.course) {
    fixed.course = { index: 1, total: 1 };
  }
  if (typeof fixed.course.index !== 'number') {
    fixed.course.index = 1;
  }
  if (typeof fixed.course.total !== 'number') {
    fixed.course.total = 1;
  }
  
  // Ensure meta object exists for author tracking
  if (!fixed.meta) {
    fixed.meta = {};
  }
  
  // Set lastModified if not present
  if (!fixed.meta.lastModified) {
    fixed.meta.lastModified = Date.now();
  }
  
  return fixed;
}
