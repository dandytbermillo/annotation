// Quick diagnostic script to check which provider is being used
// Run this in the browser console after the app loads

console.log('=== Provider Diagnostics ===');
console.log('window.yjsProvider:', window.yjsProvider);
console.log('Provider type:', window.yjsProvider?.constructor?.name);
console.log('Has getBatchingMetrics:', typeof window.yjsProvider?.getBatchingMetrics === 'function');

if (window.yjsProvider?.persistence) {
  console.log('Persistence type:', window.yjsProvider.persistence?.constructor?.name);
  console.log('Persistence adapter:', window.yjsProvider.persistence?.adapter?.constructor?.name);
}

// Check environment variables
console.log('\n=== Environment ===');
console.log('NEXT_PUBLIC_USE_ENHANCED_PROVIDER:', process.env.NEXT_PUBLIC_USE_ENHANCED_PROVIDER);
console.log('NEXT_PUBLIC_POSTGRES_ENABLED:', process.env.NEXT_PUBLIC_POSTGRES_ENABLED);

// Try to get metrics
if (window.yjsProvider?.getBatchingMetrics) {
  console.log('\n=== Metrics ===');
  console.log(window.yjsProvider.getBatchingMetrics());
}

// Check localStorage
console.log('\n=== Local Storage ===');
console.log('use-enhanced-provider:', localStorage.getItem('use-enhanced-provider'));
console.log('persistence-mode:', localStorage.getItem('persistence-mode'));