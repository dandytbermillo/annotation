# ⚠️ PostgreSQL is NOT Being Used

## The Problem
Your notes are being saved to IndexedDB (browser storage), NOT PostgreSQL.

## Why?
The app uses a "provider switcher" that requires TWO environment variables:
1. `NEXT_PUBLIC_USE_ENHANCED_PROVIDER=true` - To use the enhanced provider
2. `NEXT_PUBLIC_POSTGRES_ENABLED=true` - To enable PostgreSQL in that provider

## Quick Fix

### 1. Your `.env.local` should have:
```env
# PostgreSQL configuration
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/annotation_system

# BOTH of these are required!
NEXT_PUBLIC_USE_ENHANCED_PROVIDER=true
NEXT_PUBLIC_POSTGRES_ENABLED=true
```

### 2. Restart the app:
```bash
# Stop the current server
pkill -f "next dev"

# Start it again
npm run dev
```

### 3. Verify in Browser Console:
Open http://localhost:3000 and press F12 for Developer Console.

You should see ONE of these messages:
- ✅ "🚀 Using Enhanced YJS Provider with all advanced features"
- ✅ "Using PostgreSQL via API routes"

If you see:
- ❌ "Using standard YJS Provider (with getStates fix)"
- ❌ "Using indexeddb persistence adapter"

Then PostgreSQL is NOT active.

### 4. Create a Note and Check Database:
After creating a note, run:
```bash
docker compose exec postgres psql -U postgres -d annotation_system -c "SELECT doc_name, COUNT(*) FROM yjs_updates GROUP BY doc_name;"
```

You should see entries like:
- `note:main`
- `note:{uuid}`
- NOT just `test-doc`

## Alternative: Enable via Browser Console
If the environment variable isn't working, you can force it:

1. Open http://localhost:3000
2. Open Developer Console (F12)
3. Run: `localStorage.setItem('use-enhanced-provider', 'true')`
4. Refresh the page
5. Check console for "Enhanced YJS Provider" message

## Current Database Status
```
doc_name | updates |          last_update          
----------+---------+-------------------------------
 test-doc |       1 | 2025-08-22 22:00:30.536136+00
```

Only test data - NO actual notes are being saved to PostgreSQL.