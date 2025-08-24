import { BatchingPersistenceProvider } from '../../lib/persistence/batching-provider'
import { WEB_CONFIG, ELECTRON_CONFIG, TEST_CONFIG, BatchingConfig } from '../../lib/persistence/batching-config'
import type { PersistenceProvider } from '../../lib/enhanced-yjs-provider'
import * as Y from 'yjs'

// Simple in-memory persistence adapter for testing
class InMemoryPersistenceAdapter implements PersistenceProvider {
  private storage = new Map<string, Uint8Array[]>()
  private snapshots = new Map<string, Uint8Array>()
  public persistCount = 0
  public persistCalls: Array<{ docName: string; update: Uint8Array }> = []

  async persist(docName: string, update: Uint8Array): Promise<void> {
    this.persistCount++
    this.persistCalls.push({ docName, update })
    
    const updates = this.storage.get(docName) || []
    updates.push(update)
    this.storage.set(docName, updates)
  }

  async load(docName: string): Promise<Uint8Array | null> {
    const updates = this.storage.get(docName)
    if (!updates || updates.length === 0) return null
    
    // Merge all updates
    return Y.mergeUpdates(updates)
  }

  async getAllUpdates(docName: string): Promise<Uint8Array[]> {
    return this.storage.get(docName) || []
  }

  async clearUpdates(docName: string): Promise<void> {
    this.storage.delete(docName)
  }

  async saveSnapshot(docName: string, snapshot: Uint8Array): Promise<void> {
    this.snapshots.set(docName, snapshot)
  }

  async loadSnapshot(docName: string): Promise<Uint8Array | null> {
    return this.snapshots.get(docName) || null
  }

  async compact(docName: string): Promise<void> {
    const updates = await this.getAllUpdates(docName)
    if (updates.length > 1) {
      const merged = Y.mergeUpdates(updates)
      this.storage.set(docName, [merged])
    }
  }

  reset(): void {
    this.storage.clear()
    this.snapshots.clear()
    this.persistCount = 0
    this.persistCalls = []
  }
}

// Helper to create YJS updates
function createUpdate(content: string): Uint8Array {
  const doc = new Y.Doc()
  const text = doc.getText('test')
  text.insert(0, content)
  return Y.encodeStateAsUpdate(doc)
}

// Helper to decode update content
function decodeUpdate(update: Uint8Array): string {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, update)
  return doc.getText('test').toString()
}

