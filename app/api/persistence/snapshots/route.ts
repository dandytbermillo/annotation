/**
 * Snapshots API Route
 * 
 * Specialized endpoint for managing YJS state snapshots
 * GET: Load latest snapshot for a document
 * POST: Save new snapshot with checksum
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db/postgres-pool'
import { 
  createErrorResponse,
  createSuccessResponse,
  validateRequiredParams,
  formatUpdateForTransport,
  parseUpdateFromRequest,
  logApiOperation
} from '@/lib/api/persistence-helpers'
import crypto from 'crypto'

// GET: Load latest snapshot
export async function GET(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const searchParams = request.nextUrl.searchParams
    const docName = searchParams.get('docName')
    const checksum = searchParams.get('checksum') // Optional: get specific snapshot by checksum
    
    if (!docName) {
      return createErrorResponse('Missing required parameter: docName', 400)
    }
    
    const pool = getPool()
    let query: string
    let params: any[]
    
    if (checksum) {
      // Get specific snapshot by checksum
      query = `
        SELECT state, checksum, created_at, panels
        FROM snapshots 
        WHERE doc_name = $1 AND checksum = $2
        LIMIT 1
      `
      params = [docName, checksum]
    } else {
      // Get latest snapshot
      query = `
        SELECT state, checksum, created_at, panels
        FROM snapshots 
        WHERE doc_name = $1 
        ORDER BY created_at DESC 
        LIMIT 1
      `
      params = [docName]
    }
    
    const result = await pool.query(query, params)
    
    if (result.rows.length === 0) {
      logApiOperation('loadSnapshot', docName, true, Date.now() - startTime)
      return createSuccessResponse({ 
        docName,
        snapshot: null 
      })
    }
    
    const { state, checksum: snapshotChecksum, created_at, panels } = result.rows[0]
    
    logApiOperation('loadSnapshot', docName, true, Date.now() - startTime)
    return createSuccessResponse({ 
      docName,
      snapshot: formatUpdateForTransport(state),
      checksum: snapshotChecksum,
      createdAt: created_at.toISOString(),
      panels: panels || [],
      size: state.length
    })
  } catch (error: any) {
    console.error('Snapshots API error:', error)
    return createErrorResponse(error.message || 'Internal server error', 500)
  }
}

// POST: Save new snapshot with checksum
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const body = await request.json()
    const { docName, snapshot, panels } = body
    
    const validation = validateRequiredParams(body, ['docName', 'snapshot'])
    if (!validation.valid) {
      return createErrorResponse(`Missing required parameters: ${validation.missing?.join(', ')}`, 400)
    }
    
    const snapshotData = parseUpdateFromRequest(snapshot)
    if (!snapshotData) {
      return createErrorResponse('Invalid snapshot data format', 400)
    }
    
    const pool = getPool()
    const snapshotBuffer = Buffer.from(snapshotData)
    
    // Calculate checksum for integrity
    const checksum = crypto
      .createHash('sha256')
      .update(snapshotBuffer)
      .digest('hex')
    
    // Check if this exact snapshot already exists
    const existingQuery = `
      SELECT id FROM snapshots 
      WHERE doc_name = $1 AND checksum = $2
      LIMIT 1
    `
    const existing = await pool.query(existingQuery, [docName, checksum])
    
    if (existing.rows.length > 0) {
      logApiOperation('saveSnapshot', docName, true, Date.now() - startTime)
      return createSuccessResponse({ 
        message: 'Snapshot already exists',
        checksum,
        duplicate: true
      })
    }
    
    // Save new snapshot
    const insertQuery = `
      INSERT INTO snapshots (doc_name, state, checksum, panels, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id, created_at
    `
    
    const result = await pool.query(insertQuery, [
      docName,
      snapshotBuffer,
      checksum,
      panels ? JSON.stringify(panels) : null
    ])
    
    const { id, created_at } = result.rows[0]
    
    logApiOperation('saveSnapshot', docName, true, Date.now() - startTime)
    return createSuccessResponse({ 
      id,
      checksum,
      createdAt: created_at.toISOString(),
      size: snapshotBuffer.length
    })
  } catch (error: any) {
    console.error('Snapshots API error:', error)
    return createErrorResponse(error.message || 'Internal server error', 500)
  }
}

// DELETE: Delete old snapshots (optional cleanup endpoint)
export async function DELETE(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const searchParams = request.nextUrl.searchParams
    const docName = searchParams.get('docName')
    const keepLast = parseInt(searchParams.get('keepLast') || '5') // Keep last N snapshots
    
    if (!docName) {
      return createErrorResponse('Missing required parameter: docName', 400)
    }
    
    if (keepLast < 1) {
      return createErrorResponse('keepLast must be at least 1', 400)
    }
    
    const pool = getPool()
    
    // Find snapshots to delete (keep the most recent ones)
    const deleteQuery = `
      DELETE FROM snapshots
      WHERE doc_name = $1
      AND id NOT IN (
        SELECT id FROM snapshots
        WHERE doc_name = $1
        ORDER BY created_at DESC
        LIMIT $2
      )
    `
    
    const result = await pool.query(deleteQuery, [docName, keepLast])
    
    logApiOperation('cleanupSnapshots', docName, true, Date.now() - startTime)
    return createSuccessResponse({ 
      deletedCount: result.rowCount || 0,
      keptCount: keepLast
    })
  } catch (error: any) {
    console.error('Snapshots API error:', error)
    return createErrorResponse(error.message || 'Internal server error', 500)
  }
}