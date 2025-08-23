# Feature Request: Phase 2A - Complete Core PostgreSQL Features

## Metadata
- **author:** Claude/Agent-OS
- **created_at:** 2025-08-23T14:30:00Z
- **status:** draft
- **priority:** high
- **target_branch:** feat/postgres-core-features
- **estimated_risk:** medium
- **related_prs:** (previous PR: postgres-persistence implementation)
- **iteration_count:** 0

---

## SUMMARY
Complete the core PostgreSQL persistence features by implementing snapshot/compaction for performance optimization, adding proper note deletion with cascade cleanup, fixing all failing tests, and adding Electron direct PostgreSQL support. This phase focuses on making the existing PostgreSQL implementation production-ready with proper data lifecycle management and cross-platform support.

---

## MOTIVATION / WHY
- **Performance**: Current implementation replays all YJS updates on every load, causing performance degradation over time
- **Data Integrity**: Deleted notes remain in database forever, causing storage bloat and potential privacy issues
- **Test Coverage**: Multiple failing tests indicate unstable implementation that needs hardening
- **Platform Parity**: Electron apps need direct PostgreSQL connection for better performance and offline capabilities
- **Production Readiness**: These features are essential for enterprise deployment and data governance

---

## SCOPE (WHAT)
Clear scope: what will be changed and what will not.

**In scope**
- Implement YJS snapshot creation and loading in `lib/adapters/postgres-adapter.ts`
- Add compaction logic to merge old updates into snapshots
- Create note deletion API and cascade cleanup logic
- Fix all failing tests in postgres-adapter.test.ts, persistence.test.ts
- Add Electron-specific PostgreSQL direct connection support
- Create migration for soft-delete columns (deleted_at)
- Add scheduled compaction job/trigger
- Rename `annotations` table to `branches` for consistency

**Out of scope**
- Structured table population (notes, branches, panels tables)
- Full-text search implementation
- Multi-tenant support
- Admin dashboard UI
- Migration tools from IndexedDB

---

## ACCEPTANCE CRITERIA
- [ ] Snapshot/compaction implemented and automatically triggered after N updates
- [ ] Note deletion removes all related data (updates, snapshots, future: branches, panels)
- [ ] All existing tests pass (npm run test shows no failures)
- [ ] Electron apps connect directly to PostgreSQL without API routes
- [ ] Soft delete with deleted_at timestamps implemented
- [ ] Performance: Loading document with 1000+ updates takes <500ms
- [ ] Compaction reduces storage by >80% for documents with many updates
- [ ] Delete operation cascades properly and notifies other clients
- [ ] `annotations` table renamed to `branches` throughout codebase

---

## DOCUMENTATION & REFERENCES
List every authoritative doc / file / external URL an agent must load.

- docs/yjs-annotation-architecture.md ← **authoritative architecture doc**
- docs/note-deletion-process.md ← deletion implementation guide created earlier
- lib/adapters/postgres-adapter.ts ← existing adapter to enhance
- lib/adapters/postgres-api-adapter.ts ← API adapter for browser
- lib/adapters/electron-adapter.ts ← needs PostgreSQL integration
- tests/adapters/postgres-adapter.test.ts ← failing tests to fix
- migrations/001_initial_schema.up.sql ← schema to extend/rename
- https://github.com/yjs/yjs/blob/main/INTERNALS.md#snapshots ← YJS snapshot docs
- https://node-postgres.com/features/transactions ← for cascade deletes
- PRPs/postgres-persistence-fix-enhanced.md ← previous implementation

---

## EXAMPLES & SAMPLE FLOWS
Short, concrete user flows to use as tests and UX-checks.

1. **Snapshot Creation**: After 100 updates → snapshot created → old updates deleted → loading uses snapshot + recent updates only
2. **Note Deletion**: User deletes note → UI removes panel → API called → all yjs_updates, snapshots for that note deleted → other clients notified
3. **Electron Direct Connection**: Electron app starts → detects electron environment → connects directly to local/remote PostgreSQL → no API routes used
4. **Compaction Performance**: Document with 1000 updates → compaction runs → creates single snapshot → next load 10x faster

