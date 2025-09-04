# Firebase Database Schema & Standards

This document defines the standard structure and schema for the Vector Putt Firebase Realtime Database. Follow these guidelines to ensure consistency when adding new features or modifying existing data structures.

## Database Structure Overview

```
{
  "courses": { ... },      // Course collections
  "levels": { ... },       // Public/system levels
  "userLevels": { ... },   // User-created levels
  "scores": { ... },       // Player scores
  "settings": { ... },     // User settings
  "users": { ... }         // User accounts
}
```

## Core Data Types

### 1. Courses (`/courses/{courseId}`)

**Purpose**: Collections of levels that form structured gameplay sequences.

```typescript
interface Course {
  id: string;                    // Firebase-generated key
  title: string;                 // Display name
  levelIds: string[];            // Ordered array of level IDs
  isPublic: boolean;             // Visibility flag
  createdAt: number;             // Unix timestamp
  lastModified: number;          // Unix timestamp
}
```

**Example**:
```json
{
  "-OZ7WLQt-B5iqAp0SyJQ": {
    "title": "Dev Levs",
    "levelIds": ["-OZ77GXgavX-oiOK1fD_", "-OZ77GYYP-RvrmsFisoW"],
    "isPublic": true,
    "createdAt": 1756784583964,
    "lastModified": 1756873987447
  }
}
```

### 2. Public Levels (`/levels/{levelId}`)

**Purpose**: System-created and publicly accessible levels.

```typescript
interface PublicLevel {
  id: string;                    // Firebase-generated key
  title: string;                 // Display name
  authorId: "system";            // Always "system" for public levels
  authorName: "Game Developer";  // Always "Game Developer"
  isPublic: true;                // Always true
  createdAt: number;             // Unix timestamp
  lastModified: number;          // Unix timestamp
  data: LevelData;               // Level geometry and metadata
}
```

### 3. User Levels (`/userLevels/{userId}/{levelId}`)

**Purpose**: User-created levels organized by author.

```typescript
interface UserLevel {
  id: string;                    // Firebase-generated key
  title: string;                 // Display name
  authorId: string;              // User ID of creator
  authorName: string;            // Display name of creator
  isPublic: boolean;             // Visibility flag
  createdAt: number;             // Unix timestamp
  lastModified: number;          // Unix timestamp
  data: LevelData;               // Level geometry and metadata
}
```

### 4. Level Data Structure

**Purpose**: Common level geometry and game data format.

```typescript
interface LevelData {
  canvas: {
    width: number;               // Level width (typically 800 or 960)
    height: number;              // Level height (typically 600)
  };
  course?: {
    index: number;               // Position in course (1-based)
    total: number;               // Total levels in course
    title?: string;              // Level-specific title
  };
  tee: {
    x: number;                   // Starting position X
    y: number;                   // Starting position Y
    r?: number;                  // Tee radius (default: 8)
  };
  cup: {
    x: number;                   // Goal position X
    y: number;                   // Goal position Y
    r: number;                   // Cup radius (typically 12)
  };
  par: number;                   // Expected strokes
  
  // Geometry arrays (all optional)
  walls?: Wall[];               // Rectangular walls
  wallsPoly?: PolygonWall[];    // Polygon walls
  water?: Water[];              // Rectangular water hazards
  waterPoly?: PolygonWater[];   // Polygon water hazards
  sand?: Sand[];                // Rectangular sand traps
  sandPoly?: PolygonSand[];     // Polygon sand traps
  bridges?: Bridge[];           // Ball-passable platforms
  posts?: Post[];               // Circular obstacles
  hills?: Hill[];               // Slope areas
  decorations?: Decoration[];   // Visual elements
  
  meta?: {
    authorId?: string;           // Creator ID (legacy)
    authorName?: string;         // Creator name (legacy)
    title?: string;              // Level title (legacy)
    created?: string;            // ISO date string
    modified?: string;           // ISO date string
    lastModified?: number;       // Unix timestamp
  };
}
```

### 5. Geometry Objects

```typescript
// Rectangular objects
interface Wall {
  x: number; y: number;         // Position
  w: number; h: number;         // Dimensions
  rot?: number;                 // Rotation in radians (optional)
}

// Polygon objects
interface PolygonWall {
  points: number[];             // Flat array: [x1,y1,x2,y2,...]
}

// Circular objects
interface Post {
  x: number; y: number;         // Center position
  r: number;                    // Radius
}

// Hills (slopes)
interface Hill {
  x: number; y: number;         // Position
  w: number; h: number;         // Dimensions
  dir: "N"|"S"|"E"|"W"|"NE"|"NW"|"SE"|"SW"; // Slope direction
  strength?: number;            // Slope intensity (0-1)
  falloff?: number;             // Edge softness
}

// Decorations
interface Decoration {
  x: number; y: number;         // Position
  w: number; h: number;         // Dimensions
  kind: "flowers";              // Decoration type
}
```

### 6. Scores (`/scores/{userId}/{scoreId}`)

**Purpose**: Player performance tracking.

```typescript
interface Score {
  id: string;                   // Firebase-generated key
  userId: string;               // Player ID
  levelId: string;              // Level identifier (various formats)
  strokes: number;              // Number of shots taken
  timestamp: number;            // Unix timestamp
}
```

