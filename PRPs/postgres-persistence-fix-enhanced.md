name: "PostgreSQL Persistence Fix - Enhanced Browser/Server Context Separation"
description: |

## Purpose
Fix the PostgreSQL persistence implementation to properly handle browser/server context separation. The current implementation tries to use the `pg` library directly in the browser, which fails because `pg` requires Node.js modules like `fs`. This enhanced PRP provides a complete solution with API routes for browser access and direct connection for server/Electron contexts, with comprehensive context and patterns from the codebase.

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
  why: Pattern for browser-compatible persistence adapter with IndexedDB
  
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
  
- file: tests/adapters/postgres-adapter.test.ts
  why: Test patterns to follow for new code
  
- file: migrations/001_initial_schema.up.sql
  why: Existing database schema to use
  
- url: https://github.com/yjs/yjs/blob/main/INTERNALS.md#update-compression
  why: YJS binary data handling documentation
```

### Current Codebase tree
```bash
.
├── app/
│   ├── layout.tsx
│   ├── page.tsx (client-side only, no API routes yet)
│   └── globals.css
├── lib/
│   ├── adapters/
│   │   ├── postgres-adapter.ts (344 lines - direct pg usage, browser incompatible)
│   │   ├── web-adapter-enhanced.ts (401 lines - IndexedDB implementation pattern)
│   │   └── electron-adapter.ts (231 lines)
│   ├── enhanced-yjs-provider.ts (542 lines - main provider)
│   ├── sync/
│   │   └── hybrid-sync-manager.ts
│   └── utils/
│       └── platform-detection.ts (43 lines - needs enhancement)
├── migrations/
│   ├── 001_initial_schema.up.sql (132 lines - complete schema)
│   ├── 001_initial_schema.down.sql
│   └── README.md
├── tests/
│   └── adapters/
│       └── postgres-adapter.test.ts (existing test patterns)
├── docker-compose.yml (PostgreSQL service ready)
├── jest.config.js (test configuration)
├── .env.example (shows NEXT_PUBLIC_POSTGRES_API expectation)
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
└── tests/
    ├── adapters/
    │   └── postgres-client-adapter.test.ts (NEW)
    └── api/
        └── persistence.test.ts (NEW)
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

// PATTERN: Follow error handling from existing postgres-adapter.ts
// - withRetry wrapper for transient errors
// - Specific error codes for retryable errors
// - Connection pool error event handling

// PATTERN: Follow test structure from postgres-adapter.test.ts
// - Mock pg module
// - Test retry logic
// - Test binary data handling
// - Separate unit and integration tests
```

## Implementation Blueprint

### Data models and structure

Database schema already exists in migrations/001_initial_schema.up.sql:
```sql
-- Key tables:
-- yjs_updates: Event sourcing pattern for YJS updates
-- notes: Main documents
-- branches: Annotations with Y.RelativePosition anchors
-- panels: Canvas panels with positions
-- snapshots: Periodic state captures
-- connections: Panel relationships

-- Critical columns:
-- update BYTEA: Y.encodeStateAsUpdate binary data
-- anchor_start/end BYTEA: Y.RelativePosition encoded
-- "order" TEXT: Fractional index for ordering
```

### List of tasks to be completed in order

```yaml
Task 1: Create PostgreSQL connection pool manager
CREATE lib/db/postgres-pool.ts:
  - Singleton pool instance (follow postgres-adapter.ts pattern)
  - Use environment variable validation from platform-detection.ts
  - Connection error handling with pool.on('error')
  - Graceful shutdown in cleanup
  - Export getPool() function

Task 2: Create base API route handler utilities
CREATE lib/api/persistence-helpers.ts:
  - Binary data conversion helpers (base64 <-> Uint8Array)
  - Error response formatting
  - Request validation
  - Action routing pattern

Task 3: Create main persistence API route
CREATE app/api/persistence/route.ts:
  - POST handler with action-based routing
  - Import pool from postgres-pool.ts
  - Handle persist/load/getAllUpdates/clearUpdates actions
  - Use helpers from persistence-helpers.ts
  - Proper NextResponse usage

