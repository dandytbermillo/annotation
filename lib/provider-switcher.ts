// Provider Switcher - Allows gradual migration from old to enhanced provider
// This fixes the awareness.getStates error while enabling enhanced features

import { CollaborationProvider } from './yjs-provider'
import { EnhancedCollaborationProvider } from './enhanced-yjs-provider'
import { PostgresCollaborationProvider } from './yjs-provider-postgres'
import './enhanced-yjs-provider-patch' // Apply the patch
import { applyEnhancedProviderPatch } from './enhanced-yjs-provider-patch'
import { checkPostgresHealth, ConnectionStatus, getConnectionMonitor } from './utils/connection-health'

// Apply patch on module load
applyEnhancedProviderPatch()

// Feature flag - set to true to use enhanced provider
const USE_ENHANCED_PROVIDER = process.env.NEXT_PUBLIC_USE_ENHANCED_PROVIDER === 'true' || 
                              typeof window !== 'undefined' && window.localStorage?.getItem('use-enhanced-provider') === 'true'

console.log('USE_ENHANCED_PROVIDER:', USE_ENHANCED_PROVIDER, 'env:', process.env.NEXT_PUBLIC_USE_ENHANCED_PROVIDER)

// Quick fix for old provider - add missing getStates method
const originalGetProvider = CollaborationProvider.prototype.getProvider
CollaborationProvider.prototype.getProvider = function() {
  const provider = originalGetProvider.call(this)
  
  // Fix the awareness.getStates error
  if (provider.awareness && !provider.awareness.getStates) {
    provider.awareness.getStates = () => provider.awareness.states || new Map()
    provider.awareness.clientID = provider.awareness.clientID || 1
    provider.awareness.meta = provider.awareness.meta || new Map()
  }
  
  return provider
}

// Event emitter for fallback events
type FallbackEventListener = (event: { needsFallback: boolean; error?: Error }) => void

// Unified interface that switches between providers
export class UnifiedProvider {
  private static instance: UnifiedProvider
  private provider!: CollaborationProvider | EnhancedCollaborationProvider | PostgresCollaborationProvider
  private static fallbackListeners: Set<FallbackEventListener> = new Set()
  private static connectionHealthy: boolean = true
  private static persistenceMode: 'postgres' | 'indexeddb' | 'auto' = 'auto'
  
  private constructor() {
    // Initialize with a default provider synchronously
    this.initializeDefaultProvider()
    
    // Then check PostgreSQL health asynchronously if needed
    // BUT: Don't upgrade if we're already using the enhanced provider (it has its own PostgreSQL support)
    if (process.env.NEXT_PUBLIC_POSTGRES_ENABLED === 'true' && 
        UnifiedProvider.persistenceMode !== 'indexeddb' &&
        !USE_ENHANCED_PROVIDER) {
      this.checkAndUpgradeToPostgres()
    }
  }
  
  private initializeDefaultProvider() {
    // Check user persistence preference
    if (typeof window !== 'undefined') {
      const savedMode = window.localStorage.getItem('persistence-mode') as 'postgres' | 'indexeddb' | 'auto' | null
      if (savedMode) {
        UnifiedProvider.persistenceMode = savedMode
      }
    }
    
    if (USE_ENHANCED_PROVIDER) {
      console.log('🚀 Using Enhanced YJS Provider with all advanced features')
      this.provider = EnhancedCollaborationProvider.getInstance()
    } else {
      // Start with standard provider, will upgrade to PostgreSQL if available
      console.log('Using standard YJS Provider (will check PostgreSQL availability)')
      this.provider = CollaborationProvider.getInstance()
    }
    
    // Store reference for metrics access
    if (typeof window !== 'undefined') {
      (window as any).yjsProvider = this
    }
  }
  
  private async checkAndUpgradeToPostgres() {
    try {
      const isHealthy = await this.checkPostgresHealthWithFallback()
      
      if (isHealthy && UnifiedProvider.persistenceMode !== 'indexeddb') {
        console.log('🐘 Upgrading to PostgreSQL-enabled YJS Provider')
        
        // Save current state if any
        const currentProvider = this.provider
        
        // Switch to PostgreSQL provider
        this.provider = PostgresCollaborationProvider.getInstance()
        UnifiedProvider.connectionHealthy = true
        
        // If there was a note loaded, re-initialize it with the new provider
        // The provider will handle transferring any in-memory state
      } else {
        console.log('⚠️ PostgreSQL unavailable, continuing with standard provider')
        UnifiedProvider.connectionHealthy = false
        
        // Emit fallback event
        UnifiedProvider.emitFallbackEvent({ needsFallback: true })
      }
    } catch (error) {
      console.error('Error checking PostgreSQL:', error)
      UnifiedProvider.connectionHealthy = false
    }
  }
  
