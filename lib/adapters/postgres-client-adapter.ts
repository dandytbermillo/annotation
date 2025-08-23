/**
 * PostgreSQL Client Adapter
 * 
 * Browser-compatible PostgreSQL adapter that uses API routes for database operations.
 * This is the preferred adapter name to clearly indicate it's for client-side use.
 * 
 * This adapter is identical to PostgresAPIAdapter but with a clearer name
 * to distinguish it from the server-side PostgresAdapter.
 */

export { PostgresAPIAdapter as PostgresClientAdapter } from './postgres-api-adapter'