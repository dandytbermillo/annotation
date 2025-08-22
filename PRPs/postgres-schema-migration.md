# PostgreSQL Schema Migration PRP
**CRITICAL CONSTRAINT**: Yjs remains the runtime CRDT. Awareness/presence data is ephemeral and must NEVER be persisted to PostgreSQL.

## Goal
Design and implement PostgreSQL database schema for persisting YJS document state, annotations, panels, and snapshots while maintaining compatibility with the existing Yjs-based real-time collaboration system.

## Why
- Enable scalable, queryable persistence beyond IndexedDB limitations
- Support cross-device synchronization and backup/restore capabilities  
- Provide foundation for analytics and future Infinite Canvas OS integration
- Maintain data integrity with proper foreign keys and constraints

## What
Create PostgreSQL schema that mirrors the Yjs document structure while optimizing for relational database patterns. The schema must support efficient queries, concurrent updates, and preserve Yjs state encoding.

### Success Criteria
- [ ] All YJS document state can be persisted and restored without data loss
- [ ] Schema supports efficient queries for notes, annotations, and panels
- [ ] Migrations are idempotent and include rollback procedures
- [ ] Performance benchmarks show <100ms for typical read/write operations
- [ ] Schema supports future tagging system without breaking changes

## All Needed Context

### Documentation & References
```yaml
- file: docs/yjs-annotation-architecture.md
  why: Document structure defines what needs persistence (lines 90-153)
  
- file: INITIAL.md
  why: Data model skeleton provides initial schema design (lines 74-78)
  
- url: https://www.postgresql.org/docs/current/datatype-json.html
  why: JSONB type for flexible metadata storage
  
- url: https://github.com/yjs/yjs#document-updates
  why: Understanding Y.encodeStateAsUpdate for bytea storage
```

### Current Yjs Document Structure to Persist
```
Main Y.Doc
├── branches: Y.Map (annotations)
├── metadata: Y.Map (panels, connections)  
├── editors: Y.Map (content subdocs)
└── snapshots: Y.Map (periodic backups)

Note: presence/awareness is ephemeral - DO NOT PERSIST
```

### Known Gotchas
- Yjs state updates must be stored as bytea (binary) not text
- RelativePosition anchors require bytea storage with jsonb fallback
- Panel positions/dimensions use jsonb for flexibility
- Use UUID v4 for all IDs to match existing TypeScript types
- Timestamp columns should use timestamptz for timezone safety

## Implementation Blueprint

### Database Schema
```sql
-- Core tables for YJS persistence

-- Notes table (main documents)
CREATE TABLE notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    deleted_at TIMESTAMPTZ -- Soft delete support
);

-- Annotations/branches table
CREATE TABLE annotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('note', 'explore', 'promote')),
    source_panel_id UUID NOT NULL,
    target_panel_id UUID NOT NULL,
    -- Yjs RelativePosition stored as binary
    anchor_start BYTEA NOT NULL,
    anchor_end BYTEA NOT NULL,
    -- Fallback for anchor recovery
    anchors_fallback JSONB NOT NULL DEFAULT '{}',
    original_text TEXT,
    metadata JSONB DEFAULT '{}',
    "order" TEXT NOT NULL, -- Fractional index as string
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Panels table (canvas panels)
CREATE TABLE panels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    title TEXT,
    type TEXT DEFAULT 'editor',
    parent_id UUID REFERENCES panels(id) ON DELETE SET NULL,
    position JSONB NOT NULL DEFAULT '{"x": 0, "y": 0}',
    dimensions JSONB NOT NULL DEFAULT '{"width": 400, "height": 300}',
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'lazy', 'unloaded')),
    last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- YJS document updates (event sourcing)
CREATE TABLE yjs_updates (
    id BIGSERIAL PRIMARY KEY,
    doc_name TEXT NOT NULL, -- Format: 'note:{uuid}' or 'panel:{uuid}'
    update BYTEA NOT NULL, -- Y.encodeStateAsUpdate
    client_id TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Index for efficient loading
    INDEX idx_yjs_updates_doc_timestamp (doc_name, timestamp DESC)
);

-- Snapshots for recovery
CREATE TABLE snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    doc_name TEXT NOT NULL,
    snapshot BYTEA NOT NULL, -- Full YJS state
    panels TEXT[], -- Array of panel IDs included
    checksum TEXT NOT NULL, -- SHA256 of snapshot
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Keep only recent snapshots
    UNIQUE(note_id, doc_name, created_at)
);

-- Panel connections
CREATE TABLE connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    from_panel_id UUID NOT NULL REFERENCES panels(id) ON DELETE CASCADE,
    to_panel_id UUID NOT NULL REFERENCES panels(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'annotation',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_annotations_note_id ON annotations(note_id);
CREATE INDEX idx_annotations_panels ON annotations(source_panel_id, target_panel_id);
CREATE INDEX idx_panels_note_id ON panels(note_id);
CREATE INDEX idx_panels_state ON panels(state) WHERE state != 'unloaded';
CREATE INDEX idx_snapshots_note_created ON snapshots(note_id, created_at DESC);
CREATE INDEX idx_connections_panels ON connections(from_panel_id, to_panel_id);

-- Updated timestamp triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_notes_updated BEFORE UPDATE ON notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    
CREATE TRIGGER update_annotations_updated BEFORE UPDATE ON annotations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    
CREATE TRIGGER update_panels_updated BEFORE UPDATE ON panels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### Migration Management
```sql
-- migrations/001_initial_schema.up.sql
BEGIN;
-- All CREATE TABLE statements above
COMMIT;

