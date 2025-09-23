# Firebase Database Cleanup Tool

A comprehensive tool for maintaining Firebase database integrity by removing duplicates, fixing invalid data, and cleaning up test artifacts.

## Features

- **Duplicate Removal**: Removes duplicate users and levels based on name/title and author
- **Orphan Cleanup**: Removes levels whose authors no longer exist
- **Data Validation**: Fixes invalid or missing required fields
- **Test Data Removal**: Identifies and removes test/development data
- **Dry Run Mode**: Preview changes before applying them
- **Comprehensive Reporting**: Detailed reports of all cleanup actions

## Usage

### Command Line

```bash
# Full cleanup (recommended)
npm run cleanup:db

# Preview what would be cleaned (dry run)
npm run cleanup:db:dry-run

# Remove only test data
npm run cleanup:db:test-data

# Preview cleanup including test data removal
npm run cleanup:db:preview
```

### Manual Script Usage

```bash
# Build the project first
npm run build

# Run cleanup with options
node scripts/cleanup-db.js [options]
```

#### Command Line Options

- `-h, --help` - Show help message
- `-d, --dry-run` - Preview changes without applying them
- `-t, --remove-test-data` - Remove test/development data
- `--no-duplicates` - Skip duplicate removal
- `--no-orphans` - Skip orphaned data removal
- `--no-fix-data` - Skip invalid data fixes
- `--test-data-only` - Only remove test data (skip other cleanup)

### Programmatic Usage

```typescript
import { DatabaseCleanup } from './src/firebase/DatabaseCleanup';

// Quick cleanup with default options
const report = await DatabaseCleanup.quickCleanup();

// Custom cleanup
const cleanup = new DatabaseCleanup();
const report = await cleanup.cleanup({
  removeDuplicateLevels: true,
  removeDuplicateUsers: true,
  removeOrphanedLevels: true,
  fixInvalidData: true,
  removeTestData: false,
  dryRun: false
});

// Dry run to preview changes
const previewReport = await DatabaseCleanup.dryRunCleanup();
```

### Admin Interface

For admin users, the cleanup tool provides a web interface:

```typescript
import { adminCleanup } from './src/firebase/AdminCleanup';

// Subscribe to cleanup state changes
const unsubscribe = adminCleanup.subscribe((state) => {
  console.log('Cleanup state:', state);
});

// Run cleanup operations
await adminCleanup.previewCleanup();
await adminCleanup.quickCleanup();
await adminCleanup.removeTestDataOnly();
```

## Cleanup Operations

### Duplicate User Removal

- Identifies users with identical names (case-insensitive)
- Keeps the oldest user (by creation date)
- Removes newer duplicates

### Duplicate Level Removal

- Identifies levels with identical title and author combinations
- Keeps the newest level (by creation date)
- Removes older duplicates

### Orphaned Level Removal

- Finds levels whose `authorId` references non-existent users
- Removes these orphaned levels to maintain referential integrity

### Data Validation and Fixing

#### User Data Fixes:
- Sets default name for users with empty names
- Ensures valid role (`admin` or `user`)
- Sets default `enabled` status to `true`
- Sets creation timestamp if missing

#### Level Data Fixes:
- Sets default title for untitled levels
- Ensures author name matches author ID
- Sets creation and modification timestamps
- Ensures required level components exist (tee, cup)
- Initializes missing arrays (walls, water, sand, etc.)
- Validates course metadata

### Test Data Removal

Identifies and removes data matching test patterns:
- Names containing: test, integration, mock, dummy, sample, temp, debug, dev
- IDs with test prefixes or patterns
- Development artifacts from testing

## Cleanup Report

Each cleanup operation generates a detailed report:

```typescript
interface CleanupReport {
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
```

## Safety Features

- **Dry Run Mode**: Preview all changes before applying
- **Admin Preservation**: Ensures at least one admin user remains
- **Data Validation**: Validates data integrity after cleanup
- **Error Handling**: Comprehensive error reporting and recovery
- **Backup Recommendations**: Always backup before major cleanups

## Best Practices

1. **Always run dry-run first**: Use `--dry-run` to preview changes
2. **Regular maintenance**: Run cleanup weekly or after major testing
3. **Monitor reports**: Review warnings and errors in cleanup reports
4. **Test data hygiene**: Remove test data regularly to prevent accumulation
5. **Backup before cleanup**: Consider database backups for major cleanups

## Scheduling Automated Cleanup

For production environments, consider scheduling regular cleanup:

```bash
# Add to crontab for weekly cleanup (Sundays at 2 AM)
0 2 * * 0 cd /path/to/vector-putt && npm run cleanup:db:test-data
```

## Troubleshooting

### Common Issues

1. **Permission Errors**: Ensure Firebase credentials have admin access
2. **Network Timeouts**: Large databases may require increased timeout values
3. **Memory Issues**: For very large datasets, consider batch processing

### Error Recovery

- Check Firebase console for database state
- Review cleanup reports for specific error details
- Use dry-run mode to validate fixes before applying
- Contact admin if persistent issues occur

## Integration with Admin Panel

The cleanup tool integrates with the admin panel for easy access:

- Real-time cleanup status updates
- Visual cleanup reports
- One-click cleanup operations
- Progress monitoring

## Security Considerations

- Only admin users should have access to cleanup operations
- Cleanup operations are logged for audit purposes
- Test data patterns are configurable to prevent false positives
- Database backups recommended before major cleanup operations
