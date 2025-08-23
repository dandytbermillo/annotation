/**
 * PostgreSQL API Adapter
 * 
 * This adapter uses Next.js API routes to communicate with PostgreSQL
 * from the browser. It implements the same PersistenceProvider interface
 * but makes HTTP requests instead of direct database connections.
 * 
 * Features:
 * - Action-based routing for API calls
 * - Retry logic with exponential backoff
 * - Base64 encoding for binary data
 * - Client ID generation and tracking
 * - Comprehensive error handling
 */

import { PersistenceProvider } from '../enhanced-yjs-provider'
import { generateClientId } from '../api/persistence-helpers'

export class PostgresAPIAdapter implements PersistenceProvider {
  private baseUrl = '/api/persistence'
  private maxRetries = 3
  private retryDelay = 1000 // Initial delay in ms
  private clientId: string

  constructor() {
    // Generate a unique client ID for this session
    this.clientId = generateClientId()
  }

  async persist(docName: string, update: Uint8Array): Promise<void> {
    return this.withRetry(async () => {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'persist',
          docName,
          update: this.uint8ArrayToBase64(update),
          clientId: this.clientId
        })
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(error.error || `Failed to persist update: ${response.statusText}`)
      }
    })
  }

  async load(docName: string): Promise<Uint8Array | null> {
    return this.withRetry(async () => {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'load',
          docName
        })
      })

      if (!response.ok) {
        if (response.status === 404) return null
        const error = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(error.error || `Failed to load document: ${response.statusText}`)
      }

      const data = await response.json()
      if (!data.update) return null
      
      return this.base64ToUint8Array(data.update)
    })
  }

  async getAllUpdates(docName: string): Promise<Uint8Array[]> {
    return this.withRetry(async () => {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getAllUpdates',
          docName
        })
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(error.error || `Failed to get updates: ${response.statusText}`)
      }

      const data = await response.json()
      return data.updates.map((item: any) => 
        typeof item === 'string' 
          ? this.base64ToUint8Array(item)
          : this.base64ToUint8Array(item.update)
      )
    })
  }

  async clearUpdates(docName: string): Promise<void> {
    return this.withRetry(async () => {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'clearUpdates',
          docName
        })
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(error.error || `Failed to clear updates: ${response.statusText}`)
      }
    })
  }

  async saveSnapshot(docName: string, snapshot: Uint8Array): Promise<void> {
    return this.withRetry(async () => {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveSnapshot',
          docName,
          snapshot: this.uint8ArrayToBase64(snapshot)
        })
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(error.error || `Failed to save snapshot: ${response.statusText}`)
      }
    })
  }

  async loadSnapshot(docName: string): Promise<Uint8Array | null> {
    return this.withRetry(async () => {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'loadSnapshot',
          docName
        })
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(error.error || `Failed to load snapshot: ${response.statusText}`)
      }

      const data = await response.json()
      if (!data.snapshot) return null
      
      return this.base64ToUint8Array(data.snapshot)
    })
  }

  async compact(docName: string): Promise<void> {
    return this.withRetry(async () => {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'compact',
          docName
        })
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(error.error || `Failed to compact: ${response.statusText}`)
      }
    })
  }

  // Helper methods

  /**
   * Retry logic with exponential backoff
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    retries = this.maxRetries
  ): Promise<T> {
    try {
      return await operation()
    } catch (error: any) {
      // Check if error is retryable
      const isRetryable = this.isRetryableError(error)
      
      if (isRetryable && retries > 0) {
        const delay = this.retryDelay * Math.pow(2, this.maxRetries - retries)
        console.warn(
          `PostgreSQL API operation failed, retrying in ${delay}ms... (${retries} attempts left)`,
          error.message
        )
        await new Promise(resolve => setTimeout(resolve, delay))
        return this.withRetry(operation, retries - 1)
      }
      
      throw error
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    // Network errors
    if (error.name === 'NetworkError' || error.name === 'TypeError') {
      return true
    }
    
    // Fetch errors
    if (error.message?.includes('fetch')) {
      return true
    }
    
    // Server errors that might be transient
    if (error.message?.includes('500') || error.message?.includes('502') || 
        error.message?.includes('503') || error.message?.includes('504')) {
      return true
    }
    
    return false
  }

  /**
   * Convert Uint8Array to base64 string
   */
  private uint8ArrayToBase64(uint8Array: Uint8Array): string {
    let binary = ''
    const len = uint8Array.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8Array[i])
    }
    return btoa(binary)
  }

  /**
   * Convert base64 string to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64)
    const len = binaryString.length
    const uint8Array = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      uint8Array[i] = binaryString.charCodeAt(i)
    }
    return uint8Array
  }

  /**
   * Get the client ID for this session
   */
  getClientId(): string {
    return this.clientId
  }
}