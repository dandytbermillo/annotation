// Test script for Phase 2A PostgreSQL features
const http = require('http');

async function testAPI(endpoint, method = 'GET', body = null) {
  console.log(`\n=== Testing ${method} ${endpoint} ===`);
  
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: endpoint,
    method: method,
    headers: {
      'Content-Type': 'application/json',
    }
  };
  
  if (method === 'DELETE' && endpoint.includes('hard=true')) {
    options.headers['X-Confirm-Delete'] = 'PERMANENTLY-DELETE';
  }
  
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        try {
          const json = JSON.parse(data);
          console.log('Response:', JSON.stringify(json, null, 2));
          resolve(json);
        } catch (e) {
          console.log('Raw response:', data);
          resolve(data);
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('Request error:', error);
      reject(error);
    });
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

async function runTests() {
  console.log('Testing Phase 2A PostgreSQL Features\n');
  
  // Test 1: Health check
  await testAPI('/api/persistence/health');
  
  // Test 2: Check if note exists
  const testNoteId = 'test-note-123';
  await testAPI(`/api/notes/${testNoteId}`);
  
  // Test 3: Soft delete a note
  await testAPI(`/api/notes/${testNoteId}`, 'DELETE');
  
  // Test 4: Check note status after soft delete
  await testAPI(`/api/notes/${testNoteId}`);
  
  // Test 5: Test persistence endpoint
  await testAPI('/api/persistence', 'POST', {
    docName: 'test-doc-phase2a',
    update: Buffer.from('test update').toString('base64')
  });
  
  console.log('\n=== Phase 2A Tests Complete ===');
  console.log('\nKey features tested:');
  console.log('1. Health check endpoint');
  console.log('2. Note deletion API (soft delete)');
  console.log('3. Note status checking');
  console.log('4. Basic persistence');
  console.log('\nNote: PostgreSQL connection is expected to fail without Docker running.');
}

runTests().catch(console.error);