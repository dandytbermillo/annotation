import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db/postgres-pool'
import { 
  base64ToUint8Array, 
  uint8ArrayToBase64,
  createErrorResponse,
  createSuccessResponse,
  validateRequiredParams,
  parseAction,
  bufferToUint8Array,
  formatUpdateForTransport,
  parseUpdateFromRequest,
  logApiOperation
} from '@/lib/api/persistence-helpers'

// Handle persistence operations with action-based routing
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const body = await request.json()
    const { action, params } = parseAction(body)
    
    if (!action) {
      return createErrorResponse('Missing or invalid action parameter', 400)
    }
    
    // Route to appropriate handler based on action
    switch (action) {
      case 'persist':
        return await handlePersist(params, startTime)
      case 'load':
        return await handleLoad(params, startTime)
      case 'getAllUpdates':
        return await handleGetAllUpdates(params, startTime)
      case 'clearUpdates':
        return await handleClearUpdates(params, startTime)
      case 'saveSnapshot':
        return await handleSaveSnapshot(params, startTime)
      case 'loadSnapshot':
        return await handleLoadSnapshot(params, startTime)
      case 'compact':
        return await handleCompact(params, startTime)
      default:
        return createErrorResponse(`Unknown action: ${action}`, 400)
    }
  } catch (error: any) {
    console.error('Persistence API error:', error)
    return createErrorResponse(error.message || 'Internal server error', 500)
  }
}

// Handle data retrieval operations (legacy support)
export async function GET(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const searchParams = request.nextUrl.searchParams
    const action = searchParams.get('action') || searchParams.get('method') // Support both for backward compatibility
    const docName = searchParams.get('docName')

    if (!action || !docName) {
      return createErrorResponse('Missing action or docName parameter', 400)
    }

    const params = { docName }

    // Route to appropriate handler based on action
    switch (action) {
      case 'load':
        return await handleLoad(params, startTime)
      case 'getAllUpdates':
        return await handleGetAllUpdates(params, startTime)
      case 'loadSnapshot':
        return await handleLoadSnapshot(params, startTime)
      default:
        return createErrorResponse(`Unknown action: ${action}`, 400)
    }
  } catch (error: any) {
    console.error('Persistence API error:', error)
    return createErrorResponse(error.message || 'Internal server error', 500)
  }
}

// Handler functions

async function handlePersist(params: any, startTime: number): Promise<NextResponse> {
  const { docName, update, clientId } = params
  
  const validation = validateRequiredParams(params, ['docName', 'update'])
  if (!validation.valid) {
    return createErrorResponse(`Missing required parameters: ${validation.missing?.join(', ')}`, 400)
  }
  
  const updateData = parseUpdateFromRequest(update)
  if (!updateData) {
    return createErrorResponse('Invalid update data format', 400)
  }
  
  const pool = getPool()
  const updateBuffer = Buffer.from(updateData)
  
  const query = `
    INSERT INTO yjs_updates (doc_name, update, client_id, timestamp)
    VALUES ($1, $2, $3, NOW())
  `
  
  try {
    await pool.query(query, [docName, updateBuffer, clientId || 'api-client'])
    logApiOperation('persist', docName, true, Date.now() - startTime)
    return createSuccessResponse()
  } catch (error: any) {
    logApiOperation('persist', docName, false, Date.now() - startTime, error)
    throw error
  }
}

async function handleLoad(params: any, startTime: number): Promise<NextResponse> {
  const { docName } = params
  
  if (!docName) {
    return createErrorResponse('Missing required parameter: docName', 400)
  }
  
  const pool = getPool()
  
  // First try to load the latest snapshot
  const snapshotQuery = `
    SELECT state FROM snapshots 
    WHERE doc_name = $1 
    ORDER BY created_at DESC 
    LIMIT 1
  `
  
  try {
    const snapshotResult = await pool.query(snapshotQuery, [docName])
    
    if (snapshotResult.rows.length > 0) {
      const state = snapshotResult.rows[0].state
      logApiOperation('load', docName, true, Date.now() - startTime)
      return createSuccessResponse({ 
        update: formatUpdateForTransport(state)
      })
    }
    
    // If no snapshot, merge all updates
    const updatesQuery = `
      SELECT update FROM yjs_updates 
      WHERE doc_name = $1 
      ORDER BY timestamp ASC
    `
    
    const updatesResult = await pool.query(updatesQuery, [docName])
    
    if (updatesResult.rows.length === 0) {
      logApiOperation('load', docName, true, Date.now() - startTime)
      return createSuccessResponse({ update: null })
    }
    
    // Import Y here to merge updates (server-side only)
    const Y = await import('yjs')
    const doc = new Y.Doc()
    
    for (const row of updatesResult.rows) {
      Y.applyUpdate(doc, bufferToUint8Array(row.update))
    }
    
    const mergedUpdate = Y.encodeStateAsUpdate(doc)
    logApiOperation('load', docName, true, Date.now() - startTime)
    
    return createSuccessResponse({ 
      update: formatUpdateForTransport(mergedUpdate)
    })
  } catch (error: any) {
    logApiOperation('load', docName, false, Date.now() - startTime, error)
    throw error
  }
}

