#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_system',
  max: 5
});

async function checkDatabase() {
  try {
    console.log('\n🔍 Checking PostgreSQL Database...\n');

    // Check yjs_updates table
    const updatesResult = await pool.query(`
      SELECT 
        doc_name,
        COUNT(*) as update_count,
        MAX(timestamp) as last_update,
        SUM(octet_length(update)) as total_bytes
      FROM yjs_updates
      GROUP BY doc_name
      ORDER BY last_update DESC
    `);

    console.log('📊 YJS Updates Summary:');
    console.log('─'.repeat(80));
    
    if (updatesResult.rows.length > 0) {
      console.log('Document Name                     | Updates | Last Update         | Total Size');
      console.log('─'.repeat(80));
      
      updatesResult.rows.forEach(row => {
        const docName = row.doc_name.padEnd(32);
        const count = row.update_count.toString().padEnd(7);
        const lastUpdate = new Date(row.last_update).toLocaleString();
        const size = `${(row.total_bytes / 1024).toFixed(2)} KB`;
        console.log(`${docName} | ${count} | ${lastUpdate} | ${size}`);
      });
    } else {
      console.log('No updates found in database');
    }

    // Check snapshots table
    const snapshotsResult = await pool.query(`
      SELECT 
        doc_name,
        COUNT(*) as snapshot_count,
        MAX(created_at) as last_snapshot
      FROM snapshots
      GROUP BY doc_name
      ORDER BY last_snapshot DESC
    `);

    console.log('\n\n📸 Snapshots Summary:');
    console.log('─'.repeat(80));
    
    if (snapshotsResult.rows.length > 0) {
      console.log('Document Name                     | Snapshots | Last Snapshot');
      console.log('─'.repeat(80));
      
      snapshotsResult.rows.forEach(row => {
        const docName = row.doc_name.padEnd(32);
        const count = row.snapshot_count.toString().padEnd(9);
        const lastSnapshot = new Date(row.last_snapshot).toLocaleString();
        console.log(`${docName} | ${count} | ${lastSnapshot}`);
      });
    } else {
      console.log('No snapshots found in database');
    }

    // Get recent updates
    const recentResult = await pool.query(`
      SELECT 
        doc_name,
        client_id,
        timestamp,
        octet_length(update) as update_size
      FROM yjs_updates
      ORDER BY timestamp DESC
      LIMIT 10
    `);

    console.log('\n\n🕐 Recent Updates (Last 10):');
    console.log('─'.repeat(80));
    
    if (recentResult.rows.length > 0) {
      console.log('Time              | Document                      | Client ID | Size');
      console.log('─'.repeat(80));
      
      recentResult.rows.forEach(row => {
        const time = new Date(row.timestamp).toLocaleTimeString();
        const docName = row.doc_name.substring(0, 28).padEnd(28);
        const clientId = (row.client_id || 'unknown').substring(0, 10);
        const size = `${row.update_size} bytes`;
        console.log(`${time.padEnd(16)} | ${docName} | ${clientId} | ${size}`);
      });
    }

    // Show document content preview
    console.log('\n\n📄 Document Content Preview:');
    console.log('─'.repeat(80));
    
    const docsResult = await pool.query(`
      SELECT DISTINCT doc_name 
      FROM yjs_updates 
      WHERE doc_name LIKE 'note:%'
      LIMIT 5
    `);

    for (const row of docsResult.rows) {
      const updatesForDoc = await pool.query(`
        SELECT update 
        FROM yjs_updates 
        WHERE doc_name = $1
        ORDER BY timestamp
        LIMIT 20
      `, [row.doc_name]);
      
      console.log(`\nDocument: ${row.doc_name}`);
      console.log(`Updates: ${updatesForDoc.rows.length}`);
      
      // Try to decode some content (this is a simplified view)
      let totalSize = 0;
      updatesForDoc.rows.forEach(u => {
        totalSize += u.update.length;
      });
      console.log(`Total size: ${(totalSize / 1024).toFixed(2)} KB`);
    }

    console.log('\n✅ Database check complete!\n');

  } catch (error) {
    console.error('❌ Error checking database:', error.message);
  } finally {
    await pool.end();
  }
}

// Run the check
checkDatabase();