Task 4: Create specialized API routes
CREATE app/api/persistence/updates/route.ts:
  - GET: Retrieve all updates for a document
  - POST: Store new update with client_id
  - Use existing SQL from postgres-adapter.ts

CREATE app/api/persistence/snapshots/route.ts:
  - GET: Load latest snapshot
  - POST: Save new snapshot with checksum
  - Follow snapshot logic from postgres-adapter.ts

CREATE app/api/persistence/compact/route.ts:
  - POST: Trigger compaction (merge updates into snapshot)
  - Use transaction pattern from postgres-adapter.ts

Task 5: Create browser-compatible PostgreSQL client adapter
CREATE lib/adapters/postgres-client-adapter.ts:
  - Implements PersistenceProvider interface (from enhanced-yjs-provider.ts)
  - Uses fetch() to call API routes
  - Binary data serialization using helpers
  - Retry logic following postgres-adapter.ts pattern
  - Error handling with proper types

Task 6: Create API client helper
CREATE lib/api/persistence-client.ts:
  - Centralized fetch logic with typed responses
  - Binary data handling utilities
  - Error response parsing
  - Retry logic for network errors
  - Client ID generation

Task 7: Update platform detection
MODIFY lib/utils/platform-detection.ts:
  - Add isServerSide() check: typeof window === 'undefined'
  - Add isBuildTime() check for Next.js
  - Enhance hasPostgreSQL to check POSTGRES_URL || NEXT_PUBLIC_POSTGRES_API
  - Export new detection functions

Task 8: Update enhanced YJS provider
MODIFY lib/enhanced-yjs-provider.ts:
  - Import PostgresClientAdapter
  - Update getPreferredPersistence import
  - Add case for 'postgres-client' in persistence initialization
  - Use isServerSide() to choose adapter

Task 9: Fix postgres-adapter for server-only use
MODIFY lib/adapters/postgres-adapter.ts:
  - Add at top: if (typeof window !== 'undefined') throw new Error('PostgresAdapter cannot be used in browser')
  - Keep all existing implementation
  - Update comments to clarify server-only usage

Task 10: Create tests for new components
CREATE tests/adapters/postgres-client-adapter.test.ts:
  - Follow pattern from postgres-adapter.test.ts
  - Mock fetch instead of pg
  - Test binary data serialization
  - Test retry logic
  - Test error cases

CREATE tests/api/persistence.test.ts:
  - Test each API route
  - Mock database pool
  - Test binary data handling
  - Test error responses
```

### Per task pseudocode

```typescript
// Task 1: PostgreSQL connection pool
// lib/db/postgres-pool.ts
import { Pool, PoolClient } from 'pg'

let pool: Pool | null = null

export function getPool(): Pool {
  // PATTERN: Singleton from postgres-adapter.ts line 37-43
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL
    if (!connectionString) {
      throw new Error(
        'PostgreSQL connection string is required. ' +
        'Please set POSTGRES_URL environment variable.'
      )
    }
    
    pool = new Pool({
      connectionString,
      max: parseInt(process.env.POSTGRES_POOL_SIZE || '10'),
      idleTimeoutMillis: parseInt(process.env.POSTGRES_IDLE_TIMEOUT || '30000'),
      connectionTimeoutMillis: parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT || '2000'),
    })
    
    // PATTERN: Error handling from postgres-adapter.ts line 45-48
    pool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err)
    })
  }
  
  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

// Task 3: API Route Handler
// app/api/persistence/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db/postgres-pool'
import { 
  base64ToUint8Array, 
  uint8ArrayToBase64,
  createErrorResponse 
} from '@/lib/api/persistence-helpers'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, ...params } = body
    
    // PATTERN: Action-based routing similar to web-adapter-enhanced.ts
    switch (action) {
      case 'persist':
        return handlePersist(params)
      case 'load':
        return handleLoad(params)
      case 'getAllUpdates':
        return handleGetAllUpdates(params)
      case 'clearUpdates':
        return handleClearUpdates(params)
      default:
        return createErrorResponse('Unknown action', 400)
    }
  } catch (error: any) {
    console.error('Persistence API error:', error)
    return createErrorResponse(error.message, 500)
  }
}

