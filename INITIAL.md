# Feature Request: PostgreSQL Persistence for Notes & Metadata

## Metadata
- **author:** Dandy Bermillo
- **created_at:** 2025-08-20T10:00:00Z
- **status:** draft
- **priority:** high
- **target_branch:** feat/postgres-persistence
- **estimated_risk:** medium
- **related_prs:** 
- **iteration_count:** 0

---

## SUMMARY
Migrate local persistence from IndexedDB to a local PostgreSQL instance. All note content, metadata, annotation branches, panel states, and periodic snapshots should be saved and retrieved from Postgres while still supporting YJS real-time collaboration. IndexedDB remains as an offline-first fallback.

---

## MOTIVATION / WHY
- Current IndexedDB persistence limits scalability and cross-device migration.
- PostgreSQL provides robust, queryable storage suitable for backups, analytics, and integration with the Infinite Canvas Knowledge Base OS.
- This project must support both Web (Next.js) and local (Electron) deployments to enable local-first and server-based workflows.

---

## SCOPE (WHAT)

**In scope**
- Implement `lib/adapters/postgres-adapter.ts` (Postgres persistence adapter).
- Wire Postgres adapter into the provider/adapter selection flow for Web and Electron.
- Persist notes, annotations, branches, panels, and snapshots to Postgres.
- Provide DB migration scripts and example seed data.
- Retain IndexedDB as offline fallback and a migration path for sync-on-reconnect.

**Out of scope**
- Minimap UI (handled later by the Infinite Canvas OS integration).
- Advanced full-text search and analytics (considered as a follow-up feature).

---

## ACCEPTANCE CRITERIA
- [ ] `lib/adapters/postgres-adapter.ts` implemented and exported.
- [ ] Notes, annotations, branches, and panels can be saved to and loaded from Postgres.
- [ ] Periodic snapshots are written to a `snapshots` table and can be used to restore state.
- [ ] IndexedDB fallback remains functional when Postgres is unavailable.
- [ ] Integration tests pass in both Web and Electron environments (CI runs with Postgres).
- [ ] Documentation updated (`docs/enhanced-architecture-migration-guide.md`, README, `.env.example`).

---

## DOCUMENTATION & REFERENCES
- docs/annotation_workflow.md
- docs/enhanced-architecture-migration-guide.md
- docs/yjs-annotation-architecture.md ← **authoritative architecture doc.** All implementations must comply.  
  **Exception:** persistence layer must use PostgreSQL instead of IndexedDB.
- PRP template: PRPs/templates/prp_base.md
- Generate/execute commands: .claude/commands/generate-prp.md, .claude/commands/execute-prp.md
- Example adapter (if available): lib/adapters/indexeddb-adapter.ts
- External reference: https://node-postgres.com/ (pg client docs)

> NOTE: Agents and developers must read `docs/yjs-annotation-architecture.md` first. Preserve YJS design principles (single provider, subdocs, RelativePosition anchors). Replace only the persistence implementation to use Postgres while keeping YJS as the runtime CRDT.

---

## EXAMPLES & SAMPLE FLOWS
1. Create annotation → annotation record stored in `annotations` table AND YJS doc updated.
2. Move panel → `panels` table position updated.
3. Periodic snapshot (e.g., every 5 minutes) → serialized YJS state stored in `snapshots` table for recovery.
4. Offline edit → writes to IndexedDB; on reconnect, changes merge into Postgres via YJS update reconciliation.

---

## DATA MODEL SKELETON (suggested)
- **notes** (id uuid, title text, created_at timestamptz, updated_at timestamptz, metadata jsonb)
- **annotations** (id uuid, note_id uuid, type text, anchors bytea/jsonb, metadata jsonb, version int)
- **panels** (id uuid, note_id uuid, position jsonb, dimensions jsonb, state text, last_accessed timestamptz)
- **snapshots** (id uuid, note_id uuid, snapshot bytea, created_at timestamptz)

---

## IMPLEMENTATION HINTS (for agents/developers)
- Use `Y.encodeStateAsUpdate(doc)` to capture YJS state; store as `bytea` in Postgres.
- For per-annotation anchors, consider storing the encoded RelativePosition and a small fallback context for recovery.
- Use `pg.Pool` for connection pooling and add retry/backoff logic for transient errors.
- Upserts: use `INSERT ... ON CONFLICT (id) DO UPDATE` for idempotent writes.
- Do not persist ephemeral awareness state (keep awareness ephemeral in-memory).
- Ensure migrations are idempotent and include rollback where possible.
- Provide clear, fast-failing errors when required env vars (e.g., `POSTGRES_URL`) are missing.

---

## VALIDATION GATES (runnable commands)
**Syntax / Types**
```bash
npm run lint
npm run type-check
# or
pnpm lint && pnpm type-check
```

**Unit Tests**
```bash
npm run test
```

**Integration Tests (requires Postgres)**
```bash
# Start local Postgres
docker compose up -d postgres

# Run integration tests
npm run test:integration
```

**E2E / UX (Playwright)**
```bash
npm run test:e2e
```

---

## ERRORS / KNOWN FAILURES (living log)
*(Append concise root-cause entries after each attempt; link to full logs in `ci/` or `docs/error-log.md`.)*

```yaml
# Example
# - attempt: 1
#   date: 2025-08-20T10:12:00Z
#   actor: "execute-prp (Claude)"
#   branch: feat/postgres-persistence
#   summary: "Integration tests failed: cannot connect to Postgres"
#   reproduction_cmd: "docker compose up -d postgres && npm run test:integration"
#   root_cause: "POSTGRES_URL not set in .env.local during CI; adapter assumed env var"
#   logs_excerpt: |
#     Error: connect ECONNREFUSED 127.0.0.1:5432
#   suggested_fix: "Update docs to require .env.local and add CI docker step; adapter should fail fast with clear message"
#   artifacts: ["ci/logs/integration-run-2025-08-20.txt"]
#   resolved: false
```

---

## ATTEMPT HISTORY (chronological)
*(Agents append attempts here and increment `iteration_count`.)*

```yaml
# - attempt: 1
#   actor: PlannerAgent
#   action_summary: "Generated PRP and created feat/postgres-persistence branch"
#   timestamp: 2025-08-20T10:05:00Z
#   pr_link: ""
#   result: "tests failed"
#   errors_ref: "Errors entry attempt:1"
```

---

## NEXT STEPS / TODO (short & actionable)
- [ ] Add `POSTGRES_URL` env var docs to README and `.env.example`.
- [ ] Implement database migration scripts (e.g. `migrations/001_create_annotations.sql`).
- [ ] Write Playwright scenario: multi-client annotation create + persistence check.
- [ ] Create `lib/adapters/postgres-adapter.ts` stub to allow PRP generation to reference a concrete file.

---

## ESCALATION POLICY
- If `iteration_count >= 5` and last error `resolved: false` → tag `@maintainer` and open `docs/error-log.md` with full context.
- If any failing test indicates `security` or `data-loss`, stop automated runs and notify a human immediately.

---

## NOTES / COMMENTS
- Keep the `yjs-annotation-architecture.md` as the canonical architecture reference. Only swap IndexedDB persistence for Postgres; preserve subdoc/RelativePosition and other YJS patterns.

## ENVIRONMENT SETUP
- Local Postgres is provisioned via `docker-compose.yml` in repo root.
- Start with: `docker compose up -d postgres`
- Default credentials: see `.env` or `docker-compose.yml`
- Agents must **not** reimplement Postgres setup; only use the existing service.
