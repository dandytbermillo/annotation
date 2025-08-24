# PRP: YJS Update Batching and Performance Optimization
**version:** 1
**last_updated:** 2025-08-23

## Overview
Implement a transparent batching layer for YJS persistence that reduces database writes by 90%+ through intelligent batching, debouncing, and update coalescing. This wrapper will work with all existing persistence adapters without requiring changes to their interfaces.

## Context & Research

### Current Architecture Analysis
The persistence system follows a clean interface pattern (`PersistenceProvider`) with immediate write-through behavior. Every YJS update triggers an immediate database write via the `persist()` method. Key findings:

1. **Interface Location**: `lib/enhanced-yjs-provider.ts:13-21`
```typescript
export interface PersistenceProvider {
  persist(docName: string, update: Uint8Array): Promise<void>
  load(docName: string): Promise<Uint8Array | null>
  getAllUpdates(docName: string): Promise<Uint8Array[]>
  // ... other methods
}
```

2. **Update Handler Pattern**: `lib/enhanced-yjs-provider.ts:180-187`
```typescript
subdoc.on('update', async (update: Uint8Array) => {
  await this.persistence.persist(`panel-${panelId}`, update)
})
```

3. **Existing Queue Patterns**:
   - Loading queue: `Map<string, Promise<void>>` pattern in `enhanced-yjs-provider.ts:68`
   - Offline queue: `Array<{docName, update}>` in `web-adapter-enhanced.ts:6`

### External Research & Best Practices
Based on YJS documentation and community discussions:

1. **Y.mergeUpdates Performance**: 
   - Merges multiple updates into a single compressed update
   - Always produces smaller output than separate updates
   - Does not garbage collect deleted content
   - Reference: https://docs.yjs.dev/api/document-updates

2. **Batching Strategies** (from YJS community):
   - Batch database insertions for efficiency
   - Periodic merging to reduce storage overhead
   - Consider transaction costs vs individual operations
   - Reference: https://discuss.yjs.dev/t/handling-slow-mergeupdates-on-server/1105

3. **PowerSync Implementation** shows real-world batching:
   - Stores updates individually but processes in batches
   - Uses periodic compaction for long-term storage
   - Reference: https://www.powersync.com/blog/postgres-and-yjs-crdt-collaborative-text-editing-using-powersync

## Technical Design

### Architecture
```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│ YJS Document    │────▶│ BatchingProvider     │────▶│ Actual Adapter  │
│                 │     │ (queues & debounces) │     │ (Postgres/IDB)  │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
```

### Core Implementation Blueprint
```typescript
// lib/persistence/batching-provider.ts
export class BatchingPersistenceProvider implements PersistenceProvider {
  private queues = new Map<string, QueuedUpdate[]>()
  private timers = new Map<string, NodeJS.Timeout>()
  private metrics: BatchMetrics
  
  constructor(
    private adapter: PersistenceProvider,
    private config: BatchingConfig
  ) {}
  
  async persist(docName: string, update: Uint8Array): Promise<void> {
    // 1. Add to queue
    this.enqueue(docName, update)
    
    // 2. Check size threshold
    if (this.shouldFlushBySize(docName)) {
      return this.flush(docName, 'size')
    }
    
    // 3. Reset debounce timer
    this.resetTimer(docName)
  }
  
  private async flush(docName: string, reason: FlushReason): Promise<void> {
    const updates = this.queues.get(docName) || []
    if (updates.length === 0) return
    
    // Coalesce updates
    const merged = this.config.coalesce 
      ? Y.mergeUpdates(updates.map(u => u.data))
      : this.concatenateUpdates(updates)
    
    // Persist with retry
    await this.adapter.persist(docName, merged)
    
    // Clear queue and update metrics
    this.queues.delete(docName)
    this.updateMetrics(docName, updates.length, reason)
  }
}
```

