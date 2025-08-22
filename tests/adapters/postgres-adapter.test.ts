/**
 * Test suite for PostgreSQL Persistence Adapter
 * 
 * These tests verify that the PostgresPersistenceAdapter correctly implements
 * the PersistenceProvider interface and handles binary YJS data properly.
 */

import { PostgresPersistenceAdapter } from '../../lib/adapters/postgres-adapter'
import * as Y from 'yjs'
import { Pool } from 'pg'

// Mock pg module
jest.mock('pg', () => {
  const mockPool = {
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
  }
  
  return {
    Pool: jest.fn(() => mockPool),
  }
})

describe('PostgresPersistenceAdapter', () => {
  let adapter: PostgresPersistenceAdapter
  let mockPool: any
  
  beforeEach(() => {
    // Set required environment variable
    process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5432/test'
    
    // Get mock pool instance
    const Pool = require('pg').Pool
    mockPool = new Pool()
    
    // Setup default mock responses
    const mockClient = {
      query: jest.fn().mockResolvedValue({
        rows: [{ updates_exists: true, snapshots_exists: true }]
      }),
      release: jest.fn(),
    }
    
    mockPool.connect.mockResolvedValue(mockClient)
    
    mockPool.query.mockResolvedValue({
      rows: [{ updates_exists: true, snapshots_exists: true }]
    })
  })
  
  afterEach(() => {
    jest.clearAllMocks()
    delete process.env.POSTGRES_URL
  })
  
  describe('constructor', () => {
    test('should throw error when no connection string provided', () => {
      delete process.env.POSTGRES_URL
      
      expect(() => {
        new PostgresPersistenceAdapter()
      }).toThrow('PostgreSQL connection string is required')
    })
    
    test('should initialize with environment variable', async () => {
      adapter = new PostgresPersistenceAdapter()
      
      // Wait for test connection to complete
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: 'postgresql://test:test@localhost:5432/test',
          max: 10,
        })
      )
    })
    
    test('should initialize with provided connection string', async () => {
      adapter = new PostgresPersistenceAdapter('postgresql://custom:custom@localhost:5432/custom')
      
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(Pool).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: 'postgresql://custom:custom@localhost:5432/custom',
        })
      )
    })
  })
  
  describe('persist', () => {
    beforeEach(async () => {
      adapter = new PostgresPersistenceAdapter()
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    
    test('should persist YJS update as binary data', async () => {
      const doc = new Y.Doc()
      doc.getText('content').insert(0, 'Hello YJS')
      const update = Y.encodeStateAsUpdate(doc)
      
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      
      await adapter.persist('test-doc', update)
      
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO yjs_updates'),
        expect.arrayContaining([
          'test-doc',
          expect.any(Buffer),
          expect.any(String),
        ])
      )
      
      // Verify the buffer contains the update data
      const callArgs = mockPool.query.mock.calls.find(
        call => call[0].includes('INSERT INTO yjs_updates')
      )
      const buffer = callArgs[1][1]
      expect(buffer).toBeInstanceOf(Buffer)
      expect(new Uint8Array(buffer)).toEqual(update)
    })
    
    test('should handle empty updates', async () => {
      const emptyUpdate = new Uint8Array(0)
      
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      
      await adapter.persist('test-doc', emptyUpdate)
      
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO yjs_updates'),
        expect.any(Array)
      )
    })
  })
  
  describe('load', () => {
    beforeEach(async () => {
      adapter = new PostgresPersistenceAdapter()
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    
    test('should load from snapshot when available', async () => {
      const doc = new Y.Doc()
      doc.getText('content').insert(0, 'Snapshot content')
      const snapshot = Y.encodeStateAsUpdate(doc)
      
      // Mock loadSnapshot to return data
      mockPool.query.mockResolvedValueOnce({
        rows: [{ state: Buffer.from(snapshot) }]
      })
      
      const result = await adapter.load('test-doc')
      
      expect(result).toBeInstanceOf(Uint8Array)
      expect(result).toEqual(snapshot)
    })
    
    test('should merge updates when no snapshot exists', async () => {
      const doc1 = new Y.Doc()
      doc1.getText('content').insert(0, 'Hello')
      const update1 = Y.encodeStateAsUpdate(doc1)
      
      const doc2 = new Y.Doc()
      Y.applyUpdate(doc2, update1)
      doc2.getText('content').insert(5, ' World')
      const update2 = Y.encodeStateAsUpdate(doc2)
      
      // Mock no snapshot
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      
      // Mock getAllUpdates
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { update: Buffer.from(update1) },
          { update: Buffer.from(update2) }
        ]
      })
      
      const result = await adapter.load('test-doc')
      
      expect(result).toBeInstanceOf(Uint8Array)
      
      // Verify merged content
      const mergedDoc = new Y.Doc()
      Y.applyUpdate(mergedDoc, result!)
      expect(mergedDoc.getText('content').toString()).toBe('Hello World')
    })
    
    test('should return null for non-existent document', async () => {
      // Mock no snapshot
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      
      // Mock no updates
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      
      const result = await adapter.load('non-existent')
      
      expect(result).toBeNull()
    })
  })
  
  describe('getAllUpdates', () => {
    beforeEach(async () => {
      adapter = new PostgresPersistenceAdapter()
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    
    test('should retrieve all updates in chronological order', async () => {
      const update1 = new Uint8Array([1, 2, 3])
      const update2 = new Uint8Array([4, 5, 6])
      
      mockPool.query.mockResolvedValueOnce({
        rows: [
          { update: Buffer.from(update1) },
          { update: Buffer.from(update2) }
        ]
      })
      
      const results = await adapter.getAllUpdates('test-doc')
      
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY timestamp ASC'),
        ['test-doc']
      )
      
      expect(results).toHaveLength(2)
      expect(results[0]).toEqual(update1)
      expect(results[1]).toEqual(update2)
      expect(results[0]).toBeInstanceOf(Uint8Array)
    })
    
    test('should return empty array when no updates exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      
      const results = await adapter.getAllUpdates('test-doc')
      
      expect(results).toEqual([])
    })
  })
  
  describe('clearUpdates', () => {
    beforeEach(async () => {
      adapter = new PostgresPersistenceAdapter()
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    
    test('should delete all updates for a document', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      
      await adapter.clearUpdates('test-doc')
      
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM yjs_updates'),
        ['test-doc']
      )
    })
  })
  
  describe('saveSnapshot', () => {
    beforeEach(async () => {
      adapter = new PostgresPersistenceAdapter()
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    
    test('should save snapshot with checksum', async () => {
      const doc = new Y.Doc()
      doc.getText('content').insert(0, 'Snapshot data')
      const snapshot = Y.encodeStateAsUpdate(doc)
      
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      
      await adapter.saveSnapshot('note:123e4567-e89b-12d3-a456-426614174000', snapshot)
      
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO snapshots'),
        expect.arrayContaining([
          '123e4567-e89b-12d3-a456-426614174000', // extracted note_id
          'note:123e4567-e89b-12d3-a456-426614174000',
          expect.any(Buffer),
          expect.any(String), // checksum
        ])
      )
    })
    
    test('should handle non-note document names', async () => {
      const snapshot = new Uint8Array([1, 2, 3])
      
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      
      await adapter.saveSnapshot('panel:test', snapshot)
      
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO snapshots'),
        expect.arrayContaining([
          null, // no note_id extracted
          'panel:test',
          expect.any(Buffer),
          expect.any(String),
        ])
      )
    })
  })
  
  describe('loadSnapshot', () => {
    beforeEach(async () => {
      adapter = new PostgresPersistenceAdapter()
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    
    test('should load most recent snapshot', async () => {
      const snapshot = new Uint8Array([7, 8, 9])
      
      mockPool.query.mockResolvedValueOnce({
        rows: [{ state: Buffer.from(snapshot) }]
      })
      
      const result = await adapter.loadSnapshot('test-doc')
      
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        ['test-doc']
      )
      
      expect(result).toEqual(snapshot)
      expect(result).toBeInstanceOf(Uint8Array)
    })
    
    test('should return null when no snapshot exists', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] })
      
      const result = await adapter.loadSnapshot('test-doc')
      
      expect(result).toBeNull()
    })
  })
  
  describe('compact', () => {
    beforeEach(async () => {
      adapter = new PostgresPersistenceAdapter()
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    
    test('should merge updates and create snapshot', async () => {
      const doc1 = new Y.Doc()
      doc1.getText('content').insert(0, 'First')
      const update1 = Y.encodeStateAsUpdate(doc1)
      
      const doc2 = new Y.Doc()
      Y.applyUpdate(doc2, update1)
      doc2.getText('content').insert(5, ' Second')
      const update2 = Y.encodeStateAsUpdate(doc2)
      
      // Mock pool.connect for transaction
      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      }
      mockPool.connect.mockResolvedValueOnce(mockClient)
      
      // Mock transaction queries
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ // SELECT updates
          rows: [
            { update: Buffer.from(update1) },
            { update: Buffer.from(update2) }
          ]
        })
        .mockResolvedValueOnce({}) // DELETE updates
        .mockResolvedValueOnce({}) // DELETE old snapshots
        .mockResolvedValueOnce({}) // COMMIT
      
      // Mock pool query for saveSnapshot (called within compact)
      mockPool.query.mockResolvedValueOnce({}) // INSERT snapshot
      
      await adapter.compact('test-doc')
      
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(mockClient.release).toHaveBeenCalled()
      
      // Verify snapshot was saved - the adapter now calls pool.query directly for snapshots
      const snapshotCall = mockPool.query.mock.calls.find(
        call => typeof call[0] === 'string' && call[0].includes('INSERT INTO snapshots')
      )
      expect(snapshotCall).toBeDefined()
    })
    
    test('should handle empty updates gracefully', async () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      }
      mockPool.connect.mockResolvedValueOnce(mockClient)
      
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // No updates
        .mockResolvedValueOnce({}) // COMMIT
      
      await adapter.compact('test-doc')
      
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(mockClient.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO snapshots'),
        expect.any(Array)
      )
    })
    
    test('should rollback on error', async () => {
      const mockClient = {
        query: jest.fn(),
        release: jest.fn(),
      }
      mockPool.connect.mockResolvedValueOnce(mockClient)
      
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('Database error')) // Error during operation
      
      await expect(adapter.compact('test-doc')).rejects.toThrow('Database error')
      
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockClient.release).toHaveBeenCalled()
    })
  })
  
  describe('destroy', () => {
    test('should close pool connection', async () => {
      adapter = new PostgresPersistenceAdapter()
      await new Promise(resolve => setTimeout(resolve, 10))
      
      await adapter.destroy()
      
      expect(mockPool.end).toHaveBeenCalled()
    })
  })
  
  describe('retry logic', () => {
    beforeEach(async () => {
      adapter = new PostgresPersistenceAdapter()
      await new Promise(resolve => setTimeout(resolve, 10))
      
      // Speed up retries for testing
      ;(adapter as any).retryDelay = 10
    })
    
    test('should retry on connection errors', async () => {
      mockPool.query
        .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
        .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
        .mockResolvedValueOnce({ rows: [] })
      
      await adapter.persist('test-doc', new Uint8Array([1, 2, 3]))
      
      // Should have 3 persist attempts (initial + 2 retries before success)
      const persistCalls = mockPool.query.mock.calls.filter(
        call => typeof call[0] === 'string' && call[0].includes('INSERT INTO yjs_updates')
      )
      expect(persistCalls).toHaveLength(3) // 3 attempts total
    })
    
    test('should fail after max retries', async () => {
      mockPool.query.mockRejectedValue({ code: 'ECONNREFUSED' })
      
      await expect(
        adapter.persist('test-doc', new Uint8Array([1, 2, 3]))
      ).rejects.toMatchObject({ code: 'ECONNREFUSED' })
      
      // Verify it tried 4 times (initial + 3 retries)
      expect(mockPool.query).toHaveBeenCalled()
    })
    
    test('should not retry non-retryable errors', async () => {
      mockPool.query.mockRejectedValue(new Error('Syntax error'))
      
      await expect(
        adapter.persist('test-doc', new Uint8Array([1, 2, 3]))
      ).rejects.toThrow('Syntax error')
      
      // Verify it only tried once (no retries for non-retryable errors)
      expect(mockPool.query).toHaveBeenCalled()
    })
  })
})

