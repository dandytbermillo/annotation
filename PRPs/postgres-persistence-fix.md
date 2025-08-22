name: "PostgreSQL Persistence Fix - Browser/Server Context Separation"
description: |

## Purpose
Fix the PostgreSQL persistence implementation to properly handle browser/server context separation. The current implementation tries to use the `pg` library directly in the browser, which fails because `pg` requires Node.js modules like `fs`. This PRP provides a complete solution with API routes for browser access and direct connection for server/Electron contexts.

## Core Principles
1. **Context Separation**: Browser uses API routes, server/Electron use direct PostgreSQL
2. **YJS Architecture Compliance**: PostgreSQL is only for persistence, not real-time sync
3. **Backward Compatible**: Maintain existing adapter interfaces
4. **Progressive Enhancement**: IndexedDB fallback when PostgreSQL unavailable
5. **Global rules**: Follow all rules in CLAUDE.md

---

## Goal
Enable PostgreSQL persistence for the YJS annotation system that works in both Web (Next.js) and Electron environments by:
- Creating API routes for browser PostgreSQL access
- Fixing platform detection to properly route persistence
- Maintaining direct PostgreSQL access for server/Electron contexts
- Ensuring proper error handling and fallback mechanisms

## Why
- Current implementation fails with "Module not found: Can't resolve 'fs'" in browser
- PostgreSQL provides robust, queryable storage for enterprise deployments
- Enables cross-device sync and backup capabilities
- Required for Infinite Canvas Knowledge Base OS integration

## What
Fix the PostgreSQL adapter to work in all environments by:
- Creating Next.js API routes for PostgreSQL operations
- Implementing a browser-compatible PostgreSQL client adapter
- Enhancing platform detection for proper adapter selection
- Adding proper error handling and connection management

### Success Criteria
- [ ] No build errors related to `fs` module in browser context
- [ ] PostgreSQL persistence works in Web (via API)
- [ ] PostgreSQL persistence works in Electron (direct)
- [ ] Proper fallback to IndexedDB when PostgreSQL unavailable
- [ ] All existing tests pass
- [ ] Integration tests pass with PostgreSQL

## All Needed Context

### Documentation & References
```yaml
# MUST READ - Include these in your context window
- url: https://node-postgres.com/
  why: pg library documentation for connection pooling and error handling
  
- file: lib/adapters/postgres-adapter.ts
  why: Existing implementation that needs browser/server separation
  
- file: lib/adapters/web-adapter-enhanced.ts
  why: Pattern for browser-compatible persistence adapter
  
- doc: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
  section: Route Handlers in App Router
  critical: How to create API routes in Next.js 15 App Router
  
- file: lib/enhanced-yjs-provider.ts
  why: Main provider that initializes persistence adapters
  
- file: lib/utils/platform-detection.ts
  why: Platform detection logic that needs enhancement

- docfile: docs/yjs-annotation-architecture.md
  why: Authoritative architecture - PostgreSQL replaces IndexedDB for persistence only

- docfile: initial.md
  why: Original feature request and error details
```

### Current Codebase tree
```bash
.
├── app/
│   └── (main application components)
├── lib/
│   ├── adapters/
│   │   ├── postgres-adapter.ts (direct pg usage - browser incompatible)
│   │   ├── web-adapter-enhanced.ts (IndexedDB implementation)
│   │   └── electron-adapter.ts
│   ├── enhanced-yjs-provider.ts
│   └── utils/
│       └── platform-detection.ts
├── docker-compose.yml (PostgreSQL service)
└── package.json
```

### Desired Codebase tree with files to be added
```bash
.
├── app/
│   ├── api/
│   │   └── persistence/
│   │       ├── route.ts (Main persistence API endpoint)
│   │       ├── updates/route.ts (YJS updates endpoint)
│   │       ├── snapshots/route.ts (Snapshots endpoint)
│   │       └── compact/route.ts (Compaction endpoint)
│   └── (main application components)
├── lib/
│   ├── adapters/
│   │   ├── postgres-adapter.ts (server-side only)
│   │   ├── postgres-client-adapter.ts (NEW: browser-compatible)
│   │   ├── web-adapter-enhanced.ts
│   │   └── electron-adapter.ts
│   ├── api/
│   │   └── persistence-client.ts (NEW: API client for browser)
│   ├── db/
│   │   └── postgres-pool.ts (NEW: connection pool management)
│   └── utils/
│       └── platform-detection.ts (enhanced)
└── migrations/
    ├── 001_create_tables.sql (NEW: database schema)
    └── README.md (NEW: migration instructions)
```

### Known Gotchas & Library Quirks
```typescript
// CRITICAL: pg library cannot run in browser - requires Node.js runtime
// Example: import { Pool } from 'pg' // This fails in browser with "Module not found: Can't resolve 'fs'"

// CRITICAL: Next.js 15 App Router API routes use different syntax
// Example: export async function POST(request: Request) instead of export default function handler

// CRITICAL: YJS updates are binary data (Uint8Array) - need proper serialization
// Example: Must convert to/from base64 or use proper binary handling in API

// GOTCHA: PostgreSQL BYTEA columns need Buffer conversion
// Example: Buffer.from(uint8Array) for inserts, new Uint8Array(buffer) for reads

// GOTCHA: Platform detection happens at build time AND runtime
// Example: typeof window check doesn't work in Next.js SSR
```

