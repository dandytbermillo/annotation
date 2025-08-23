/**
 * Persistence API Client
 * 
 * Centralized client for making persistence API requests with
 * typed responses, error handling, and retry logic.
 */

import { 
  uint8ArrayToBase64, 
  base64ToUint8Array,
  generateClientId 
} from './persistence-helpers'

export interface PersistenceResponse<T = any> {
  success?: boolean
  error?: string
  data?: T
}

export interface UpdateInfo {
  update: string
  clientId: string
  timestamp: string
}

export interface SnapshotInfo {
  snapshot: string
  checksum: string
  createdAt: string
  panels?: any[]
  size: number
}

export interface CompactStatus {
  docName: string
  updates: {
    count: number
    totalSize: number
    oldestUpdate: string | null
    newestUpdate: string | null
  }
  snapshots: {
    count: number
    latestSnapshot: string | null
  }
  needsCompaction: boolean
  recommendation: string
}

export class PersistenceClient {
  private baseUrl: string
  private clientId: string
  private maxRetries: number
  private retryDelay: number

  constructor(options: {
    baseUrl?: string
    clientId?: string
    maxRetries?: number
    retryDelay?: number
  } = {}) {
    this.baseUrl = options.baseUrl || '/api/persistence'
    this.clientId = options.clientId || generateClientId()
    this.maxRetries = options.maxRetries || 3
    this.retryDelay = options.retryDelay || 1000
  }

  /**
   * Make a persistence API request with retry logic
   */
  private async request<T = any>(
    endpoint: string,
    options: RequestInit
  ): Promise<T> {
    return this.withRetry(async () => {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ 
          error: `HTTP ${response.status}: ${response.statusText}` 
        }))
        throw new Error(error.error || error.message || 'Request failed')
      }

      return response.json()
    })
  }

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
      if (this.isRetryableError(error) && retries > 0) {
        const delay = this.retryDelay * Math.pow(2, this.maxRetries - retries)
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
    return (
      error.name === 'NetworkError' ||
      error.name === 'TypeError' ||
      error.message?.includes('fetch') ||
      error.message?.includes('network') ||
      error.message?.includes('500') ||
      error.message?.includes('502') ||
      error.message?.includes('503') ||
      error.message?.includes('504')
    )
  }

  /**
   * Persist a YJS update
   */
  async persist(docName: string, update: Uint8Array): Promise<void> {
    await this.request('', {
      method: 'POST',
      body: JSON.stringify({
        action: 'persist',
        docName,
        update: uint8ArrayToBase64(update),
        clientId: this.clientId
      })
    })
  }

  /**
   * Load the latest state of a document
   */
  async load(docName: string): Promise<Uint8Array | null> {
    const response = await this.request<{ update: string | null }>('', {
      method: 'POST',
      body: JSON.stringify({
        action: 'load',
        docName
      })
    })

    return response.update ? base64ToUint8Array(response.update) : null
  }

  /**
   * Get all updates for a document
   */
  async getAllUpdates(docName: string): Promise<UpdateInfo[]> {
    const response = await this.request<{ updates: UpdateInfo[] }>('', {
      method: 'POST',
      body: JSON.stringify({
        action: 'getAllUpdates',
        docName
      })
    })

    return response.updates
  }

  /**
   * Get updates from the specialized endpoint
   */
  async getUpdates(
    docName: string, 
    since?: Date
  ): Promise<{ updates: UpdateInfo[], count: number }> {
    const params = new URLSearchParams({ docName })
    if (since) {
      params.append('since', since.toISOString())
    }

    return this.request(`/updates?${params}`, {
      method: 'GET'
    })
  }

  /**
   * Store a new update via the specialized endpoint
   */
  async storeUpdate(
    docName: string, 
    update: Uint8Array
  ): Promise<{ id: string, timestamp: string, size: number }> {
    return this.request('/updates', {
      method: 'POST',
      body: JSON.stringify({
        docName,
        update: uint8ArrayToBase64(update),
        clientId: this.clientId
      })
    })
  }

  /**
   * Clear all updates for a document
   */
  async clearUpdates(docName: string): Promise<{ deletedCount: number }> {
    const response = await this.request<{ deletedCount: number }>('', {
      method: 'POST',
      body: JSON.stringify({
        action: 'clearUpdates',
        docName
      })
    })

    return response
  }

  /**
   * Save a snapshot
   */
  async saveSnapshot(
    docName: string, 
    snapshot: Uint8Array,
    panels?: any[]
  ): Promise<{ checksum: string }> {
    const response = await this.request<{ checksum: string }>('', {
      method: 'POST',
      body: JSON.stringify({
        action: 'saveSnapshot',
        docName,
        snapshot: uint8ArrayToBase64(snapshot),
        panels
      })
    })

    return response
  }

  /**
   * Load the latest snapshot
   */
  async loadSnapshot(docName: string): Promise<SnapshotInfo | null> {
    const response = await this.request<SnapshotInfo | { snapshot: null }>('', {
      method: 'POST',
      body: JSON.stringify({
        action: 'loadSnapshot',
        docName
      })
    })

    return 'snapshot' in response && response.snapshot ? response : null
  }

  /**
   * Get snapshot via specialized endpoint
   */
  async getSnapshot(
    docName: string,
    checksum?: string
  ): Promise<SnapshotInfo | null> {
    const params = new URLSearchParams({ docName })
    if (checksum) {
      params.append('checksum', checksum)
    }

    return this.request(`/snapshots?${params}`, {
      method: 'GET'
    })
  }

  /**
   * Save snapshot via specialized endpoint
   */
  async createSnapshot(
    docName: string,
    snapshot: Uint8Array,
    panels?: any[]
  ): Promise<{ id: string, checksum: string, createdAt: string, size: number }> {
    return this.request('/snapshots', {
      method: 'POST',
      body: JSON.stringify({
        docName,
        snapshot: uint8ArrayToBase64(snapshot),
        panels
      })
    })
  }

  /**
   * Trigger compaction
   */
  async compact(
    docName: string,
    force = false
  ): Promise<{ 
    message: string, 
    compactedCount?: number, 
    checksum?: string,
    skipped?: boolean 
  }> {
    return this.request('', {
      method: 'POST',
      body: JSON.stringify({
        action: 'compact',
        docName,
        force
      })
    })
  }

  /**
   * Get compaction status
   */
  async getCompactStatus(docName: string): Promise<CompactStatus> {
    return this.request(`/compact?docName=${encodeURIComponent(docName)}`, {
      method: 'GET'
    })
  }

  /**
   * Trigger compaction via specialized endpoint
   */
  async triggerCompact(
    docName: string,
    force = false
  ): Promise<any> {
    return this.request('/compact', {
      method: 'POST',
      body: JSON.stringify({
        docName,
        force
      })
    })
  }

  /**
   * Get the client ID
   */
  getClientId(): string {
    return this.clientId
  }

  /**
   * Set a new client ID
   */
  setClientId(clientId: string): void {
    this.clientId = clientId
  }
}