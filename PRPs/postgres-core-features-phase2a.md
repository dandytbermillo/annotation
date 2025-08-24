# PRP: PostgreSQL Core Features - Phase 2A

**version:** 1  
**last_updated:** 2025-08-23  
**feature_branch:** feat/postgres-core-features  
**risk_level:** medium  
**complexity:** high  

## Summary

Complete the PostgreSQL persistence implementation by adding production-ready features: YJS snapshot/compaction for performance optimization, proper note deletion with cascade cleanup, comprehensive test fixes, and Electron direct database support. This phase transforms the basic persistence layer into a robust, performant system suitable for enterprise deployment.

## Context

### Current State Analysis
The PostgreSQL persistence is functional but incomplete:
- ✅ Basic YJS update persistence working (22+ updates saved)
- ✅ Browser/server separation implemented
- ❌ No snapshot compaction (performance degrades over time)
- ❌ No note deletion (data accumulates forever)
- ❌ Failing tests indicate instability
- ❌ Electron still uses IndexedDB instead of PostgreSQL

### Required Reading
```yaml
Essential Documentation:
  - file: lib/adapters/postgres-adapter.ts
    why: Current adapter has all methods but missing deleteNote()
    lines: 140-356 (full implementation to enhance)
    
  - file: docs/note-deletion-process.md
    why: Detailed deletion workflow and considerations
    
  - file: migrations/001_initial_schema.up.sql
    why: Current schema - note 'annotations' table needs renaming
    
  - url: https://github.com/yjs/yjs/blob/main/INTERNALS.md#snapshots
    section: Snapshots and Document Updates
    why: YJS V2 format provides better compression
    
  - url: https://www.postgresql.org/docs/current/sql-delete.html
    why: CASCADE DELETE syntax and transaction patterns
    
  - url: https://www.dbvis.com/thetable/postgres-on-delete-cascade-a-guide/
    why: Comprehensive cascade delete patterns
    
  - url: https://rxdb.info/electron-database.html
    why: Electron database best practices
    
  - file: app/api/persistence/compact/route.ts
    lines: 125-136
    why: Existing compaction patterns to follow
```

### External Dependencies
```yaml
Libraries:
  pg: ^8.11.3  # PostgreSQL client
  yjs: ^13.6.8  # CRDT library - use V2 format
  js-base64: ^3.7.5  # Binary to Base64 conversion
  
Electron (when implemented):
  electron: ^26.0.0
  @electron/remote: ^2.0.0
```

## Detailed Design

### Task 1: Implement Snapshot/Compaction System

