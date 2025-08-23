/**
 * PostgreSQL Persistence Adapter for YJS Annotation System (Server-Side Only)
 * 
 * This adapter implements the PersistenceProvider interface using PostgreSQL
 * as the backing store. It follows an event-sourcing pattern, storing individual
 * YJS updates and periodically creating snapshots for performance.
 * 
 * IMPORTANT: This adapter is for server-side use only (Node.js environments).
 * For browser-based applications, use PostgresClientAdapter or PostgresAPIAdapter.
 * 
 * Key principles:
 * - YJS remains the source of truth for real-time sync
 * - PostgreSQL is used only for persistence, not real-time collaboration
 * - Binary YJS data is stored in BYTEA columns
 * - Direct database connection requires Node.js runtime
 * - Supports server-side Next.js API routes and Electron apps
 */

import { Pool, PoolClient } from 'pg'
import * as Y from 'yjs'
import { PersistenceProvider } from '../enhanced-yjs-provider'

// Server-side only check - this adapter cannot be used in browser contexts
if (typeof window !== 'undefined') {
  throw new Error(
    'PostgresPersistenceAdapter cannot be used in browser contexts. ' +
    'Please use PostgresClientAdapter or PostgresAPIAdapter for browser-based applications.'
  )
}

// Configuration for compaction thresholds
export interface CompactionConfig {
  updateThreshold: number  // Default: 100
  sizeThreshold: number    // Default: 1MB (in bytes)
  autoCompact: boolean     // Default: true
  keepSnapshots: number    // Default: 3
}

export interface DocumentStats {
  updateCount: number
  totalSize: number
  lastSnapshot?: Date
  oldestUpdate?: Date
}

export class PostgresPersistenceAdapter implements PersistenceProvider {
  private pool: Pool
  private maxRetries = 3
  private retryDelay = 1000 // ms
  private connected = false
  private compactionConfig: CompactionConfig = {
    updateThreshold: 100,
    sizeThreshold: 1024 * 1024, // 1MB
    autoCompact: true,
    keepSnapshots: 3
  }

  constructor(connectionString?: string) {
    // Use provided connection string or fall back to environment variable
    const dbUrl = connectionString || process.env.POSTGRES_URL

    if (!dbUrl) {
      throw new Error(
        'PostgreSQL connection string is required. ' +
        'Please set POSTGRES_URL environment variable or pass connectionString to constructor.'
      )
    }

    // Initialize connection pool with configuration
    this.pool = new Pool({
      connectionString: dbUrl,
      max: parseInt(process.env.POSTGRES_POOL_SIZE || process.env.POSTGRES_MAX_CONNECTIONS || '10'),
      idleTimeoutMillis: parseInt(process.env.POSTGRES_IDLE_TIMEOUT || '30000'),
      connectionTimeoutMillis: parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT || '2000'),
    })

