# Project Conventions – YJS-Based Collaborative Annotation System

## CODE STYLE
- Language: TypeScript + React + Next.js 15
- Collaboration: YJS (CRDT), TipTap Editor
- Styling: Tailwind + Radix UI
- Animations: Framer Motion
- Persistence: PostgreSQL (primary), IndexedDB (fallback)

## UX PRINCIPLES
- Canvas-based interaction with draggable, zoomable panels
- Branch-based annotation model (Note/Explore/Promote)
- Breadcrumb navigation across annotation depth
- Real-time awareness (cursors, selections, viewports)

## TESTING
- Unit tests: Jest
- Integration tests: Playwright (annotation workflow, DB persistence)
- New DB adapter features require DB integration tests

## DATA MODEL (Postgres)
- `notes`: id, title, content
- `annotations`: id, type, sourcePanel, targetPanel, anchors (Y.RelativePosition), metadata, order
- `panels`: id, position, dimensions, state, lastAccessed
- `snapshots`: id, noteId, data, createdAt
- `presence`: client states for awareness

## DOCUMENTATION
- All persistence changes must update `/docs/enhanced-architecture-migration-guide.md`
- Annotation UX must remain consistent with `/docs/annotation_workflow.md`

## BRANCHING
- `main` = stable
- `dev` = integration
- `feat/` = feature branches


## PLATFORM REQUIREMENTS
- Must run as Web app (Next.js)
- Must run as local Electron app
- Persistence layer must adapt:
  - Web → Postgres via server API
  - Electron → Postgres or SQLite directly
