import { NextRequest, NextResponse } from 'next/server'
import { PostgresPersistenceAdapter } from '@/lib/adapters/postgres-adapter'

/**
 * DELETE /api/notes/[noteId]
 * Soft delete a note and all its associated data
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> }
) {
  const { noteId } = await params
  
  console.log('[DELETE /api/notes/:noteId] Request received', {
    noteId: noteId,
    timestamp: new Date().toISOString()
  })

  // Validate noteId
  if (!noteId || noteId.length < 1) {
    return NextResponse.json(
      { error: 'Invalid note ID' },
      { status: 400 }
    )
  }

  try {
    // Check for hard delete option
    const { searchParams } = new URL(request.url)
    const hardDelete = searchParams.get('hard') === 'true'
    
    // Initialize adapter
    const adapter = new PostgresPersistenceAdapter()
    
    // Perform deletion
    if (hardDelete) {
      // Hard delete requires additional confirmation
      const confirmHeader = request.headers.get('X-Confirm-Delete')
      if (confirmHeader !== 'PERMANENTLY-DELETE') {
        return NextResponse.json(
          { 
            error: 'Hard delete requires confirmation', 
            hint: 'Set X-Confirm-Delete header to PERMANENTLY-DELETE' 
          },
          { status: 400 }
        )
      }
      
      await adapter.hardDeleteNote(noteId)
      
      return NextResponse.json({ 
        success: true,
        message: `Note ${noteId} permanently deleted`,
        type: 'hard'
      })
    } else {
      // Soft delete (default)
      await adapter.deleteNote(noteId)
      
      return NextResponse.json({ 
        success: true,
        message: `Note ${noteId} deleted`,
        type: 'soft'
      })
    }
  } catch (error) {
    console.error('[DELETE /api/notes/:noteId] Error:', error)
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    // Check if it's a specific error type
    if (errorMessage.includes('Failed to delete note')) {
      return NextResponse.json(
        { error: errorMessage },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    )
  }
}

/**
 * GET /api/notes/[noteId]
 * Check if a note exists and its deletion status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ noteId: string }> }
) {
  const { noteId } = await params
  
  console.log('[GET /api/notes/:noteId] Request received', {
    noteId: noteId,
    timestamp: new Date().toISOString()
  })

  try {
    const adapter = new PostgresPersistenceAdapter()
    
    // Query note status
    const result = await adapter.query(
      `SELECT id, title, deleted_at, created_at, updated_at 
       FROM notes 
       WHERE id = $1`,
      [noteId]
    )
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Note not found' },
        { status: 404 }
      )
    }
    
    const note = result.rows[0]
    
    return NextResponse.json({
      id: note.id,
      title: note.title,
      exists: true,
      deleted: note.deleted_at !== null,
      deletedAt: note.deleted_at,
      createdAt: note.created_at,
      updatedAt: note.updated_at
    })
    
  } catch (error) {
    console.error('[GET /api/notes/:noteId] Error:', error)
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    )
  }
}