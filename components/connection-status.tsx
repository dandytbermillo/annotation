"use client"

import { useEffect, useState } from 'react'
import { UnifiedProvider } from '@/lib/provider-switcher'
import { Database, HardDrive, AlertCircle } from 'lucide-react'

export function ConnectionStatus() {
  const [providerType, setProviderType] = useState<'standard' | 'enhanced' | 'postgres'>('standard')
  const [isHealthy, setIsHealthy] = useState(true)
  
  useEffect(() => {
    // Get initial status
    const provider = UnifiedProvider.getInstance()
    setProviderType(provider.getProviderType())
    setIsHealthy(UnifiedProvider.isConnectionHealthy())
    
    // Listen for fallback events
    const handleFallback = (event: { needsFallback: boolean }) => {
      if (event.needsFallback) {
        setIsHealthy(false)
        setProviderType('standard') // Fallback to standard (IndexedDB)
      }
    }
    
    UnifiedProvider.onFallbackNeeded(handleFallback)
    
    return () => {
      UnifiedProvider.offFallbackNeeded(handleFallback)
    }
  }, [])
  
  const getStatusIcon = () => {
    if (providerType === 'postgres' && isHealthy) {
      return <Database className="h-3 w-3 text-green-400" />
    } else if (providerType === 'postgres' && !isHealthy) {
      return <AlertCircle className="h-3 w-3 text-orange-400" />
    } else {
      return <HardDrive className="h-3 w-3 text-blue-400" />
    }
  }
  
  const getStatusText = () => {
    if (providerType === 'postgres' && isHealthy) {
      return 'PostgreSQL'
    } else if (providerType === 'postgres' && !isHealthy) {
      return 'Connection Error'
    } else if (providerType === 'enhanced') {
      return 'Enhanced Local'
    } else {
      return 'Local Storage'
    }
  }
  
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/20 backdrop-blur-sm text-xs">
      {getStatusIcon()}
      <span className="text-white/80">{getStatusText()}</span>
    </div>
  )
}