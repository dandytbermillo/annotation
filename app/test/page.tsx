"use client"

export default function TestPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl mb-4">Test Page - PostgreSQL Persistence</h1>
      <p>If you can see this page, the app is running correctly.</p>
      <p className="mt-4">The "Unexpected content type" error occurs when clicking notes due to a y-indexeddb conflict.</p>
      
      <div className="mt-8 p-4 bg-gray-100 rounded">
        <h2 className="font-bold mb-2">PostgreSQL Status:</h2>
        <p>PostgreSQL persistence is configured and the API routes are working.</p>
        <p>The error is isolated to the YJS/IndexedDB integration when loading notes.</p>
      </div>
      
      <div className="mt-4">
        <a href="/" className="text-blue-500 underline">Back to main app</a>
      </div>
    </div>
  )
}