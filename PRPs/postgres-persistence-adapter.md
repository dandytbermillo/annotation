name: "PostgreSQL Persistence Adapter for YJS Annotation System"
description: |

## Purpose
Implement a PostgreSQL persistence adapter to replace IndexedDB as the primary storage layer for the YJS-based collaborative annotation system, while maintaining IndexedDB as an offline fallback. This implementation must preserve all YJS design principles, CRDT functionality, and real-time collaboration features.

## Core Principles
1. **YJS is Source of Truth**: PostgreSQL is only for persistence, not real-time sync
2. **Binary Data Handling**: Store YJS updates as bytea in PostgreSQL
3. **Event Sourcing Pattern**: Store individual updates, not just snapshots
4. **Platform Compatibility**: Support both Web (via API) and Electron (direct connection)
5. **Offline-First**: IndexedDB remains as fallback when PostgreSQL is unavailable

---

## Goal
Create a PostgreSQL persistence adapter (`lib/adapters/postgres-adapter.ts`) that implements the `PersistenceProvider` interface, enabling robust, queryable storage for notes, annotations, panels, and snapshots while supporting both Web and Electron deployments.

## Why
- IndexedDB limits scalability and cross-device migration
- PostgreSQL provides robust, queryable storage for backups and analytics
- Enables integration with the Infinite Canvas Knowledge Base OS
- Supports both local-first (Electron) and server-based (Web) workflows
- Allows for better data recovery and migration capabilities

## What
A PostgreSQL adapter that:
- Implements all methods of the `PersistenceProvider` interface
- Handles binary YJS data using PostgreSQL bytea columns
- Supports connection pooling and retry logic
- Works seamlessly with existing YJS sync mechanisms
- Provides clear error messages when required env vars are missing

### Success Criteria
- [ ] All PersistenceProvider methods implemented and working
- [ ] Binary YJS data correctly stored/retrieved from bytea columns
- [ ] Connection pooling and retry logic implemented
- [ ] Integration tests pass with local PostgreSQL
- [ ] Falls back gracefully to IndexedDB when PostgreSQL unavailable
- [ ] Documentation updated with setup instructions
- [ ] Environment variables documented in .env.example

## All Needed Context

### Documentation & References
```yaml
# MUST READ - Include these in your context window
- url: https://node-postgres.com/
  why: Official pg client documentation for connection, queries, and pooling
  
- url: https://node-postgres.com/features/types#node-postgres-type-parsers
  why: Understanding how to handle bytea type for binary data
  
- url: https://github.com/MaxNoetzold/y-postgresql
  why: Reference implementation of YJS PostgreSQL adapter
  
- file: lib/adapters/web-adapter-enhanced.ts
  why: Pattern to follow for adapter implementation, shows all required methods
  
- file: lib/adapters/electron-adapter.ts
  why: Shows SQLite adapter pattern, similar to what we need for PostgreSQL
  
- file: lib/enhanced-yjs-provider.ts
  why: PersistenceProvider interface definition (lines 11-19)
  
- file: migrations/001_initial_schema.up.sql
  why: PostgreSQL schema already defined - must match these tables
  
- doc: docs/yjs-annotation-architecture.md
  section: Lines 1446-1451 about PostgreSQL exception
  critical: "Replace persistence with PostgreSQL-based adapters. All other architecture principles remain mandatory."

- file: CLAUDE.md
  why: Project conventions and anti-hallucination rules
  
- file: INITIAL.md
  why: Original feature request with all requirements
```

### Current Codebase tree
```bash
lib/
├── adapters/
│   ├── electron-adapter.ts      # SQLite-like adapter pattern
│   └── web-adapter-enhanced.ts  # IndexedDB adapter with all methods
├── enhanced-yjs-provider.ts     # PersistenceProvider interface
└── ...

migrations/
├── 001_initial_schema.up.sql   # PostgreSQL schema ready to use
├── 001_initial_schema.down.sql # Rollback migration
└── README.md                    # Migration instructions
```

### Desired Codebase tree with files to be added
```bash
lib/
├── adapters/
│   ├── postgres-adapter.ts      # NEW: PostgreSQL persistence adapter
│   ├── electron-adapter.ts
│   └── web-adapter-enhanced.ts
└── ...

.env.example                     # NEW: Example environment variables
docker-compose.yml              # NEW: Local PostgreSQL setup
```

### Known Gotchas of our codebase & Library Quirks
```typescript
// CRITICAL: YJS uses Uint8Array for binary data
// Node.js pg client expects Buffer objects
// Always convert: Buffer.from(uint8Array) when storing
// Always convert: new Uint8Array(buffer) when retrieving

// CRITICAL: PostgreSQL bytea columns in node-postgres
// Can pass Buffer objects directly - no encoding needed
// Retrieved data comes back as Buffer, convert to Uint8Array

// CRITICAL: YJS update format
// Y.encodeStateAsUpdate returns Uint8Array binary data
// This is NOT JSON - must store as binary (bytea)

// CRITICAL: Connection handling
// Use pg.Pool for connection pooling
// Always release connections back to pool
// Handle connection errors with retry logic

// CRITICAL: Environment detection
// Web deployments connect via API (not implemented here)
// Electron deployments connect directly to PostgreSQL
// Use platform detection to determine connection method
```

