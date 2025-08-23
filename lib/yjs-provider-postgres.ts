// PostgreSQL-enabled YJS Provider
// This extends the standard YJS provider to add PostgreSQL persistence

import { CollaborationProvider } from './yjs-provider'
import { PostgresAPIAdapter } from './adapters/postgres-api-adapter'
import * as Y from 'yjs'

// Extend the standard provider to add PostgreSQL persistence
export class PostgresCollaborationProvider extends CollaborationProvider {
  private static _instance: PostgresCollaborationProvider | null = null
  private postgresAdapter: PostgresAPIAdapter | null = null
  private persistenceEnabled: boolean = false

  constructor() {
    super()
    
    // Check if PostgreSQL is enabled
    if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_POSTGRES_ENABLED === 'true') {
      console.log('📦 Initializing PostgreSQL persistence for YJS')
      this.postgresAdapter = new PostgresAPIAdapter()
      this.persistenceEnabled = true
      this.setupPersistence()
    }
  }

  private setupPersistence() {
    if (!this.postgresAdapter) return

    // We'll set up persistence for each note doc when it's created
    console.log('📦 PostgreSQL persistence adapter ready')
  }

  async loadFromPostgres() {
    if (!this.postgresAdapter || !this.postgresNoteId) return

    try {
      const updates = await this.postgresAdapter.getAllUpdates(`note:${this.postgresNoteId}`)
      
      if (updates.length > 0) {
        console.log(`📥 Loading ${updates.length} updates from PostgreSQL for note: ${this.postgresNoteId}`)
        
        // Get the Y.Doc through the branches map
        const branchesMap = this.getBranchesMap()
        if (branchesMap && branchesMap.doc) {
          const doc = branchesMap.doc
          Y.transact(doc, () => {
            updates.forEach(update => {
              Y.applyUpdate(doc, update, 'postgres-load')
            })
          })
        }
      }
    } catch (error) {
      console.error('Failed to load from PostgreSQL:', error)
    }
  }

  // Keep track of current note ID
  private postgresNoteId: string | null = null

  // Override setCurrentNote to set up PostgreSQL persistence
  setCurrentNote(noteId: string) {
    super.setCurrentNote(noteId)
    this.postgresNoteId = noteId
    
    if (this.persistenceEnabled) {
      // Small delay to ensure doc is initialized
      setTimeout(() => {
        this.setupPostgresPersistenceForNote(noteId)
        this.loadFromPostgres()
      }, 100)
    }
  }
  
  private setupPostgresPersistenceForNote(noteId: string) {
    if (!this.postgresAdapter) return
    
    // Access the Y.Doc through the branches map which is exposed
    const branchesMap = this.getBranchesMap()
    if (!branchesMap) return
    
    // The branches map is part of a Y.Doc, so we can get the doc from it
    const doc = branchesMap.doc
    if (!doc) return
    
    // Check if we already added the update handler
    const handlerKey = `postgres-handler-${noteId}`
    if (!(doc as any)[handlerKey]) {
      (doc as any)[handlerKey] = true
      
      // Save updates to PostgreSQL
      doc.on('update', async (update: Uint8Array, origin: any) => {
        if (origin !== 'postgres-load' && this.postgresNoteId === noteId) {
          try {
            await this.postgresAdapter!.persist(`note:${noteId}`, update)
            console.log('💾 Saved update to PostgreSQL for note:', noteId)
          } catch (error) {
            console.error('Failed to persist to PostgreSQL:', error)
          }
        }
      })
    }
  }

  // Add method to check if PostgreSQL is enabled
  isPostgresEnabled(): boolean {
    return this.persistenceEnabled
  }

  // Override initializeDefaultData to set up persistence
  public initializeDefaultData(noteId: string, data: Record<string, any>): void {
    this.postgresNoteId = noteId
    super.initializeDefaultData(noteId, data)
    
    // Setup persistence after data is initialized
    if (this.persistenceEnabled) {
      // Small delay to ensure doc is fully initialized
      setTimeout(() => {
        this.setupPostgresPersistenceForNote(noteId)
        this.loadFromPostgres()
      }, 100)
    }
  }

  // Add missing getInstance static method for provider-switcher compatibility
  public static getInstance(): PostgresCollaborationProvider {
    if (!PostgresCollaborationProvider._instance) {
      PostgresCollaborationProvider._instance = new PostgresCollaborationProvider()
    }
    return PostgresCollaborationProvider._instance
  }
}

// Singleton instance
let instance: PostgresCollaborationProvider | null = null

export function getPostgresProvider(): PostgresCollaborationProvider {
  if (!instance) {
    instance = new PostgresCollaborationProvider()
  }
  return instance
}