  private async checkPostgresHealthWithFallback(): Promise<boolean> {
    try {
      // Only check if we're in the browser
      if (typeof window === 'undefined') {
        return true // Assume healthy on server side
      }
      
      const isHealthy = await checkPostgresHealth(5000, 1) // Quick check with 1 retry
      return isHealthy
    } catch (error) {
      console.error('PostgreSQL health check failed:', error)
      return false
    }
  }
  
  public static getInstance(): UnifiedProvider {
    if (!UnifiedProvider.instance) {
      UnifiedProvider.instance = new UnifiedProvider()
    }
    return UnifiedProvider.instance
  }
  
  // Delegate all methods to the underlying provider
  public getProvider() {
    return this.provider.getProvider()
  }
  
  public setCurrentNote(noteId: string) {
    if ('setCurrentNote' in this.provider) {
      this.provider.setCurrentNote(noteId)
    }
  }
  
  public getBranchesMap() {
    if ('getBranchesMap' in this.provider) {
      return this.provider.getBranchesMap()
    }
    return new Map()
  }
  
  public addBranch(parentId: string, branchId: string, branchData: any) {
    if ('addBranch' in this.provider) {
      this.provider.addBranch(parentId, branchId, branchData)
    }
  }
  
  public getBranches(panelId: string) {
    if ('getBranches' in this.provider) {
      return this.provider.getBranches(panelId)
    }
    return []
  }
  
  public initializeDefaultData(noteId: string, data: any) {
    if ('initializeDefaultData' in this.provider) {
      this.provider.initializeDefaultData(noteId, data)
    } else if ('initializeNote' in this.provider) {
      ;(this.provider as EnhancedCollaborationProvider).initializeNote(noteId, data)
    }
  }
  
  public destroyNote(noteId: string) {
    if ('destroyNote' in this.provider) {
      this.provider.destroyNote(noteId)
    }
  }
  
  public destroy() {
    if ('destroy' in this.provider) {
      this.provider.destroy()
    }
  }
  
  // Get the underlying provider type
  public getProviderType(): 'standard' | 'enhanced' | 'postgres' {
    if (this.provider instanceof EnhancedCollaborationProvider) return 'enhanced'
    if (this.provider instanceof PostgresCollaborationProvider) return 'postgres'
    return 'standard'
  }
  
  // Enable enhanced provider at runtime
  public static enableEnhancedProvider() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('use-enhanced-provider', 'true')
      window.location.reload()
    }
  }
  
  // Disable enhanced provider at runtime
  public static disableEnhancedProvider() {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('use-enhanced-provider')
      window.location.reload()
    }
  }
  
  // Fallback event management
  public static onFallbackNeeded(listener: FallbackEventListener) {
    UnifiedProvider.fallbackListeners.add(listener)
  }
  
  public static offFallbackNeeded(listener: FallbackEventListener) {
    UnifiedProvider.fallbackListeners.delete(listener)
  }
  
  private static emitFallbackEvent(event: { needsFallback: boolean; error?: Error }) {
    UnifiedProvider.fallbackListeners.forEach(listener => listener(event))
  }
  
  // Switch to IndexedDB fallback
  public async switchToIndexedDB() {
    console.log('Switching to IndexedDB persistence...')
    
    // Save preference
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('persistence-mode', 'indexeddb')
    }
    
    // Switch provider
    UnifiedProvider.persistenceMode = 'indexeddb'
    this.provider = CollaborationProvider.getInstance()
    
    // Re-initialize current note if any
    // The provider will handle transferring the in-memory state
    console.log('✅ Switched to IndexedDB persistence')
  }
  
  // Retry PostgreSQL connection
  public async retryPostgresConnection(): Promise<boolean> {
    console.log('Retrying PostgreSQL connection...')
    
    const isHealthy = await this.checkPostgresHealthWithFallback()
    
    if (isHealthy) {
      // Save preference
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('persistence-mode', 'postgres')
      }
      
      // Switch back to PostgreSQL
      UnifiedProvider.persistenceMode = 'postgres'
      this.provider = PostgresCollaborationProvider.getInstance()
      UnifiedProvider.connectionHealthy = true
      
      console.log('✅ PostgreSQL connection restored')
      return true
    }
    
    return false
  }
  
  // Get connection status
  public static isConnectionHealthy(): boolean {
    return UnifiedProvider.connectionHealthy
  }
  
  // Get persistence mode
  public static getPersistenceMode(): 'postgres' | 'indexeddb' | 'auto' {
    return UnifiedProvider.persistenceMode
  }
  
  // Get batching metrics if available
  public getBatchingMetrics(): any {
    if ('getBatchingMetrics' in this.provider) {
      return this.provider.getBatchingMetrics()
    }
    return null
  }
}

// Export helper to check current provider
export function getCurrentProviderType(): 'standard' | 'enhanced' | 'postgres' {
  return UnifiedProvider.getInstance().getProviderType()
}

// Export helper to toggle provider
export function toggleProvider() {
  const current = getCurrentProviderType()
  if (current === 'standard') {
    UnifiedProvider.enableEnhancedProvider()
  } else {
    UnifiedProvider.disableEnhancedProvider()
  }
} 