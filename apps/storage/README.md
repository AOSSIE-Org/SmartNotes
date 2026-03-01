What it does — in plain terms
Vault (the notes folder)
Open any folder as a vault
Re-opening the same folder is safe — nothing breaks or duplicates
Works even if you already have existing .md files in the folder
Notes
Create a note — writes a .md file, saves metadata to DB
Read a note — gives you the content + title + tags
Update a note — saves new content, keeps frontmatter intact
Rename a note — renames the file, updates the title inside the file
Move a note to a different folder
Delete a note — moves to trash by default, or permanent delete
Trash
Deleted notes go to a .trash folder, not permanently gone
List everything in the trash
Restore a trashed note back to its original location
Folders
Create a folder (with optional icon and pin-to-top)
Rename a folder — all notes inside automatically get their paths updated
Delete a folder — safely trashes all notes inside first
Tags
Attach tags to a note when creating or updating
Tags stored in both the DB and the .md file frontmatter
Filter notes by tag
List all tags in the vault with usage counts
Search
Search notes by title
Sorting & Pagination
List notes sorted by last updated, created date, or name
Limit results per page (useful for sidebars with many notes)
Conflict Detection
If a note was edited by another app (e.g. VS Code) while you had it open, it won't silently overwrite — saves a conflict copy and alerts you
File Watcher
Detects when any .md file is added, changed, or deleted outside your app
DB automatically stays in sync even if the user edits notes in another editor
Events
Every action fires an event (noteCreated, noteUpdated, noteDeleted, noteRenamed, noteMoved, folderCreated, folderRenamed, folderDeleted, conflictDetected)
Your UI just listens and reacts — no polling needed
RAG / AI pipeline bridge
Tells the RAG pipeline which notes need to be embedded (new, changed, or previously failed)
Tells the RAG pipeline which notes changed since a specific time (for incremental updates)
Lets the RAG pipeline report back when it finishes indexing a note
Bulk-read all notes with content in one call for initial indexing