## Implementation Blueprint

### Data models and structure

Database schema for PostgreSQL:
```sql
-- YJS updates table (event sourcing pattern)
CREATE TABLE IF NOT EXISTS yjs_updates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    doc_name VARCHAR(255) NOT NULL,
    update BYTEA NOT NULL,
    client_id VARCHAR(255),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    INDEX idx_updates_doc_timestamp (doc_name, timestamp)
);

-- Snapshots table (periodic state captures)
CREATE TABLE IF NOT EXISTS snapshots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    note_id UUID,
    doc_name VARCHAR(255) NOT NULL,
    state BYTEA NOT NULL,
    checksum VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    INDEX idx_snapshots_doc_created (doc_name, created_at DESC)
);

-- Notes metadata (structured data)
CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY,
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB
);

-- Annotations (structured for querying)
CREATE TABLE IF NOT EXISTS annotations (
    id UUID PRIMARY KEY,
    note_id UUID REFERENCES notes(id),
    type VARCHAR(50),
    anchors BYTEA,
    anchors_fallback JSONB,
    metadata JSONB,
    "order" VARCHAR(255),
    version INTEGER DEFAULT 1
);

-- Panels state
CREATE TABLE IF NOT EXISTS panels (
    id UUID PRIMARY KEY,
    note_id UUID REFERENCES notes(id),
    position JSONB,
    dimensions JSONB,
    state VARCHAR(50),
    last_accessed TIMESTAMPTZ DEFAULT NOW()
);
```

### List of tasks to be completed in order

```yaml
Task 1: Create database migrations
CREATE migrations/001_create_tables.sql:
  - Use schema above
  - Add IF NOT EXISTS for idempotency
  - Include rollback section

CREATE migrations/README.md:
  - Instructions for running migrations
  - Connection string format
  - Docker setup reference

Task 2: Create PostgreSQL connection pool manager
CREATE lib/db/postgres-pool.ts:
  - Singleton pool instance
  - Environment variable validation
  - Connection error handling
  - Graceful shutdown

Task 3: Create API route handlers
CREATE app/api/persistence/route.ts:
  - POST /api/persistence - Main persistence endpoint
  - Handles all persistence operations via action parameter
  - Proper error responses

CREATE app/api/persistence/updates/route.ts:
  - GET - Retrieve updates for a document
  - POST - Store new update
  - DELETE - Clear updates after snapshot

CREATE app/api/persistence/snapshots/route.ts:
  - GET - Load latest snapshot
  - POST - Save new snapshot
  - Cleanup old snapshots

CREATE app/api/persistence/compact/route.ts:
  - POST - Trigger compaction for a document
  - Merge updates into snapshot

Task 4: Create browser-compatible PostgreSQL client adapter
CREATE lib/adapters/postgres-client-adapter.ts:
  - Implements PersistenceProvider interface
  - Uses fetch() to call API routes
  - Handles binary data serialization
  - Proper error handling and retries

Task 5: Create API client helper
CREATE lib/api/persistence-client.ts:
  - Centralized fetch logic
  - Binary data handling
  - Error response parsing
  - Retry logic

Task 6: Update platform detection
MODIFY lib/utils/platform-detection.ts:
  - Add isServerSide() check
  - Enhance PostgreSQL detection
  - Add API availability check

Task 7: Update enhanced YJS provider
MODIFY lib/enhanced-yjs-provider.ts:
  - Import postgres-client-adapter
  - Update persistence initialization logic
  - Use client adapter for browser context

Task 8: Fix postgres-adapter for server-only use
MODIFY lib/adapters/postgres-adapter.ts:
  - Add server-side check at top
  - Throw clear error if used in browser
  - Keep existing implementation

Task 9: Add environment configuration
MODIFY .env.example:
  - Add POSTGRES_URL example
  - Add pool configuration examples
  - Document required variables

Task 10: Create integration tests
CREATE tests/integration/postgres-persistence.test.ts:
  - Test API routes
  - Test client adapter
  - Test fallback behavior
  - Test binary data handling
```

### Per task pseudocode

