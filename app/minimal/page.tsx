"use client"

export default function MinimalPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl">Minimal Test Page</h1>
      <p>This page has no YJS dependencies at all.</p>
      <p>If this loads without errors, the issue is in the YJS integration.</p>
      <div className="mt-4">
        <button 
          className="px-4 py-2 bg-blue-500 text-white rounded"
          onClick={() => alert('Button clicked!')}
        >
          Test Button
        </button>
      </div>
    </div>
  )
}