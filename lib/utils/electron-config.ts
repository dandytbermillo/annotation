/**
 * Electron Database Configuration
 * 
 * Provides database configuration for Electron applications
 * with support for both local and remote PostgreSQL instances
 */

export interface ElectronDatabaseConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl?: boolean
}

/**
 * Get database configuration for Electron
 * In production, this would read from electron-store or similar
 */
export async function getElectronDatabaseConfig(): Promise<ElectronDatabaseConfig> {
  // Check if running in Electron
  if (typeof process !== 'undefined' && process.versions?.electron) {
    // In real Electron app, would use:
    // const Store = require('electron-store')
    // const store = new Store()
    // return store.get('database') || getDefaultConfig()
    
    // For now, use environment variables
    return {
      host: process.env.ELECTRON_DB_HOST || 'localhost',
      port: parseInt(process.env.ELECTRON_DB_PORT || '5432'),
      database: process.env.ELECTRON_DB_NAME || 'annotation_system',
      user: process.env.ELECTRON_DB_USER || 'postgres',
      password: process.env.ELECTRON_DB_PASSWORD || 'postgres',
      ssl: process.env.ELECTRON_DB_SSL === 'true'
    }
  }
  
  // Default configuration for development
  return {
    host: 'localhost',
    port: 5432,
    database: 'annotation_system',
    user: 'postgres',
    password: 'postgres',
    ssl: false
  }
}

/**
 * Check if running in Electron environment
 */
export function isElectron(): boolean {
  return typeof process !== 'undefined' && 
         process.versions && 
         !!process.versions.electron
}

/**
 * Get preferred database type for Electron
 */
export function getElectronDbType(): 'postgres' | 'sqlite' {
  if (!isElectron()) return 'sqlite'
  
  // Check environment variable for preference
  const dbType = process.env.ELECTRON_DB_TYPE
  if (dbType === 'sqlite' || dbType === 'postgres') {
    return dbType
  }
  
  // Default to PostgreSQL for better performance
  return 'postgres'
}