### Configuration Strategy
```typescript
// Platform-specific defaults
const WEB_CONFIG: BatchingConfig = {
  maxBatchSize: 100,
  maxBatchSizeBytes: 1024 * 1024, // 1MB
  batchTimeout: 2000,              // 2 seconds
  debounceMs: 300,                 // 300ms typing pause
  coalesce: true
}

const ELECTRON_CONFIG: BatchingConfig = {
  maxBatchSize: 50,
  maxBatchSizeBytes: 256 * 1024,  // 256KB
  batchTimeout: 500,               // 500ms
  debounceMs: 100,                 // 100ms
  coalesce: true
}
```

## Implementation Tasks

### Phase 1: Core Batching (Day 1)
1. Create `lib/persistence/batching-provider.ts`
   - Define `BatchingConfig` and `BatchMetrics` interfaces
   - Implement queue management per document
   - Add basic time-based flushing

2. Create `lib/persistence/batching-config.ts`
   - Export platform-specific configurations
   - Add config validation

3. Write unit tests `tests/persistence/batching-provider.test.ts`
   - Test queue management
   - Test timeout-based flushing
   - Test error handling

### Phase 2: Advanced Features (Day 1-2)
4. Implement size-based flushing
   - Track queue size in bytes
   - Flush when threshold exceeded

5. Add update coalescing
   - Import Y.mergeUpdates from yjs
   - Handle merge errors gracefully
   - Add fallback to concatenation

6. Implement debouncing
   - Clear/reset timers on new updates
   - Proper cleanup on flush

### Phase 3: Integration (Day 2)
7. Update `lib/enhanced-yjs-provider.ts`
   - Wrap persistence adapter with batching
   - Use platform detection for config

8. Add metrics and monitoring
   - Track batch sizes, frequencies
   - Expose metrics via getter
   - Add event emitters for debugging

9. Integration tests
   - Test with all adapter types
   - Verify no data loss scenarios
   - Performance benchmarks

### Phase 4: Polish & Edge Cases
10. Handle edge cases
    - App shutdown (flush on exit)
    - Memory pressure (force flush)
    - Error recovery (retry logic)

11. Documentation
    - API documentation
    - Migration guide
    - Performance tuning guide

## Code Patterns to Follow

### Error Handling (from postgres-adapter.ts:132-156)
```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error
      if (!isRetryableError(error) || i === maxRetries - 1) throw error
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000))
    }
  }
  throw lastError!
}
```

### Queue Pattern (from web-adapter-enhanced.ts:256-288)
```typescript
private offlineQueue: Array<{ docName: string; update: Uint8Array }> = []

private async flushOfflineQueue(): Promise<void> {
  const queue = [...this.offlineQueue]
  this.offlineQueue = []
  
  for (const { docName, update } of queue) {
    try {
      await this.persist(docName, update)
    } catch (error) {
      this.offlineQueue.push({ docName, update })
      throw error
    }
  }
}
```

## External Dependencies

### YJS Documentation
- Update merging: https://docs.yjs.dev/api/document-updates#merging-updates
- Y.mergeUpdates API: https://github.com/yjs/yjs#merging-updates
- Internals guide: https://docs.yjs.dev/api/internals

### NPM Packages
```json
{
  "dependencies": {
    "yjs": "^13.6.0"  // Already in project
  }
}
```

## Validation Gates

### Linting & Type Checking
```bash
npm run lint
npm run type-check
```

### Unit Tests
```bash
# Test batching logic
npm run test -- batching-provider.test.ts

# Test individual features
npm run test -- batching-provider.test.ts --grep "debouncing"
npm run test -- batching-provider.test.ts --grep "coalescing"
npm run test -- batching-provider.test.ts --grep "size threshold"
```

### Integration Tests
```bash
# Start PostgreSQL
docker compose up -d postgres

# Run with real adapters
npm run test:integration -- --batching-enabled

# Test each adapter type
npm run test:integration -- postgres-batching.test.ts
npm run test:integration -- indexeddb-batching.test.ts
```

