import * as Y from 'yjs'
// import { Awareness } from 'y-protocols/awareness' // Not needed here
// import { LRUCache } from 'lru-cache' // Temporarily disabled due to compatibility issues
import { HybridSyncManager } from './sync/hybrid-sync-manager'
import { AnnotationMerger } from './annotation/annotation-merger'
import { FractionalIndexManager } from './utils/fractional-indexing'
import { PerformanceMonitor, DetailedMetrics } from './monitoring/performance-monitor'
import { getPreferredPersistence } from './utils/platform-detection'
import { EnhancedWebPersistenceAdapter } from './adapters/web-adapter-enhanced'
import { ElectronPersistenceAdapter } from './adapters/electron-adapter'
import { PostgresAPIAdapter } from './adapters/postgres-api-adapter'
import { BatchingPersistenceProvider } from './persistence/batching-provider'
import { getDefaultConfig, BatchMetrics } from './persistence/batching-config'

export interface PersistenceProvider {
  persist(docName: string, update: Uint8Array): Promise<void>
  load(docName: string): Promise<Uint8Array | null>
  getAllUpdates(docName: string): Promise<Uint8Array[]>
  clearUpdates(docName: string): Promise<void>
  saveSnapshot(docName: string, snapshot: Uint8Array): Promise<void>
  loadSnapshot(docName: string): Promise<Uint8Array | null>
  compact(docName: string): Promise<void>
}

export interface AnnotationAnchor {
  relativePosition: Uint8Array
  fallback: {
    offset: number
    textContent: string
    contextBefore: string
    contextAfter: string
    checksum: string
  }
}

export interface Annotation {
  id: string
  type: 'note' | 'explore' | 'promote'
  sourcePanel: string
  targetPanel: string
  anchors: {
    start: AnnotationAnchor
    end: AnnotationAnchor
  }
  metadata: Y.Map<any>
  order: string
  version: number
  mergedWith?: string[]
}

export interface PerformanceMetrics {
  syncLatency: number
  memoryUsage: {
    panels: number
    annotations: number
    total: number
  }
  activePanels: number
  networkBandwidth: {
    incoming: number
    outgoing: number
  }
  lastGC: Date
}

// Enhanced Collaborative Document Structure with LRU Cache
export class EnhancedCollaborativeStructure {
  private mainDoc: Y.Doc
  private editorCache: LRUCache<string, Y.Doc>
  private loadingQueue: Map<string, Promise<Y.Doc>>
  private persistence: PersistenceProvider

  constructor(mainDoc: Y.Doc, persistence: PersistenceProvider) {
    this.mainDoc = mainDoc
    this.persistence = persistence
    this.loadingQueue = new Map()
    
    // Initialize LRU cache for editor subdocs
    // Using a simple Map for now to avoid LRUCache compatibility issues
    this.editorCache = new Map() as any
    
    // TODO: Replace with proper LRUCache implementation when compatibility is resolved
    // For now, using a simple Map that doesn't have TTL or max size limits
    
    this.initializeMainDocStructure()
  }

  private initializeMainDocStructure(): void {
    // Initialize all required Y.Maps if they don't exist
    if (!this.mainDoc.getMap('branches').size) {
      this.mainDoc.getMap('branches')
    }
    
    const metadata = this.mainDoc.getMap('metadata')
    if (!metadata.has('canvas')) {
      metadata.set('canvas', new Y.Map())
    }
    if (!metadata.has('panels')) {
      metadata.set('panels', new Y.Map())
    }
    if (!metadata.has('panelOrder')) {
      metadata.set('panelOrder', new Y.Array())
    }
    if (!metadata.has('connections')) {
      metadata.set('connections', new Y.Array())
    }
    
    if (!this.mainDoc.getMap('presence').size) {
      const presence = this.mainDoc.getMap('presence')
      // Don't store Awareness in Y.Map - it should be handled separately
      // presence.set('awareness', new Awareness(this.mainDoc)) // This causes "Unexpected content type"
      presence.set('cursors', new Y.Map())
      presence.set('selections', new Y.Map())
      presence.set('viewports', new Y.Map())
    }
    
    if (!this.mainDoc.getMap('editors').size) {
      this.mainDoc.getMap('editors')
    }
    
    if (!this.mainDoc.getMap('snapshots').size) {
      this.mainDoc.getMap('snapshots')
    }
  }

