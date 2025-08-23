/**
 * PostgreSQL Connection Pool Manager
 * 
 * Provides a singleton connection pool for server-side PostgreSQL operations.
 * This module manages the database connection lifecycle and provides
 * centralized configuration for all PostgreSQL connections.
 * 
 * Note: This module is server-side only and cannot be used in browser contexts.
 */

import { Pool, PoolClient, PoolConfig } from 'pg'

let pool: Pool | null = null

/**
 * Get the singleton PostgreSQL connection pool
 * Creates the pool on first access with configuration from environment variables
 */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL
    
    if (!connectionString) {
      throw new Error(
        'PostgreSQL connection string is required. ' +
        'Please set POSTGRES_URL environment variable.'
      )
    }
    
    // Pool configuration with sensible defaults
    const config: PoolConfig = {
      connectionString,
      max: parseInt(process.env.POSTGRES_POOL_SIZE || '10'),
      idleTimeoutMillis: parseInt(process.env.POSTGRES_IDLE_TIMEOUT || '30000'),
      connectionTimeoutMillis: parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT || '2000'),
    }
    
    pool = new Pool(config)
    
    // Set up error handling for unexpected errors
    pool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err)
    })
    
    // Log successful pool creation
    console.log('PostgreSQL connection pool created with config:', {
      max: config.max,
      idleTimeoutMillis: config.idleTimeoutMillis,
      connectionTimeoutMillis: config.connectionTimeoutMillis
    })
  }
  
  return pool
}

/**
 * Close the connection pool gracefully
 * Should be called on application shutdown
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
    console.log('PostgreSQL connection pool closed')
  }
}

/**
 * Execute a query with automatic client acquisition and release
 * Handles connection errors and ensures proper cleanup
 */
export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<{ rows: T[], rowCount: number }> {
  const pool = getPool()
  const client = await pool.connect()
  
  try {
    const result = await client.query(text, params)
    return {
      rows: result.rows,
      rowCount: result.rowCount || 0
    }
  } finally {
    client.release()
  }
}

/**
 * Execute a transaction with automatic rollback on error
 * Useful for operations that need to be atomic
 */
export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool()
  const client = await pool.connect()
  
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Test database connection
 * Returns true if connection is successful, false otherwise
 */
export async function testConnection(): Promise<boolean> {
  try {
    const result = await query('SELECT 1 as test')
    return result.rows[0]?.test === 1
  } catch (error) {
    console.error('PostgreSQL connection test failed:', error)
    return false
  }
}

/**
 * Get pool statistics for monitoring
 */
export function getPoolStats() {
  const currentPool = pool
  if (!currentPool) {
    return null
  }
  
  return {
    totalCount: currentPool.totalCount,
    idleCount: currentPool.idleCount,
    waitingCount: currentPool.waitingCount
  }
}

// Handle process termination gracefully
process.on('SIGINT', async () => {
  await closePool()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await closePool()
  process.exit(0)
})