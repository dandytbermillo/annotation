/**
 * Compaction API Route
 * 
 * Specialized endpoint for compacting YJS updates into snapshots
 * POST: Trigger compaction (merge updates into snapshot)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPool, transaction } from '@/lib/db/postgres-pool'
import { 
  createErrorResponse,
  createSuccessResponse,
  bufferToUint8Array,
  logApiOperation
} from '@/lib/api/persistence-helpers'
import crypto from 'crypto'
import * as Y from 'yjs'

// POST: Trigger compaction
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const body = await request.json()
    const { docName, force = false } = body
    
    if (!docName) {
      return createErrorResponse('Missing required parameter: docName', 400)
    }
    
    const pool = getPool()
    
    // Check if compaction is needed
    if (!force) {
      const countQuery = `
        SELECT COUNT(*) as update_count 
        FROM yjs_updates 
        WHERE doc_name = $1
      `
      const countResult = await pool.query(countQuery, [docName])
      const updateCount = parseInt(countResult.rows[0].update_count)
      
      // Skip compaction if too few updates
      if (updateCount < 10) {
        logApiOperation('compact', docName, true, Date.now() - startTime)
        return createSuccessResponse({ 
          message: 'Compaction skipped - too few updates',
          updateCount,
          skipped: true
        })
      }
    }
    
    // Perform compaction in a transaction
    const result = await transaction(async (client) => {
      // Get the latest snapshot (if any)
      const snapshotResult = await client.query(
        `SELECT state FROM snapshots 
         WHERE doc_name = $1 
         ORDER BY created_at DESC 
         LIMIT 1`,
        [docName]
      )
      
      // Get all updates after the snapshot
      const updatesResult = await client.query(
        `SELECT update FROM yjs_updates 
         WHERE doc_name = $1 
         ORDER BY timestamp ASC`,
        [docName]
      )
      
      if (updatesResult.rows.length === 0) {
        return {
          message: 'No updates to compact',
          compactedCount: 0
        }
      }
      
      // Create a new YJS document
      const doc = new Y.Doc()
      
      // Apply snapshot if exists
      if (snapshotResult.rows.length > 0) {
        Y.applyUpdate(doc, bufferToUint8Array(snapshotResult.rows[0].state))
      }
      
      // Apply all updates
      for (const row of updatesResult.rows) {
        Y.applyUpdate(doc, bufferToUint8Array(row.update))
      }
      
      // Encode the compacted state
      const compactedState = Y.encodeStateAsUpdate(doc)
      const stateBuffer = Buffer.from(compactedState)
      
      // Calculate checksum
      const checksum = crypto
        .createHash('sha256')
        .update(stateBuffer)
        .digest('hex')
      
      // Get current panel states (if any)
      const panelsResult = await client.query(
        `SELECT panel_id, position, dimensions, state, title, type 
         FROM panels 
         WHERE note_id = $1`,
        [docName]
      )
      const panels = panelsResult.rows
      
      // Save new snapshot
      await client.query(
        `INSERT INTO snapshots (doc_name, state, checksum, panels, created_at) 
         VALUES ($1, $2, $3, $4, NOW())`,
        [docName, stateBuffer, checksum, panels.length > 0 ? JSON.stringify(panels) : null]
      )
      
      // Delete old updates
      await client.query(
        `DELETE FROM yjs_updates WHERE doc_name = $1`,
        [docName]
      )
      
      // Optionally delete old snapshots (keep last 3)
      await client.query(
        `DELETE FROM snapshots
         WHERE doc_name = $1
         AND id NOT IN (
           SELECT id FROM snapshots
           WHERE doc_name = $1
           ORDER BY created_at DESC
           LIMIT 3
         )`,
        [docName]
      )
      
      return {
        message: 'Compaction successful',
        compactedCount: updatesResult.rows.length,
        checksum,
        size: stateBuffer.length
      }
    })
    
    logApiOperation('compact', docName, true, Date.now() - startTime)
    return createSuccessResponse(result)
  } catch (error: any) {
    console.error('Compact API error:', error)
    logApiOperation('compact', 'unknown', false, Date.now() - startTime, error)
    return createErrorResponse(error.message || 'Internal server error', 500)
  }
}

// GET: Check compaction status
export async function GET(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const searchParams = request.nextUrl.searchParams
    const docName = searchParams.get('docName')
    
    if (!docName) {
      return createErrorResponse('Missing required parameter: docName', 400)
    }
    
    const pool = getPool()
    
    // Get update count and size
    const statsQuery = `
      SELECT 
        COUNT(*) as update_count,
        COALESCE(SUM(LENGTH(update)), 0) as total_size,
        MIN(timestamp) as oldest_update,
        MAX(timestamp) as newest_update
      FROM yjs_updates
      WHERE doc_name = $1
    `
    
    const statsResult = await pool.query(statsQuery, [docName])
    const stats = statsResult.rows[0]
    
    // Get snapshot info
    const snapshotQuery = `
      SELECT 
        COUNT(*) as snapshot_count,
        MAX(created_at) as latest_snapshot
      FROM snapshots
      WHERE doc_name = $1
    `
    
    const snapshotResult = await pool.query(snapshotQuery, [docName])
    const snapshotInfo = snapshotResult.rows[0]
    
    const updateCount = parseInt(stats.update_count)
    const needsCompaction = updateCount >= 10
    
    logApiOperation('compactStatus', docName, true, Date.now() - startTime)
    return createSuccessResponse({
      docName,
      updates: {
        count: updateCount,
        totalSize: parseInt(stats.total_size),
        oldestUpdate: stats.oldest_update,
        newestUpdate: stats.newest_update
      },
      snapshots: {
        count: parseInt(snapshotInfo.snapshot_count),
        latestSnapshot: snapshotInfo.latest_snapshot
      },
      needsCompaction,
      recommendation: needsCompaction 
        ? 'Compaction recommended' 
        : 'No compaction needed'
    })
  } catch (error: any) {
    console.error('Compact status API error:', error)
    return createErrorResponse(error.message || 'Internal server error', 500)
  }
}