async function handlePersist(params: any): Promise<NextResponse> {
  const { docName, update, clientId } = params
  
  if (!docName || !update) {
    return createErrorResponse('Missing required parameters', 400)
  }
  
  const pool = getPool()
  const updateBuffer = Buffer.from(base64ToUint8Array(update))
  
  // SQL from postgres-adapter.ts line 133-137
  const query = `
    INSERT INTO yjs_updates (doc_name, update, client_id, timestamp)
    VALUES ($1, $2, $3, NOW())
  `
  
  try {
    await pool.query(query, [docName, updateBuffer, clientId || 'api-client'])
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return createErrorResponse(error.message, 500)
  }
}

// Task 5: Browser PostgreSQL Client
// lib/adapters/postgres-client-adapter.ts
import { PersistenceProvider } from '../enhanced-yjs-provider'

export class PostgresClientAdapter implements PersistenceProvider {
  private apiBase = '/api/persistence'
  private maxRetries = 3
  private retryDelay = 1000
  
  // PATTERN: Implement interface from enhanced-yjs-provider.ts line 12-20
  async persist(docName: string, update: Uint8Array): Promise<void> {
    // PATTERN: Retry logic from postgres-adapter.ts line 99-123
    return this.withRetry(async () => {
      const response = await fetch(this.apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'persist',
          docName,
          update: this.uint8ArrayToBase64(update),
          clientId: this.getClientId()
        })
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || `Persistence failed: ${response.statusText}`)
      }
    })
  }
  
  async load(docName: string): Promise<Uint8Array | null> {
    return this.withRetry(async () => {
      const response = await fetch(this.apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'load',
          docName
        })
      })
      
      if (!response.ok) {
        if (response.status === 404) return null
        const error = await response.json()
        throw new Error(error.message || `Load failed: ${response.statusText}`)
      }
      
      const data = await response.json()
      if (!data.update) return null
      
      return this.base64ToUint8Array(data.update)
    })
  }
  
  // Helper methods following patterns from postgres-adapter.ts
  private async withRetry<T>(
    operation: () => Promise<T>,
    retries = this.maxRetries
  ): Promise<T> {
    try {
      return await operation()
    } catch (error: any) {
      // Network errors are retryable
      const isRetryable = 
        error.name === 'NetworkError' ||
        error.message.includes('fetch') ||
        error.message.includes('network')
      
      if (isRetryable && retries > 0) {
        console.warn(`API operation failed, retrying... (${retries} attempts left)`)
        await new Promise(resolve => setTimeout(resolve, this.retryDelay))
        return this.withRetry(operation, retries - 1)
      }
      
      throw error
    }
  }
  
  private uint8ArrayToBase64(uint8Array: Uint8Array): string {
    return btoa(String.fromCharCode(...uint8Array))
  }
  
  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64)
    const uint8Array = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      uint8Array[i] = binaryString.charCodeAt(i)
    }
    return uint8Array
  }
}
```

### Integration Points
```yaml
DATABASE:
  - schema: Use existing migrations/001_initial_schema.up.sql
  - connection: Use POSTGRES_URL from environment
  - docker: docker compose up -d postgres
  
CONFIG:
  - add to: .env.local
  - POSTGRES_URL: "postgresql://postgres:postgres@localhost:5432/annotation_system"
  - POSTGRES_POOL_SIZE: "10"
  - CLIENT_ID: "web-client-1"
  
