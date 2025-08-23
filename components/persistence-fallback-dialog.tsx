"use client"

import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface PersistenceFallbackDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUseLocalStorage: () => void
  onRetry: () => void
  isRetrying?: boolean
}

export function PersistenceFallbackDialog({
  open,
  onOpenChange,
  onUseLocalStorage,
  onRetry,
  isRetrying = false
}: PersistenceFallbackDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg">
          <div className="flex flex-col space-y-4">
            {/* Header with icon */}
            <div className="flex items-center space-x-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-100">
                <AlertCircle className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <Dialog.Title className="text-lg font-semibold">
                  Database Connection Failed
                </Dialog.Title>
                <Dialog.Description className="text-sm text-muted-foreground">
                  Unable to connect to the PostgreSQL database
                </Dialog.Description>
              </div>
            </div>

            {/* Message */}
            <div className="text-sm text-muted-foreground">
              The app failed to connect to the database server. You can continue working with local storage, 
              or retry the connection.
            </div>

            {/* Action buttons */}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <button
                type="button"
                onClick={onRetry}
                disabled={isRetrying}
                className="inline-flex h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              >
                {isRetrying ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Retrying...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry Connection
                  </>
                )}
              </button>
              
              <button
                type="button"
                onClick={onUseLocalStorage}
                disabled={isRetrying}
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              >
                Use Local Storage
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}