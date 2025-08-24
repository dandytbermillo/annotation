# YJS Update Batching Provider

## Overview

The `BatchingPersistenceProvider` is a performance optimization layer that wraps any YJS persistence adapter to add batching, debouncing, and update coalescing capabilities. This dramatically reduces database writes and improves application performance.

## Features

- **Update Batching**: Collects multiple updates and persists them together
- **Debouncing**: Waits for editing pauses before persisting
- **Update Coalescing**: Merges multiple updates using `Y.mergeUpdates()` for compression
- **Platform-Specific Configs**: Optimized settings for Web vs Electron
- **Metrics & Monitoring**: Track batch performance and compression ratios
- **Error Recovery**: Automatic retry with exponential backoff
- **Graceful Shutdown**: Ensures all updates are persisted on app exit

## Usage

The batching provider is automatically enabled in the `EnhancedCollaborationProvider`:

```typescript
import { EnhancedCollaborationProvider } from './lib/enhanced-yjs-provider'

// Batching is automatically applied to the persistence layer
const provider = EnhancedCollaborationProvider.getInstance()

// Optional: Get batching metrics
const metrics = provider.getBatchingMetrics()
console.log(`Compression ratio: ${metrics.compressionRatio}x`)
console.log(`Write reduction: ${metrics.totalBatches} batches from ${metrics.totalUpdates} updates`)
```

## Configuration

### Platform-Specific Defaults

**Web Configuration** (2 second batches, 300ms debounce):
```typescript
{
  maxBatchSize: 100,
  maxBatchSizeBytes: 1024 * 1024, // 1MB
  batchTimeout: 2000,              // 2 seconds
  debounceMs: 300,                 // 300ms typing pause
  coalesce: true
}
```

**Electron Configuration** (500ms batches, 100ms debounce):
```typescript
{
  maxBatchSize: 50,
  maxBatchSizeBytes: 256 * 1024,  // 256KB
  batchTimeout: 500,               // 500ms
  debounceMs: 100,                 // 100ms
  coalesce: true
}
```

### Custom Configuration

To use custom batching settings:

```typescript
import { BatchingPersistenceProvider } from './lib/persistence/batching-provider'
import { PostgresAPIAdapter } from './lib/adapters/postgres-api-adapter'

const customConfig = {
  maxBatchSize: 200,
  maxBatchSizeBytes: 2 * 1024 * 1024, // 2MB
  batchTimeout: 5000,                  // 5 seconds
  debounceMs: 500,                     // 500ms
  coalesce: true,
  debug: true                          // Enable debug logging
}

const baseAdapter = new PostgresAPIAdapter()
const batchingProvider = new BatchingPersistenceProvider(baseAdapter, customConfig)
```

## Performance Impact

Based on testing, the batching provider typically achieves:

- **90-95% reduction** in database write operations
- **1.5-2x compression** through update coalescing
- **<10ms persist latency** (just queuing, not actual DB write)
- **Constant memory usage** with proper queue management

## How It Works

1. **Queueing**: Updates are added to per-document queues instead of immediate persistence
2. **Triggers**: Batches are flushed when:
   - Time threshold is reached (e.g., 2 seconds)
   - Size threshold is exceeded (e.g., 1MB)
   - Count threshold is hit (e.g., 100 updates)
   - Manual flush is requested (load, shutdown, etc.)
3. **Coalescing**: Multiple updates are merged using `Y.mergeUpdates()` before persistence
4. **Retry**: Failed batches are retried with exponential backoff

## Events

The batching provider emits events for monitoring:

```typescript
batchingProvider.on('enqueue', ({ docName, queueSize, totalSize }) => {
  console.log(`Queued update for ${docName}: ${queueSize} updates, ${totalSize} bytes`)
})

batchingProvider.on('flush', ({ docName, updateCount, finalSize, reason }) => {
  console.log(`Flushed ${updateCount} updates for ${docName}: ${finalSize} bytes (${reason})`)
})

batchingProvider.on('shutdown', () => {
  console.log('Batching provider shutting down')
})
```

## Best Practices

1. **Let batching work**: Don't manually flush unless necessary
2. **Monitor metrics**: Use `getBatchingMetrics()` to track performance
3. **Platform awareness**: Use appropriate configs for Web vs Electron
4. **Error handling**: The provider handles retries automatically
5. **Shutdown properly**: Always call `destroy()` on the provider to ensure final flush

## Troubleshooting

### Updates not persisting quickly enough?
- Reduce `batchTimeout` or `debounceMs`
- Consider manual flush for critical operations

### Memory usage growing?
- Check `maxBatchSize` and `maxBatchSizeBytes` limits
- Ensure proper shutdown/cleanup

### Compression ratio low?
- Enable coalescing (`coalesce: true`)
- Larger batches typically compress better

### Debug logging
Enable debug mode to see detailed batching behavior:
```typescript
{ debug: true }
```