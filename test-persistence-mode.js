const http = require('http');

// Test which persistence mode is being used
async function testPersistenceMode() {
  console.log('=== Testing Persistence Mode ===\n');
  
  // 1. Test persistence endpoint
  const persistData = JSON.stringify({
    action: 'persist',
    docName: 'test-persistence-mode',
    update: Buffer.from('test update').toString('base64')
  });
  
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/persistence',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': persistData.length
    }
  };
  
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log('Response:', data);
        
        // Check if it mentions PostgreSQL or IndexedDB
        if (data.includes('postgres') || data.includes('PostgreSQL')) {
          console.log('\n✅ Using PostgreSQL persistence (or trying to)');
        } else if (data.includes('indexeddb') || data.includes('IndexedDB')) {
          console.log('\n⚠️  Using IndexedDB fallback');
        } else {
          console.log('\n❓ Persistence mode unclear from response');
        }
        
        resolve();
      });
    });
    
    req.on('error', (error) => {
      console.error('Request error:', error);
      reject(error);
    });
    
    req.write(persistData);
    req.end();
  });
}

testPersistenceMode().catch(console.error);