## Implementation Blueprint

### PersistenceProvider Interface
```typescript
export interface PersistenceProvider {
  persist(docName: string, update: Uint8Array): Promise<void>
  load(docName: string): Promise<Uint8Array | null>
  getAllUpdates(docName: string): Promise<Uint8Array[]>
  clearUpdates(docName: string): Promise<void>
  saveSnapshot(docName: string, snapshot: Uint8Array): Promise<void>
  loadSnapshot(docName: string): Promise<Uint8Array | null>
  compact(docName: string): Promise<void>
}
```

### Data models and structure

PostgreSQL tables are already defined in migrations/001_initial_schema.up.sql:
- `yjs_updates` - Event-sourced updates with bytea column
- `snapshots` - Full state snapshots with bytea column
- `notes`, `branches`, `panels`, `connections` - Metadata tables

Key columns:
- `update BYTEA` - Binary YJS update data
- `state BYTEA` - Full YJS state snapshot
- `anchor_start BYTEA` - Y.RelativePosition encoded
- `anchor_end BYTEA` - Y.RelativePosition encoded

### List of tasks to be completed in order

```yaml
Task 1:
CREATE .env.example:
  - Add POSTGRES_URL with example connection string
  - Add POSTGRES_POOL_SIZE with default value
  - Add comments explaining each variable

Task 2:
CREATE docker-compose.yml:
  - PostgreSQL service with version 15+
  - Volume for data persistence
  - Port mapping to 5432
  - Environment variables for database setup

Task 3:
INSTALL dependencies:
  - Run: npm install pg @types/pg
  - These provide PostgreSQL client and TypeScript types

Task 4:
CREATE lib/adapters/postgres-adapter.ts:
  - Import pg and required types
  - Implement PersistenceProvider interface
  - PATTERN: Follow web-adapter-enhanced.ts structure
  - Use connection pooling with pg.Pool
  - Handle binary data conversion
  - Add retry logic for transient errors
  - Implement all 7 required methods

Task 5:
MODIFY lib/utils/platform-detection.ts:
  - Add PostgreSQL adapter detection logic
  - Check for POSTGRES_URL environment variable
  - Return appropriate adapter based on platform

Task 6:
CREATE tests for PostgreSQL adapter:
  - Unit tests for each method
  - Integration tests with real PostgreSQL
  - Test binary data round-trip
  - Test error handling and retries

Task 7:
UPDATE documentation:
  - Add PostgreSQL setup to README.md
  - Document environment variables
  - Add troubleshooting section
```

### Per task pseudocode

```typescript
// Task 4: PostgreSQL Adapter Implementation

import { Pool, PoolClient } from 'pg'
import * as Y from 'yjs'
import { PersistenceProvider } from '../enhanced-yjs-provider'

export class PostgresPersistenceAdapter implements PersistenceProvider {
  private pool: Pool
  private maxRetries = 3
  
  constructor(connectionString?: string) {
    // PATTERN: Use env var if not provided
    const dbUrl = connectionString || process.env.POSTGRES_URL
    
    // CRITICAL: Fail fast with clear message
    if (!dbUrl) {
      throw new Error('POSTGRES_URL environment variable is required')
    }
    
    // PATTERN: Connection pooling for performance
    this.pool = new Pool({
      connectionString: dbUrl,
      max: parseInt(process.env.POSTGRES_POOL_SIZE || '10'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })
    
    // GOTCHA: Test connection on startup
    this.testConnection()
  }
  
  async persist(docName: string, update: Uint8Array): Promise<void> {
    // PATTERN: Retry logic for transient errors
    return this.withRetry(async () => {
      // CRITICAL: Convert Uint8Array to Buffer for pg
      const updateBuffer = Buffer.from(update)
      
      const query = `
        INSERT INTO yjs_updates (doc_name, update, client_id, timestamp)
        VALUES ($1, $2, $3, NOW())
      `
      
      await this.pool.query(query, [
        docName,
        updateBuffer,  // pg handles Buffer -> bytea
        'postgres-adapter'
      ])
    })
  }
  
  async load(docName: string): Promise<Uint8Array | null> {
    // PATTERN: Try snapshot first, then merge updates
    const snapshot = await this.loadSnapshot(docName)
    if (snapshot) return snapshot
    
    const updates = await this.getAllUpdates(docName)
    if (updates.length === 0) return null
    
    // PATTERN: Merge all updates into single state
    const doc = new Y.Doc()
    updates.forEach(update => Y.applyUpdate(doc, update))
    
    return Y.encodeStateAsUpdate(doc)
  }
  
  async getAllUpdates(docName: string): Promise<Uint8Array[]> {
    const query = `
      SELECT update FROM yjs_updates 
      WHERE doc_name = $1 
      ORDER BY timestamp ASC
    `
    
    const result = await this.pool.query(query, [docName])
    
    // CRITICAL: Convert Buffer back to Uint8Array
    return result.rows.map(row => new Uint8Array(row.update))
  }
  
  // ... implement remaining methods following same patterns
}
```

