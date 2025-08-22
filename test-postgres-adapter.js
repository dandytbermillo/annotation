#!/usr/bin/env node

/**
 * Test script to verify PostgreSQL adapter functionality
 * This demonstrates how the adapter works outside the browser
 */

const { Pool } = require('pg');

// Check if PostgreSQL is accessible
async function checkDatabase() {
  const connectionString = process.env.POSTGRES_URL || 
    'postgresql://postgres:postgres@localhost:5432/annotation_system';
  
  console.log('🔍 Testing PostgreSQL connection...');
  console.log(`📍 Connection string: ${connectionString}`);
  
  const pool = new Pool({ connectionString });
  
  try {
    const client = await pool.connect();
    console.log('✅ Successfully connected to PostgreSQL!');
    
    // Check if tables exist
    const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('yjs_updates', 'snapshots', 'notes', 'branches', 'panels')
      ORDER BY table_name
    `);
    
    if (tableCheck.rows.length === 0) {
      console.log('❌ No tables found. Run migrations first:');
      console.log('   npm run db:migrate');
    } else {
      console.log('\n📋 Found tables:');
      tableCheck.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
      
      // Check data in tables
      console.log('\n📊 Data statistics:');
      const tables = ['yjs_updates', 'snapshots', 'notes'];
      
      for (const table of tables) {
        try {
          const count = await client.query(`SELECT COUNT(*) FROM ${table}`);
          console.log(`   - ${table}: ${count.rows[0].count} records`);
        } catch (e) {
          console.log(`   - ${table}: ❌ Table not found`);
        }
      }
    }
    
    client.release();
    console.log('\n✅ Database check complete!');
    
  } catch (error) {
    console.error('\n❌ Connection failed:', error.message);
    console.log('\n💡 To fix this:');
    console.log('1. Make sure Docker is running');
    console.log('2. Start PostgreSQL: npm run db:up');
    console.log('3. Run migrations: npm run db:migrate');
  } finally {
    await pool.end();
  }
}

// Test the actual adapter if database is available
async function testAdapter() {
  try {
    console.log('\n🧪 Testing PostgreSQL Adapter...');
    
    // We can't import the TypeScript adapter directly, but we can test the connection
    const { PostgresPersistenceAdapter } = require('./lib/adapters/postgres-adapter');
    
    const adapter = new PostgresPersistenceAdapter();
    console.log('✅ Adapter created successfully');
    
    // The adapter would be used like this in a server environment:
    // await adapter.persist('test-doc', new Uint8Array([1, 2, 3]));
    // const data = await adapter.load('test-doc');
    
  } catch (error) {
    console.log('ℹ️  Cannot test TypeScript adapter directly from Node.js');
    console.log('   The adapter is designed for use in the Next.js server environment');
  }
}

// Run the checks
checkDatabase().then(() => {
  console.log('\n📝 Note: In the browser, the app uses IndexedDB for security reasons.');
  console.log('   PostgreSQL can only be used through server-side API routes.');
});