# YJS PostgreSQL Provider Implementation PRP
**CRITICAL CONSTRAINT**: Yjs remains the runtime CRDT. Awareness/presence data is ephemeral and must NEVER be persisted to PostgreSQL.

## Goal
Implement a PostgreSQL persistence provider that integrates seamlessly with the existing Yjs CollaborationProvider architecture, supporting both Web (via API) and Electron (direct connection) platforms while maintaining IndexedDB as offline fallback.

## Why
- Current IndexedDB-only persistence limits data portability and querying
- PostgreSQL enables server-side analytics and cross-device sync
- Adapter pattern allows future persistence backends without code changes
- Maintains offline-first capability with sync-on-reconnect

## What
Create `lib/adapters/postgres-adapter.ts` implementing the PersistenceProvider interface, with platform-specific connection strategies and efficient Yjs state synchronization.

### Success Criteria
- [ ] PostgreSQL adapter implements full PersistenceProvider interface
- [ ] Seamless fallback to IndexedDB when Postgres unavailable
- [ ] Efficient batch updates with connection pooling
- [ ] Platform detection for Web (API) vs Electron (direct)
- [ ] Integration tests pass with real PostgreSQL instance
- [ ] No awareness/presence data persisted

## All Needed Context

### Documentation & References
```yaml
- file: lib/adapters/web-adapter-enhanced.ts
  why: Reference implementation showing PersistenceProvider interface
  
- file: lib/enhanced-yjs-provider.ts
  why: Understand how providers integrate with CollaborationProvider
  
- file: docs/yjs-annotation-architecture.md
  why: Architecture constraints, especially lines 64-68 on persistence adapters
  
- url: https://node-postgres.com/features/pooling
  why: Connection pooling for production usage
  
- url: https://github.com/yjs/yjs#document-updates
  why: Yjs update encoding/decoding patterns

- file: lib/utils/platform-detection.ts
  why: Platform detection utilities for Web vs Electron
```

### Current Architecture Overview
```
CollaborationProvider (Singleton)
    ├── PersistenceProvider Interface
    │   ├── persist(docName, update)
    │   ├── load(docName) 
    │   ├── getAllUpdates(docName)
    │   └── createSnapshot(docName)
    │
    └── Platform Adapters
        ├── WebAdapter (IndexedDB + Service Worker)
        ├── ElectronAdapter (SQLite planned)
        └── PostgresAdapter (NEW - this PRP)
```

### Known Gotchas
- Web platform cannot directly connect to Postgres (needs API layer)
- Electron can use pg client directly or via IPC to main process
- Connection pooling critical for performance
- Binary data (Uint8Array) must be handled correctly
- Retry logic needed for transient connection failures
- Must not block Yjs real-time sync operations

## Implementation Blueprint

