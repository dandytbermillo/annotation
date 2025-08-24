import { webcrypto } from 'crypto'

// Polyfill for crypto.subtle in Node.js test environment
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = webcrypto as any
}

// Ensure crypto.subtle is available
if (!globalThis.crypto.subtle) {
  Object.defineProperty(globalThis.crypto, 'subtle', {
    value: webcrypto.subtle,
    writable: true,
    configurable: true
  })
}

// Mock for window object if needed
if (typeof window === 'undefined') {
  global.window = {} as any
}

// Set test environment variables
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test'
}
if (!process.env.POSTGRES_URL) {
  process.env.POSTGRES_URL = 'postgresql://postgres:postgres@localhost:5432/annotation_system_test'
}