### Integration Points
```yaml
DATABASE:
  - Tables already created via migrations
  - Run: npm run migrate:up (need to create this script)
  
CONFIG:
  - Add to: .env.local (for local development)
  - Pattern: POSTGRES_URL=postgresql://user:pass@localhost:5432/dbname
  
PROVIDER:
  - Wire into: lib/enhanced-yjs-provider.ts constructor
  - Detect platform and choose adapter
  
DOCKER:
  - Local PostgreSQL for development
  - docker compose up -d postgres
```

## Validation Loop

### Level 1: Syntax & Style
```bash
# TypeScript compilation
npm run type-check

# Linting
npm run lint

# Expected: No errors. Fix any issues before proceeding.
```

### Level 2: Unit Tests
```typescript
// test/adapters/postgres-adapter.test.ts

import { PostgresPersistenceAdapter } from '../../lib/adapters/postgres-adapter'
import * as Y from 'yjs'

describe('PostgresPersistenceAdapter', () => {
  let adapter: PostgresPersistenceAdapter
  
  beforeAll(() => {
    // Use test database
    process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test'
    adapter = new PostgresPersistenceAdapter()
  })
  
  afterAll(async () => {
    await adapter.destroy()
  })
  
  test('persist and load binary data', async () => {
    const doc = new Y.Doc()
    doc.getText('content').insert(0, 'Hello YJS')
    const update = Y.encodeStateAsUpdate(doc)
    
    // Store update
    await adapter.persist('test-doc', update)
    
    // Load and verify
    const loaded = await adapter.load('test-doc')
    expect(loaded).toBeTruthy()
    
    // Apply to new doc and check content
    const newDoc = new Y.Doc()
    Y.applyUpdate(newDoc, loaded!)
    expect(newDoc.getText('content').toString()).toBe('Hello YJS')
  })
  
  test('handles missing document gracefully', async () => {
    const result = await adapter.load('non-existent')
    expect(result).toBeNull()
  })
  
  test('snapshot storage and retrieval', async () => {
    const doc = new Y.Doc()
    doc.getText('content').insert(0, 'Snapshot test')
    const snapshot = Y.encodeStateAsUpdate(doc)
    
    await adapter.saveSnapshot('snap-doc', snapshot)
    const loaded = await adapter.loadSnapshot('snap-doc')
    
    expect(loaded).toEqual(snapshot)
  })
})
```

### Level 3: Integration Test
```bash
# Start PostgreSQL
docker compose up -d postgres

# Wait for PostgreSQL to be ready
docker compose exec postgres pg_isready

# Run migrations
npm run migrate:up

# Run integration tests
npm run test:integration

# Manual test with the app
npm run dev
# Create annotations and verify they persist across refreshes
```

## Final validation Checklist
- [ ] All tests pass: `npm run test`
- [ ] No type errors: `npm run type-check`
- [ ] No lint errors: `npm run lint`
- [ ] PostgreSQL connection works: `docker compose exec postgres psql -U postgres -c '\dt'`
- [ ] Binary data round-trip successful (YJS state preserved)
- [ ] Graceful fallback to IndexedDB when PostgreSQL unavailable
- [ ] Environment variables documented in .env.example
- [ ] Migration scripts tested up and down

---

## Anti-Patterns to Avoid
- ❌ Don't store YJS data as JSON - it's binary format
- ❌ Don't skip Buffer/Uint8Array conversions
- ❌ Don't forget to release pool connections
- ❌ Don't ignore connection errors - implement retry
- ❌ Don't hardcode connection strings
- ❌ Don't persist awareness/presence data (ephemeral only)
- ❌ Don't use PostgreSQL for real-time sync (YJS handles that)

## Migration Notes
When ready to migrate existing data:
1. Export from IndexedDB using existing adapter
2. Import into PostgreSQL using new adapter
3. Verify data integrity with checksums
4. Keep IndexedDB data as backup during transition

## Performance Considerations
- Use connection pooling (already implemented)
- Consider batching multiple updates in transactions
- Implement periodic compaction to merge old updates
- Monitor bytea storage size and implement cleanup
- Index doc_name column for faster queries (already in schema)

---
**Confidence Score: 9/10** - Comprehensive context provided with working examples, clear patterns, and specific implementation details. The only uncertainty is around the Web platform API layer which isn't implemented yet but is clearly noted.