### Core PostgreSQL Adapter
```typescript
// lib/adapters/postgres-adapter.ts

import { Pool, PoolClient } from 'pg'
import * as Y from 'yjs'
import { PersistenceProvider } from '../enhanced-yjs-provider'
import { detectPlatform } from '../utils/platform-detection'

export class PostgresAdapter implements PersistenceProvider {
  private pool: Pool | null = null
  private apiEndpoint: string | null = null
  private platform: 'web' | 'electron'
  private fallbackProvider?: PersistenceProvider
  private retryCount = 3
  private batchQueue = new Map<string, Uint8Array[]>()
  private batchTimer: NodeJS.Timeout | null = null
  
  constructor(config: PostgresAdapterConfig) {
    this.platform = detectPlatform()
    
    if (this.platform === 'electron' && config.connectionString) {
      // Direct connection for Electron
      this.pool = new Pool({
        connectionString: config.connectionString,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      })
    } else if (this.platform === 'web' && config.apiEndpoint) {
      // API endpoint for web
      this.apiEndpoint = config.apiEndpoint
    }
    
    // Optional fallback to IndexedDB
    if (config.fallbackProvider) {
      this.fallbackProvider = config.fallbackProvider
    }
  }
  
  async persist(docName: string, update: Uint8Array): Promise<void> {
    // Batch updates for efficiency
    if (!this.batchQueue.has(docName)) {
      this.batchQueue.set(docName, [])
    }
    this.batchQueue.get(docName)!.push(update)
    
    // Debounce batch processing
    if (this.batchTimer) clearTimeout(this.batchTimer)
    this.batchTimer = setTimeout(() => this.processBatch(), 100)
  }
  
  private async processBatch(): Promise<void> {
    const batches = new Map(this.batchQueue)
    this.batchQueue.clear()
    
    for (const [docName, updates] of batches) {
      try {
        if (this.platform === 'electron' && this.pool) {
          await this.persistDirect(docName, updates)
        } else if (this.platform === 'web' && this.apiEndpoint) {
          await this.persistViaAPI(docName, updates)
        } else {
          throw new Error('No persistence method available')
        }
      } catch (error) {
        // Fallback to IndexedDB if available
        if (this.fallbackProvider) {
          for (const update of updates) {
            await this.fallbackProvider.persist(docName, update)
          }
        } else {
          throw error
        }
      }
    }
  }
  
  private async persistDirect(docName: string, updates: Uint8Array[]): Promise<void> {
    const client = await this.pool!.acquire()
    try {
      await client.query('BEGIN')
      
      for (const update of updates) {
        await client.query(
          'INSERT INTO yjs_updates (doc_name, update, timestamp) VALUES ($1, $2, NOW())',
          [docName, Buffer.from(update)]
        )
      }
      
      // Update snapshot periodically (every 10 updates)
      const count = await client.query(
        'SELECT COUNT(*) FROM yjs_updates WHERE doc_name = $1',
        [docName]
      )
      
      if (parseInt(count.rows[0].count) % 10 === 0) {
        await this.createSnapshot(docName, client)
      }
      
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  
  private async persistViaAPI(docName: string, updates: Uint8Array[]): Promise<void> {
    const response = await fetch(`${this.apiEndpoint}/persist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        docName,
        updates: updates.map(u => Array.from(u)),
        timestamp: Date.now()
      })
    })
    
    if (!response.ok) {
      throw new Error(`API persist failed: ${response.statusText}`)
    }
  }
  
  async load(docName: string): Promise<Uint8Array | null> {
    try {
      // Try loading from snapshot first
      const snapshot = await this.loadSnapshot(docName)
      if (snapshot) return snapshot
      
      // Load and merge all updates
      const updates = await this.getAllUpdates(docName)
      if (updates.length === 0) return null
      
      // Merge updates into single state
      const doc = new Y.Doc()
      updates.forEach(update => Y.applyUpdate(doc, update))
      
      return Y.encodeStateAsUpdate(doc)
    } catch (error) {
      if (this.fallbackProvider) {
        return this.fallbackProvider.load(docName)
      }
      throw error
    }
  }
  
  async getAllUpdates(docName: string): Promise<Uint8Array[]> {
    if (this.platform === 'electron' && this.pool) {
      const result = await this.pool.query(
        'SELECT update FROM yjs_updates WHERE doc_name = $1 ORDER BY timestamp ASC',
        [docName]
      )
      return result.rows.map(row => new Uint8Array(row.update))
    } else if (this.platform === 'web' && this.apiEndpoint) {
      const response = await fetch(`${this.apiEndpoint}/updates/${encodeURIComponent(docName)}`)
      const data = await response.json()
      return data.updates.map((u: number[]) => new Uint8Array(u))
    }
    
    return []
  }
  
  private async loadSnapshot(docName: string): Promise<Uint8Array | null> {
    if (this.platform === 'electron' && this.pool) {
      const result = await this.pool.query(
        'SELECT snapshot FROM snapshots WHERE doc_name = $1 ORDER BY created_at DESC LIMIT 1',
        [docName]
      )
      return result.rows[0]?.snapshot ? new Uint8Array(result.rows[0].snapshot) : null
    } else if (this.platform === 'web' && this.apiEndpoint) {
      const response = await fetch(`${this.apiEndpoint}/snapshot/${encodeURIComponent(docName)}`)
      if (response.ok) {
        const data = await response.json()
        return data.snapshot ? new Uint8Array(data.snapshot) : null
      }
    }
    
    return null
  }
  
  async createSnapshot(docName: string, client?: PoolClient): Promise<void> {
    const updates = await this.getAllUpdates(docName)
    if (updates.length === 0) return
    
    // Merge all updates into snapshot
    const doc = new Y.Doc()
    updates.forEach(update => Y.applyUpdate(doc, update))
    const snapshot = Y.encodeStateAsUpdate(doc)
    
    if (this.platform === 'electron' && this.pool) {
      const poolClient = client || await this.pool.acquire()
      try {
        // Extract note_id from docName (format: 'note:uuid' or 'panel:uuid')
        const [type, id] = docName.split(':')
        const noteId = type === 'note' ? id : await this.getNoteIdForPanel(id, poolClient)
        
        await poolClient.query(
          `INSERT INTO snapshots (note_id, doc_name, snapshot, checksum, created_at) 
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (note_id, doc_name, created_at) DO NOTHING`,
          [noteId, docName, Buffer.from(snapshot), this.calculateChecksum(snapshot)]
        )
        
        // Clean old updates (keep last 100)
        await poolClient.query(
          `DELETE FROM yjs_updates 
           WHERE doc_name = $1 AND id NOT IN (
             SELECT id FROM yjs_updates 
             WHERE doc_name = $1 
             ORDER BY timestamp DESC 
             LIMIT 100
           )`,
          [docName]
        )
      } finally {
        if (!client) poolClient.release()
      }
    }
  }
  
  private calculateChecksum(data: Uint8Array): string {
    // Simple checksum for demo - use crypto.subtle.digest in production
    return Array.from(data.slice(0, 20))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }
  
  private async getNoteIdForPanel(panelId: string, client: PoolClient): Promise<string> {
    const result = await client.query(
      'SELECT note_id FROM panels WHERE id = $1',
      [panelId]
    )
    return result.rows[0]?.note_id || panelId
  }
  
  async destroy(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
    }
    
    if (this.pool) {
      await this.pool.end()
    }
  }
}