-- migrations/001_initial_schema.down.sql  
BEGIN;
DROP TABLE IF EXISTS connections CASCADE;
DROP TABLE IF EXISTS snapshots CASCADE;
DROP TABLE IF EXISTS yjs_updates CASCADE;
DROP TABLE IF EXISTS panels CASCADE;
DROP TABLE IF EXISTS annotations CASCADE;
DROP TABLE IF EXISTS notes CASCADE;
DROP FUNCTION IF EXISTS update_updated_at() CASCADE;
COMMIT;
```

### Future Tagging Support (pre-allocated)
```sql
-- Reserved for next feature
-- CREATE TABLE tags (id, name, color)
-- CREATE TABLE note_tags (note_id, tag_id)
-- CREATE TABLE annotation_tags (annotation_id, tag_id)
-- CREATE TABLE panel_tags (panel_id, tag_id)
```

## Validation Loop

### Level 1: Schema Validation
```bash
# Test migrations up/down
docker compose up -d postgres
psql $POSTGRES_URL -f migrations/001_initial_schema.up.sql
psql $POSTGRES_URL -c "\dt" # Should show all tables
psql $POSTGRES_URL -f migrations/001_initial_schema.down.sql
psql $POSTGRES_URL -c "\dt" # Should show no tables
```

### Level 2: Data Integrity Tests
```sql
-- Test foreign key constraints
INSERT INTO panels (note_id) VALUES (gen_random_uuid());
-- Should fail with FK violation

-- Test check constraints  
INSERT INTO annotations (note_id, type, source_panel_id, target_panel_id, anchor_start, anchor_end, "order")
VALUES (gen_random_uuid(), 'invalid', gen_random_uuid(), gen_random_uuid(), '\x00', '\x00', '1');
-- Should fail with check constraint violation
```

### Level 3: Performance Benchmarks
```sql
-- Insert 10k updates and measure query time
EXPLAIN ANALYZE
SELECT update FROM yjs_updates 
WHERE doc_name = 'note:test-uuid' 
ORDER BY timestamp DESC 
LIMIT 100;
-- Should use index and complete < 10ms
```

## Final Validation Checklist
- [ ] All migrations run without errors
- [ ] Rollback migrations work correctly
- [ ] Foreign keys enforce data integrity
- [ ] Indexes improve query performance
- [ ] No awareness/presence data is persisted
- [ ] Schema supports all Yjs document types
- [ ] Future tagging system considered

## Anti-Patterns to Avoid
- ❌ Don't store Yjs state as JSON/text (use bytea)
- ❌ Don't persist awareness/presence data
- ❌ Don't use serial IDs (use UUID v4)
- ❌ Don't forget timezone (use timestamptz)
- ❌ Don't skip indexes on foreign keys
- ❌ Don't make non-idempotent migrations