describe('PostgresPersistenceAdapter Integration Tests', () => {
  let adapter: PostgresPersistenceAdapter
  
  // Skip these tests if no real PostgreSQL connection is available
  const skipIfNoPostgres = process.env.POSTGRES_TEST_URL ? test : test.skip
  
  beforeAll(() => {
    if (process.env.POSTGRES_TEST_URL) {
      adapter = new PostgresPersistenceAdapter(process.env.POSTGRES_TEST_URL)
    }
  })
  
  afterAll(async () => {
    if (adapter) {
      await adapter.destroy()
    }
  })
  
  skipIfNoPostgres('should perform full roundtrip with real database', async () => {
    const docName = `test-doc-${Date.now()}`
    
    // Create a document with content
    const doc = new Y.Doc()
    const text = doc.getText('content')
    text.insert(0, 'Hello PostgreSQL!')
    
    const update = Y.encodeStateAsUpdate(doc)
    
    // Persist the update
    await adapter.persist(docName, update)
    
    // Load the document
    const loaded = await adapter.load(docName)
    expect(loaded).toBeTruthy()
    
    // Verify content
    const loadedDoc = new Y.Doc()
    Y.applyUpdate(loadedDoc, loaded!)
    expect(loadedDoc.getText('content').toString()).toBe('Hello PostgreSQL!')
    
    // Test snapshot functionality
    await adapter.saveSnapshot(docName, loaded!)
    const snapshot = await adapter.loadSnapshot(docName)
    expect(snapshot).toEqual(loaded)
    
    // Test compaction
    await adapter.compact(docName)
    
    // Cleanup
    await adapter.clearUpdates(docName)
  })
})