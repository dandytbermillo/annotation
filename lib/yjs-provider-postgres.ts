// PostgreSQL-enabled YJS Provider
// This extends the standard YJS provider to add PostgreSQL persistence

import { CollaborationProvider } from './yjs-provider'
import { PostgresAPIAdapter } from './adapters/postgres-api-adapter'
import * as Y from 'yjs'

// Extend the standard provider to add PostgreSQL persistence
export class PostgresCollaborationProvider extends CollaborationProvider {
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

    const provider = this.getProvider()
    const doc = provider.doc

    // Save updates to PostgreSQL
    doc.on('update', async (update: Uint8Array, origin: any) => {
      if (origin !== 'postgres-load' && this.currentNoteId) {
        try {
          await this.postgresAdapter!.persist(`note:${this.currentNoteId}`, update)
          console.log('💾 Saved update to PostgreSQL')
        } catch (error) {
          console.error('Failed to persist to PostgreSQL:', error)
        }
      }
    })

    // Load existing data when note changes
    this.loadFromPostgres()
  }

  async loadFromPostgres() {
    if (!this.postgresAdapter || !this.currentNoteId) return

    try {
      const updates = await this.postgresAdapter.getAllUpdates(`note:${this.currentNoteId}`)
      const provider = this.getProvider()
      
      if (updates.length > 0) {
        console.log(`📥 Loading ${updates.length} updates from PostgreSQL`)
        Y.transact(provider.doc, () => {
          updates.forEach(update => {
            Y.applyUpdate(provider.doc, update, 'postgres-load')
          })
        })
      }
    } catch (error) {
      console.error('Failed to load from PostgreSQL:', error)
    }
  }

  // Override setCurrentNote to trigger PostgreSQL load
  setCurrentNote(noteId: string) {
    super.setCurrentNote(noteId)
    if (this.persistenceEnabled) {
      this.loadFromPostgres()
    }
  }

  // Add method to check if PostgreSQL is enabled
  isPostgresEnabled(): boolean {
    return this.persistenceEnabled
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