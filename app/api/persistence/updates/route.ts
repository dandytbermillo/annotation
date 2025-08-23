/**
 * YJS Updates API Route
 * 
 * Specialized endpoint for managing YJS updates
 * GET: Retrieve all updates for a document
 * POST: Store a new update with client_id
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db/postgres-pool'
import { 
  base64ToUint8Array,
  createErrorResponse,
  createSuccessResponse,
  validateRequiredParams,
  formatUpdateForTransport,
  parseUpdateFromRequest,
  logApiOperation
} from '@/lib/api/persistence-helpers'

// GET: Retrieve all updates for a document
export async function GET(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const searchParams = request.nextUrl.searchParams
    const docName = searchParams.get('docName')
    const since = searchParams.get('since') // Optional: timestamp to get updates since
    
    if (!docName) {
      return createErrorResponse('Missing required parameter: docName', 400)
    }
    
    const pool = getPool()
    let query = `
      SELECT update, client_id, timestamp 
      FROM yjs_updates 
      WHERE doc_name = $1
    `
    const params: any[] = [docName]
    
    if (since) {
      query += ` AND timestamp > $2`
      params.push(new Date(since))
    }
    
    query += ` ORDER BY timestamp ASC`
    
    const result = await pool.query(query, params)
    const updates = result.rows.map(row => ({
      update: formatUpdateForTransport(row.update),
      clientId: row.client_id,
      timestamp: row.timestamp.toISOString()
    }))
    
    logApiOperation('getUpdates', docName, true, Date.now() - startTime)
    return createSuccessResponse({ 
      docName,
      updates,
      count: updates.length
    })
  } catch (error: any) {
    console.error('Updates API error:', error)
    return createErrorResponse(error.message || 'Internal server error', 500)
  }
}

// POST: Store new update with client_id
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const body = await request.json()
    const { docName, update, clientId } = body
    
    const validation = validateRequiredParams(body, ['docName', 'update'])
    if (!validation.valid) {
      return createErrorResponse(`Missing required parameters: ${validation.missing?.join(', ')}`, 400)
    }
    
    const updateData = parseUpdateFromRequest(update)
    if (!updateData) {
      return createErrorResponse('Invalid update data format', 400)
    }
    
    const pool = getPool()
    const updateBuffer = Buffer.from(updateData)
    
    // Store the update
    const query = `
      INSERT INTO yjs_updates (doc_name, update, client_id, timestamp)
      VALUES ($1, $2, $3, NOW())
      RETURNING id, timestamp
    `
    
    const result = await pool.query(query, [
      docName, 
      updateBuffer, 
      clientId || 'api-client'
    ])
    
    const { id, timestamp } = result.rows[0]
    
    logApiOperation('storeUpdate', docName, true, Date.now() - startTime)
    return createSuccessResponse({ 
      id,
      timestamp: timestamp.toISOString(),
      size: updateBuffer.length
    })
  } catch (error: any) {
    console.error('Updates API error:', error)
    return createErrorResponse(error.message || 'Internal server error', 500)
  }
}

// DELETE: Clear updates for a document (optional)
export async function DELETE(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const searchParams = request.nextUrl.searchParams
    const docName = searchParams.get('docName')
    const before = searchParams.get('before') // Optional: clear updates before timestamp
    
    if (!docName) {
      return createErrorResponse('Missing required parameter: docName', 400)
    }
    
    const pool = getPool()
    let query = `DELETE FROM yjs_updates WHERE doc_name = $1`
    const params: any[] = [docName]
    
    if (before) {
      query += ` AND timestamp < $2`
      params.push(new Date(before))
    }
    
    const result = await pool.query(query, params)
    
    logApiOperation('deleteUpdates', docName, true, Date.now() - startTime)
    return createSuccessResponse({ 
      deletedCount: result.rowCount || 0
    })
  } catch (error: any) {
    console.error('Updates API error:', error)
    return createErrorResponse(error.message || 'Internal server error', 500)
  }
}