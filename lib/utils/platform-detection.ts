export type Platform = 'web' | 'electron'

export function detectPlatform(): Platform {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return 'electron'
  }
  return 'web'
}

export function getPlatformCapabilities() {
  const platform = detectPlatform()
  
  // In the browser, check if we have PostgreSQL configured
  const hasPostgreSQLConfig = typeof window !== 'undefined' 
    ? !!(window as any).__POSTGRES_ENABLED__ || process.env.NEXT_PUBLIC_POSTGRES_ENABLED === 'true'
    : !!process.env.POSTGRES_URL
  
  return {
    platform,
    hasServiceWorker: typeof window !== 'undefined' && 'serviceWorker' in navigator,
    hasWebRTC: typeof RTCPeerConnection !== 'undefined',
    hasCompressionStream: typeof window !== 'undefined' && 'CompressionStream' in window,
    hasWebWorkers: typeof Worker !== 'undefined',
    hasIndexedDB: typeof window !== 'undefined' && 'indexedDB' in window,
    hasSQLite: platform === 'electron',
    hasPostgreSQL: hasPostgreSQLConfig,
    hasFileSystem: platform === 'electron',
    hasNotifications: typeof window !== 'undefined' && 'Notification' in window,
    hasPersistentStorage: typeof navigator !== 'undefined' && 
                         'storage' in navigator && 
                         'persist' in navigator.storage
  }
}

export function getPreferredPersistence(): 'postgres' | 'indexeddb' | 'sqlite' {
  const capabilities = getPlatformCapabilities()
  
  // Priority order: PostgreSQL > Platform-specific default
  if (capabilities.hasPostgreSQL) {
    return 'postgres'
  }
  
  if (capabilities.platform === 'electron' && capabilities.hasSQLite) {
    return 'sqlite'
  }
  
  return 'indexeddb'
} 