interface PostgresAdapterConfig {
  connectionString?: string // For Electron
  apiEndpoint?: string // For Web
  fallbackProvider?: PersistenceProvider
}
```

### API Layer for Web Platform
```typescript
// pages/api/yjs/[...params].ts (Next.js API route example)

import { Pool } from 'pg'
import { NextApiRequest, NextApiResponse } from 'next'

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL
})

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const [action, ...params] = req.query.params as string[]
  
  try {
    switch (action) {
      case 'persist':
        // Handle batch persist
        const { docName, updates } = req.body
        // Implementation similar to persistDirect above
        break
        
      case 'updates':
        // Get all updates for a document
        const docName = params[0]
        // Query and return updates
        break
        
      case 'snapshot':
        // Get latest snapshot
        // Query and return snapshot
        break
    }
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
```

### Integration with Enhanced Provider
```typescript
// lib/provider-switcher.ts (addition)

import { PostgresAdapter } from './adapters/postgres-adapter'

export function createPersistenceProvider(platform: Platform): PersistenceProvider {
  // Existing logic...
  
  if (process.env.POSTGRES_URL || process.env.NEXT_PUBLIC_POSTGRES_API) {
    const postgresAdapter = new PostgresAdapter({
      connectionString: process.env.POSTGRES_URL,
      apiEndpoint: process.env.NEXT_PUBLIC_POSTGRES_API,
      fallbackProvider: existingProvider // IndexedDB fallback
    })
    
    return postgresAdapter
  }
  
  // Fall back to existing provider
  return existingProvider
}
```

## Validation Loop

### Level 1: Type Checking
```bash
npm run type-check
# Ensure PostgresAdapter implements PersistenceProvider interface
```

### Level 2: Unit Tests
```typescript
// __tests__/postgres-adapter.test.ts
describe('PostgresAdapter', () => {
  test('persists and loads YJS updates', async () => {
    const adapter = new PostgresAdapter({ connectionString: TEST_DB_URL })
    const doc = new Y.Doc()
    doc.getText('test').insert(0, 'Hello')
    
    await adapter.persist('test-doc', Y.encodeStateAsUpdate(doc))
    const loaded = await adapter.load('test-doc')
    
    const newDoc = new Y.Doc()
    Y.applyUpdate(newDoc, loaded!)
    expect(newDoc.getText('test').toString()).toBe('Hello')
  })
  
  test('falls back to IndexedDB on connection failure', async () => {
    // Test with invalid connection string
  })
  
  test('never persists awareness data', async () => {
    // Ensure awareness updates are filtered
  })
})
```

### Level 3: Integration Tests
```bash
# Start Postgres
docker compose up -d postgres

# Run integration tests
npm run test:integration -- postgres-adapter

# Should test:
# - Multi-client concurrent updates
# - Snapshot creation and recovery
# - Platform-specific connection methods
```

## Final Validation Checklist
- [ ] Type safety maintained throughout
- [ ] Platform detection works correctly
- [ ] Fallback to IndexedDB on failures
- [ ] Connection pooling prevents exhaustion
- [ ] Binary data handled correctly
- [ ] No awareness data persisted
- [ ] Batch updates improve performance
- [ ] Snapshots created periodically

## Anti-Patterns to Avoid
- ❌ Don't block Yjs sync operations
- ❌ Don't persist awareness/presence
- ❌ Don't forget connection pooling
- ❌ Don't assume platform (detect it)
- ❌ Don't lose updates on failure
- ❌ Don't expose DB credentials in web