    // Set up error handling for the pool
    this.pool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err)
    })

    // Test connection on initialization
    this.testConnection()
  }

  /**
   * Test database connection and verify required tables exist
   */
  private async testConnection(): Promise<void> {
    let client: PoolClient | null = null
    try {
      client = await this.pool.connect()
      
      // Verify required tables exist
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'yjs_updates'
        ) as updates_exists,
        EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'snapshots'
        ) as snapshots_exists
      `)

      const { updates_exists, snapshots_exists } = tableCheck.rows[0]
      
      if (!updates_exists || !snapshots_exists) {
        throw new Error(
          'Required database tables not found. ' +
          'Please run migrations before using the PostgreSQL adapter.'
        )
      }

      this.connected = true
      console.log('PostgreSQL adapter connected successfully')
    } catch (error) {
      console.error('PostgreSQL connection test failed:', error)
      throw error
    } finally {
      if (client) {
        client.release()
      }
    }
  }

  /**
   * Execute a database operation with retry logic for transient errors
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    retries = this.maxRetries
  ): Promise<T> {
    try {
      return await operation()
    } catch (error: any) {
      // Check if error is retryable (connection errors, timeouts, etc.)
      const isRetryable = 
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.code === '08000' || // connection_exception
        error.code === '08003' || // connection_does_not_exist
        error.code === '08006'    // connection_failure

      if (isRetryable && retries > 0) {
        console.warn(`PostgreSQL operation failed, retrying... (${retries} attempts left)`)
        await new Promise(resolve => setTimeout(resolve, this.retryDelay))
        return this.withRetry(operation, retries - 1)
      }

      throw error
    }
  }

  /**
   * Persist a YJS update to the database
   */
  async persist(docName: string, update: Uint8Array): Promise<void> {
    await this.withRetry(async () => {
      // Convert Uint8Array to Buffer for pg driver
      const updateBuffer = Buffer.from(update)

      const query = `
        INSERT INTO yjs_updates (doc_name, update, client_id, timestamp)
        VALUES ($1, $2, $3, NOW())
      `

      await this.pool.query(query, [
        docName,
        updateBuffer,
        process.env.CLIENT_ID || 'postgres-adapter'
      ])
    })
    
    // Check if auto-compaction is needed (async, non-blocking)
    if (this.compactionConfig.autoCompact) {
      // Run compaction check asynchronously to avoid blocking persist
      this.checkAndCompact(docName).catch(err => {
        console.error(`Auto-compaction check failed for ${docName}:`, err)
      })
    }
  }
  
  /**
   * Check if compaction is needed and run it
   */
  private async checkAndCompact(docName: string): Promise<void> {
    try {
      const stats = await this.getDocumentStats(docName)
      if (this.shouldCompact(stats)) {
        console.log(`Auto-compacting ${docName} due to:`, {
          updateCount: stats.updateCount,
          totalSize: stats.totalSize,
          thresholds: {
            updateThreshold: this.compactionConfig.updateThreshold,
            sizeThreshold: this.compactionConfig.sizeThreshold
          }
        })
        await this.compact(docName)
      }
    } catch (error) {
      // Log but don't throw - compaction failures shouldn't break persistence
      console.error(`Auto-compaction failed for ${docName}:`, error)
    }
  }

  /**
   * Load the current state of a document
   * First tries to load from snapshot, then falls back to merging all updates
   */
  async load(docName: string): Promise<Uint8Array | null> {
    return this.withRetry(async () => {
      // Try to load from snapshot first for performance
      const snapshot = await this.loadSnapshot(docName)
      if (snapshot) {
        return snapshot
      }

      // No snapshot found, merge all updates
      const updates = await this.getAllUpdates(docName)
      if (updates.length === 0) {
        return null
      }

      // Create a new Y.Doc and apply all updates
      const doc = new Y.Doc()
      updates.forEach(update => {
        Y.applyUpdate(doc, update)
      })

      // Return the merged state
      return Y.encodeStateAsUpdate(doc)
    })
  }

  /**
   * Get all updates for a document in chronological order
   */
  async getAllUpdates(docName: string): Promise<Uint8Array[]> {
    return this.withRetry(async () => {
      const query = `
        SELECT update 
        FROM yjs_updates 
        WHERE doc_name = $1 
        ORDER BY timestamp ASC
      `

      const result = await this.pool.query(query, [docName])

      // Convert Buffer objects back to Uint8Array
      return result.rows.map(row => new Uint8Array(row.update))
    })
  }

  /**
   * Clear all updates for a document
   * Typically called after creating a snapshot
   */
  async clearUpdates(docName: string): Promise<void> {
    return this.withRetry(async () => {
      const query = `
        DELETE FROM yjs_updates 
        WHERE doc_name = $1
      `

      await this.pool.query(query, [docName])
    })
  }

  /**
   * Save a snapshot of the current document state
   */
  async saveSnapshot(docName: string, snapshot: Uint8Array): Promise<void> {
    return this.withRetry(async () => {
      // Convert Uint8Array to Buffer for pg driver
      const snapshotBuffer = Buffer.from(snapshot)

      // Calculate checksum for validation
      const checksum = this.calculateChecksum(snapshot)

      // Extract note_id from doc_name if it follows the pattern 'note:{uuid}'
      let noteId: string | null = null
      const noteMatch = docName.match(/^note:(.+)$/)
      if (noteMatch) {
        noteId = noteMatch[1]
      }

      const query = `
        INSERT INTO snapshots (note_id, doc_name, state, checksum, created_at)
        VALUES ($1, $2, $3, $4, NOW())
      `

      await this.pool.query(query, [
        noteId,
        docName,
        snapshotBuffer,
        checksum
      ])
    })
  }

  /**
   * Load the most recent snapshot for a document
   */
  async loadSnapshot(docName: string): Promise<Uint8Array | null> {
    return this.withRetry(async () => {
      const query = `
        SELECT state 
        FROM snapshots 
        WHERE doc_name = $1 
        ORDER BY created_at DESC 
        LIMIT 1
      `

      const result = await this.pool.query(query, [docName])

      if (result.rows.length === 0) {
        return null
      }

      // Convert Buffer back to Uint8Array
      return new Uint8Array(result.rows[0].state)
    })
  }

  /**
   * Get statistics about a document for compaction decisions
   */
  private async getDocumentStats(docName: string): Promise<DocumentStats> {
    const query = `
      SELECT 
        COUNT(*) as update_count,
        COALESCE(SUM(LENGTH(update::text)), 0) as total_size,
        MIN(timestamp) as oldest_update
      FROM yjs_updates
      WHERE doc_name = $1
    `
    
    const snapshotQuery = `
      SELECT created_at 
      FROM snapshots 
      WHERE doc_name = $1 
      ORDER BY created_at DESC 
      LIMIT 1
    `
    
    const [updateResult, snapshotResult] = await Promise.all([
      this.pool.query(query, [docName]),
      this.pool.query(snapshotQuery, [docName])
    ])
    
    return {
      updateCount: parseInt(updateResult.rows[0]?.update_count || '0'),
      totalSize: parseInt(updateResult.rows[0]?.total_size || '0'),
      oldestUpdate: updateResult.rows[0]?.oldest_update,
      lastSnapshot: snapshotResult.rows[0]?.created_at
    }
  }

  /**
   * Check if compaction is needed based on configuration
   */
  private shouldCompact(stats: DocumentStats, config?: CompactionConfig): boolean {
    const cfg = config || this.compactionConfig
    
    // Don't compact if no updates
    if (stats.updateCount === 0) return false
    
    // Check thresholds
    if (stats.updateCount >= cfg.updateThreshold) return true
    if (stats.totalSize >= cfg.sizeThreshold) return true
    
    // Check time since last snapshot (compact if older than 24 hours)
    if (stats.lastSnapshot) {
      const hoursSinceSnapshot = (Date.now() - new Date(stats.lastSnapshot).getTime()) / (1000 * 60 * 60)
      if (hoursSinceSnapshot > 24) return true
    }
    
    return false
  }

  /**
   * Log compaction operation
   */
  private async logCompaction(
    client: PoolClient,
    docName: string,
    updatesBefore: number,
    updatesAfter: number,
    snapshotSize: number,
    duration: number
  ): Promise<void> {
    await client.query(
      `INSERT INTO compaction_log (doc_name, updates_before, updates_after, snapshot_size, duration_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [docName, updatesBefore, updatesAfter, snapshotSize, duration]
    )
  }

  /**
   * Compact storage by merging updates into a snapshot
   * This improves performance by reducing the number of updates to replay
   */
  async compact(docName: string, config?: CompactionConfig): Promise<void> {
    return this.withRetry(async () => {
      const startTime = Date.now()
      const cfg = config || this.compactionConfig
      
      // Check if compaction is needed
      const stats = await this.getDocumentStats(docName)
      if (!this.shouldCompact(stats, cfg)) {
        console.log(`Compaction not needed for ${docName}:`, stats)
        return
      }
      
      // Use a transaction to ensure consistency
      const client = await this.pool.connect()
      
      try {
        await client.query('BEGIN')

        // 1. Get all updates
        const updatesResult = await client.query(
          'SELECT update FROM yjs_updates WHERE doc_name = $1 ORDER BY timestamp ASC',
          [docName]
        )

        if (updatesResult.rows.length === 0) {
          await client.query('COMMIT')
          return
        }

        // 2. Extract note_id from doc_name if applicable
        let noteId: string | null = null
        const noteMatch = docName.match(/^note:(.+)$/)
        if (noteMatch) {
          noteId = noteMatch[1]
        }

        // 3. Merge using YJS efficient merge (similar to V2)
        const updates = updatesResult.rows.map(row => new Uint8Array(row.update))
        const mergedUpdate = updates.length > 1 ? Y.mergeUpdates(updates) : updates[0]
        
        // 4. Apply to fresh document for clean state
        const doc = new Y.Doc()
        Y.applyUpdate(doc, mergedUpdate)
        
        // 5. Create snapshot with metadata
        const snapshot = Y.encodeStateAsUpdate(doc)
        const checksum = this.calculateChecksum(snapshot)
        
        await client.query(
          `INSERT INTO snapshots (note_id, doc_name, state, update_count, size_bytes, checksum, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [noteId, docName, Buffer.from(snapshot), updatesResult.rows.length, snapshot.byteLength, checksum]
        )

        // 6. Delete old updates
        await client.query('DELETE FROM yjs_updates WHERE doc_name = $1', [docName])

        // 7. Keep only last N snapshots
        await client.query(
          `DELETE FROM snapshots 
           WHERE doc_name = $1 AND id NOT IN (
             SELECT id FROM snapshots 
             WHERE doc_name = $1 
             ORDER BY created_at DESC 
             LIMIT $2
           )`,
          [docName, cfg.keepSnapshots]
        )

        // 8. Log compaction
        const duration = Date.now() - startTime
        await this.logCompaction(client, docName, updatesResult.rows.length, 0, snapshot.byteLength, duration)

        await client.query('COMMIT')
        
        console.log(`Compaction completed for ${docName}: ${updatesResult.rows.length} updates -> 1 snapshot (${snapshot.byteLength} bytes) in ${duration}ms`)
      } catch (error) {
        await client.query('ROLLBACK')
        console.error(`Compaction failed for ${docName}:`, error)
        throw error
      } finally {
        client.release()
      }
    })
  }

  /**
   * Calculate a simple checksum for data validation
   */
  private calculateChecksum(data: Uint8Array): string {
    let hash = 0
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data[i]
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16)
  }

  /**
   * Delete a note and all its associated data
   * Uses soft delete for notes, panels, and branches tables
   * Hard deletes YJS updates and snapshots
   */
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
      
      console.log(`Successfully deleted note ${noteId} and all associated data`)
      
    } catch (error) {
      await client.query('ROLLBACK')
      throw new Error(`Failed to delete note ${noteId}: ${error.message}`)
    } finally {
      client.release()
    }
  }
  
  /**
   * Hard delete for permanent removal
   * WARNING: This permanently removes all data and cannot be undone
   */
  async hardDeleteNote(noteId: string): Promise<void> {
    const client = await this.pool.connect()
    
    try {
      await client.query('BEGIN')
      
      // Delete in reverse order of dependencies
      
      // 1. Delete YJS updates
      await client.query(
        `DELETE FROM yjs_updates 
         WHERE doc_name = $1 OR doc_name LIKE $2`,
        [`note:${noteId}`, `panel:${noteId}:%`]
      )
      
      // 2. Delete snapshots
      await client.query(
        'DELETE FROM snapshots WHERE note_id = $1',
        [noteId]
      )
      
      // 3. Delete branches
      await client.query(
        'DELETE FROM branches WHERE note_id = $1',
        [noteId]
      )
      
      // 4. Delete panels
      await client.query(
        'DELETE FROM panels WHERE note_id = $1',
        [noteId]
      )
      
      // 5. Delete the note itself
      await client.query(
        'DELETE FROM notes WHERE id = $1',
        [noteId]
      )
      
      await client.query('COMMIT')
      
      console.log(`Permanently deleted note ${noteId} and all associated data`)
      
    } catch (error) {
      await client.query('ROLLBACK')
      throw new Error(`Failed to permanently delete note ${noteId}: ${error.message}`)
    } finally {
      client.release()
    }
  }
  
  /**
   * Notify other clients about deletion (placeholder for awareness integration)
   */
  private notifyDeletion(noteId: string): void {
    // TODO: Integrate with awareness protocol to notify other clients
    // This would typically emit an event or update a shared state
    console.log(`Deletion notification for note ${noteId} would be sent to other clients`)
  }

  /**
   * Execute a raw query (for internal use and API routes)
   */
  async query(text: string, params?: any[]): Promise<any> {
    return this.pool.query(text, params)
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    await this.pool.end()
    this.connected = false
  }
}