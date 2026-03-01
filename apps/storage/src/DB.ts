import path from "path"
import Database from "better-sqlite3"
import { ensureDir } from "./fsutils"
import type { NoteMeta, NoteID, Folder, FolderID, EmbeddingStatus, ListNotesOptions } from "./types"

// Bump this when the schema changes to trigger migrations
const STORAGE_VERSION = "2.1.0"

export default class DB {
  dbPath: string
  db: InstanceType<typeof Database>

  constructor(vaultPath: string) {
    const grimoireDir = path.join(vaultPath, ".grimoire")
    this.dbPath = path.join(grimoireDir, "meta.db")

    ensureDir(grimoireDir)

    this.db = new Database(this.dbPath)
    this.db.exec("PRAGMA journal_mode = WAL;")
    this.db.exec("PRAGMA foreign_keys = ON;")
    this.initializeSchema()
    this.runMigrations()
  }

  // ==================== SCHEMA ====================

  initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        note_id TEXT PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        display_name TEXT,
        folder_path TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        content_hash TEXT,
        source TEXT DEFAULT 'md',
        deleted_at INTEGER DEFAULT NULL,
        embedding_status TEXT DEFAULT 'pending',
        last_embedded_at INTEGER DEFAULT NULL,
        original_path TEXT DEFAULT NULL
      );
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS note_tags (
        note_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (note_id, tag),
        FOREIGN KEY (note_id) REFERENCES notes(note_id) ON DELETE CASCADE
      );
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS folders (
        folder_id TEXT PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        parent_path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        icon TEXT DEFAULT NULL,
        pinned INTEGER NOT NULL DEFAULT 0
      );
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `)

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_path);`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_embedding ON notes(embedding_status);`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_tags_tag ON note_tags(tag);`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_path);`)
  }

  // ==================== MIGRATIONS ====================

  runMigrations() {
    const currentVersion = this.getConfig("storage_version")

    if (!currentVersion) {
      this.setConfig("storage_version", STORAGE_VERSION)
      this.setConfig("initialized_at", Date.now().toString())
      console.log(`[DB] Initialized storage version ${STORAGE_VERSION}`)
      return
    }

    if (currentVersion === "1.0.0" || currentVersion === "2.0.0") {
      console.log(`[DB] Migrating from ${currentVersion} to 2.1.0`)
      try { this.db.exec(`ALTER TABLE notes ADD COLUMN embedding_status TEXT DEFAULT 'pending';`) } catch (_) {}
      try { this.db.exec(`ALTER TABLE notes ADD COLUMN last_embedded_at INTEGER DEFAULT NULL;`) } catch (_) {}
      try { this.db.exec(`ALTER TABLE notes ADD COLUMN original_path TEXT DEFAULT NULL;`) } catch (_) {}
      this.db.prepare(`UPDATE notes SET embedding_status = 'pending' WHERE embedding_status IS NULL`).run()
      this.setConfig("storage_version", STORAGE_VERSION)
      console.log(`[DB] Migration to 2.1.0 complete`)
    }
  }

  // ==================== CONFIG ====================

  getConfig(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM config WHERE key = ?").get(key) as any
    return row ? row.value : null
  }

  setConfig(key: string, value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run(key, value)
  }

  // ==================== NOTE CRUD ====================

  /**
   * Bulk upsert notes. On path collision, updates metadata but PRESERVES the existing note_id.
   * This is the fix for the UUID-regeneration bug: re-scanning never replaces an existing ID.
   */
  bulkUpsertNotes(notes: NoteMeta[]) {
    const upsert = this.db.prepare(`
      INSERT INTO notes (note_id, path, display_name, folder_path, created_at, updated_at, content_hash, source, embedding_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        display_name = excluded.display_name,
        folder_path  = excluded.folder_path,
        updated_at   = excluded.updated_at,
        content_hash = excluded.content_hash,
        source       = excluded.source,
        deleted_at   = NULL,
        embedding_status = CASE
          WHEN notes.content_hash != excluded.content_hash THEN 'stale'
          ELSE notes.embedding_status
        END
    `)

    const transaction = this.db.transaction((notes: NoteMeta[]) => {
      for (const n of notes) {
        upsert.run(
          n.note_id,
          n.path,
          n.display_name,
          n.folder_path,
          n.created_at,
          n.updated_at,
          n.content_hash ?? null,
          n.source ?? "md",
          n.embedding_status ?? "pending",
        )
      }
    })

    transaction(notes)
  }

  insertNote(note: NoteMeta): void {
    this.db.prepare(`
      INSERT INTO notes (note_id, path, display_name, folder_path, created_at, updated_at, content_hash, source, embedding_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      note.note_id,
      note.path,
      note.display_name,
      note.folder_path,
      note.created_at,
      note.updated_at,
      note.content_hash ?? null,
      note.source ?? "md",
      note.embedding_status ?? "pending",
    )
  }

  getNoteById(noteId: NoteID): NoteMeta | null {
    const row = this.db
      .prepare("SELECT * FROM notes WHERE note_id = ? AND deleted_at IS NULL")
      .get(noteId) as any
    return row ? this.rowToNoteMeta(row) : null
  }

  getNoteByPath(notePath: string): NoteMeta | null {
    const row = this.db
      .prepare("SELECT * FROM notes WHERE path = ? AND deleted_at IS NULL")
      .get(notePath) as any
    return row ? this.rowToNoteMeta(row) : null
  }

  /** Get a note regardless of deleted_at â€” used for trash/restore */
  getNoteByPathIncDeleted(notePath: string): NoteMeta | null {
    const row = this.db
      .prepare("SELECT * FROM notes WHERE path = ?")
      .get(notePath) as any
    return row ? this.rowToNoteMeta(row) : null
  }

  updateNote(noteId: NoteID, updates: Partial<Omit<NoteMeta, "note_id">>): void {
    const fields = Object.keys(updates).map((key) => `${key} = ?`).join(", ")
    const values = Object.values(updates)
    this.db.prepare(`UPDATE notes SET ${fields} WHERE note_id = ?`).run(...values, noteId)
  }

  updateNoteHashAndTime(noteId: NoteID, contentHash: string, updatedAt: number): void {
    this.db.prepare(`
      UPDATE notes 
      SET content_hash = ?, updated_at = ?, embedding_status = 'stale'
      WHERE note_id = ?
    `).run(contentHash, updatedAt, noteId)
  }

  softDeleteNote(noteId: NoteID): void {
    this.db.prepare("UPDATE notes SET deleted_at = ? WHERE note_id = ?").run(Date.now(), noteId)
  }

  /**
   * Soft delete and record the trash path so we can restore later.
   * Stores the pre-trash path in `original_path`, then updates `path` to trashPath.
   */
  softDeleteNoteWithPath(
    noteId: NoteID,
    trashRelativePath: string,
    originalPath: string
  ): void {
    this.db.prepare(`
      UPDATE notes
      SET deleted_at = ?, original_path = ?, path = ?
      WHERE note_id = ?
    `).run(Date.now(), originalPath, trashRelativePath, noteId)
  }

  /**
   * Restore a trashed note: swap path back to original_path and clear deleted_at / original_path.
   * Returns the original path so the caller can move the file.
   */
  restoreNoteFromTrash(noteId: NoteID): string | null {
    const row = this.db
      .prepare("SELECT original_path, path FROM notes WHERE note_id = ?")
      .get(noteId) as any

    if (!row || !row.original_path) return null

    this.db.prepare(`
      UPDATE notes
      SET deleted_at = NULL, path = original_path, original_path = NULL,
          folder_path = ?, embedding_status = 'stale'
      WHERE note_id = ?
    `).run(
      row.original_path.split("/").slice(0, -1).join("/") || "",
      noteId
    )

    return row.original_path
  }

  deleteNote(noteId: NoteID): void {
    this.db.prepare("DELETE FROM notes WHERE note_id = ?").run(noteId)
  }

  restoreNote(noteId: NoteID): void {
    this.db.prepare("UPDATE notes SET deleted_at = NULL WHERE note_id = ?").run(noteId)
  }

  // ==================== NOTE QUERIES ====================

  listNotes(options: ListNotesOptions = {}): NoteMeta[] {
    const {
      folderPath,
      offset = 0,
      limit,
      orderBy = "updated_at",
      direction = "desc",
    } = options

    // Whitelist to prevent SQL injection
    const safeOrder = ["updated_at", "created_at", "display_name"].includes(orderBy)
      ? orderBy
      : "updated_at"
    const safeDir = direction === "asc" ? "ASC" : "DESC"

    let query = `SELECT * FROM notes WHERE deleted_at IS NULL`
    const params: any[] = []

    if (folderPath !== undefined) {
      query += " AND folder_path = ?"
      params.push(folderPath)
    }

    query += ` ORDER BY ${safeOrder} ${safeDir}`

    if (limit !== undefined) {
      query += " LIMIT ? OFFSET ?"
      params.push(limit, offset)
    }

    const rows = this.db.prepare(query).all(...params) as any[]
    return rows.map(this.rowToNoteMeta)
  }

  /** List notes currently in trash (soft-deleted) */
  listTrashedNotes(): NoteMeta[] {
    const rows = this.db
      .prepare("SELECT * FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC")
      .all() as any[]
    return rows.map(this.rowToNoteMeta)
  }

  searchNotes(searchTerm: string): NoteMeta[] {
    const rows = this.db.prepare(`
      SELECT * FROM notes 
      WHERE deleted_at IS NULL 
      AND display_name LIKE ? 
      ORDER BY updated_at DESC
    `).all(`%${searchTerm}%`) as any[]
    return rows.map(this.rowToNoteMeta)
  }

  searchByTags(tags: string[]): NoteMeta[] {
    if (tags.length === 0) return []
    const placeholders = tags.map(() => "?").join(", ")
    const rows = this.db.prepare(`
      SELECT DISTINCT n.* FROM notes n
      JOIN note_tags t ON n.note_id = t.note_id
      WHERE n.deleted_at IS NULL
      AND t.tag IN (${placeholders})
      ORDER BY n.updated_at DESC
    `).all(...tags) as any[]
    return rows.map(this.rowToNoteMeta)
  }

  countNotes(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM notes WHERE deleted_at IS NULL")
      .get() as any
    return row.count
  }

  getFolderPaths(): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT folder_path 
      FROM notes 
      WHERE deleted_at IS NULL 
      ORDER BY folder_path
    `).all() as any[]
    return rows.map((r) => r.folder_path)
  }

  // ==================== RAG METHODS ====================

  /**
   * Notes modified after a given timestamp â€” for incremental RAG indexing.
   * Returns notes where updated_at > sinceMs OR embedding_status = 'pending'.
   */
  getNotesModifiedSince(sinceMs: number): NoteMeta[] {
    const rows = this.db.prepare(`
      SELECT * FROM notes
      WHERE deleted_at IS NULL
      AND updated_at > ?
      ORDER BY updated_at ASC
    `).all(sinceMs) as any[]
    return rows.map(this.rowToNoteMeta)
  }

  /**
   * Notes that the RAG pipeline needs to (re)index.
   * Covers: never embedded (pending), content changed (stale), or previous failure (error).
   */
  getNotesNeedingReindex(): NoteMeta[] {
    const rows = this.db.prepare(`
      SELECT * FROM notes
      WHERE deleted_at IS NULL
      AND (
        embedding_status IN ('pending', 'stale', 'error')
        OR (embedding_status = 'indexed' AND updated_at > last_embedded_at)
      )
      ORDER BY updated_at ASC
    `).all() as any[]
    return rows.map(this.rowToNoteMeta)
  }

  /** Update the embedding state for a note (called by the RAG pipeline after indexing) */
  updateEmbeddingStatus(noteId: NoteID, status: EmbeddingStatus): void {
    const lastEmbeddedAt = status === "indexed" ? Date.now() : null
    this.db.prepare(`
      UPDATE notes
      SET embedding_status = ?, last_embedded_at = ?
      WHERE note_id = ?
    `).run(status, lastEmbeddedAt, noteId)
  }

  // ==================== TAG METHODS ====================

  /** Replace all tags on a note (atomic: deletes then inserts) */
  setNoteTags(noteId: NoteID, tags: string[]): void {
    const del = this.db.prepare("DELETE FROM note_tags WHERE note_id = ?")
    const ins = this.db.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag) VALUES (?, ?)")

    this.db.transaction(() => {
      del.run(noteId)
      for (const tag of tags) {
        if (tag.trim()) ins.run(noteId, tag.trim().toLowerCase())
      }
    })()
  }

  getNoteTags(noteId: NoteID): string[] {
    const rows = this.db
      .prepare("SELECT tag FROM note_tags WHERE note_id = ? ORDER BY tag")
      .all(noteId) as any[]
    return rows.map((r) => r.tag)
  }

  /** List all unique tags used in the vault */
  getAllTags(): { tag: string; count: number }[] {
    return this.db.prepare(`
      SELECT t.tag, COUNT(*) as count
      FROM note_tags t
      JOIN notes n ON n.note_id = t.note_id
      WHERE n.deleted_at IS NULL
      GROUP BY t.tag
      ORDER BY count DESC, t.tag ASC
    `).all() as any[]
  }

  // ==================== FOLDER CRUD ====================

  insertFolder(folder: Folder): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO folders (folder_id, path, name, parent_path, created_at, sort_order, icon, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      folder.folder_id,
      folder.path,
      folder.name,
      folder.parent_path,
      folder.created_at,
      folder.sort_order ?? 0,
      folder.icon ?? null,
      folder.pinned ? 1 : 0,
    )
  }

  getFolderByPath(folderPath: string): Folder | null {
    const row = this.db
      .prepare("SELECT * FROM folders WHERE path = ?")
      .get(folderPath) as any
    return row ? this.rowToFolder(row) : null
  }

  getFolderById(folderId: FolderID): Folder | null {
    const row = this.db
      .prepare("SELECT * FROM folders WHERE folder_id = ?")
      .get(folderId) as any
    return row ? this.rowToFolder(row) : null
  }

  listFolders(parentPath?: string): Folder[] {
    if (parentPath !== undefined) {
      const rows = this.db
        .prepare("SELECT * FROM folders WHERE parent_path = ? ORDER BY sort_order ASC, name ASC")
        .all(parentPath) as any[]
      return rows.map(this.rowToFolder)
    }
    const rows = this.db
      .prepare("SELECT * FROM folders ORDER BY sort_order ASC, name ASC")
      .all() as any[]
    return rows.map(this.rowToFolder)
  }

  updateFolder(folderId: FolderID, updates: Partial<Omit<Folder, "folder_id">>): void {
    const fields = Object.keys(updates).map((k) => `${k} = ?`).join(", ")
    const values = Object.values(updates)
    this.db.prepare(`UPDATE folders SET ${fields} WHERE folder_id = ?`).run(...values, folderId)
  }

  /** Rename a folder path â€” also updates all child note paths and child folder paths */
  renameFolderPath(oldPath: string, newPath: string): number {
    // Update notes whose folder_path matches exactly
    const r1 = this.db.prepare(`
      UPDATE notes SET folder_path = ? WHERE folder_path = ? AND deleted_at IS NULL
    `).run(newPath, oldPath) as any

    // Update notes in sub-folders (e.g. oldPath/sub -> newPath/sub)
    this.db.prepare(`
      UPDATE notes 
      SET folder_path = ? || SUBSTR(folder_path, LENGTH(?) + 1)
      WHERE folder_path LIKE ? AND deleted_at IS NULL
    `).run(newPath, oldPath, oldPath + "/%")

    // Update note paths themselves
    this.db.prepare(`
      UPDATE notes 
      SET path = ? || SUBSTR(path, LENGTH(?) + 1)
      WHERE path LIKE ? AND deleted_at IS NULL
    `).run(newPath, oldPath, oldPath + "/%")

    // Update child folder paths
    this.db.prepare(`
      UPDATE folders 
      SET path = ? || SUBSTR(path, LENGTH(?) + 1),
          parent_path = CASE 
            WHEN parent_path = ? THEN ?
            ELSE ? || SUBSTR(parent_path, LENGTH(?) + 1)
          END
      WHERE path LIKE ?
    `).run(newPath, oldPath, oldPath, newPath, newPath, oldPath, oldPath + "/%")

    // Update the folder itself
    this.db.prepare("UPDATE folders SET path = ?, name = ? WHERE path = ?").run(
      newPath,
      newPath.split("/").pop() ?? newPath,
      oldPath
    )

    return (r1.changes as number)
  }

  deleteFolder(folderId: FolderID): void {
    this.db.prepare("DELETE FROM folders WHERE folder_id = ?").run(folderId)
  }

  deleteFolderByPath(folderPath: string): void {
    this.db.prepare("DELETE FROM folders WHERE path = ?").run(folderPath)
  }

  // ==================== HELPERS ====================

  private rowToNoteMeta(row: any): NoteMeta {
    return {
      note_id: row.note_id,
      path: row.path,
      display_name: row.display_name,
      folder_path: row.folder_path,
      created_at: row.created_at,
      updated_at: row.updated_at,
      content_hash: row.content_hash,
      source: row.source,
      deleted_at: row.deleted_at ?? null,
      embedding_status: row.embedding_status ?? "pending",
      last_embedded_at: row.last_embedded_at ?? null,
    }
  }

  private rowToFolder(row: any): Folder {
    return {
      folder_id: row.folder_id,
      path: row.path,
      name: row.name,
      parent_path: row.parent_path,
      created_at: row.created_at,
      sort_order: row.sort_order,
      icon: row.icon ?? undefined,
      pinned: row.pinned === 1,
    }
  }

  close(): void {
    this.db.close()
  }
}

