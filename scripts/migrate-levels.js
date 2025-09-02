#!/usr/bin/env node

// One-time migration script: import JSON levels from ./levels/ into Firebase public (dev) levels
// Usage:
//   npm run build:ts && node scripts/migrate-levels.js [--dir levels] [--dry-run] [--overwrite]
// Options:
//   --dir <path>       Directory containing level JSON files (default: levels)
//   --dry-run          Print actions without writing to Firebase
//   --overwrite        If a level with same (title, authorId) exists, update it instead of skipping
//   --author-name <n>  Author name for imported levels (default: "Game Developer")
//   --author-id <id>   Author id for imported levels (default: "system")

import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, stat } from 'node:fs/promises';

async function main() {
  console.log('Starting levels migration...');

  // Import Firebase database layer from build output
  let FirebaseDatabase;
  try {
    const module = await import('../dist/firebase/database.js');
    FirebaseDatabase = module.FirebaseDatabase;
    if (!FirebaseDatabase) throw new Error('FirebaseDatabase export not found');
  } catch (err) {
    console.error('Failed to import Firebase database layer. Did you run "npm run build:ts"?', err);
    process.exit(1);
  }

  // Parse CLI args
  const args = process.argv.slice(2);
  const opts = {
    dir: 'levels',
    dryRun: false,
    overwrite: false,
    authorName: 'Game Developer',
    authorId: 'system'
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--dir':
        opts.dir = args[++i] || opts.dir;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--overwrite':
        opts.overwrite = true;
        break;
      case '--author-name':
        opts.authorName = args[++i] || opts.authorName;
        break;
      case '--author-id':
        opts.authorId = args[++i] || opts.authorId;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        if (a.startsWith('-')) {
          console.warn(`Unknown option: ${a}`);
          printHelp();
          process.exit(1);
        }
    }
  }

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const root = join(__dirname, '..');
  const levelsDir = join(root, opts.dir);

  // Collect json files in dir (non-recursive)
  let entries;
  try {
    entries = await readdir(levelsDir, { withFileTypes: true });
  } catch (err) {
    console.error(`Failed to read levels directory: ${levelsDir}`, err);
    process.exit(1);
  }

  const files = entries
    .filter((e) => e.isFile() && extname(e.name).toLowerCase() === '.json')
    // Exclude known non-level files
    .filter((e) => e.name.toLowerCase() !== 'course.json')
    .map((e) => join(levelsDir, e.name));

  if (files.length === 0) {
    console.log('No JSON level files found. Nothing to migrate.');
    process.exit(0);
  }

  console.log(`Found ${files.length} level files to process in ${levelsDir}`);

  // Fetch existing public levels to avoid duplicates
  let existing = [];
  try {
    existing = await FirebaseDatabase.getLevels();
  } catch (err) {
    console.error('Failed to fetch existing public levels from Firebase:', err);
    process.exit(1);
  }

  const existingKeyToLevel = new Map();
  for (const lvl of existing) {
    const key = `${(lvl.title || '').toLowerCase()}__${(lvl.authorId || '').toLowerCase()}`;
    existingKeyToLevel.set(key, lvl);
  }

  const results = { created: 0, updated: 0, skipped: 0, errors: 0 };

  for (const file of files) {
    try {
      const content = await readFile(file, 'utf-8');
      const data = JSON.parse(content);

      // Derive title
      const fallbackTitle = basename(file, '.json');
      const title = data?.course?.title || data?.title || fallbackTitle;

      // Build key and check duplicates
      const key = `${title.toLowerCase()}__${opts.authorId.toLowerCase()}`;
      const existingLevel = existingKeyToLevel.get(key);

      // Construct FirebaseLevel payload (without id)
      const payload = {
        title,
        authorId: opts.authorId,
        authorName: opts.authorName,
        data,
        isPublic: true,
        createdAt: Date.now(),
        lastModified: Date.now()
      };

      if (existingLevel && !opts.overwrite) {
        console.log(`⏭️  Skip (exists): ${title}`);
        results.skipped++;
        continue;
      }

      if (opts.dryRun) {
        console.log(`${existingLevel ? '🔁 Would update' : '➕ Would create'}: ${title}`);
        continue;
      }

      if (existingLevel && opts.overwrite) {
        await FirebaseDatabase.updateLevel(existingLevel.id, {
          title: payload.title,
          authorName: payload.authorName,
          data: payload.data,
          isPublic: true
        });
        console.log(`🔁 Updated: ${title}`);
        results.updated++;
      } else {
        await FirebaseDatabase.saveLevel(payload, false);
        console.log(`✅ Created: ${title}`);
        results.created++;
      }
    } catch (err) {
      console.error(`❌ Failed to migrate file: ${file}`, err);
      results.errors++;
    }
  }

  console.log('\n📊 Migration summary');
  console.log('====================');
  console.log(`Created: ${results.created}`);
  console.log(`Updated: ${results.updated}`);
  console.log(`Skipped: ${results.skipped}`);
  console.log(`Errors:  ${results.errors}`);

  if (opts.dryRun) {
    console.log('\nNote: DRY RUN mode. No changes were written.');
  }

  // Exit with non-zero if errors
  process.exit(results.errors > 0 ? 1 : 0);
}

function printHelp() {
  console.log(`\nLevels Migration Tool\n\nUsage:\n  npm run build:ts && node scripts/migrate-levels.js [options]\n\nOptions:\n  --dir <path>       Directory containing level JSON files (default: levels)\n  --dry-run          Print actions without writing to Firebase\n  --overwrite        Update existing levels that match by (title, authorId)\n  --author-name <n>  Author name for imported levels (default: "Game Developer")\n  --author-id <id>   Author id for imported levels (default: "system")\n`);
}

// Guard unhandled errors
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

// Run
await main();
