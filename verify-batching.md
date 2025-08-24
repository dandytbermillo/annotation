# How to Verify Batching Optimization is Working

## 1. Start the Application

```bash
# Start PostgreSQL
docker compose up -d postgres

# Run the development server
npm run dev
```

## 2. Open Browser DevTools Console

The batching provider logs metrics to the console. Look for these messages:

```javascript
// When typing in the editor or moving panels:
"Batching metrics:", {
  totalEnqueued: 45,      // Total updates queued
  totalFlushed: 3,        // Actual database writes
  totalCoalesced: 42,     // Updates merged together
  writeReduction: "93.33%", // Percentage reduction
  avgBatchSize: 15,       // Average updates per batch
  avgFlushTime: 12        // Average flush time in ms
}
```

## 3. Add Console Logging (Optional)

To see real-time batching activity, add this temporary code to `app/page.tsx`:

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    const provider = (window as any).yjsProvider;
    if (provider?.getBatchingMetrics) {
      const metrics = provider.getBatchingMetrics();
      console.log('Batching metrics:', metrics);
    }
  }, 5000); // Log every 5 seconds

  return () => clearInterval(interval);
}, []);
```

## 4. Monitor PostgreSQL Directly

Open a new terminal and connect to PostgreSQL:

```bash
# Connect to the database
docker exec -it postgres-persistence-postgres-1 psql -U postgres -d collaborative_notes

# Watch the yjs_updates table
\watch 2
SELECT COUNT(*) as total_updates, 
       MAX(created_at) as last_update 
FROM yjs_updates 
WHERE doc_name = 'YOUR_NOTE_ID';
```

## 5. Expected Behavior

### WITHOUT Batching (Old Behavior):
- Every keystroke = 1 database write
- Moving a panel = multiple database writes
- Database writes happen immediately

### WITH Batching (New Behavior):
- Multiple keystrokes = 1 database write after 300ms pause
- Continuous typing = 1 write every 2 seconds
- Panel movements = batched together
- 90%+ reduction in database writes

## 6. Test Scenarios

### Test 1: Rapid Typing
1. Open a note
2. Type quickly for 10 seconds
3. Check console - should show high coalesce rate

### Test 2: Panel Movement
1. Move a panel around continuously
2. Stop moving
3. Check console - multiple moves = 1 database write

### Test 3: Batch Size Limit
1. Make 100+ rapid changes
2. Should see automatic flush at 100 updates

### Test 4: Browser Shutdown
1. Make some changes
2. Close the browser tab
3. Reopen - changes should be persisted

## 7. Verification Checklist

- [ ] Console shows batching metrics
- [ ] writeReduction > 90%
- [ ] Database writes happen in batches, not per-keystroke
- [ ] No data loss on browser close
- [ ] Performance feels smooth

## 8. Troubleshooting

If batching doesn't seem to work:

1. Check browser console for errors
2. Verify `enhanced-yjs-provider.ts` is using BatchingPersistenceProvider
3. Check that persistence adapter supports batching
4. Look for "Batching provider initialized" in console logs