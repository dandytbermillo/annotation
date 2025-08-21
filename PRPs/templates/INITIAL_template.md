# Feature Request: <SHORT FEATURE TITLE>
<!-- e.g. PostgreSQL Persistence for Notes & Metadata -->

## Metadata
- **author:** <your-name-or-agent>
- **created_at:** YYYY-MM-DDTHH:MM:SSZ
- **status:** draft / in-progress / blocked / done
- **priority:** low / medium / high
- **target_branch:** feat/<short-name>
- **estimated_risk:** low / medium / high
- **related_prs:** (leave blank — agents add PR links)
- **iteration_count:** 0

---

## SUMMARY
A one-paragraph summary of the feature and expected user-visible behavior.

Example:
Migrate document persistence from IndexedDB to PostgreSQL so that notes, annotations, panels, snapshots, and metadata are stored in Postgres while keeping YJS as the live CRDT state and retaining IndexedDB as an offline fallback.

---

## MOTIVATION / WHY
- Business value and user impact (short bullets).
- Why this is needed now and how it integrates with the Infinite Canvas OS roadmap.
- Any non-functional goals (scalability, backups, cross-device sync).

---

## SCOPE (WHAT)
Clear scope: what will be changed and what will not.

**In scope**
- Create `lib/adapters/postgres-adapter.ts`.
- Wire Postgres adapter into provider selection (web vs electron).
- Persist notes, annotations, panels, snapshots.
- Add DB migrations.

**Out of scope**
- Minimap UI (handled by Infinite Canvas OS later).
- Full-text search (may be next feature).

---

## ACCEPTANCE CRITERIA
- [ ] PostgresPersistenceAdapter implemented in `lib/adapters/postgres-adapter.ts`.
- [ ] Can save/load notes, annotations, panels, snapshots.
- [ ] Automatic snapshot creation and restore verified.
- [ ] IndexedDB fallback remains for offline mode.
- [ ] Unit + integration + e2e tests pass.
- [ ] Works in Web (via API or direct connection) and Electron (local DB).

---

## DOCUMENTATION & REFERENCES
List every authoritative doc / file / external URL an agent must load.

- docs/annotation_workflow.md
- docs/enhanced-architecture-migration-guide.md
- docs/yjs-annotation-architecture.md  ← **authoritative architecture doc**
- PRP template: PRPs/templates/prp_base.md
- Generate/execute commands: .claude/commands/generate-prp.md, .claude/commands/execute-prp.md
- Example adapter (if available): lib/adapters/indexeddb-adapter.ts
- (External) Postgres client docs: https://node-postgres.com/ (agent: include specific link)

> NOTE: `yjs-annotation-architecture.md` is required reading. **Exception:** replace IndexedDB persistence with PostgreSQL; all other architecture rules remain mandatory.

---

## EXAMPLES & SAMPLE FLOWS
Short, concrete user flows to use as tests and UX-checks.

1. Create annotation -> new annotation record exists in `annotations` table and YJS doc is updated.
2. Move panel -> `panels` table position updated.
3. Create snapshot -> `snapshots` table contains serialized YJS update.
4. Offline edit (no DB) -> changes saved to IndexedDB, when connectivity returns they are migrated/merged to Postgres.

---

## DATA MODEL SKELETON (suggested)
Minimal suggested table names and fields (agents may propose refinements).

- notes (id uuid, title text, created_at timestamptz, updated_at timestamptz, metadata jsonb)
- annotations (id uuid, note_id uuid, type text, anchors bytea/jsonb, metadata jsonb, version int)
- panels (id uuid, note_id uuid, position jsonb, dimensions jsonb, state text, last_accessed timestamptz)
- snapshots (id uuid, note_id uuid, snapshot bytea, created_at timestamptz)

---

## IMPLEMENTATION HINTS (for agents/developers)
- Use `Y.encodeStateAsUpdate(doc)` to persist YJS state as `bytea`.
- Use `ON CONFLICT (id) DO UPDATE` for upserts.
- Ensure Postgres connections use a pool (e.g., `pg.Pool`) and proper retry/backoff.
- Do not persist ephemeral awareness state; keep awareness ephemeral in-memory.

---

## VALIDATION GATES (runnable commands)
Agents must run these steps and include results in the attempt log.

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
docker compose up -d postgres
npm run test:integration
```

**E2E / UX (Playwright)**
```bash
npm run test:e2e
```

---

## ERRORS / KNOWN FAILURES (living log)
*(Append here after each attempt — include concise root-cause + reproduction + hint)*

Structure per entry:

```yaml
- attempt: 1
  date: 2025-08-20T10:00:00Z
  actor: "execute-prp (Claude) / Coder-Agent / human"
  branch: feat/postgres-persistence
  summary: "Integration tests failed: cannot connect to Postgres"
  reproduction_cmd: "docker compose up -d postgres && npm run test:integration"
  root_cause: "POSTGRES_URL not set in .env.local during CI; adapter assumed env var"
  logs_excerpt: |
    Error: connect ECONNREFUSED 127.0.0.1:5432
  suggested_fix: "Update docs to require .env.local and add CI docker step; add clear error if env missing"
  artifacts: ["ci/logs/integration-run-2025-08-20.txt", "pr/123"]
  resolved: false
```

**Guidelines**:
- Keep `logs_excerpt` short (1-10 lines). Link to full logs stored in `ci/` or `docs/error-log.md`.
- `root_cause` must be a single-sentence diagnosis.
- `suggested_fix` helps the next agent write code/tests.

---

## ATTEMPT HISTORY (chronological)
Agents append attempts here (auto-increment `iteration_count`).

Example entry:
```yaml
- attempt: 1
  actor: PlannerAgent
  action_summary: "Generated PRP and created feat/postgres-persistence branch"
  timestamp: 2025-08-20T10:05:00Z
  pr_link: https://github.com/your/repo/pull/123
  result: "tests failed"
  errors_ref: "Errors entry attempt:1"
- attempt: 2
  actor: CoderAgent
  action_summary: "Added pool config and .env check"
  timestamp: 2025-08-20T11:20:00Z
  pr_link: https://github.com/your/repo/pull/124
  result: "integration tests passed; e2e failing on missing minimap references"
  errors_ref: "Errors entry attempt:2"
```

---

## NEXT STEPS / TODO (short & actionable)
- [ ] Add `POSTGRES_URL` env var docs to README and `.env.example`.
- [ ] Implement database migration scripts (e.g. `migrations/001_create_annotations.sql`).
- [ ] Write Playwright scenario: multi-client annotation create + persistence check.

---

## ESCALATION POLICY
- If `iteration_count >= 5` and `resolved: false` for last error → tag `@maintainer` and open `docs/error-log.md` with full context.
- If any test fails with `security` or `data-loss` category, stop automated runs and notify a human immediately.

---

## NOTES / COMMENTS
Free-form notes or links to related tickets, design docs, or Slack threads.
