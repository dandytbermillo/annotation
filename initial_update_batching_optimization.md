# Feature Request: YJS Update Batching and Performance Optimization

## Metadata
- **author:** Dandy Bermillo / Claude
- **created_at:** 2025-08-23T16:45:00Z
- **status:** draft
- **priority:** high
- **target_branch:** feat/update-batching
- **estimated_risk:** low
- **related_prs:** 
- **iteration_count:** 0

---

## SUMMARY
Implement batching, debouncing, and coalescing for YJS updates to reduce database write frequency from every keystroke to periodic flushes. Currently, every YJS document change (keystroke, cursor movement, panel drag) creates an immediate database write, causing performance issues and excessive storage usage. This optimization will reduce database writes by 10-100x while maintaining data durability.

---

## MOTIVATION / WHY
- **Performance Impact**: Current implementation creates a database write for every keystroke, causing high I/O load and potential bottlenecks
- **Storage Efficiency**: Thousands of tiny updates consume excessive storage; coalescing can reduce size by 80%+
- **Scalability**: Won't scale to multiple concurrent users without write optimization
- **User Experience**: Reduce latency and improve responsiveness, especially on slower connections
- **Cost Reduction**: Fewer database operations = lower infrastructure costs

---

## SCOPE (WHAT)
Clear scope: what will be changed and what will not.

**In scope**
- Create `lib/persistence/batching-provider.ts` wrapper for existing persistence adapters
- Implement configurable batching with time and size thresholds
- Add debouncing to wait for editing pauses before persisting
- Implement update coalescing using YJS's `Y.mergeUpdates()`
- Add platform-specific configurations (Web vs Electron)
- Create metrics/monitoring for batch performance
- Ensure compatibility with all existing adapters (PostgreSQL, IndexedDB, SQLite)

**Out of scope**
- Changing the underlying persistence adapters
- Modifying YJS document structure
- Changing the persistence API interface
- Adding new storage backends
- Implementing write-ahead logging (future enhancement)

---

## ACCEPTANCE CRITERIA
- [ ] BatchingPersistenceProvider implemented and wraps existing adapters
- [ ] Updates are batched and flushed based on configurable time/size thresholds
- [ ] Debouncing prevents writes during active typing (configurable delay)
- [ ] Multiple updates are coalesced before persisting
- [ ] No data loss - all updates eventually persisted even on crash
- [ ] Performance: 90%+ reduction in database writes during typical editing
- [ ] All existing tests pass with batching enabled
- [ ] New tests verify batching behavior and edge cases
- [ ] Configurable per platform (Web: higher latency tolerance, Electron: lower)

---

## DOCUMENTATION & REFERENCES
List every authoritative doc / file / external URL an agent must load.