---

## DATA MODEL SKELETON (suggested)
Schema additions needed:

```sql
-- First rename annotations to branches for consistency
ALTER TABLE annotations RENAME TO branches;

-- Add soft delete support
ALTER TABLE notes ADD COLUMN deleted_at TIMESTAMP;
ALTER TABLE panels ADD COLUMN deleted_at TIMESTAMP;
ALTER TABLE branches ADD COLUMN deleted_at TIMESTAMP;

-- Add snapshot metadata
ALTER TABLE snapshots ADD COLUMN update_count INTEGER DEFAULT 0;
ALTER TABLE snapshots ADD COLUMN size_bytes INTEGER;

-- Add compaction tracking
CREATE TABLE compaction_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_name TEXT NOT NULL,
  updates_before INTEGER,
  updates_after INTEGER,
  snapshot_size INTEGER,
  duration_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Update any foreign key constraints to reference branches instead of annotations
-- Update any indexes that reference annotations table
```

---

## IMPLEMENTATION HINTS (for agents/developers)
- Use `Y.snapshot(doc)` and `Y.snapshotFromUpdate()` for snapshot operations
- Implement cascade deletes with PostgreSQL transactions for consistency
- For Electron, check `process.versions.electron` to detect environment
- Use `pg.Pool` with different configs for Electron (local) vs Web (remote)
- Compact when update count > 100 or total size > 1MB
- Soft deletes: UPDATE with deleted_at, add WHERE deleted_at IS NULL to queries
- Use background job or PostgreSQL trigger for auto-compaction
- Test snapshot restore thoroughly - corrupted snapshots can lose data
- Remember to update all references from `annotations` to `branches` in code

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
npm run test -- postgres-adapter.test.ts
```

**Integration Tests (requires Postgres)**
```bash
docker compose up -d postgres
npm run test:integration
```

**Performance Test (new)**
```bash
# Create test to verify <500ms load time with 1000 updates
npm run test:performance -- snapshot-loading
```

**Electron Test (new)**
```bash
# Run in Electron environment
npm run test:electron -- postgres-direct
```

---

## ERRORS / KNOWN FAILURES (living log)
*(To be populated during implementation)*

Current known issues from previous phase:
```yaml
- attempt: 0
  date: 2025-08-23T14:00:00Z
  actor: "previous implementation"
  branch: postgres-persistence
  summary: "Tests failing: postgres-client-adapter.test.ts, persistence.test.ts"
  reproduction_cmd: "npm test"
  root_cause: "Mock setup issues and missing crypto.subtle in test environment"
  logs_excerpt: |
    Cannot read properties of undefined (reading 'subtle')
    Expected substring: "Failed to persist update: Internal Server Error"
  suggested_fix: "Add proper test environment setup for crypto, fix mock expectations"
  artifacts: ["test output from previous run"]
  resolved: false
```

---

## ATTEMPT HISTORY (chronological)
Agents append attempts here (auto-increment `iteration_count`).

*(To be populated during implementation)*

---

## NEXT STEPS / TODO (short & actionable)
- [ ] Run existing tests to catalog all failures
- [ ] Design snapshot storage strategy (frequency, triggers)
- [ ] Create cascade delete transaction logic
- [ ] Add Electron environment detection to platform-detection.ts
- [ ] Write performance benchmarks for before/after compaction
- [ ] Document snapshot recovery process
- [ ] Create migration script for annotations → branches rename

---

## ESCALATION POLICY
- If snapshot implementation causes data loss in any test → STOP and escalate immediately
- If cascade delete affects unrelated documents → STOP and review transaction boundaries
- If Electron connection affects Web deployment → revert and redesign
- Performance regression >20% → investigate before proceeding

---

## NOTES / COMMENTS
- Phase 2A focuses on production readiness before adding features
- Snapshot/compaction is critical for long-running documents
- Note deletion must be bulletproof to avoid orphaned data
- Consider adding metrics collection for compaction effectiveness
- Future Phase 2B will populate structured tables for SQL queries
- Important: The `annotations` → `branches` rename ensures consistency with UI terminology