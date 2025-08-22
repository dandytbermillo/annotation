# 🚀 Running the Application with PostgreSQL

## Current Status
The application is running at http://localhost:3000 but PostgreSQL is NOT connected because Docker/PostgreSQL isn't running.

## Step-by-Step Setup

### 1️⃣ Start Docker Desktop
- Open Docker Desktop application on your Mac
- Wait for it to fully start (green icon)

### 2️⃣ Start PostgreSQL Container
```bash
# Run this command:
docker compose up -d postgres

# Verify it's running:
docker ps
```

### 3️⃣ Run Database Migrations
```bash
# Create the database tables:
docker compose exec postgres psql -U postgres -d annotation_system -f - << 'EOF'
-- Create tables if they don't exist
CREATE TABLE IF NOT EXISTS yjs_updates (
    id BIGSERIAL PRIMARY KEY,
    doc_name TEXT NOT NULL,
    update BYTEA NOT NULL,
    client_id TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID,
    doc_name TEXT NOT NULL,
    state BYTEA NOT NULL,
    checksum TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_yjs_updates_doc_timestamp ON yjs_updates(doc_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_doc_name ON snapshots(doc_name, created_at DESC);
EOF
```

### 4️⃣ Verify PostgreSQL is Working
Open the verification page: **file:///Users/dandy/Downloads/all-project/postgres-persistence/verify-postgres.html**

Click the test buttons in order:
1. Test API Connection
2. Save Test Data
3. Load Test Data

### 5️⃣ Use the Application
1. Open http://localhost:3000
2. Open Developer Tools (F12) → Console
3. Look for: **"Using PostgreSQL via API routes"**
4. Create annotations - they'll be saved to PostgreSQL!

## Troubleshooting

### If PostgreSQL won't connect:
1. Check Docker is running: `docker ps`
2. Check logs: `docker compose logs postgres`
3. Restart PostgreSQL: 
   ```bash
   docker compose down
   docker compose up -d postgres
   ```

### If you see "ECONNREFUSED":
This means PostgreSQL isn't running or isn't accessible. Make sure Docker Desktop is running.

### To verify data is in PostgreSQL:
```bash
# Connect to PostgreSQL:
docker compose exec postgres psql -U postgres -d annotation_system

# Check data:
SELECT COUNT(*) FROM yjs_updates;
SELECT COUNT(*) FROM snapshots;
\q
```

## How It Works

When PostgreSQL is available:
```
Browser → YJS → PostgresAPIAdapter → HTTP → /api/persistence → PostgreSQL
```

When PostgreSQL is NOT available:
```
Browser → YJS → IndexedDB (fallback)
```

## Quick Commands

```bash
# Start everything:
docker compose up -d postgres
npm run dev

# Stop everything:
docker compose down
pkill -f "next dev"

# Check status:
docker ps
curl http://localhost:3000/api/persistence?method=load&docName=test
```