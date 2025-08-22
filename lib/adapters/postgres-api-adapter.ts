/**
 * PostgreSQL API Adapter
 * 
 * This adapter uses Next.js API routes to communicate with PostgreSQL
 * from the browser. It implements the same PersistenceProvider interface
 * but makes HTTP requests instead of direct database connections.
 */

import { PersistenceProvider } from '../enhanced-yjs-provider'

export class PostgresAPIAdapter implements PersistenceProvider {
  private baseUrl = '/api/persistence'

  async persist(docName: string, update: Uint8Array): Promise<void> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'persist',
        docName,
        update: Array.from(update)
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to persist update')
    }
  }

  async load(docName: string): Promise<Uint8Array | null> {
    const response = await fetch(
      `${this.baseUrl}?method=load&docName=${encodeURIComponent(docName)}`
    )

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to load document')
    }

    const { data } = await response.json()
    return data ? new Uint8Array(data) : null
  }

  async getAllUpdates(docName: string): Promise<Uint8Array[]> {
    const response = await fetch(
      `${this.baseUrl}?method=getAllUpdates&docName=${encodeURIComponent(docName)}`
    )

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to get updates')
    }

    const { updates } = await response.json()
    return updates.map((u: number[]) => new Uint8Array(u))
  }

  async clearUpdates(docName: string): Promise<void> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'clearUpdates',
        docName
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to clear updates')
    }
  }

  async saveSnapshot(docName: string, snapshot: Uint8Array): Promise<void> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'saveSnapshot',
        docName,
        snapshot: Array.from(snapshot)
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to save snapshot')
    }
  }

  async loadSnapshot(docName: string): Promise<Uint8Array | null> {
    const response = await fetch(
      `${this.baseUrl}?method=loadSnapshot&docName=${encodeURIComponent(docName)}`
    )

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to load snapshot')
    }

    const { snapshot } = await response.json()
    return snapshot ? new Uint8Array(snapshot) : null
  }

  async compact(docName: string): Promise<void> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'compact',
        docName
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to compact')
    }
  }
}