  async getEditorSubdoc(panelId: string): Promise<Y.Doc> {
    // Check if already loading
    if (this.loadingQueue.has(panelId)) {
      return await this.loadingQueue.get(panelId)!
    }

    // Try to get from cache
    // Check if already cached
    let cached = this.editorCache.get(panelId)
    if (!cached) {
      // Load the panel if not cached
      cached = await this.loadPanel(panelId)
      if (cached) {
        this.editorCache.set(panelId, cached)
      }
    }
    if (cached) {
      this.updatePanelState(panelId, 'active')
      return cached
    }

    // Not found, this shouldn't happen with fetchMethod, but handle it
    const loadPromise = this.loadPanel(panelId)
    this.loadingQueue.set(panelId, loadPromise)
    
    try {
      const doc = await loadPromise
      return doc
    } finally {
      this.loadingQueue.delete(panelId)
    }
  }

  private async loadPanel(panelId: string): Promise<Y.Doc> {
    // Create subdoc
    const subdoc = new Y.Doc()
    
    // Try to load from persistence
    try {
      const snapshot = await this.persistence.loadSnapshot(`panel-${panelId}`)
      if (snapshot) {
        Y.applyUpdate(subdoc, snapshot)
      }
    } catch (error) {
      console.warn(`Failed to load panel ${panelId} from persistence:`, error)
    }
    
    // Initialize content structure
    if (!subdoc.getXmlFragment('content').length) {
      subdoc.getXmlFragment('content')
    }
    
    // Update metadata
    this.updatePanelState(panelId, 'active')
    
    // Set up auto-save
    subdoc.on('update', async (update: Uint8Array) => {
      try {
        await this.persistence.persist(`panel-${panelId}`, update)
      } catch (error) {
        console.error(`Failed to persist panel ${panelId}:`, error)
      }
    })
    
    return subdoc
  }

  private async unloadPanel(panelId: string, doc: Y.Doc): Promise<void> {
    // Save final state
    try {
      const snapshot = Y.encodeStateAsUpdate(doc)
      await this.persistence.saveSnapshot(`panel-${panelId}`, snapshot)
    } catch (error) {
      console.error(`Failed to save panel ${panelId} snapshot:`, error)
    }
    
    // Update state
    this.updatePanelState(panelId, 'unloaded')
    
    // Destroy doc
    doc.destroy()
  }

  private updatePanelState(panelId: string, state: 'active' | 'lazy' | 'unloaded'): void {
    const panels = this.mainDoc.getMap('metadata').get('panels') as Y.Map<any>
    const panel = panels.get(panelId) as Y.Map<any>
    if (panel) {
      panel.set('state', state)
      panel.set('lastAccessed', Date.now())
    }
  }

  async forceGarbageCollection(): Promise<{ collected: number; remaining: number }> {
    const threshold = Date.now() - (30 * 60 * 1000) // 30 min
    let collected = 0
    
    const panels = this.mainDoc.getMap('metadata').get('panels') as Y.Map<any>
    const toUnload: string[] = []
    
    panels.forEach((panel, panelId) => {
      const lastAccessed = panel.get('lastAccessed') || 0
      const state = panel.get('state')
      
      if (lastAccessed < threshold && state === 'active') {
        toUnload.push(panelId)
      }
    })
    
    // Clear from cache (will trigger dispose and unload)
    for (const panelId of toUnload) {
      if (this.editorCache.delete(panelId)) {
        collected++
      }
    }
    
    return {
      collected,
      remaining: this.editorCache.size
    }
  }

