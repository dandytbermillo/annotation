import { PostgresPersistenceAdapter } from './lib/adapters/postgres-adapter';

async function testPostgresIntegration() {
  console.log('Testing PostgreSQL Integration...\n');
  
  try {
    // Create adapter
    const adapter = new PostgresPersistenceAdapter();
    console.log('✅ PostgreSQL adapter created successfully');
    
    // Test persistence
    const testUpdate = new Uint8Array([1, 2, 3, 4, 5]);
    const docName = 'test-integration-doc';
    
    console.log(`\n📝 Persisting test data to document: ${docName}`);
    await adapter.persist(docName, testUpdate);
    console.log('✅ Data persisted successfully');
    
    // Test loading
    console.log('\n📥 Loading data from PostgreSQL...');
    const loadedData = await adapter.load(docName);
    console.log('✅ Data loaded successfully');
    console.log(`   Loaded ${loadedData ? loadedData.length : 0} bytes`);
    
    // Test getting all updates
    console.log('\n📊 Getting all updates...');
    const allUpdates = await adapter.getAllUpdates(docName);
    console.log(`✅ Found ${allUpdates.length} updates`);
    
    // Clean up
    console.log('\n🧹 Cleaning up test data...');
    await adapter.clearUpdates(docName);
    console.log('✅ Test data cleaned up');
    
    await adapter.destroy();
    console.log('\n✅ PostgreSQL integration test completed successfully!');
    
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

testPostgresIntegration();