API ROUTES:
  - location: app/api/persistence/*
  - pattern: Next.js 15 App Router route handlers
  - auth: Consider adding authentication middleware later
  
PERSISTENCE:
  - browser: PostgresClientAdapter via API
  - server: PostgresAdapter direct connection
  - electron: PostgresAdapter direct connection
  - fallback: EnhancedWebPersistenceAdapter (IndexedDB)
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

# Wait for PostgreSQL to be ready
sleep 5

# Run migrations
psql postgresql://postgres:postgres@localhost:5432/annotation_system < migrations/001_initial_schema.up.sql

# Run new tests
npm test tests/adapters/postgres-client-adapter.test.ts
npm test tests/api/persistence.test.ts

# Run existing tests to ensure no regression
npm test tests/adapters/postgres-adapter.test.ts

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

# Test getAllUpdates
curl -X POST http://localhost:3000/api/persistence \
  -H "Content-Type: application/json" \
  -d '{
    "action": "getAllUpdates",
    "docName": "test-doc"
  }'

# Expected: {"updates": ["SGVsbG8gV29ybGQ="]}
```

### Level 4: Browser Test
```bash
# Open browser console at http://localhost:3000
# Run in console:
import { PostgresClientAdapter } from '/lib/adapters/postgres-client-adapter.js';
const adapter = new PostgresClientAdapter();

// Test persist
await adapter.persist('browser-test', new TextEncoder().encode('Hello from browser'));
console.log('Persist successful');

// Test load
const result = await adapter.load('browser-test');
console.log('Loaded:', new TextDecoder().decode(result)); // Should print: "Hello from browser"

// Test null case
const notFound = await adapter.load('non-existent');
console.log('Not found:', notFound); // Should print: null
```

## Final validation Checklist
- [ ] No build errors in browser context
- [ ] All tests pass: `npm test`
- [ ] No linting errors: `npm run lint`
- [ ] No type errors: `npm run type-check`
- [ ] API routes respond correctly to curl tests
- [ ] Browser can persist/load via API
- [ ] Server can persist/load directly
- [ ] Fallback to IndexedDB works when PostgreSQL unavailable
- [ ] PostgreSQL data is properly stored (check with psql)
- [ ] Binary YJS data handled correctly (no corruption)
- [ ] Retry logic works for transient errors
- [ ] Error messages are helpful and specific

---

## Anti-Patterns to Avoid
- ❌ Don't import pg library in browser code
- ❌ Don't expose database credentials to browser
- ❌ Don't skip binary data serialization
- ❌ Don't ignore connection pool limits
- ❌ Don't forget CORS if API on different port
- ❌ Don't store YJS data as JSON (use binary)
- ❌ Don't create new error patterns (follow existing)
- ❌ Don't skip the withRetry wrapper for database operations
- ❌ Don't forget to close database connections in tests
- ❌ Don't hardcode client IDs

## External References
- https://node-postgres.com/features/pooling
- https://node-postgres.com/features/transactions
- https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- https://nextjs.org/docs/app/api-reference/functions/next-response
- https://github.com/yjs/yjs/blob/main/INTERNALS.md#update-compression
- https://developer.mozilla.org/en-US/docs/Web/API/btoa
- https://jestjs.io/docs/mock-functions

## Risk Assessment
- **Medium Risk**: API route performance under load
  - Mitigation: Add connection pooling (already included)
  - Further mitigation: Add Redis caching layer if needed
- **Low Risk**: Binary data serialization overhead
  - Mitigation: Use efficient base64 encoding
  - Alternative: Consider binary-friendly transport (WebSocket)
- **Low Risk**: PostgreSQL connection exhaustion
  - Mitigation: Proper pool configuration with limits
  - Monitoring: Add pool.totalCount and pool.idleCount logging
- **Low Risk**: Test flakiness from database state
  - Mitigation: Use transactions and rollback in tests
  - Alternative: Separate test database per test suite

## Implementation Notes
1. The existing postgres-adapter.ts is well-structured with retry logic, proper error handling, and connection pooling patterns - reuse these patterns
2. The test file shows good practices for mocking the pg module - adapt for mocking fetch
3. Platform detection already checks for POSTGRES_URL, just need to add client-side checks
4. Database schema is complete and well-documented in migrations
5. Follow the existing PersistenceProvider interface exactly for compatibility

## Success Confidence Score: 9.5/10
Very high confidence due to:
- Comprehensive existing patterns to follow
- Clear separation of browser/server contexts
- Well-defined database schema already in place
- Existing test patterns to adapt
- Proper error handling patterns established
- All architectural requirements maintained
- Clear validation steps at each level