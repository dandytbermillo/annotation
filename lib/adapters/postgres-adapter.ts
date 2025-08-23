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

export class PostgresPersistenceAdapter implements PersistenceProvider {
  private pool: Pool
  private maxRetries = 3
  private retryDelay = 1000 // ms
  private connected = false

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
    return this.withRetry(async () => {
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
   * Compact storage by merging updates into a snapshot
   * This improves performance by reducing the number of updates to replay
   */
  async compact(docName: string): Promise<void> {
    return this.withRetry(async () => {
      // Use a transaction to ensure consistency
      const client = await this.pool.connect()
      
      try {
        await client.query('BEGIN')

        // Get all updates
        const updatesResult = await client.query(
          'SELECT update FROM yjs_updates WHERE doc_name = $1 ORDER BY timestamp ASC',
          [docName]
        )

        if (updatesResult.rows.length === 0) {
          await client.query('COMMIT')
          return
        }

        // Merge all updates into a single state
        const doc = new Y.Doc()
        updatesResult.rows.forEach(row => {
          const update = new Uint8Array(row.update)
          Y.applyUpdate(doc, update)
        })

        const mergedState = Y.encodeStateAsUpdate(doc)

        // Save as snapshot
        await this.saveSnapshot(docName, mergedState)

        // Clear old updates
        await client.query(
          'DELETE FROM yjs_updates WHERE doc_name = $1',
          [docName]
        )

        // Optionally clean up old snapshots (keep only the most recent N)
        const retentionDays = parseInt(process.env.SNAPSHOT_RETENTION_DAYS || '30')
        await client.query(
          `DELETE FROM snapshots 
           WHERE doc_name = $1 
           AND created_at < NOW() - INTERVAL '${retentionDays} days'`,
          [docName]
        )

        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
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
   * Clean up resources
   */
  async destroy(): Promise<void> {
    await this.pool.end()
    this.connected = false
  }
}