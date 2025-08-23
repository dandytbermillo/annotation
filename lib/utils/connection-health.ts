/**
 * PostgreSQL Connection Health Check
 * 
 * Provides utilities to check the health of PostgreSQL connection
 * without disrupting existing functionality.
 */

export enum ConnectionStatus {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED', 
  CHECKING = 'CHECKING'
}

export interface HealthCheckResult {
  status: ConnectionStatus
  message?: string
  timestamp: Date
}

/**
 * Check if PostgreSQL is healthy and accessible
 * @param timeout - Maximum time to wait for response (default: 5000ms)
 * @param retries - Number of retry attempts (default: 3)
 * @returns Promise<boolean> - true if healthy, false otherwise
 */
export async function checkPostgresHealth(
  timeout: number = 5000,
  retries: number = 3
): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)
      
      const response = await fetch('/api/persistence/health', {
        method: 'GET',
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      
      if (response.ok) {
        const data = await response.json()
        return data.healthy === true
      }
      
      // If not ok but not a network error, don't retry
      if (response.status >= 400 && response.status < 500) {
        return false
      }
      
    } catch (error) {
      // Network error or timeout
      if (attempt === retries) {
        console.warn(`PostgreSQL health check failed after ${retries} attempts:`, error)
        return false
      }
      
      // Wait before retry with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  return false
}

/**
 * Get detailed health check result with status and message
 */
export async function getDetailedHealthStatus(): Promise<HealthCheckResult> {
  try {
    const isHealthy = await checkPostgresHealth(5000, 1)
    
    if (isHealthy) {
      return {
        status: ConnectionStatus.CONNECTED,
        message: 'PostgreSQL is connected and healthy',
        timestamp: new Date()
      }
    } else {
      return {
        status: ConnectionStatus.DISCONNECTED,
        message: 'Unable to connect to PostgreSQL database',
        timestamp: new Date()
      }
    }
  } catch (error) {
    return {
      status: ConnectionStatus.DISCONNECTED,
      message: error instanceof Error ? error.message : 'Unknown connection error',
      timestamp: new Date()
    }
  }
}

/**
 * Connection health monitor that can emit events
 */
export class ConnectionHealthMonitor {
  private listeners: Map<string, Function[]> = new Map()
  private checkInterval: NodeJS.Timeout | null = null
  private lastStatus: ConnectionStatus = ConnectionStatus.CHECKING
  
  /**
   * Start monitoring connection health
   * @param intervalMs - How often to check health (default: 30000ms)
   */
  startMonitoring(intervalMs: number = 30000) {
    this.stopMonitoring()
    
    // Initial check
    this.checkHealth()
    
    // Set up interval
    this.checkInterval = setInterval(() => {
      this.checkHealth()
    }, intervalMs)
  }
  
  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }
  
  /**
   * Perform health check and emit events if status changed
   */
  private async checkHealth() {
    const result = await getDetailedHealthStatus()
    
    if (result.status !== this.lastStatus) {
      this.lastStatus = result.status
      this.emit('statusChanged', result)
      
      if (result.status === ConnectionStatus.DISCONNECTED) {
        this.emit('connectionLost', result)
      } else if (result.status === ConnectionStatus.CONNECTED) {
        this.emit('connectionRestored', result)
      }
    }
  }
  
  /**
   * Add event listener
   */
  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event)!.push(callback)
  }
  
  /**
   * Remove event listener
   */
  off(event: string, callback: Function) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      const index = callbacks.indexOf(callback)
      if (index > -1) {
        callbacks.splice(index, 1)
      }
    }
  }
  
  /**
   * Emit event
   */
  private emit(event: string, data: any) {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      callbacks.forEach(callback => callback(data))
    }
  }
  
  /**
   * Get current status
   */
  getCurrentStatus(): ConnectionStatus {
    return this.lastStatus
  }
}

// Singleton instance
let monitorInstance: ConnectionHealthMonitor | null = null

export function getConnectionMonitor(): ConnectionHealthMonitor {
  if (!monitorInstance) {
    monitorInstance = new ConnectionHealthMonitor()
  }
  return monitorInstance
}