```typescript
// Task 2: PostgreSQL connection pool
// lib/db/postgres-pool.ts
import { Pool } from 'pg'

let pool: Pool | null = null

export function getPool(): Pool {
  // PATTERN: Singleton pool instance
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL
    if (!connectionString) {
      throw new Error('POSTGRES_URL environment variable required')
    }
    
    pool = new Pool({
      connectionString,
      max: 10, // connection pool size
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })
    
    // CRITICAL: Handle pool errors
    pool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err)
    })
  }
  
  return pool
}

// Task 3: API Route Handler
// app/api/persistence/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db/postgres-pool'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, ...params } = body
    
    // PATTERN: Action-based routing
    switch (action) {
      case 'persist':
        return handlePersist(params)
      case 'load':
        return handleLoad(params)
      case 'getAllUpdates':
        return handleGetAllUpdates(params)
      // ... other actions
    }
  } catch (error) {
    // PATTERN: Consistent error response
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}

// Task 4: Browser PostgreSQL Client
// lib/adapters/postgres-client-adapter.ts
export class PostgresClientAdapter implements PersistenceProvider {
  private apiBase = '/api/persistence'
  
  async persist(docName: string, update: Uint8Array): Promise<void> {
    // CRITICAL: Convert binary to base64 for JSON transport
    const response = await fetch(this.apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'persist',
        docName,
        update: Buffer.from(update).toString('base64'),
        clientId: this.getClientId()
      })
    })
    
    if (!response.ok) {
      throw new Error(`Persistence failed: ${response.statusText}`)
    }
  }
  
  async load(docName: string): Promise<Uint8Array | null> {
    // PATTERN: Proper null handling
    const response = await fetch(`${this.apiBase}?${new URLSearchParams({
      action: 'load',
      docName
    })}`)
    
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Load failed: ${response.statusText}`)
    }
    
    const data = await response.json()
    if (!data.update) return null
    
    // CRITICAL: Convert base64 back to Uint8Array
    return Uint8Array.from(Buffer.from(data.update, 'base64'))
  }
}
```

### Integration Points
```yaml
DATABASE:
  - migration: Run migrations/001_create_tables.sql
  - connection: Use POSTGRES_URL from environment
  
CONFIG:
  - add to: .env.local
  - pattern: "POSTGRES_URL=postgresql://user:pass@localhost:5432/annotation_system"
  
API ROUTES:
  - location: app/api/persistence/*
  - pattern: Next.js 15 App Router route handlers
  
PERSISTENCE:
  - browser: PostgresClientAdapter via API
  - server: PostgresAdapter direct connection
  - electron: PostgresAdapter direct connection
```

## Validation Loop

### Level 1: Syntax & Style
```bash
# Run these FIRST - fix any errors before proceeding
npm run lint
npm run type-check

# Expected: No errors. If errors, READ the error and fix.
```

### Level 2: Unit Tests
```bash
# Start PostgreSQL first
docker compose up -d postgres

# Run migrations
npm run db:migrate

# Run tests
npm run test -- tests/adapters/postgres-client-adapter.test.ts
npm run test -- tests/api/persistence.test.ts

# Expected: All tests pass
```

### Level 3: Integration Test
```bash
# Start the full stack
docker compose up -d postgres
npm run dev

# Test the persistence API
curl -X POST http://localhost:3000/api/persistence \
  -H "Content-Type: application/json" \
  -d '{
    "action": "persist",
    "docName": "test-doc",
    "update": "SGVsbG8gV29ybGQ=",
    "clientId": "test-client"
  }'

# Expected: {"success": true}

# Test loading
curl -X POST http://localhost:3000/api/persistence \
  -H "Content-Type: application/json" \
  -d '{
    "action": "load",
    "docName": "test-doc"
  }'

# Expected: {"update": "SGVsbG8gV29ybGQ="}
```

### Level 4: Browser Test
```bash
# Open browser console at http://localhost:3000
# Run in console:
const adapter = new PostgresClientAdapter();
await adapter.persist('browser-test', new TextEncoder().encode('Hello from browser'));
const result = await adapter.load('browser-test');
console.log(new TextDecoder().decode(result)); // Should print: "Hello from browser"
```

## Final validation Checklist
- [ ] No build errors in browser context
- [ ] All tests pass: `npm run test`
- [ ] No linting errors: `npm run lint`
- [ ] No type errors: `npm run type-check`
- [ ] API routes respond correctly
- [ ] Browser can persist/load via API
- [ ] Server can persist/load directly
- [ ] Fallback to IndexedDB works
- [ ] PostgreSQL data is properly stored
- [ ] Binary YJS data handled correctly

---

## Anti-Patterns to Avoid
- ❌ Don't import pg library in browser code
- ❌ Don't expose database credentials to browser
- ❌ Don't skip binary data serialization
- ❌ Don't ignore connection pool limits
- ❌ Don't forget CORS if API on different port
- ❌ Don't store YJS data as JSON (use binary)

## External References
- https://node-postgres.com/features/pooling
- https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- https://github.com/yjs/yjs/blob/main/INTERNALS.md#update-compression

## Risk Assessment
- **Medium Risk**: API route performance under load
  - Mitigation: Add caching layer if needed
- **Low Risk**: Binary data serialization overhead
  - Mitigation: Use streaming for large updates
- **Low Risk**: PostgreSQL connection exhaustion
  - Mitigation: Proper pool configuration

## Success Confidence Score: 9/10
High confidence due to:
- Clear separation of browser/server contexts
- Following established patterns from existing adapters
- Comprehensive error handling
- Proper fallback mechanisms
- All architectural requirements maintained