  getMetrics(): { cacheSize: number; activePanels: number } {
    const panels = this.mainDoc.getMap('metadata').get('panels') as Y.Map<any>
    let activePanels = 0
    
    panels.forEach(panel => {
      if (panel.get('state') === 'active') {
        activePanels++
      }
    })
    
    return {
      cacheSize: this.editorCache.size,
      activePanels
    }
  }
}

// Main Enhanced Collaboration Provider
export class EnhancedCollaborationProvider {
  private static instance: EnhancedCollaborationProvider
  private mainDoc: Y.Doc
  private structure: EnhancedCollaborativeStructure
  private persistence: PersistenceProvider
  private syncManager: HybridSyncManager
  private performanceMonitor: PerformanceMonitor
  private annotationMerger: AnnotationMerger
  private fractionalIndexManager: FractionalIndexManager
  private currentNoteId: string | null = null

  private constructor() {
    this.mainDoc = new Y.Doc()
    
    // Select persistence adapter based on available features
    const preferredPersistence = getPreferredPersistence()
    
    let baseAdapter: PersistenceProvider
    
    switch (preferredPersistence) {
      case 'postgres':
        // For now, always use API adapter in browser context
        // Direct PostgreSQL connection would only work in Electron
        console.log('Using PostgreSQL via API routes (browser-safe)')
        baseAdapter = new PostgresAPIAdapter()
        break
      case 'postgres-client':
        // PostgreSQL via API routes (browser)
        console.log('Using PostgreSQL via API routes')
        baseAdapter = new PostgresAPIAdapter()
        break
      case 'sqlite':
        // SQLite is handled by ElectronPersistenceAdapter
        baseAdapter = new ElectronPersistenceAdapter('annotation-system')
        break
      case 'indexeddb':
      default:
        baseAdapter = new EnhancedWebPersistenceAdapter('annotation-system')
        break
    }
    
    // Wrap with batching provider for performance optimization
    const batchingConfig = getDefaultConfig()
    this.persistence = new BatchingPersistenceProvider(baseAdapter, batchingConfig)
    
    console.log(`Using ${preferredPersistence} persistence adapter with batching enabled`)
    
    // Store reference for metrics access
    if (typeof window !== 'undefined') {
      (window as any).yjsProvider = this
    }
    
    this.structure = new EnhancedCollaborativeStructure(this.mainDoc, this.persistence)
    this.syncManager = new HybridSyncManager(this.mainDoc, 'default-room')
    this.performanceMonitor = new PerformanceMonitor(this)
    this.annotationMerger = new AnnotationMerger(this.mainDoc)
    this.fractionalIndexManager = new FractionalIndexManager()
    
    this.initializeMainDocStructure()
    this.setupEventHandlers()
  }

  public static getInstance(): EnhancedCollaborationProvider {
    if (!EnhancedCollaborationProvider.instance) {
      EnhancedCollaborationProvider.instance = new EnhancedCollaborationProvider()
    }
    return EnhancedCollaborationProvider.instance
  }

  private initializeMainDocStructure(): void {
    // Ensure all required maps exist
    this.mainDoc.getMap('branches')
    this.mainDoc.getMap('metadata')
    this.mainDoc.getMap('presence')
    this.mainDoc.getMap('editors')
    this.mainDoc.getMap('snapshots')
  }

  private setupEventHandlers(): void {
    // Set up persistence for main document
    this.mainDoc.on('update', async (update: Uint8Array, origin: any) => {
      // Skip updates from loading
      if (origin === 'load') return
      
      try {
        await this.persistence.persist('main-doc', update)
      } catch (error) {
        console.error('Failed to persist main document:', error)
      }
    })
    
    // Listen for performance warnings
    if (typeof window !== 'undefined') {
      window.addEventListener('performance-warning', (event: CustomEvent) => {
        console.warn('Performance issues detected:', event.detail)
        this.optimizePerformance(event.detail.issues)
      })
      
      // Listen for sync strategy changes
      window.addEventListener('sync-strategy-change', (event: CustomEvent) => {
        this.syncManager.switchStrategy(event.detail.strategy)
      })
    }
    
    // Auto-merge overlapping annotations
    this.mainDoc.getMap('branches').observe(() => {
      this.checkAndMergeOverlaps()
    })
  }