**Implementation Blueprint:**
```typescript
// In lib/adapters/postgres-adapter.ts

// Add configuration for compaction thresholds
interface CompactionConfig {
  updateThreshold: number  // Default: 100
  sizeThreshold: number    // Default: 1MB
  autoCompact: boolean     // Default: true
  keepSnapshots: number    // Default: 3
}

// Enhanced compact method with V2 format
async compact(docName: string, config?: CompactionConfig): Promise<void> {
  const client = await this.pool.connect()
  
  try {
    await client.query('BEGIN')
    
    // 1. Check if compaction needed
    const stats = await this.getDocumentStats(docName)
    if (!this.shouldCompact(stats, config)) return
    
    // 2. Load all updates
    const updates = await this.getAllUpdates(docName)
    if (updates.length === 0) return
    
    // 3. Merge using V2 format for better compression
    const mergedUpdate = Y.mergeUpdatesV2(updates)
    const doc = new Y.Doc()
    Y.applyUpdateV2(doc, mergedUpdate)
    
    // 4. Create snapshot with metadata
    const snapshot = Y.encodeStateAsUpdateV2(doc)
    await client.query(
      `INSERT INTO snapshots (note_id, doc_name, state, update_count, size_bytes, checksum)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [noteId, docName, snapshot, updates.length, snapshot.byteLength, checksum]
    )
    
    // 5. Delete old updates
    await client.query('DELETE FROM yjs_updates WHERE doc_name = $1', [docName])
    
    // 6. Keep only last N snapshots
    await client.query(
      `DELETE FROM snapshots 
       WHERE doc_name = $1 AND id NOT IN (
         SELECT id FROM snapshots 
         WHERE doc_name = $1 
         ORDER BY created_at DESC 
         LIMIT $2
       )`,
      [docName, config?.keepSnapshots || 3]
    )
    
    // 7. Log compaction
    await this.logCompaction(client, docName, updates.length, 0, snapshot.byteLength)
    
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Auto-compaction trigger
async persist(docName: string, update: Uint8Array): Promise<void> {
  await super.persist(docName, update)
  
  // Check if auto-compaction needed
  if (this.compactionConfig.autoCompact) {
    const stats = await this.getDocumentStats(docName)
    if (this.shouldCompact(stats)) {
      // Run async without blocking
      this.compact(docName).catch(err => 
        console.error('Auto-compaction failed:', err)
      )
    }
  }
}
```

**Key Patterns from Codebase:**
- Transaction pattern from line 287-336 in postgres-adapter.ts
- Snapshot retention from app/api/persistence/compact/route.ts lines 125-136
- Use YJS V2 format for 50% better compression

### Task 2: Note Deletion with Cascade Cleanup

**Implementation Blueprint:**
```typescript
// Add to lib/adapters/postgres-adapter.ts

async deleteNote(noteId: string): Promise<void> {
  const client = await this.pool.connect()
  
  try {
    await client.query('BEGIN')
    
    // 1. Soft delete the note first
    await client.query(
      'UPDATE notes SET deleted_at = NOW() WHERE id = $1',
      [noteId]
    )
    
    // 2. Delete YJS updates for note and all panels
    await client.query(
      `DELETE FROM yjs_updates 
       WHERE doc_name = $1 OR doc_name LIKE $2`,
      [`note:${noteId}`, `panel:${noteId}:%`]
    )
    
    // 3. Delete snapshots
    await client.query(
      'DELETE FROM snapshots WHERE note_id = $1',
      [noteId]
    )
    
    // 4. Soft delete panels
    await client.query(
      'UPDATE panels SET deleted_at = NOW() WHERE note_id = $1',
      [noteId]
    )
    
    // 5. Soft delete branches (renamed from annotations)
    await client.query(
      'UPDATE branches SET deleted_at = NOW() WHERE note_id = $1',
      [noteId]
    )
    
    await client.query('COMMIT')
    
    // 6. Notify other clients via awareness
    this.notifyDeletion(noteId)
    
  } catch (error) {
    await client.query('ROLLBACK')
    throw new Error(`Failed to delete note ${noteId}: ${error.message}`)
  } finally {
    client.release()
  }
}

// Add hard delete for permanent removal
async hardDeleteNote(noteId: string): Promise<void> {
  // Similar to above but with DELETE instead of UPDATE
  // Only accessible via admin interface
}
```

**API Route Implementation:**
```typescript
// Create app/api/notes/[noteId]/route.ts