async function handleGetAllUpdates(params: any, startTime: number): Promise<NextResponse> {
  const { docName } = params
  
  if (!docName) {
    return createErrorResponse('Missing required parameter: docName', 400)
  }
  
  const pool = getPool()
  const query = `
    SELECT update, client_id, timestamp 
    FROM yjs_updates 
    WHERE doc_name = $1 
    ORDER BY timestamp ASC
  `
  
  try {
    const result = await pool.query(query, [docName])
    const updates = result.rows.map(row => ({
      update: formatUpdateForTransport(row.update),
      clientId: row.client_id,
      timestamp: row.timestamp
    }))
    
    logApiOperation('getAllUpdates', docName, true, Date.now() - startTime)
    return createSuccessResponse({ updates })
  } catch (error: any) {
    logApiOperation('getAllUpdates', docName, false, Date.now() - startTime, error)
    throw error
  }
}

async function handleClearUpdates(params: any, startTime: number): Promise<NextResponse> {
  const { docName } = params
  
  if (!docName) {
    return createErrorResponse('Missing required parameter: docName', 400)
  }
  
  const pool = getPool()
  const query = `DELETE FROM yjs_updates WHERE doc_name = $1`
  
  try {
    const result = await pool.query(query, [docName])
    logApiOperation('clearUpdates', docName, true, Date.now() - startTime)
    return createSuccessResponse({ 
      deletedCount: result.rowCount || 0 
    })
  } catch (error: any) {
    logApiOperation('clearUpdates', docName, false, Date.now() - startTime, error)
    throw error
  }
}

async function handleSaveSnapshot(params: any, startTime: number): Promise<NextResponse> {
  const { docName, snapshot } = params
  
  const validation = validateRequiredParams(params, ['docName', 'snapshot'])
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
  const crypto = await import('crypto')
  const checksum = crypto
    .createHash('sha256')
    .update(snapshotBuffer)
    .digest('hex')
  
  const query = `
    INSERT INTO snapshots (doc_name, state, checksum, created_at)
    VALUES ($1, $2, $3, NOW())
  `
  
  try {
    await pool.query(query, [docName, snapshotBuffer, checksum])
    logApiOperation('saveSnapshot', docName, true, Date.now() - startTime)
    return createSuccessResponse({ checksum })
  } catch (error: any) {
    logApiOperation('saveSnapshot', docName, false, Date.now() - startTime, error)
    throw error
  }
}

async function handleLoadSnapshot(params: any, startTime: number): Promise<NextResponse> {
  const { docName } = params
  
  if (!docName) {
    return createErrorResponse('Missing required parameter: docName', 400)
  }
  
  const pool = getPool()
  const query = `
    SELECT state, checksum, created_at 
    FROM snapshots 
    WHERE doc_name = $1 
    ORDER BY created_at DESC 
    LIMIT 1
  `
  
  try {
    const result = await pool.query(query, [docName])
    
    if (result.rows.length === 0) {
      logApiOperation('loadSnapshot', docName, true, Date.now() - startTime)
      return createSuccessResponse({ snapshot: null })
    }
    
    const { state, checksum, created_at } = result.rows[0]
    logApiOperation('loadSnapshot', docName, true, Date.now() - startTime)
    
    return createSuccessResponse({ 
      snapshot: formatUpdateForTransport(state),
      checksum,
      createdAt: created_at
    })
  } catch (error: any) {
    logApiOperation('loadSnapshot', docName, false, Date.now() - startTime, error)
    throw error
  }
}

async function handleCompact(params: any, startTime: number): Promise<NextResponse> {
  const { docName } = params
  
  if (!docName) {
    return createErrorResponse('Missing required parameter: docName', 400)
  }
  
  const pool = getPool()
  
  try {
    // Start a transaction for atomicity
    const client = await pool.connect()
    
    try {
      await client.query('BEGIN')
      
      // Get all updates
      const updatesResult = await client.query(
        'SELECT update FROM yjs_updates WHERE doc_name = $1 ORDER BY timestamp ASC',
        [docName]
      )
      
      if (updatesResult.rows.length === 0) {
        await client.query('COMMIT')
        logApiOperation('compact', docName, true, Date.now() - startTime)
        return createSuccessResponse({ 
          message: 'No updates to compact',
          compactedCount: 0 
        })
      }
      
      // Merge all updates into a single state
      const Y = await import('yjs')
      const doc = new Y.Doc()
      
      for (const row of updatesResult.rows) {
        Y.applyUpdate(doc, bufferToUint8Array(row.update))
      }
      
      const compactedState = Y.encodeStateAsUpdate(doc)
      const stateBuffer = Buffer.from(compactedState)
      
      // Calculate checksum
      const crypto = await import('crypto')
      const checksum = crypto
        .createHash('sha256')
        .update(stateBuffer)
        .digest('hex')
      
      // Save as snapshot
      await client.query(
        'INSERT INTO snapshots (doc_name, state, checksum, created_at) VALUES ($1, $2, $3, NOW())',
        [docName, stateBuffer, checksum]
      )
      
      // Delete old updates
      await client.query(
        'DELETE FROM yjs_updates WHERE doc_name = $1',
        [docName]
      )
      
      await client.query('COMMIT')
      client.release()
      
      logApiOperation('compact', docName, true, Date.now() - startTime)
      return createSuccessResponse({ 
        message: 'Compaction successful',
        compactedCount: updatesResult.rows.length,
        checksum
      })
    } catch (error) {
      await client.query('ROLLBACK')
      client.release()
      throw error
    }
  } catch (error: any) {
    logApiOperation('compact', docName, false, Date.now() - startTime, error)
    throw error
  }
}