- lib/enhanced-yjs-provider.ts ← current provider implementation
- lib/adapters/postgres-adapter.ts ← adapter to wrap
- lib/adapters/postgres-api-adapter.ts ← browser adapter to wrap
- lib/adapters/web-adapter-enhanced.ts ← IndexedDB adapter to wrap
- lib/utils/platform-detection.ts ← for platform-specific configs
- tests/adapters/*.test.ts ← existing adapter tests
- https://github.com/yjs/yjs#merging-updates ← YJS update merging docs
- https://docs.yjs.dev/api/document-updates#merging-updates ← Y.mergeUpdates API

---

## EXAMPLES & SAMPLE FLOWS
Short, concrete user flows to use as tests and UX-checks.

1. **Rapid Typing**: User types 100 characters quickly → creates 100 YJS updates → batching collects all → debounce waits 300ms after typing stops → single coalesced update persisted
2. **Size Threshold**: User pastes large content → update exceeds 1MB threshold → immediately flushed without waiting for timeout
3. **Time Threshold**: User makes small edits over 5 seconds → batch timeout triggers → all queued updates coalesced and persisted
4. **Application Crash**: Updates queued but not flushed → on restart, recovery mechanism ensures no data loss

---

## DATA MODEL SKELETON (suggested)
No database changes needed. Batching operates at the adapter level:

```typescript
interface BatchingConfig {
  maxBatchSize: number;        // Max updates before flush (e.g., 100)
  maxBatchSizeBytes: number;   // Max size before flush (e.g., 1MB)
  batchTimeout: number;        // Max time before flush in ms (e.g., 2000)
  debounceMs: number;          // Debounce delay in ms (e.g., 300)
  coalesce: boolean;           // Whether to merge updates (default: true)
}

interface BatchMetrics {
  totalBatches: number;
  totalUpdates: number;
  averageBatchSize: number;
  compressionRatio: number;
  flushReasons: {
    timeout: number;
    size: number;
    count: number;
    manual: number;
  };
}
```

---

## IMPLEMENTATION HINTS (for agents/developers)
- Use `Y.mergeUpdates(updates: Uint8Array[]): Uint8Array` to coalesce multiple updates
- Implement per-document queues to avoid blocking between documents
- Use `setTimeout` for batch timeouts, `clearTimeout` when flushing early
- Add `flush()` method for forced immediate persistence (e.g., before app close)
- Consider using `queueMicrotask` or `requestIdleCallback` for better timing
- Track batch metrics for performance monitoring and auto-tuning
- Ensure error handling doesn't lose queued updates
- Add event emitters for batch lifecycle (queued, flushing, flushed)
- Platform configs: Web (2s timeout, 1MB), Electron (500ms timeout, 256KB)

---

## VALIDATION GATES (runnable commands)
Agents must run these steps and include results in the attempt log.

**Syntax / Types**
```bash
npm run lint
npm run type-check
```

**Unit Tests**
```bash
# Run new batching tests
npm run test -- batching-provider.test.ts
```

**Integration Tests**
```bash
# Test with real adapters
docker compose up -d postgres
npm run test:integration -- --batching
```

**Performance Tests**
```bash
# Verify write reduction
npm run test:performance -- batching-metrics
```

**Stress Tests**
```bash
# Test under load
npm run test:stress -- rapid-updates
```

---

## ERRORS / KNOWN FAILURES (living log)
*(Append here after each attempt — include concise root-cause + reproduction + hint)*

```yaml
# Example structure for future entries
# - attempt: 1
#   date: 2025-08-23T17:00:00Z
#   actor: "execute-prp (Claude)"
#   branch: feat/update-batching
#   summary: "Updates lost when batch timeout and size threshold hit simultaneously"
#   reproduction_cmd: "npm test -- batching-provider.test.ts --grep 'concurrent thresholds'"
#   root_cause: "Race condition between timeout and size flush handlers"
#   logs_excerpt: |
#     Expected 100 updates, received 50
#   suggested_fix: "Use mutex or queue to serialize flush operations"
#   artifacts: ["test-output.log"]
#   resolved: false
```

---

## ATTEMPT HISTORY (chronological)
Agents append attempts here (auto-increment `iteration_count`).

*(To be populated during implementation)*

---

## NEXT STEPS / TODO (short & actionable)
- [ ] Create `lib/persistence/batching-provider.ts` stub file
- [ ] Design queue data structure for per-document batching
- [ ] Implement basic time-based batching without coalescing
- [ ] Add update coalescing with Y.mergeUpdates
- [ ] Create comprehensive test suite for edge cases
- [ ] Add configuration presets for Web/Electron platforms
- [ ] Document migration guide for existing deployments

---

## ESCALATION POLICY
- If data loss detected in any test → STOP immediately and review queue persistence
- If performance regression >10% → investigate before proceeding
- If memory usage grows unbounded → add queue size limits
- If coalescing produces invalid updates → disable and investigate YJS compatibility

---

## NOTES / COMMENTS
- This is a pure optimization - no functional changes to the application
- Must be completely transparent to the rest of the codebase
- Consider future enhancement: Write-Ahead Logging for crash recovery
- Monitor production metrics to tune default configurations
- Future: Could add smart batching based on operation types (e.g., flush on structural changes)