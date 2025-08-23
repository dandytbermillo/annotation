// Test script to verify PostgreSQL fallback implementation
const http = require('http');

console.log('Testing PostgreSQL Connection Fallback...\n');

// Test health endpoint
const testHealthEndpoint = () => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/persistence/health',
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        console.log(`Health Check Status: ${res.statusCode}`);
        console.log(`Response: ${data}`);
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', (e) => {
      console.error(`Health check failed: ${e.message}`);
      reject(e);
    });

    req.end();
  });
};

// Test persistence endpoint
const testPersistenceEndpoint = () => {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      action: 'persist',
      docName: 'test-fallback',
      update: 'AQID', // base64 encoded test data
      clientId: 'test-client'
    });

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/persistence',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        console.log(`\nPersistence Test Status: ${res.statusCode}`);
        console.log(`Response: ${data}`);
        resolve({ status: res.statusCode, data });
      });
    });

    req.on('error', (e) => {
      console.error(`Persistence test failed: ${e.message}`);
      reject(e);
    });

    req.write(postData);
    req.end();
  });
};

// Run tests
async function runTests() {
  try {
    console.log('1. Testing health endpoint...');
    await testHealthEndpoint();
    
    console.log('\n2. Testing persistence with fallback...');
    await testPersistenceEndpoint();
    
    console.log('\n✅ Fallback implementation test complete!');
    console.log('\nTo test the UI fallback:');
    console.log('1. Stop PostgreSQL: docker compose stop postgres');
    console.log('2. Refresh the app - you should see the fallback dialog');
    console.log('3. Click "Use Local Storage" to continue with IndexedDB');
    console.log('4. The connection status indicator should show "Local Storage"');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  }
}

// Wait a bit for server to be ready
console.log('Waiting for server...\n');
setTimeout(runTests, 2000);