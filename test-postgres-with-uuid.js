const http = require('http');
const crypto = require('crypto');

async function testWithUUID() {
  // Generate a proper UUID
  const noteId = crypto.randomUUID();
  console.log(`Testing with UUID: ${noteId}\n`);
  
  // First, let's create a note in the database
  const insertResult = await new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/persistence',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Create note result:', res.statusCode);
        resolve(data);
      });
    });
    
    req.write(JSON.stringify({
      action: 'persist',
      docName: `note:${noteId}`,
      update: Buffer.from('Initial note content').toString('base64')
    }));
    req.end();
  });
  
  // Now test deletion
  console.log('\nTesting deletion of note:', noteId);
  const deleteResult = await new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: `/api/notes/${noteId}`,
      method: 'DELETE'
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Delete result:', res.statusCode, data);
        resolve(data);
      });
    });
    req.end();
  });
  
  // Check compaction log
  console.log('\n=== Checking Database State ===');
  console.log('Run: docker exec annotation_postgres psql -U postgres -d annotation_system -c "SELECT COUNT(*) FROM yjs_updates;"');
}

testWithUUID().catch(console.error);