export async function DELETE(
  request: Request,
  { params }: { params: { noteId: string } }
) {
  try {
    const adapter = new PostgresAdapter()
    await adapter.deleteNote(params.noteId)
    
    return NextResponse.json({ 
      success: true,
      message: `Note ${params.noteId} deleted`
    })
  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
```

### Task 3: Fix Failing Tests

**Known Issues:**
1. **crypto.subtle not available in test environment**
   ```typescript
   // In tests/setup.ts or jest.config.js
   import { webcrypto } from 'crypto'
   global.crypto = webcrypto as any
   ```

2. **Mock expectations mismatch**
   - Update mocks to match new method signatures
   - Add proper transaction mocking

3. **Missing destroy() method in ElectronAdapter**
   ```typescript
   // In lib/adapters/electron-adapter.ts
   async destroy(): Promise<void> {
     if (this.db && typeof this.db.close === 'function') {
       this.db.close()
     }
   }
   ```

### Task 4: Electron Direct PostgreSQL Support

**Implementation Blueprint:**
```typescript
// In lib/adapters/electron-adapter.ts

import { Pool } from 'pg'
import { getElectronDatabaseConfig } from '../utils/electron-config'

class ElectronPostgresAdapter implements PersistenceProvider {
  private pool: Pool | null = null
  
  constructor() {
    if (this.isElectron()) {
      this.initializePostgres()
    }
  }
  
  private isElectron(): boolean {
    return typeof process !== 'undefined' && 
           process.versions && 
           process.versions.electron
  }
  
  private async initializePostgres(): Promise<void> {
    const config = await getElectronDatabaseConfig()
    this.pool = new Pool({
      host: config.host || 'localhost',
      port: config.port || 5432,
      database: config.database || 'annotation_system',
      user: config.user,
      password: config.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })
  }
  
  // Reuse PostgresAdapter methods but with direct connection
  async persist(docName: string, update: Uint8Array): Promise<void> {
    if (!this.pool) throw new Error('PostgreSQL not initialized')
    // Implementation identical to PostgresAdapter
  }
}

// In main process (main.js)
import { ipcMain } from 'electron'

ipcMain.handle('db-query', async (event, query, params) => {
  return await electronAdapter.query(query, params)
})
```

**Platform Detection Enhancement:**
```typescript
// In lib/utils/platform-detection.ts

export function getPreferredPersistence(): string {
  if (isElectron()) {
    return process.env.ELECTRON_DB_TYPE || 'postgres'
  }
  if (typeof window !== 'undefined') {
    return process.env.NEXT_PUBLIC_POSTGRES_ENABLED === 'true' 
      ? 'postgres-api' 
      : 'indexeddb'
  }
  return 'postgres'
}
```

### Task 5: Schema Migration - Rename annotations to branches

**Migration File:**
```sql
-- migrations/002_rename_annotations_to_branches.up.sql

BEGIN;

-- Rename the table
ALTER TABLE annotations RENAME TO branches;

-- Update any indexes
ALTER INDEX annotations_pkey RENAME TO branches_pkey;
ALTER INDEX idx_annotations_note_id RENAME TO idx_branches_note_id;

-- Update any foreign key constraints if they exist
-- Note: May need to drop and recreate constraints with new names

-- Add soft delete columns
ALTER TABLE notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE panels ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- Add snapshot metadata columns
ALTER TABLE snapshots 
  ADD COLUMN IF NOT EXISTS update_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS size_bytes INTEGER;

-- Create compaction log table
CREATE TABLE IF NOT EXISTS compaction_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_name TEXT NOT NULL,
  updates_before INTEGER,
  updates_after INTEGER,
  snapshot_size INTEGER,
  duration_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add partial indexes for soft deletes
CREATE INDEX idx_notes_active ON notes(id) WHERE deleted_at IS NULL;
CREATE INDEX idx_panels_active ON panels(id) WHERE deleted_at IS NULL;
CREATE INDEX idx_branches_active ON branches(id) WHERE deleted_at IS NULL;

COMMIT;
```

## Implementation Order

1. **Fix test environment** (30 min)
   - Add crypto.subtle polyfill
   - Fix ElectronAdapter destroy method
   - Update test mocks

2. **Schema migration** (1 hour)
   - Create and run migration script
   - Update all code references from annotations to branches
   - Test migration rollback

3. **Implement compaction** (3 hours)
   - Add compact method with V2 format
   - Add auto-compaction logic
   - Create compaction config
   - Add performance metrics

4. **Implement note deletion** (2 hours)
   - Add deleteNote method
   - Create API route
   - Add cascade cleanup
   - Test with transactions

5. **Add Electron support** (3 hours)
   - Enhance ElectronAdapter
   - Add IPC handlers
   - Update platform detection
   - Test in Electron environment

6. **Integration testing** (2 hours)
   - Test all features together
   - Performance benchmarks
   - Multi-client sync tests

## Known Gotchas

1. **YJS V2 Format**
   - Not backwards compatible with V1
   - Must use `Y.applyUpdateV2()` for V2 updates
   - 50% better compression but requires migration

2. **Transaction Deadlocks**
   - Always acquire locks in same order
   - Keep transactions short
   - Use NOWAIT option for user-initiated deletes

3. **Electron Security**
   - Never expose raw SQL to renderer process
   - Use contextBridge for IPC
   - Validate all queries in main process

4. **Soft Delete Queries**
   - Must add `WHERE deleted_at IS NULL` to all queries
   - Consider creating views for active records
   - Update counts may be misleading

5. **Compaction Timing**
   - Don't compact during high load
   - Consider time-based scheduling
   - Monitor compaction duration

## Validation Gates

```bash
# 1. Syntax and Types
npm run lint
npm run type-check

# 2. Unit Tests - Fix environment first
export NODE_OPTIONS="--experimental-webcrypto"
npm run test -- postgres-adapter.test.ts

# 3. Integration Tests with PostgreSQL
docker compose up -d postgres
npm run test:integration

# 4. Migration Test
npm run db:migrate:up
npm run db:migrate:down
npm run db:migrate:up

# 5. Performance Benchmark
# Create new test file: tests/performance/compaction.test.ts
npm run test:performance -- compaction

# 6. Electron Tests (requires Electron environment)
npm run build:electron
npm run test:electron

# 7. End-to-End Tests
npm run test:e2e -- note-deletion
npm run test:e2e -- compaction

# 8. Load Test - 1000+ updates
npm run test:load -- --updates=1000
```

## Success Metrics

1. **Performance**
   - Document load time < 500ms with 1000 updates
   - Compaction reduces storage by > 80%
   - Snapshot creation < 100ms for typical documents

2. **Reliability**
   - All tests passing (0 failures)
   - No data loss during compaction
   - Cascade deletes atomic and complete

3. **Functionality**
   - Soft delete with recovery option
   - Auto-compaction triggers correctly
   - Electron connects directly to PostgreSQL
   - Multi-client sync after deletion

## Error Recovery Strategies

1. **Compaction Failure**
   - Log error but don't fail persist
   - Retry with exponential backoff
   - Alert if repeated failures

2. **Delete Failure**
   - Full rollback on any error
   - Return specific error messages
   - Log failed deletion attempts

3. **Migration Failure**
   - Automatic rollback
   - Clear error messages
   - Manual intervention guide

## Code Snippets from Existing Patterns

**Transaction Pattern (postgres-adapter.ts:287-336):**
```typescript
const client = await this.pool.connect()
try {
  await client.query('BEGIN')
  // ... operations ...
  await client.query('COMMIT')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
}
```

**Snapshot Cleanup (compact/route.ts:125-136):**
```typescript
const deleteResult = await adapter.query(
  `DELETE FROM snapshots 
   WHERE doc_name = $1 AND id NOT IN (
     SELECT id FROM snapshots 
     WHERE doc_name = $1 
     ORDER BY created_at DESC 
     LIMIT $2
   )`,
  [docName, keepSnapshots]
)
```

## Next Steps After Implementation

1. **Monitoring**
   - Add metrics for compaction frequency
   - Track deletion operations
   - Monitor snapshot sizes

2. **Documentation**
   - Update API documentation
   - Create runbook for operations
   - Document recovery procedures

3. **Future Enhancements**
   - Background compaction service
   - Configurable retention policies
   - Admin UI for manual compaction

## Quality Score: 9/10

This PRP provides comprehensive context including:
- ✅ All necessary code patterns from existing codebase
- ✅ External documentation with specific URLs
- ✅ Detailed implementation blueprints
- ✅ Known gotchas and error handling
- ✅ Executable validation gates
- ✅ Clear task ordering

The implementation should succeed in one pass with this level of detail.