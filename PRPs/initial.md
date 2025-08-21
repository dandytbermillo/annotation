# Feature Request: PostgreSQL Persistence for Notes & Metadata

## SUMMARY
Migrate local persistence from IndexedDB to PostgreSQL running locally. All note content, metadata, annotation branches, and panel states should be saved and retrieved from Postgres, while still supporting YJS real-time collaboration.

## MOTIVATION
- Current IndexedDB persistence limits scalability and cross-device migration
- PostgreSQL will provide robust, queryable storage
- This project will eventually integrate into the Infinite Canvas Knowledge Base OS (which will have its own minimap system)
- This project must run both as Web (Next.js) and local (Electron) app

## EXAMPLES
- Annotation creation → stored in `annotations` table
- Panel movement → updated in `panels` table
- Snapshots every 5 minutes → stored in `snapshots` table

## DOCUMENTATION
- Annotation Workflow: `docs/annotation_workflow.md`
- Enhanced YJS Provider: `lib/enhanced-yjs-provider.ts`
- Migration Guide: `docs/enhanced-architecture-migration-guide.md`

## EDGE CASES
- Offline mode: fallback to IndexedDB
- Conflict resolution: YJS merge before DB commit
- Large datasets: handle 1000+ panels
- Transactions: atomic updates for annotation + branch

## ACCEPTANCE CRITERIA
- [ ] New PostgresPersistenceAdapter (`lib/adapters/postgres-adapter.ts`)
- [ ] Notes, annotations, branches, panels persisted to Postgres
- [ ] Snapshots stored + restorable
- [ ] IndexedDB fallback remains for offline
- [ ] Integration tests pass with both Web + Electron

## NEXT STEPS
- Add Tagging System (tags stored in DB, attachable to annotations or panels)


## ENVIRONMENT SETUP
- Local Postgres is provisioned via `docker-compose.yml` in repo root.
- Start with: `docker compose up -d postgres`
- Default credentials: see `.env` or `docker-compose.yml`
- Agents must **not** reimplement Postgres setup; only use the existing service.