  private async optimizePerformance(issues: string[]): Promise<void> {
    if (issues.includes('High memory usage')) {
      await this.structure.forceGarbageCollection()
    }
    
    if (issues.includes('High sync latency')) {
      await this.syncManager.switchStrategy('local')
      setTimeout(() => {
        this.syncManager.switchStrategy('auto')
      }, 30000)
    }
  }

  private checkAndMergeOverlaps(): void {
    const branches = this.mainDoc.getMap('branches')
    const annotations: any[] = []
    
    branches.forEach((branch, id) => {
      if (!branch.get('mergedInto')) {
        annotations.push(this.branchToAnnotation(branch, id))
      }
    })
    
    const overlaps = this.annotationMerger.detectOverlaps(annotations)
    
    overlaps.forEach(group => {
      if (group.annotations.every((a: any) => a.metadata.get('autoMerge'))) {
        this.annotationMerger.mergeAnnotations(group)
      }
    })
  }

  private branchToAnnotation(branch: Y.Map<any>, id: string): any {
    return {
      id,
      type: branch.get('type'),
      sourcePanel: branch.get('sourcePanel'),
      targetPanel: branch.get('targetPanel'),
      anchors: branch.get('anchors'),
      metadata: branch.get('metadata'),
      order: branch.get('order'),
      version: branch.get('version')
    }
  }

  // Enhanced addBranch with fractional indexing
  public addBranch(parentId: string, branchId: string, branchData: any): void {
    const branches = this.mainDoc.getMap('branches')
    
    // Get existing branches for ordering
    const siblingBranches = this.getBranches(parentId)
    const order = this.fractionalIndexManager.generateForPosition(
      siblingBranches.map(b => ({ id: b.id, order: b.order })),
      siblingBranches.length
    )
    
    const branch = new Y.Map()
    branch.set('id', branchId)
    branch.set('type', branchData.type || 'note')
    branch.set('sourcePanel', parentId)
    branch.set('targetPanel', branchId)
    branch.set('order', order)
    branch.set('version', 1)
    branch.set('metadata', new Y.Map())
    
    // Enhanced anchoring with RelativePosition
    if (branchData.selection) {
      this.structure.getEditorSubdoc(parentId).then(editorDoc => {
        const content = editorDoc.getXmlFragment('content')
        
        const anchors = {
          start: {
            relativePosition: Y.encodeRelativePosition(
              Y.createRelativePositionFromTypeIndex(content, branchData.selection.from)
            ),
            fallback: this.createFallbackAnchor(content, branchData.selection.from)
          },
          end: {
            relativePosition: Y.encodeRelativePosition(
              Y.createRelativePositionFromTypeIndex(content, branchData.selection.to)
            ),
            fallback: this.createFallbackAnchor(content, branchData.selection.to)
          }
        }
        
        branch.set('anchors', anchors)
      })
    }
    
    branches.set(branchId, branch)
    this.performanceMonitor.recordOperation('branch-created')
  }

  private createFallbackAnchor(content: Y.XmlFragment, position: number): any {
    const text = content.toString()
    const contextLength = 20
    
    return {
      offset: position,
      textContent: text.slice(position, position + 20),
      contextBefore: text.slice(Math.max(0, position - contextLength), position),
      contextAfter: text.slice(position, position + contextLength),
      checksum: this.calculateChecksum(text.slice(position - 50, position + 50))
    }
  }

  private calculateChecksum(text: string): string {
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return hash.toString(36)
  }

