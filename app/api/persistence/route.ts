import { NextRequest, NextResponse } from 'next/server'
import { PostgresPersistenceAdapter } from '@/lib/adapters/postgres-adapter'

// Create a single adapter instance
let adapter: PostgresPersistenceAdapter | null = null

function getAdapter() {
  if (!adapter) {
    try {
      adapter = new PostgresPersistenceAdapter()
      console.log('PostgreSQL adapter initialized for API routes')
    } catch (error) {
      console.error('Failed to initialize PostgreSQL adapter:', error)
      throw error
    }
  }
  return adapter
}

// Handle persistence operations
export async function POST(req: NextRequest) {
  try {
    const { method, docName, update, snapshot } = await req.json()
    const pgAdapter = getAdapter()

    switch (method) {
      case 'persist':
        await pgAdapter.persist(docName, new Uint8Array(update))
        return NextResponse.json({ success: true })

      case 'clearUpdates':
        await pgAdapter.clearUpdates(docName)
        return NextResponse.json({ success: true })

      case 'saveSnapshot':
        await pgAdapter.saveSnapshot(docName, new Uint8Array(snapshot))
        return NextResponse.json({ success: true })

      case 'compact':
        await pgAdapter.compact(docName)
        return NextResponse.json({ success: true })

      default:
        return NextResponse.json(
          { error: 'Invalid method' },
          { status: 400 }
        )
    }
  } catch (error: any) {
    console.error('Persistence API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// Handle data retrieval operations
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams
    const method = searchParams.get('method')
    const docName = searchParams.get('docName')

    if (!method || !docName) {
      return NextResponse.json(
        { error: 'Missing method or docName parameter' },
        { status: 400 }
      )
    }

    const pgAdapter = getAdapter()

    switch (method) {
      case 'load':
        const data = await pgAdapter.load(docName)
        return NextResponse.json({ 
          data: data ? Array.from(data) : null 
        })

      case 'getAllUpdates':
        const updates = await pgAdapter.getAllUpdates(docName)
        return NextResponse.json({ 
          updates: updates.map(u => Array.from(u)) 
        })

      case 'loadSnapshot':
        const snapshot = await pgAdapter.loadSnapshot(docName)
        return NextResponse.json({ 
          snapshot: snapshot ? Array.from(snapshot) : null 
        })

      default:
        return NextResponse.json(
          { error: 'Invalid method' },
          { status: 400 }
        )
    }
  } catch (error: any) {
    console.error('Persistence API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}