/**
 * Test suite for Persistence API Routes
 * 
 * These tests verify that the API routes correctly handle
 * persistence operations with proper data conversion and error handling.
 */

import { NextRequest } from 'next/server'
import { POST, GET } from '../../app/api/persistence/route'
import * as Y from 'yjs'

// Mock the database pool
jest.mock('../../lib/db/postgres-pool', () => ({
  getPool: jest.fn(() => mockPool),
  query: jest.fn(),
  transaction: jest.fn()
}))

// Mock crypto for consistent checksums
jest.mock('crypto', () => ({
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn(() => 'mock-checksum-123')
  }))
}))

// Create mock pool
const mockPool = {
  query: jest.fn(),
  connect: jest.fn(() => ({
    query: jest.fn(),
    release: jest.fn()
  }))
}

describe('Persistence API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Reset environment
    process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test'
  })
  
  describe('POST /api/persistence', () => {
    describe('persist action', () => {
      it('should persist update with base64 encoding', async () => {
        // Setup
        const updateData = new Uint8Array([1, 2, 3, 4, 5])
        const base64Update = 'AQIDBAU=' // base64 of [1,2,3,4,5]
        
        mockPool.query.mockResolvedValueOnce({ rows: [] })
        
        const request = new NextRequest('http://localhost:3000/api/persistence', {
          method: 'POST',
          body: JSON.stringify({
            action: 'persist',
            docName: 'test-doc',
            update: base64Update,
            clientId: 'test-client'
          })
        })
        
        // Execute
        const response = await POST(request)
        const data = await response.json()
        
        // Verify
        expect(response.status).toBe(200)
        expect(data.success).toBe(true)
        
        expect(mockPool.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO yjs_updates'),
          ['test-doc', expect.any(Buffer), 'test-client']
        )
        
        // Verify buffer content
        const bufferArg = mockPool.query.mock.calls[0][1][1]
        expect(Array.from(bufferArg)).toEqual([1, 2, 3, 4, 5])
      })
      
      it('should handle missing parameters', async () => {
        // Setup
        const request = new NextRequest('http://localhost:3000/api/persistence', {
          method: 'POST',
          body: JSON.stringify({
            action: 'persist',
            docName: 'test-doc'
            // missing update
          })
        })
        
        // Execute
        const response = await POST(request)
        const data = await response.json()
        
        // Verify
        expect(response.status).toBe(400)
        expect(data.error).toContain('Missing required parameters')
      })
    })
    
    describe('load action', () => {
      it('should load from snapshot if available', async () => {
        // Setup
        const snapshotData = Buffer.from([10, 20, 30])
        mockPool.query
          .mockResolvedValueOnce({ 
            rows: [{ state: snapshotData }] 
          })
        
        const request = new NextRequest('http://localhost:3000/api/persistence', {
          method: 'POST',
          body: JSON.stringify({
            action: 'load',
            docName: 'test-doc'
          })
        })
        
        // Execute
        const response = await POST(request)
        const data = await response.json()
        
        // Verify
        expect(response.status).toBe(200)
        expect(data.update).toBe('ChQe') // base64 of [10,20,30]
      })
      
      it('should merge updates if no snapshot', async () => {
        // Setup
        const update1 = Buffer.from([1, 2])
        const update2 = Buffer.from([3, 4])
        
        // No snapshot
        mockPool.query.mockResolvedValueOnce({ rows: [] })
        
        // Return updates
        mockPool.query.mockResolvedValueOnce({ 
          rows: [
            { update: update1 },
            { update: update2 }
          ] 
        })
        
        const request = new NextRequest('http://localhost:3000/api/persistence', {
          method: 'POST',
          body: JSON.stringify({
            action: 'load',
            docName: 'test-doc'
          })
        })
        
        // Execute
        const response = await POST(request)
        const data = await response.json()
        
        // Verify
        expect(response.status).toBe(200)
        expect(data.update).toBeTruthy()
      })
      
      it('should return null for non-existent document', async () => {
        // Setup - no snapshot and no updates
        mockPool.query
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
        
        const request = new NextRequest('http://localhost:3000/api/persistence', {
          method: 'POST',
          body: JSON.stringify({
            action: 'load',
            docName: 'non-existent'
          })
        })
        
        // Execute
        const response = await POST(request)
        const data = await response.json()
        
        // Verify
        expect(response.status).toBe(200)
        expect(data.update).toBeNull()
      })
    })
    
    describe('getAllUpdates action', () => {
      it('should return all updates with metadata', async () => {
        // Setup
        const updates = [
          { 
            update: Buffer.from([1, 2]), 
            client_id: 'client-1',
            timestamp: new Date('2024-01-01')
          },
          { 
            update: Buffer.from([3, 4]), 
            client_id: 'client-2',
            timestamp: new Date('2024-01-02')
          }
        ]
        
        mockPool.query.mockResolvedValueOnce({ rows: updates })
        
        const request = new NextRequest('http://localhost:3000/api/persistence', {
          method: 'POST',
          body: JSON.stringify({
            action: 'getAllUpdates',
            docName: 'test-doc'
          })
        })
        
        // Execute
        const response = await POST(request)
        const data = await response.json()
        
        // Verify
        expect(response.status).toBe(200)
        expect(data.updates).toHaveLength(2)
        expect(data.updates[0]).toEqual({
          update: 'AQI=', // base64 of [1,2]
          clientId: 'client-1',
          timestamp: '2024-01-01T00:00:00.000Z'
        })
      })
    })
    
    describe('clearUpdates action', () => {
      it('should delete updates and return count', async () => {
        // Setup
        mockPool.query.mockResolvedValueOnce({ rowCount: 5 })
        
        const request = new NextRequest('http://localhost:3000/api/persistence', {
          method: 'POST',
          body: JSON.stringify({
            action: 'clearUpdates',
            docName: 'test-doc'
          })
        })
        
        // Execute
        const response = await POST(request)
        const data = await response.json()
        
        // Verify
        expect(response.status).toBe(200)
        expect(data.deletedCount).toBe(5)
        expect(mockPool.query).toHaveBeenCalledWith(
          'DELETE FROM yjs_updates WHERE doc_name = $1',
          ['test-doc']
        )
      })
    })
    
    describe('saveSnapshot action', () => {
      it('should save snapshot with checksum', async () => {
        // Setup
        mockPool.query.mockResolvedValueOnce({ rows: [] })
        
        const request = new NextRequest('http://localhost:3000/api/persistence', {
          method: 'POST',
          body: JSON.stringify({
            action: 'saveSnapshot',
            docName: 'test-doc',
            snapshot: 'ChQe' // base64 of [10,20,30]
          })
        })
        
        // Execute
        const response = await POST(request)
        const data = await response.json()
        
        // Verify
        expect(response.status).toBe(200)
        expect(data.checksum).toBe('mock-checksum-123')
        
        expect(mockPool.query).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO snapshots'),
          ['test-doc', expect.any(Buffer), 'mock-checksum-123']
        )
      })
    })
    
    describe('compact action', () => {
      it('should compact updates into snapshot', async () => {
        // Setup
        const mockClient = {
          query: jest.fn(),
          release: jest.fn()
        }
        
        mockPool.connect.mockResolvedValueOnce(mockClient)
        
        // Mock transaction queries
        mockClient.query
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({ rows: [] }) // Get snapshot
          .mockResolvedValueOnce({ // Get updates
            rows: [
              { update: Buffer.from([1, 2]) },
              { update: Buffer.from([3, 4]) }
            ]
          })
          .mockResolvedValueOnce({}) // Insert snapshot
          .mockResolvedValueOnce({}) // Delete updates
          .mockResolvedValueOnce({}) // COMMIT
        
        const request = new NextRequest('http://localhost:3000/api/persistence', {
          method: 'POST',
          body: JSON.stringify({
            action: 'compact',
            docName: 'test-doc'
          })
        })
        
        // Execute
        const response = await POST(request)
        const data = await response.json()
        
        // Verify
        expect(response.status).toBe(200)
        expect(data.message).toBe('Compaction successful')
        expect(data.compactedCount).toBe(2)
        expect(data.checksum).toBe('mock-checksum-123')
        
        expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
        expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
        expect(mockClient.release).toHaveBeenCalled()
      })
      
      it('should rollback on error', async () => {
        // Setup
        const mockClient = {
          query: jest.fn(),
          release: jest.fn()
        }
        
        mockPool.connect.mockResolvedValueOnce(mockClient)
        
        // Mock transaction queries
        mockClient.query
          .mockResolvedValueOnce({}) // BEGIN
          .mockRejectedValueOnce(new Error('Database error')) // Fail on first query
        
        const request = new NextRequest('http://localhost:3000/api/persistence', {
          method: 'POST',
          body: JSON.stringify({
            action: 'compact',
            docName: 'test-doc'
          })
        })
        
        // Execute
        const response = await POST(request)
        const data = await response.json()
        
        // Verify
        expect(response.status).toBe(500)
        expect(data.error).toContain('Database error')
        
        expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
        expect(mockClient.release).toHaveBeenCalled()
      })
    })
    
    describe('error handling', () => {
      it('should handle missing action', async () => {
        const request = new NextRequest('http://localhost:3000/api/persistence', {
          method: 'POST',
          body: JSON.stringify({
            docName: 'test-doc'
          })
        })
        
        const response = await POST(request)
        const data = await response.json()
        
        expect(response.status).toBe(400)
        expect(data.error).toContain('Missing or invalid action')
      })
      
      it('should handle unknown action', async () => {
        const request = new NextRequest('http://localhost:3000/api/persistence', {
          method: 'POST',
          body: JSON.stringify({
            action: 'unknown-action',
            docName: 'test-doc'
          })
        })
        
        const response = await POST(request)
        const data = await response.json()
        
        expect(response.status).toBe(400)
        expect(data.error).toContain('Unknown action: unknown-action')
      })
      
      it('should handle database errors', async () => {
        mockPool.query.mockRejectedValueOnce(new Error('Connection failed'))
        
        const request = new NextRequest('http://localhost:3000/api/persistence', {
          method: 'POST',
          body: JSON.stringify({
            action: 'persist',
            docName: 'test-doc',
            update: 'AQID',
            clientId: 'test-client'
          })
        })
        
        const response = await POST(request)
        const data = await response.json()
        
        expect(response.status).toBe(500)
        expect(data.error).toContain('Connection failed')
      })
    })
  })
  
  describe('GET /api/persistence', () => {
    it('should support legacy method parameter', async () => {
      // Setup
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
      
      const request = new NextRequest(
        'http://localhost:3000/api/persistence?method=load&docName=test-doc'
      )
      
      // Execute
      const response = await GET(request)
      const data = await response.json()
      
      // Verify
      expect(response.status).toBe(200)
      expect(data.update).toBeNull()
    })
    
    it('should support action parameter', async () => {
      // Setup
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
      
      const request = new NextRequest(
        'http://localhost:3000/api/persistence?action=load&docName=test-doc'
      )
      
      // Execute
      const response = await GET(request)
      const data = await response.json()
      
      // Verify
      expect(response.status).toBe(200)
      expect(data.update).toBeNull()
    })
    
    it('should handle missing parameters', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/persistence?action=load'
      )
      
      const response = await GET(request)
      const data = await response.json()
      
      expect(response.status).toBe(400)
      expect(data.error).toContain('Missing action or docName')
    })
  })
})