  public getBranches(panelId: string): any[] {
    const branches = this.mainDoc.getMap('branches')
    const result: any[] = []
    
    branches.forEach((branch, id) => {
      if (branch.get('sourcePanel') === panelId) {
        result.push({
          id,
          ...this.branchToAnnotation(branch, id)
        })
      }
    })
    
    return result.sort((a, b) => (a.order || '').localeCompare(b.order || ''))
  }

  public async initializeNote(noteId: string, noteData: any): Promise<void> {
    this.currentNoteId = noteId
    
    // Load existing data from persistence
    try {
      const updates = await this.persistence.getAllUpdates('main-doc')
      updates.forEach(update => {
        Y.applyUpdate(this.mainDoc, update, 'load')
      })
      console.log(`Loaded ${updates.length} updates from persistence for main-doc`)
    } catch (error) {
      console.error('Failed to load main document from persistence:', error)
    }
    
    // Initialize panels
    const metadata = this.mainDoc.getMap('metadata')
    const panels = metadata.get('panels') as Y.Map<any>
    
    Object.entries(noteData).forEach(([panelId, panelData]: [string, any]) => {
      const panel = new Y.Map()
      panel.set('id', panelId)
      panel.set('type', panelData.type || 'branch')
      panel.set('title', panelData.title || 'Untitled')
      panel.set('position', panelData.position || { x: 100, y: 100 })
      panel.set('dimensions', panelData.dimensions || { width: 600, height: 400 })
      panel.set('state', 'lazy')
      panel.set('lastAccessed', Date.now())
      
      panels.set(panelId, panel)
    })
  }

  public getMainDoc(): Y.Doc {
    return this.mainDoc
  }

  public getMetrics(): PerformanceMetrics {
    const structureMetrics = this.structure.getMetrics()
    return {
      syncLatency: this.syncManager.getLatency(),
      memoryUsage: {
        panels: structureMetrics.cacheSize * 1024 * 100, // Estimate
        annotations: this.mainDoc.getMap('branches').size * 1024 * 10,
        total: 0 // Will be calculated by performance monitor
      },
      activePanels: structureMetrics.activePanels,
      networkBandwidth: {
        incoming: 0,
        outgoing: 0
      },
      lastGC: new Date()
    }
  }

  public getDetailedMetrics(): DetailedMetrics {
    return this.performanceMonitor.getMetrics()
  }

  public async optimizeCanvas(): Promise<void> {
    const branches = this.mainDoc.getMap('branches')
    const panelGroups = new Map<string, any[]>()
    
    branches.forEach((branch, id) => {
      const sourcePanel = branch.get('sourcePanel')
      if (!panelGroups.has(sourcePanel)) {
        panelGroups.set(sourcePanel, [])
      }
      panelGroups.get(sourcePanel)!.push({ id, order: branch.get('order') })
    })
    
    // Rebalance each panel's annotations
    for (const [panelId, annotations] of panelGroups) {
      if (annotations.length > 100) {
        const rebalanced = this.fractionalIndexManager.rebalanceIndices(annotations)
        rebalanced.forEach(({ id, order }) => {
          const branch = branches.get(id)
          if (branch) {
            branch.set('order', order)
          }
        })
      }
    }
    
    await this.structure.forceGarbageCollection()
    await this.persistence.compact('main-doc')
  }

  /**
   * Get batching metrics if batching is enabled
   */
  public getBatchingMetrics(): BatchMetrics | null {
    if (this.persistence instanceof BatchingPersistenceProvider) {
      return this.persistence.getMetrics()
    }
    return null
  }

  public async destroy(): Promise<void> {
    this.performanceMonitor.destroy()
    this.syncManager.disconnect()
    
    // Save final state
    const snapshot = Y.encodeStateAsUpdate(this.mainDoc)
    await this.persistence.saveSnapshot('main-doc', snapshot)
    
    // Shutdown batching provider if applicable
    if (this.persistence instanceof BatchingPersistenceProvider) {
      await this.persistence.shutdown()
    }
    
    // Cleanup
    this.mainDoc.destroy()
  }
} 