**Level ID Formats**:
- Public levels: `dev:{levelId}`
- Course levels: `course:{courseId}:{levelIndex}`
- Legacy levels: `/levels/level1.json`

### 7. User Settings (`/settings/{userId}`)

**Purpose**: Per-user game preferences.

```typescript
interface UserSettings {
  userId: string;               // User ID (matches key)
  volume: number;               // Audio volume (0-1)
  muted: boolean;               // Audio mute state
}
```

### 8. Users (`/users/{userId}`)

**Purpose**: User account management.

```typescript
interface User {
  id: string;                   // Firebase-generated key (matches path)
  name: string;                 // Display name
  role: "user" | "admin";       // Permission level
  enabled: boolean;             // Account status
  createdAt: number;            // Unix timestamp
  lastActive?: number;          // Unix timestamp (optional)
}
```

## Naming Conventions

### IDs and Keys
- **Firebase Keys**: Use Firebase's `push()` generated keys (e.g., `-OZ77GXgavX-oiOK1fD_`)
- **User-defined IDs**: Use kebab-case for readability (e.g., `level-1`, `my-course`)

### Field Names
- Use **camelCase** for all field names
- Use descriptive names: `authorName` not `author`, `lastModified` not `modified`
- Boolean fields: Use positive phrasing (`enabled` not `disabled`)

### Timestamps
- **Always use Unix timestamps** (milliseconds since epoch)
- Standard fields: `createdAt`, `lastModified`, `timestamp`
- Generate with: `Date.now()` in JavaScript

## Data Consistency Rules

### 1. Required Fields
Every entity must have:
- `id` (matches Firebase key)
- `createdAt` timestamp
- `lastModified` timestamp (update on every change)

### 2. Author Information
For user-created content:
- `authorId`: Firebase user ID
- `authorName`: Display name at time of creation
- Store both to handle name changes gracefully

### 3. Public vs Private Content
- **Public levels**: Store in `/levels/`, set `isPublic: true`
- **User levels**: Store in `/userLevels/{userId}/`, `isPublic` can be true/false
- **System levels**: Use `authorId: "system"`, `authorName: "Game Developer"`

### 4. Level Data Validation
Before saving level data:
- Validate canvas dimensions (minimum 400x300, maximum 1920x1080)
- Ensure tee and cup are within canvas bounds
- Verify par is positive integer (1-20)
- Check geometry objects don't have negative dimensions

## Database Operations

### Creating New Entities
```typescript
// Generate new Firebase key
const newKey = push(ref(database, 'levels')).key;

// Create with required fields
const newLevel = {
  id: newKey,
  title: "My Level",
  authorId: userId,
  authorName: userName,
  isPublic: false,
  createdAt: Date.now(),
  lastModified: Date.now(),
  data: levelData
};

// Save to appropriate path
await set(ref(database, `userLevels/${userId}/${newKey}`), newLevel);
```

### Updating Entities
```typescript
// Always update lastModified
const updates = {
  title: "New Title",
  lastModified: Date.now()
};

await update(ref(database, `userLevels/${userId}/${levelId}`), updates);
```

### Querying Data
```typescript
// Get all public levels
const publicLevels = await get(ref(database, 'levels'));

// Get user's levels
const userLevels = await get(ref(database, `userLevels/${userId}`));

// Get all user levels (admin operation)
const allUserLevels = await get(ref(database, 'userLevels'));
```

## Security Considerations

### Access Patterns
- **Public levels**: Read-only for all users, write access for admins only
- **User levels**: Full access for owner, read-only for others if `isPublic: true`
- **Scores**: Write access for owner only, read access for leaderboards
- **Settings**: Private to user, no cross-user access
- **Users**: Admin-only write access, limited read access

### Data Validation
- Validate all user input before database writes
- Sanitize level titles and user names
- Enforce size limits on level data (max 1MB per level)
- Rate limit level creation (max 10 levels per user per hour)

## Migration Guidelines

When modifying the schema:

1. **Additive Changes**: Add new optional fields, maintain backward compatibility
2. **Field Renames**: Support both old and new field names during transition
3. **Data Migration**: Write scripts to update existing data
4. **Version Tracking**: Add schema version field for major changes

## Performance Best Practices

### Data Structure
- Keep frequently accessed data at shallow paths
- Denormalize data when read performance is critical
- Use arrays for ordered data (course level lists)
- Limit nesting depth (max 3 levels)

### Query Optimization
- Index commonly queried fields
- Use pagination for large datasets
- Cache frequently accessed data client-side
- Batch related operations

## Error Handling

### Common Scenarios
- **Missing required fields**: Validate before save, provide defaults
- **Invalid references**: Check existence before creating relationships
- **Permission denied**: Graceful fallback, clear error messages
- **Network failures**: Implement retry logic with exponential backoff

### Data Integrity
- Use transactions for multi-path updates
- Validate foreign key relationships
- Clean up orphaned data periodically
- Log all data modifications for audit trail

---

**Last Updated**: September 2025  
**Schema Version**: 1.0  
**Maintainer**: Vector Putt Development Team
