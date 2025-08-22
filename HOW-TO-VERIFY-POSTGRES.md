# 🔍 How to Verify PostgreSQL is Working

## Current Status
✅ PostgreSQL is running  
✅ API routes are configured  
⚠️ Your notes are NOT being saved to PostgreSQL yet (only 1 test entry exists)

## Quick Check
```bash
# Check what's in the database
docker compose exec postgres psql -U postgres -d annotation_system -c "SELECT doc_name, COUNT(*) as updates, MAX(timestamp) as last_update FROM yjs_updates GROUP BY doc_name;"
```

Currently shows:
```
doc_name | updates |          last_update          
----------+---------+-------------------------------
 test-doc |       1 | 2025-08-22 22:00:30.536136+00
```

## To Enable PostgreSQL for Your Notes

### 1. Verify Configuration
Your `.env.local` should have:
```env
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/annotation_system
NEXT_PUBLIC_POSTGRES_ENABLED=true
```

### 2. Restart the Application
```bash
# Stop the app
pkill -f "next dev"

# Start it again
npm run dev
```

### 3. Check Browser Console
1. Open http://localhost:3000
2. Open Developer Tools (F12)
3. Look in Console for: **"Using PostgreSQL via API routes"**
   - ✅ If you see this, PostgreSQL is being used
   - ❌ If you see "Using IndexedDB", it's still using local storage

### 4. Create Notes and Verify
1. Create some annotations in the app
2. Run the database check again:
```bash
docker compose exec postgres psql -U postgres -d annotation_system -c "SELECT doc_name, COUNT(*) FROM yjs_updates GROUP BY doc_name;"
```

You should see entries like:
- `note:main`
- `note:{uuid}`
- `annotation:{uuid}`

## Verification Tools

### Web-based Verification
Open these files in your browser:
- `file:///Users/dandy/Downloads/all-project/postgres-persistence/verify-app-data.html`
- `file:///Users/dandy/Downloads/all-project/postgres-persistence/test-postgres-usage.html`

### Command-line Verification
```bash
# Check all data
node check-postgres-data.js

# Direct database query
docker compose exec postgres psql -U postgres -d annotation_system
\dt  # List tables
SELECT COUNT(*) FROM yjs_updates;
SELECT COUNT(*) FROM snapshots;
\q   # Quit
```

## Troubleshooting

### If PostgreSQL isn't being used:
1. Check `.env.local` exists and has `NEXT_PUBLIC_POSTGRES_ENABLED=true`
2. Restart the Next.js server
3. Clear browser cache and reload
4. Check browser console for errors

### If Docker/PostgreSQL isn't running:
```bash
# Start PostgreSQL
docker compose up -d postgres

# Check it's running
docker ps

# View logs
docker compose logs postgres
```

### If you see connection errors:
1. Ensure Docker Desktop is running
2. Check PostgreSQL is on port 5432: `docker compose ps`
3. Restart PostgreSQL: `docker compose restart postgres`

## Expected Behavior
When working correctly:
- Browser console shows: "Using PostgreSQL via API routes"
- Creating notes adds entries to PostgreSQL
- Refreshing the page preserves your notes
- Multiple users can collaborate in real-time