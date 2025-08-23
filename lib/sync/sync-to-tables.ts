/**
 * Client-side sync helpers for YJS data
 * Server-side PostgreSQL sync functionality is in separate server-only modules
 */

import * as Y from 'yjs'

// Helper to sync legacy localStorage data to YJS format
export function syncLegacyDataToYjs(noteId: string, doc: Y.Doc, legacyData: Record<string, any>) {
  // Clear any existing YJS state for this note to avoid conflicts
  if (typeof window !== 'undefined') {
    localStorage.removeItem(`yjs-doc-${noteId}`)
  }
  
  // Initialize the YJS document with the legacy data
  const branchesMap = doc.getMap('branches')
  const panelsMap = doc.getMap('panels')
  
  // Clear existing data in the document
  branchesMap.clear()
  panelsMap.clear()
  
  // Add all panels from legacy data
  Object.entries(legacyData).forEach(([panelId, panelData]) => {
    // Store in branches map (for backward compatibility)
    branchesMap.set(panelId, panelData)
    
    // Also store in panels map using YJS native types
    const panelYMap = new Y.Map()
    Object.entries(panelData as any).forEach(([key, value]) => {
      if (key === 'branches' && Array.isArray(value)) {
        // Store branches as Y.Array
        const branchesArray = new Y.Array()
        value.forEach(branchId => branchesArray.push([branchId]))
        panelYMap.set(key, branchesArray)
      } else {
        panelYMap.set(key, value)
      }
    })
    panelsMap.set(panelId, panelYMap)
  })
  
  // Now save the YJS state if in browser
  if (typeof window !== 'undefined') {
    const state = Y.encodeStateAsUpdate(doc)
    const persistableState = {
      documentState: Array.from(state),
      timestamp: Date.now()
    }
    localStorage.setItem(`yjs-doc-${noteId}`, JSON.stringify(persistableState))
  }
  
  console.log(`Migrated legacy data for note ${noteId} to YJS format`)
}

export function checkAndMigrateLegacyData(noteId: string, doc: Y.Doc): boolean {
  if (typeof window === 'undefined') return false
  
  // Check if we have legacy data but no YJS data
  const legacyData = localStorage.getItem(`note-data-${noteId}`)
  const yjsData = localStorage.getItem(`yjs-doc-${noteId}`)
  
  if (legacyData && !yjsData) {
    try {
      const parsedLegacyData = JSON.parse(legacyData)
      syncLegacyDataToYjs(noteId, doc, parsedLegacyData)
      return true
    } catch (error) {
      console.error('Failed to migrate legacy data:', error)
      return false
    }
  }
  
  return false
}