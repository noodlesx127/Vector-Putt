#!/usr/bin/env node

// Firebase Database Cleanup Script
// Usage: node scripts/cleanup-db.js [options]

async function main() {
  console.log('Starting cleanup script...');

  let DatabaseCleanup;
  try {
    const module = await import('../dist/firebase/DatabaseCleanup.js');
    DatabaseCleanup = module.DatabaseCleanup;
    console.log('DatabaseCleanup imported successfully');
  } catch (error) {
    console.error('Failed to import DatabaseCleanup:', error);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  
  // Parse command line arguments
  const options = {
    removeDuplicateLevels: true,
    removeDuplicateUsers: true,
    removeOrphanedLevels: true,
    fixInvalidData: true,
    removeTestData: false,
    dryRun: false
  };

  let showHelp = false;

  for (const arg of args) {
    switch (arg) {
      case '--help':
      case '-h':
        showHelp = true;
        break;
      case '--dry-run':
      case '-d':
        options.dryRun = true;
        break;
      case '--remove-test-data':
      case '-t':
        options.removeTestData = true;
        break;
      case '--no-duplicates':
        options.removeDuplicateLevels = false;
        options.removeDuplicateUsers = false;
        break;
      case '--no-orphans':
        options.removeOrphanedLevels = false;
        break;
      case '--no-fix-data':
        options.fixInvalidData = false;
        break;
      case '--test-data-only':
        options.removeDuplicateLevels = false;
        options.removeDuplicateUsers = false;
        options.removeOrphanedLevels = false;
        options.fixInvalidData = false;
        options.removeTestData = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        showHelp = true;
        break;
    }
  }

  if (showHelp) {
    console.log(`
Firebase Database Cleanup Tool

Usage: node scripts/cleanup-db.js [options]

Options:
  -h, --help              Show this help message
  -d, --dry-run          Preview changes without applying them
  -t, --remove-test-data Remove test/development data
  --no-duplicates        Skip duplicate removal
  --no-orphans          Skip orphaned data removal
  --no-fix-data         Skip invalid data fixes
  --test-data-only      Only remove test data (skip other cleanup)

Examples:
  node scripts/cleanup-db.js                    # Full cleanup
  node scripts/cleanup-db.js --dry-run          # Preview what would be cleaned
  node scripts/cleanup-db.js --remove-test-data # Include test data removal
  node scripts/cleanup-db.js --test-data-only   # Only remove test data
`);
    process.exit(0);
  }

  console.log('🧹 Firebase Database Cleanup Tool');
  console.log('==================================');

  try {
    const cleanup = new DatabaseCleanup();
    const report = await cleanup.cleanup(options);

    // Exit with error code if there were errors
    if (report.errors.length > 0) {
      process.exit(1);
    }

    console.log('✅ Cleanup completed successfully');
    process.exit(0);

  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled promise rejection:', error);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  process.exit(1);
});

main();