// Helper for timing
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('BatchingPersistenceProvider Integration Tests', () => {
  describe('with InMemoryPersistenceAdapter', () => {
    let adapter: InMemoryPersistenceAdapter
    let batchingProvider: BatchingPersistenceProvider
    const testDocName = 'test-doc-' + Date.now()

    beforeEach(() => {
      adapter = new InMemoryPersistenceAdapter()
      const config = { ...TEST_CONFIG, disableEventListeners: true }
      batchingProvider = new BatchingPersistenceProvider(adapter, config)
    })

    afterEach(async () => {
      await batchingProvider.shutdown()
      adapter.reset()
    })

    it('should persist and load updates correctly with batching', async () => {
      // Add multiple updates
      await batchingProvider.persist(testDocName, createUpdate('Hello'))
      await batchingProvider.persist(testDocName, createUpdate(' World'))
      await batchingProvider.persist(testDocName, createUpdate('!'))
      
      // Force flush
      await batchingProvider.flushAll()
      
      // Should have batched the updates
      expect(adapter.persistCount).toBe(1)
      
      // Load the document
      const loaded = await batchingProvider.load(testDocName)
      expect(loaded).not.toBeNull()
      
      // Verify content - YJS may merge updates differently
      const content = decodeUpdate(loaded!)
      expect(content).toContain('Hello')
      expect(content).toContain('World')
      expect(content).toContain('!')
    })

    it('should handle large batches efficiently', async () => {
      const startTime = Date.now()
      
      // Add 100 updates
      for (let i = 0; i < 100; i++) {
        await batchingProvider.persist(testDocName, createUpdate(`Update ${i} `))
      }
      
      // Force flush
      await batchingProvider.flushAll()
      
      const duration = Date.now() - startTime
      
      // Get metrics
      const metrics = batchingProvider.getMetrics()
      
      // Should have batched updates
      expect(metrics.totalBatches).toBeGreaterThan(0)
      expect(metrics.totalBatches).toBeLessThan(100) // Should batch, not persist individually
      expect(metrics.compressionRatio).toBeGreaterThan(1) // Should achieve compression
      
      console.log(`Batched 100 updates into ${metrics.totalBatches} batches in ${duration}ms`)
      console.log(`Compression ratio: ${metrics.compressionRatio.toFixed(2)}x`)
      
      // Verify data integrity
      const allUpdates = await batchingProvider.getAllUpdates(testDocName)
      expect(allUpdates.length).toBeGreaterThan(0)
    })

    it('should maintain data integrity across shutdown/restart', async () => {
      // Add updates
      await batchingProvider.persist(testDocName, createUpdate('Before'))
      await batchingProvider.persist(testDocName, createUpdate(' Shutdown'))
      
      // Shutdown (should flush)
      await batchingProvider.shutdown()
      
      // Create new provider
      const config = { ...TEST_CONFIG, disableEventListeners: true }
      const newProvider = new BatchingPersistenceProvider(adapter, config)
      
      // Load data
      const loaded = await newProvider.load(testDocName)
      expect(loaded).not.toBeNull()
      
      const content = decodeUpdate(loaded!)
      expect(content).toContain('Before')
      expect(content).toContain('Shutdown')
      
      await newProvider.shutdown()
    })

    it('should handle concurrent documents independently', async () => {
      const doc1 = testDocName + '-1'
      const doc2 = testDocName + '-2'
      
      // Add updates to different documents
      await batchingProvider.persist(doc1, createUpdate('Doc 1'))
      await batchingProvider.persist(doc2, createUpdate('Doc 2'))
      
      // Force flush
      await batchingProvider.flushAll()
      
      // Should have persisted separately
      expect(adapter.persistCalls.filter(c => c.docName === doc1).length).toBe(1)
      expect(adapter.persistCalls.filter(c => c.docName === doc2).length).toBe(1)
      
      // Verify both documents
      const loaded1 = await batchingProvider.load(doc1)
      const loaded2 = await batchingProvider.load(doc2)
      
      expect(decodeUpdate(loaded1!)).toBe('Doc 1')
      expect(decodeUpdate(loaded2!)).toBe('Doc 2')
    })
  })

  describe('Platform-specific configurations', () => {
    let adapter: InMemoryPersistenceAdapter

    beforeEach(() => {
      adapter = new InMemoryPersistenceAdapter()
    })

    it('should use appropriate config for web platform', async () => {
      const config = { ...WEB_CONFIG, disableEventListeners: true }
      const provider = new BatchingPersistenceProvider(adapter, config)
      
      // Web config has longer timeouts
      expect(config.batchTimeout).toBe(2000)
      expect(config.debounceMs).toBe(300)
      
      await provider.shutdown()
    })

    it('should use appropriate config for electron platform', async () => {
      const config = { ...ELECTRON_CONFIG, disableEventListeners: true }
      const provider = new BatchingPersistenceProvider(adapter, config)
      
      // Electron config has shorter timeouts
      expect(config.batchTimeout).toBe(500)
      expect(config.debounceMs).toBe(100)
      
      await provider.shutdown()
    })
  })

  describe('Performance benchmarks', () => {
    let adapter: InMemoryPersistenceAdapter
    let batchingProvider: BatchingPersistenceProvider
    let unbatchedAdapter: InMemoryPersistenceAdapter
    
    beforeEach(() => {
      adapter = new InMemoryPersistenceAdapter()
      const config: BatchingConfig = {
        ...TEST_CONFIG,
        batchTimeout: 500,
        maxBatchSize: 50,
        disableEventListeners: true
      }
      batchingProvider = new BatchingPersistenceProvider(adapter, config)
      unbatchedAdapter = new InMemoryPersistenceAdapter()
    })

    afterEach(async () => {
      await batchingProvider.shutdown()
    })

    it('should significantly reduce write operations', async () => {
      const testDoc = 'perf-test-' + Date.now()
      const updateCount = 100
      
      // Test with batching
      const batchedStart = Date.now()
      for (let i = 0; i < updateCount; i++) {
        await batchingProvider.persist(testDoc, createUpdate(`Batched ${i}`))
      }
      await batchingProvider.flushAll()
      const batchedDuration = Date.now() - batchedStart
      
      // Test without batching
      const unbatchedStart = Date.now()
      for (let i = 0; i < updateCount; i++) {
        await unbatchedAdapter.persist(testDoc + '-unbatched', createUpdate(`Unbatched ${i}`))
      }
      const unbatchedDuration = Date.now() - unbatchedStart
      
      // Get metrics
      const metrics = batchingProvider.getMetrics()
      
      console.log('Performance comparison:')
      console.log(`  Batched: ${batchedDuration}ms, ${metrics.totalBatches} writes`)
      console.log(`  Unbatched: ${unbatchedDuration}ms, ${updateCount} writes`)
      console.log(`  Write reduction: ${((1 - metrics.totalBatches / updateCount) * 100).toFixed(1)}%`)
      console.log(`  Compression ratio: ${metrics.compressionRatio.toFixed(2)}x`)
      
      // Verify significant reduction in writes
      expect(metrics.totalBatches).toBeLessThan(updateCount / 2) // At least 50% reduction
      expect(metrics.compressionRatio).toBeGreaterThan(1.0) // Some compression achieved
    })

    it('should maintain low latency for document operations', async () => {
      const testDoc = 'latency-test-' + Date.now()
      
      // Measure persist latency
      const persistTimes: number[] = []
      for (let i = 0; i < 20; i++) {
        const start = Date.now()
        await batchingProvider.persist(testDoc, createUpdate(`Update ${i}`))
        persistTimes.push(Date.now() - start)
      }
      
      // Measure load latency (includes flush)
      const loadStart = Date.now()
      await batchingProvider.load(testDoc)
      const loadLatency = Date.now() - loadStart
      
      // Calculate P95 latency
      persistTimes.sort((a, b) => a - b)
      const p95Index = Math.floor(persistTimes.length * 0.95)
      const p95Latency = persistTimes[p95Index]
      
      console.log(`Persist P95 latency: ${p95Latency}ms`)
      console.log(`Load latency (with flush): ${loadLatency}ms`)
      
      // Verify low latency
      expect(p95Latency).toBeLessThan(10) // Persist should be very fast (just queuing)
      expect(loadLatency).toBeLessThan(500) // Load with flush should be reasonable
    })
  })

  describe('Error recovery integration', () => {
    it('should recover from adapter failures', async () => {
      // Create a custom adapter with controlled failures
      class FlakyAdapter extends InMemoryPersistenceAdapter {
        private failCount = 0
        
        async persist(docName: string, update: Uint8Array): Promise<void> {
          this.failCount++
          if (this.failCount <= 1) {
            throw new Error('Simulated adapter failure')
          }
          return super.persist(docName, update)
        }
      }
      
      const adapter = new FlakyAdapter()
      const config = { ...TEST_CONFIG, disableEventListeners: true, debug: false }
      const provider = new BatchingPersistenceProvider(adapter, config)
      const testDoc = 'error-test-' + Date.now()
      
      // Add updates
      await provider.persist(testDoc, createUpdate('Should'))
      await provider.persist(testDoc, createUpdate(' Eventually'))
      await provider.persist(testDoc, createUpdate(' Succeed'))
      
      // First flush attempts will fail
      try {
        await provider.flushAll()
      } catch (error) {
        // Expected
      }
      
      // Retry should succeed
      await provider.flushAll()
      
      // Verify data was persisted
      const loaded = await provider.load(testDoc)
      const content = decodeUpdate(loaded!)
      expect(content).toContain('Should')
      expect(content).toContain('Eventually')
      expect(content).toContain('Succeed')
      
      await provider.shutdown()
    })
  })

  describe('Real-world scenarios', () => {
    it('should handle collaborative editing patterns efficiently', async () => {
      const adapter = new InMemoryPersistenceAdapter()
      const config: BatchingConfig = {
        ...WEB_CONFIG,
        disableEventListeners: true,
        debug: false
      }
      const provider = new BatchingPersistenceProvider(adapter, config)
      const docId = 'collab-doc-' + Date.now()
      
      // Simulate rapid collaborative editing
      // User 1 types quickly
      for (let i = 0; i < 10; i++) {
        await provider.persist(docId, createUpdate(`User1-${i} `))
        await sleep(50) // 50ms between keystrokes
      }
      
      // User 2 makes a large paste
      const largePaste = 'Lorem ipsum '.repeat(100)
      await provider.persist(docId, createUpdate(largePaste))
      
      // User 1 continues typing
      for (let i = 10; i < 20; i++) {
        await provider.persist(docId, createUpdate(`User1-${i} `))
        await sleep(50)
      }
      
      // Wait for all flushes
      await sleep(config.batchTimeout + config.debounceMs + 100)
      
      const metrics = provider.getMetrics()
      console.log('Collaborative editing scenario:')
      console.log(`  Total updates: ${21}`)
      console.log(`  Total batches: ${metrics.totalBatches}`)
      console.log(`  Average batch size: ${metrics.averageBatchSize.toFixed(1)}`)
      console.log(`  Compression ratio: ${metrics.compressionRatio.toFixed(2)}x`)
      
      // Should have significantly fewer batches than updates
      expect(metrics.totalBatches).toBeLessThan(10)
      
      await provider.shutdown()
    })
  })
})