### Performance Tests
```bash
# Benchmark write reduction
npm run test:performance -- batching-metrics.test.ts

# Expected output:
# - Writes reduced by: 95%
# - Average batch size: 47 updates
# - P95 latency: <500ms
```

### Stress Tests
```bash
# Rapid update simulation
npm run test:stress -- rapid-typing.test.ts

# Memory leak detection
npm run test:stress -- memory-usage.test.ts
```

## Risk Mitigation

### Data Loss Prevention
1. Implement write-ahead logging to IndexedDB
2. Flush on `beforeunload` event
3. Add recovery mechanism on startup
4. Comprehensive error handling with no silent failures

### Memory Management
1. Set maximum queue size (1000 updates or 10MB)
2. Force flush when approaching limits
3. Monitor memory usage in metrics
4. Implement backpressure handling

### Compatibility
1. No changes to existing adapter interfaces
2. Feature detection for Y.mergeUpdates
3. Graceful degradation if coalescing fails
4. Configurable disable flag for debugging

## Error Handling Strategy

### Batch Failure Handling
```typescript
async flush(docName: string): Promise<void> {
  const updates = this.queues.get(docName)
  if (!updates) return
  
  try {
    const merged = Y.mergeUpdates(updates.map(u => u.data))
    await this.adapter.persist(docName, merged)
    this.queues.delete(docName)
  } catch (error) {
    if (error.message.includes('merge')) {
      // Fallback: persist individually
      for (const update of updates) {
        await this.adapter.persist(docName, update.data)
      }
    } else {
      // Requeue for retry
      this.handlePersistError(docName, updates, error)
    }
  }
}
```

## Success Metrics
- 90%+ reduction in database write operations
- <500ms P95 latency for document operations
- Zero data loss in stress tests
- Memory usage remains constant over time
- All existing tests continue to pass

## Testing Approach

### Unit Test Structure
```typescript
describe('BatchingPersistenceProvider', () => {
  describe('Basic Operations', () => {
    it('should queue updates without immediate persist')
    it('should flush after timeout')
    it('should flush when size threshold reached')
  })
  
  describe('Coalescing', () => {
    it('should merge updates using Y.mergeUpdates')
    it('should handle merge failures gracefully')
  })
  
  describe('Error Recovery', () => {
    it('should retry failed batches')
    it('should not lose updates on adapter failure')
  })
})
```

### Integration Test Example
```typescript
it('should reduce write operations by 90%+', async () => {
  const mockAdapter = createMockAdapter()
  const batchingProvider = new BatchingPersistenceProvider(mockAdapter, WEB_CONFIG)
  
  // Simulate rapid typing (100 updates)
  for (let i = 0; i < 100; i++) {
    await batchingProvider.persist('doc1', createUpdate(i))
    await sleep(10) // 10ms between keystrokes
  }
  
  // Wait for final flush
  await sleep(WEB_CONFIG.batchTimeout + 100)
  
  // Should have dramatically fewer writes
  expect(mockAdapter.persistCount).toBeLessThan(10)
  expect(mockAdapter.totalUpdates).toBe(100)
})
```

## Documentation References
1. [YJS Update Merging](https://docs.yjs.dev/api/document-updates#merging-updates)
2. [YJS GitHub - Merging Updates](https://github.com/yjs/yjs#merging-updates)
3. [YJS Internals](https://docs.yjs.dev/api/internals)
4. [YJS Community - Batching Discussion](https://discuss.yjs.dev/t/handling-slow-mergeupdates-on-server/1105)
5. [PowerSync YJS Implementation](https://www.powersync.com/blog/postgres-and-yjs-crdt-collaborative-text-editing-using-powersync)

## Confidence Score: 9/10

High confidence due to:
- Clear interface boundaries (wrapper pattern)
- Existing queue patterns in codebase to follow
- Well-documented YJS APIs
- Comprehensive test strategy
- Isolated from core functionality

Minor deduction for:
- Potential edge cases in error recovery
- Platform-specific timing sensitivities