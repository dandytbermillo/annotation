import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db/postgres-pool'

/**
 * Health check endpoint for PostgreSQL persistence
 * 
 * GET /api/persistence/health
 * 
 * Returns:
 * - 200 OK with { healthy: true, latency: number } if connected
 * - 503 Service Unavailable if database is not accessible
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    // Only check if PostgreSQL is enabled
    if (!process.env.POSTGRES_URL) {
      return NextResponse.json(
        { 
          healthy: false, 
          error: 'PostgreSQL not configured',
          timestamp: new Date().toISOString()
        },
        { status: 503 }
      )
    }
    
    // Get connection pool
    const pool = getPool()
    
    // Perform a simple query to check connection
    const result = await pool.query('SELECT NOW() as current_time')
    
    const latency = Date.now() - startTime
    
    return NextResponse.json({
      healthy: true,
      latency,
      timestamp: result.rows[0].current_time,
      poolStatus: {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      }
    })
    
  } catch (error) {
    console.error('[Health Check] PostgreSQL health check failed:', error)
    
    return NextResponse.json(
      {
        healthy: false,
        error: error instanceof Error ? error.message : 'Database connection failed',
        latency: Date.now() - startTime,
        timestamp: new Date().toISOString()
      },
      { status: 503 }
    )
  }
}