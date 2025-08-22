#!/usr/bin/env node

const { execSync } = require('child_process');

console.log('🔧 PostgreSQL Setup Script\n');

// Check if Docker is running
try {
  execSync('docker info > /dev/null 2>&1');
  console.log('✅ Docker is running');
} catch (error) {
  console.error('❌ Docker is not running. Please start Docker Desktop first.');
  console.log('\n💡 To use PostgreSQL, you need Docker running.');
  console.log('   Alternatively, the app will use IndexedDB (browser storage).');
  process.exit(0);
}

// Check if PostgreSQL container is running
try {
  const psStatus = execSync('docker compose ps postgres 2>/dev/null || echo "not found"').toString();
  
  if (psStatus.includes('postgres') && psStatus.includes('running')) {
    console.log('✅ PostgreSQL container is already running');
  } else {
    console.log('🚀 Starting PostgreSQL container...');
    try {
      execSync('docker compose up -d postgres', { stdio: 'inherit' });
      console.log('✅ PostgreSQL container started');
      
      // Wait for PostgreSQL to be ready
      console.log('⏳ Waiting for PostgreSQL to be ready...');
      setTimeout(() => {
        try {
          execSync('docker compose exec -T postgres pg_isready', { stdio: 'ignore' });
          console.log('✅ PostgreSQL is ready');
        } catch (e) {
          console.log('⚠️  PostgreSQL might not be ready yet. Wait a moment and try again.');
        }
      }, 3000);
    } catch (error) {
      console.error('❌ Failed to start PostgreSQL:', error.message);
    }
  }
} catch (error) {
  console.log('⚠️  PostgreSQL container not found. Starting it now...');
  try {
    execSync('docker compose up -d postgres', { stdio: 'inherit' });
    console.log('✅ PostgreSQL container started');
  } catch (error) {
    console.error('❌ Failed to start PostgreSQL:', error.message);
  }
}

console.log('\n📝 Next steps:');
console.log('1. Run migrations: npm run db:migrate');
console.log('2. Start the app: npm run dev');
console.log('3. Open http://localhost:3000');
console.log('\n🔍 The app will now use PostgreSQL via API routes!');
console.log('   Check the browser console - you should see:');
console.log('   "Using PostgreSQL via API routes"');