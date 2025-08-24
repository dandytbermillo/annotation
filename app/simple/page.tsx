"use client"

import { useState } from "react"

export default function SimplePage() {
  const [notes, setNotes] = useState([
    { id: "1", title: "Note 1", content: "Content 1" },
    { id: "2", title: "Note 2", content: "Content 2" }
  ])
  const [selectedNote, setSelectedNote] = useState<string | null>(null)

  return (
    <div className="flex h-screen">
      {/* Notes List */}
      <div className="w-80 bg-gray-900 text-white p-4">
        <h2 className="text-xl mb-4">Simple Notes (No YJS)</h2>
        {notes.map(note => (
          <div
            key={note.id}
            onClick={() => setSelectedNote(note.id)}
            className={`p-3 mb-2 rounded cursor-pointer ${
              selectedNote === note.id ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'
            }`}
          >
            {note.title}
          </div>
        ))}
      </div>

      {/* Content Area */}
      <div className="flex-1 p-8">
        {selectedNote ? (
          <div>
            <h1 className="text-2xl mb-4">
              {notes.find(n => n.id === selectedNote)?.title}
            </h1>
            <p>{notes.find(n => n.id === selectedNote)?.content}</p>
          </div>
        ) : (
          <p className="text-gray-500">Select a note to view</p>
        )}
      </div>
    </div>
  )
}