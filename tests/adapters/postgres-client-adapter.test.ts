/**
 * Test suite for PostgreSQL Client Adapter (Browser-Compatible)
 * 
 * These tests verify that the PostgresClientAdapter correctly implements
 * the PersistenceProvider interface using API routes and handles binary data
 * conversion, retry logic, and error handling properly.
 */

import { PostgresClientAdapter } from '../../lib/adapters/postgres-client-adapter'
import * as Y from 'yjs'

// Mock fetch globally
global.fetch = jest.fn()

// Mock the generateClientId function
jest.mock('../../lib/api/persistence-helpers', () => ({
  generateClientId: jest.fn(() => 'test-client-123')
}))

describe('PostgresClientAdapter', () => {
  let adapter: PostgresClientAdapter
  let mockFetch: jest.MockedFunction<typeof fetch>
  
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks()
    
    // Create adapter instance
    adapter = new PostgresClientAdapter()
    
    // Setup fetch mock
    mockFetch = global.fetch as jest.MockedFunction<typeof fetch>
  })
  
  afterEach(() => {
    jest.clearAllMocks()
  })
  
  describe('persist', () => {
    it('should persist update via API with base64 encoding', async () => {
      // Setup
      const docName = 'test-doc'
      const update = new Uint8Array([1, 2, 3, 4, 5])
      const base64Update = 'AQIDBAU=' // base64 of [1,2,3,4,5]
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      } as Response)
      
      // Execute
      await adapter.persist(docName, update)
      
      // Verify
      expect(mockFetch).toHaveBeenCalledWith('/api/persistence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'persist',
          docName: 'test-doc',
          update: base64Update,
          clientId: 'test-client-123'
        })
      })
    })
    
    it('should retry on network errors', async () => {
      // Setup
      const docName = 'test-doc'
      const update = new Uint8Array([1, 2, 3])
      
      // First call fails with network error
      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      
      // Second call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      } as Response)
      
      // Execute
      await adapter.persist(docName, update)
      
      // Verify
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
    
    it('should throw error after max retries', async () => {
      // Setup
      const docName = 'test-doc'
      const update = new Uint8Array([1, 2, 3])
      
      // All calls fail
      mockFetch.mockRejectedValue(new Error('Network error'))
      
      // Execute & Verify
      await expect(adapter.persist(docName, update))
        .rejects.toThrow('Network error')
      
      // Should try maxRetries + 1 times
      expect(mockFetch).toHaveBeenCalledTimes(4) // 1 initial + 3 retries
    })
  })
  
  describe('load', () => {
    it('should load document and decode base64', async () => {
      // Setup
      const docName = 'test-doc'
      const base64Update = 'AQIDBAU=' // base64 of [1,2,3,4,5]
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ update: base64Update })
      } as Response)
      
      // Execute
      const result = await adapter.load(docName)
      
      // Verify
      expect(mockFetch).toHaveBeenCalledWith('/api/persistence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'load',
          docName: 'test-doc'
        })
      })
      
      expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    })
    
    it('should return null for non-existent document', async () => {
      // Setup
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ update: null })
      } as Response)
      
      // Execute
      const result = await adapter.load('non-existent')
      
      // Verify
      expect(result).toBeNull()
    })
    
    it('should return null on 404 response', async () => {
      // Setup
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' })
      } as Response)
      
      // Execute
      const result = await adapter.load('non-existent')
      
      // Verify
      expect(result).toBeNull()
    })
  })
  
  describe('getAllUpdates', () => {
    it('should retrieve and decode all updates', async () => {
      // Setup
      const docName = 'test-doc'
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          updates: [
            { update: 'AQI=', clientId: 'client-1', timestamp: '2024-01-01' },
            { update: 'AwQ=', clientId: 'client-2', timestamp: '2024-01-02' }
          ]
        })
      } as Response)
      
      // Execute
      const updates = await adapter.getAllUpdates(docName)
      
      // Verify
      expect(updates).toHaveLength(2)
      expect(updates[0]).toEqual(new Uint8Array([1, 2]))
      expect(updates[1]).toEqual(new Uint8Array([3, 4]))
    })
    
    it('should handle legacy array format', async () => {
      // Setup
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          updates: ['AQI=', 'AwQ='] // Simple string array
        })
      } as Response)
      
      // Execute
      const updates = await adapter.getAllUpdates('test-doc')
      
      // Verify
      expect(updates).toHaveLength(2)
      expect(updates[0]).toEqual(new Uint8Array([1, 2]))
      expect(updates[1]).toEqual(new Uint8Array([3, 4]))
    })
  })
  
  describe('saveSnapshot', () => {
    it('should save snapshot with base64 encoding', async () => {
      // Setup
      const docName = 'test-doc'
      const snapshot = new Uint8Array([10, 20, 30])
      const base64Snapshot = 'ChQe' // base64 of [10,20,30]
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ checksum: 'abc123' })
      } as Response)
      
      // Execute
      await adapter.saveSnapshot(docName, snapshot)
      
      // Verify
      expect(mockFetch).toHaveBeenCalledWith('/api/persistence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveSnapshot',
          docName: 'test-doc',
          snapshot: base64Snapshot
        })
      })
    })
  })
  
  describe('loadSnapshot', () => {
    it('should load and decode snapshot', async () => {
      // Setup
      const base64Snapshot = 'ChQe' // base64 of [10,20,30]
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          snapshot: base64Snapshot,
          checksum: 'abc123'
        })
      } as Response)
      
      // Execute
      const snapshot = await adapter.loadSnapshot('test-doc')
      
      // Verify
      expect(snapshot).toEqual(new Uint8Array([10, 20, 30]))
    })
  })
  
  describe('compact', () => {
    it('should trigger compaction via API', async () => {
      // Setup
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: 'Compaction successful',
          compactedCount: 42
        })
      } as Response)
      
      // Execute
      await adapter.compact('test-doc')
      
      // Verify
      expect(mockFetch).toHaveBeenCalledWith('/api/persistence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'compact',
          docName: 'test-doc'
        })
      })
    })
  })
  
  describe('error handling', () => {
    it('should handle API error responses', async () => {
      // Setup
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Database connection failed' })
      } as Response)
      
      // Execute & Verify
      await expect(adapter.persist('test-doc', new Uint8Array([1])))
        .rejects.toThrow('Database connection failed')
    })
    
    it('should handle malformed API responses', async () => {
      // Setup
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => { throw new Error('Invalid JSON') }
      } as Response)
      
      // Execute & Verify
      await expect(adapter.persist('test-doc', new Uint8Array([1])))
        .rejects.toThrow('Failed to persist update: Internal Server Error')
    })
  })
  
  describe('client ID', () => {
    it('should generate and use consistent client ID', () => {
      const clientId = adapter.getClientId()
      expect(clientId).toBe('test-client-123')
    })
  })
  
  describe('binary data conversion', () => {
    it('should correctly convert various binary data sizes', async () => {
      // Test empty array
      const empty = new Uint8Array([])
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      } as Response)
      
      await adapter.persist('test', empty)
      
      // Test large array
      const large = new Uint8Array(1000).fill(255)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      } as Response)
      
      await adapter.persist('test', large)
      
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })
  
  describe('retry logic', () => {
    beforeEach(() => {
      // Speed up tests by reducing retry delay
      jest.useFakeTimers()
    })
    
    afterEach(() => {
      jest.useRealTimers()
    })
    
    it('should use exponential backoff for retries', async () => {
      // Setup
      let callCount = 0
      mockFetch.mockImplementation(async () => {
        callCount++
        if (callCount < 3) {
          throw new Error('Network error')
        }
        return {
          ok: true,
          json: async () => ({ success: true })
        } as Response
      })
      
      // Execute
      const promise = adapter.persist('test', new Uint8Array([1]))
      
      // First retry after 1000ms
      await jest.advanceTimersByTimeAsync(1000)
      
      // Second retry after 2000ms (exponential backoff)
      await jest.advanceTimersByTimeAsync(2000)
      
      await promise
      
      // Verify
      expect(callCount).toBe(3)
    })
  })
})