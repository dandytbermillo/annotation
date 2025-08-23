export type Platform = 'web' | 'electron'

/**
 * Detect the current platform (web or electron)
 */
export function detectPlatform(): Platform {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return 'electron'
  }
  return 'web'
}

/**
 * Check if code is running on server-side (Node.js)
 * Returns true in Next.js SSR, API routes, or Node.js environments
 */
export function isServerSide(): boolean {
  return typeof window === 'undefined'
}

/**
 * Check if code is running at build time
 * Useful for Next.js static generation and build-time optimizations
 */
export function isBuildTime(): boolean {
  // Next.js sets NODE_ENV to 'production' during build
  // and we can check for the absence of window
  return typeof window === 'undefined' && 
         process.env.NODE_ENV === 'production' &&
         // Additional check for Next.js build phase
         (process.env.NEXT_PHASE === 'phase-production-build' ||
          process.env.NEXT_PHASE === 'phase-export')
}

export function getPlatformCapabilities() {
  const platform = detectPlatform()
  
  // Check if PostgreSQL is available/configured
  const hasPostgreSQLConfig = isServerSide()
    ? !!process.env.POSTGRES_URL  // Server-side: direct connection available
    : !!(
        // Browser-side: check for API configuration
        (window as any).__POSTGRES_ENABLED__ || 
        process.env.NEXT_PUBLIC_POSTGRES_ENABLED === 'true' ||
        process.env.NEXT_PUBLIC_POSTGRES_API // API endpoint configured
      )
  
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

export function getPreferredPersistence(): 'postgres' | 'postgres-client' | 'indexeddb' | 'sqlite' {
  const capabilities = getPlatformCapabilities()
  
  // Priority order: PostgreSQL > Platform-specific default
  if (capabilities.hasPostgreSQL) {
    // Use direct PostgreSQL on server or Electron, API client in browser
    return isServerSide() || capabilities.platform === 'electron' 
      ? 'postgres' 
      : 'postgres-client'
  }
  
  if (capabilities.platform === 'electron' && capabilities.hasSQLite) {
    return 'sqlite'
  }
  
  return 'indexeddb'
}

/**
 * Get the specific persistence adapter class based on platform and configuration
 */
export function getPersistenceAdapterType(): string {
  const persistence = getPreferredPersistence()
  
  switch (persistence) {
    case 'postgres':
      return 'PostgresPersistenceAdapter'
    case 'postgres-client':
      return 'PostgresClientAdapter'
    case 'sqlite':
      return 'SQLiteAdapter'
    case 'indexeddb':
    default:
      return 'EnhancedWebPersistenceAdapter'
  }
} 