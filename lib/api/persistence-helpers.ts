/**
 * API Persistence Helper Utilities
 * 
 * Provides helper functions for binary data conversion, error handling,
 * and request validation for the persistence API routes.
 */

import { NextResponse } from 'next/server'

/**
 * Convert a Uint8Array to base64 string for JSON transport
 */
export function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  // Convert Uint8Array to binary string
  let binary = ''
  const len = uint8Array.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8Array[i])
  }
  // Convert binary string to base64
  return btoa(binary)
}

/**
 * Convert a base64 string back to Uint8Array
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  // Convert base64 to binary string
  const binaryString = atob(base64)
  // Convert binary string to Uint8Array
  const len = binaryString.length
  const uint8Array = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    uint8Array[i] = binaryString.charCodeAt(i)
  }
  return uint8Array
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(message: string, status: number = 500): NextResponse {
  return NextResponse.json(
    { 
      error: message,
      status,
      timestamp: new Date().toISOString()
    },
    { status }
  )
}

/**
 * Create a standardized success response
 */
export function createSuccessResponse(data: any = { success: true }): NextResponse {
  return NextResponse.json(data)
}

/**
 * Validate required parameters in request body
 */
export function validateRequiredParams(
  params: Record<string, any>,
  required: string[]
): { valid: boolean; missing?: string[] } {
  const missing = required.filter(param => !params[param])
  
  if (missing.length > 0) {
    return { valid: false, missing }
  }
  
  return { valid: true }
}

/**
 * Generate a unique client ID for the session
 * Uses timestamp and random component
 */
export function generateClientId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 9)
  return `client-${timestamp}-${random}`
}

/**
 * Parse and validate action from request body
 */
export function parseAction(body: any): { 
  action: string | null; 
  params: Record<string, any> 
} {
  if (!body || typeof body !== 'object') {
    return { action: null, params: {} }
  }
  
  const { action, ...params } = body
  
  if (!action || typeof action !== 'string') {
    return { action: null, params }
  }
  
  return { action, params }
}

/**
 * Convert Buffer to Uint8Array (for database results)
 */
export function bufferToUint8Array(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer)
}

/**
 * Handle YJS update data conversion
 * Ensures proper format for API transport
 */
export function formatUpdateForTransport(update: Uint8Array | Buffer): string {
  if (Buffer.isBuffer(update)) {
    return uint8ArrayToBase64(bufferToUint8Array(update))
  }
  return uint8ArrayToBase64(update)
}

/**
 * Parse update data from API request
 * Handles both base64 and array formats for backward compatibility
 */
export function parseUpdateFromRequest(update: any): Uint8Array | null {
  if (!update) return null
  
  // Handle base64 string
  if (typeof update === 'string') {
    try {
      return base64ToUint8Array(update)
    } catch (error) {
      console.error('Failed to parse base64 update:', error)
      return null
    }
  }
  
  // Handle array format (backward compatibility)
  if (Array.isArray(update)) {
    return new Uint8Array(update)
  }
  
  // Handle Uint8Array directly
  if (update instanceof Uint8Array) {
    return update
  }
  
  return null
}

/**
 * Create a response with proper CORS headers if needed
 */
export function createCorsResponse(response: NextResponse): NextResponse {
  // Add CORS headers if needed for cross-origin requests
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return response
}

/**
 * Log API operation for monitoring
 */
export function logApiOperation(
  action: string,
  docName: string,
  success: boolean,
  duration?: number,
  error?: any
) {
  const log = {
    timestamp: new Date().toISOString(),
    action,
    docName,
    success,
    duration: duration ? `${duration}ms` : undefined,
    error: error?.message
  }
  
  if (success) {
    console.log('[Persistence API]', JSON.stringify(log))
  } else {
    console.error('[Persistence API Error]', JSON.stringify(log))
  }
}