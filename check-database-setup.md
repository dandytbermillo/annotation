# How to Check PostgreSQL Database Functionality

## Current Status
The application is currently using **IndexedDB** (browser storage) because:
1. PostgreSQL adapter can't run directly in the browser (security restriction)
2. PostgreSQL database isn't currently running

## To Test PostgreSQL:

### Option 1: Start PostgreSQL with Docker
```bash
# 1. Make sure Docker Desktop is running
# 2. Start PostgreSQL container:
npm run db:up

# 3. Run database migrations:
npm run db:migrate

# 4. Check if database is running:
docker compose ps
```

### Option 2: Connect to PostgreSQL and Check Data
```bash
# Connect to database
docker compose exec postgres psql -U postgres -d annotation_system

# Once connected, check tables:
\dt

# Check if data exists:
SELECT * FROM yjs_updates LIMIT 5;
SELECT * FROM snapshots LIMIT 5;
SELECT * FROM notes LIMIT 5;
```

### Option 3: Create a Test Script
Create `test-postgres.js`:
```javascript
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_system'
});

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL');
    
    // Check tables
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    console.log('📋 Tables:', result.rows.map(r => r.table_name));
    
    // Check for data
    const updates = await client.query('SELECT COUNT(*) FROM yjs_updates');
    console.log('📊 YJS Updates:', updates.rows[0].count);
    
    client.release();
    await pool.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

testConnection();
```

Run with: `node test-postgres.js`

## Why You're Not Seeing PostgreSQL Data

In the browser at http://localhost:3000, the app is using IndexedDB because:
- Browser JavaScript cannot directly connect to PostgreSQL (security)
- The adapter detects it's running in a browser and falls back to IndexedDB
- You'll see this in the browser console: "PostgreSQL adapter not available in browser environment, using IndexedDB"

## To Actually Use PostgreSQL

You would need to:
1. Create Next.js API routes (`/api/persistence/*`)
2. Use the PostgreSQL adapter in those API routes (server-side)
3. Modify the client to call these APIs instead of direct persistence

This is the proper architecture for web apps with databases.
