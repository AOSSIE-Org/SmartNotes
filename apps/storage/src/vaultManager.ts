import EventEmitter from "eventemitter3"
import fs from "fs/promises"
import path from "path"
import { v4 as uuidv4 } from "uuid"
import DB from "./DB"
import Watcher from "./Watcher"
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter"
import { atomicWrite, computeHash, toPosix, ensureDir } from "./fsutils"
import { detectConflict, saveConflict } from "./conflicts"
import { EVENTS } from "./events"
import type {
  NoteMeta,
  NoteID,
  NoteWithContent,
  VaultStats,
  Folder,
  FolderID,
  EmbeddingStatus,
  RAGNoteInfo,
  ListNotesOptions,
  VaultReadyPayload,
  NoteCreatedPayload,
  NoteUpdatedPayload,
  NoteDeletedPayload,
  NoteRenamedPayload,
  NoteMovedPayload,
  ConflictDetectedPayload,
  FolderCreatedPayload,
  FolderRenamedPayload,
  FolderDeletedPayload,
  FolderMovedPayload,
} from "./types"

/**
 * VaultManager - Main API for storage operations
 *
 * DB-First Architecture:
 * - Note IDs stored ONLY in database
 * - User files contain only user content (no system IDs)
 * - File system is source of truth for content
 * - Database is source of truth for metadata
 */
export default class VaultManager extends EventEmitter {
  vaultPath: string | null = null
  db: DB | null = null
  watcher: Watcher | null = null
  private isWatcherActive = false

  constructor() {
    super()
  }

  // ==================== INITIALIZATION ====================

  /**
   * Initialize vault: scan files, build database, prepare for operations.
   * Safe to call multiple times — closes any previous state first.
   */
  async initializeVault(vaultPath: string): Promise<void> {
    // Idempotent: close previous state if already initialized
    if (this.vaultPath) {
      await this.close()
    }

    const start = Date.now()

    const stat = await fs.stat(vaultPath)
    if (!stat.isDirectory()) {
      throw new Error("Vault path must be a directory")
    }

    this.vaultPath = vaultPath

    await ensureDir(path.join(vaultPath, ".grimoire"))
    await ensureDir(path.join(vaultPath, ".conflicts"))
    await ensureDir(path.join(vaultPath, ".trash"))

    this.db = new DB(vaultPath)

    // === UUID BUG FIX ===
    // Load all existing notes from DB into a Map keyed by path.
    // processFile will reuse these UUIDs instead of generating new ones,
    // so re-opening the vault never changes a note's ID.
    const existingByPath = new Map<string, NoteMeta>()
    for (const note of this.db.listNotes()) {
      existingByPath.set(note.path, note)
    }

    console.log("[VaultManager] Scanning vault...")
    const files = await this.walk(vaultPath)
    const notes: NoteMeta[] = []

    for (const file of files) {
      if (!file.endsWith(".md")) continue
      try {
        const noteMeta = await this.processFile(file, existingByPath)
        notes.push(noteMeta)
      } catch (err) {
        console.error(`[VaultManager] Error processing ${file}:`, err)
      }
    }

    // Bulk upsert: ON CONFLICT(path) preserves existing note_id, marks stale if hash changed
    if (notes.length > 0) {
      this.db.bulkUpsertNotes(notes)
    }

    // Sync tags for all notes from their frontmatter
    for (const note of notes) {
      const absPath = path.join(vaultPath, note.path)
      try {
        const raw = await fs.readFile(absPath, "utf8")
        const parsed = parseFrontmatter(raw)
        if (parsed.tags && parsed.tags.length > 0) {
          this.db.setNoteTags(note.note_id, parsed.tags)
        }
      } catch (_) {}
    }

    // Soft-delete notes that exist in DB but are no longer on disk
    const scannedPaths = new Set(notes.map((n) => n.path))
    for (const [existingPath, existing] of existingByPath) {
      if (!scannedPaths.has(existingPath)) {
        this.db.softDeleteNote(existing.note_id)
        console.log(`[VaultManager] Note gone from disk, soft-deleted: ${existingPath}`)
      }
    }

    const end = Date.now()
    console.log(`[VaultManager] Initialized ${notes.length} notes in ${end - start}ms`)

    this.emit(EVENTS.VAULT_READY, {
      vaultPath,
      totalNotes: notes.length,
      totalFolders: this.db.listFolders().length,
      scanTimeMs: end - start,
    } as VaultReadyPayload)
  }

  /**
   * Process a single file: extract metadata, reuse existing UUID if known.
   * Never modifies the file — DB-first approach.
   */
  private async processFile(
    absolutePath: string,
    existingByPath?: Map<string, NoteMeta>
  ): Promise<NoteMeta> {
    const raw = await fs.readFile(absolutePath, "utf8")
    const parsed = parseFrontmatter(raw)
    const stat = await fs.stat(absolutePath)

    const relative = path.relative(this.vaultPath!, absolutePath)
    const posixPath = toPosix(relative)
    const folderPath = toPosix(path.dirname(relative))

    // Reuse existing UUID — never generate a new one for a known path
    const existing = existingByPath?.get(posixPath)
    const noteId = existing?.note_id ?? uuidv4()

    const displayName = parsed.title || path.basename(absolutePath, ".md")
    const createdAt = parsed.created_at || existing?.created_at || stat.birthtimeMs || Date.now()

    return {
      note_id: noteId,
      path: posixPath,
      display_name: displayName,
      folder_path: folderPath === "." ? "" : folderPath,
      created_at: createdAt,
      updated_at: stat.mtimeMs,
      content_hash: computeHash(raw),
      source: "md",
      embedding_status: existing?.embedding_status ?? "pending",
      last_embedded_at: existing?.last_embedded_at ?? null,
    }
  }

  /**
   * Recursively walk directory tree
   */
  private async walk(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const files: string[] = []

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        // Skip system directories
        if (
          entry.name === ".grimoire" ||
          entry.name === ".conflicts" ||
          entry.name === ".trash" ||
          entry.name === ".git" ||
          entry.name === ".derived" ||
          entry.name === "node_modules"
        ) {
          continue
        }

        const sub = await this.walk(fullPath)
        files.push(...sub)
      } else {
        files.push(fullPath)
      }
    }

    return files
  }

  // ==================== WATCHER CONTROL ====================

  /**
   * Start watching for external file changes
   */
  startWatcher(): void {
    if (!this.vaultPath) {
      throw new Error("Vault not initialized")
    }

    if (this.isWatcherActive) {
      console.warn("[VaultManager] Watcher already active")
      return
    }

    this.watcher = new Watcher(this.vaultPath)
    this.watcher.start(async (event) => {
      await this.handleWatcherEvent(event)
    })

    this.isWatcherActive = true
    console.log("[VaultManager] Watcher started")
  }

  /**
   * Stop watching
   */
  async stopWatcher(): Promise<void> {
    if (this.watcher) {
      await this.watcher.stop()
      this.watcher = null
      this.isWatcherActive = false
      console.log("[VaultManager] Watcher stopped")
    }
  }

  /**
   * Handle file system events from watcher
   */
  private async handleWatcherEvent(event: any): Promise<void> {
    try {
      switch (event.type) {
        case "add":
          await this.handleExternalAdd(event.relativePath)
          break
        case "change":
          await this.handleExternalChange(event.relativePath)
          break
        case "unlink":
          await this.handleExternalDelete(event.relativePath)
          break
      }
    } catch (err) {
      console.error("[VaultManager] Watcher event error:", err)
    }
  }

  private async handleExternalAdd(relativePath: string): Promise<void> {
    const absolutePath = path.join(this.vaultPath!, relativePath)
    const noteMeta = await this.processFile(absolutePath)

    this.db!.insertNote(noteMeta)

    this.emit(EVENTS.NOTE_CREATED, {
      note_id: noteMeta.note_id,
      path: noteMeta.path,
      folder_path: noteMeta.folder_path,
      display_name: noteMeta.display_name,
      created_at: noteMeta.created_at,
      source: "external",
    } as NoteCreatedPayload)

    console.log(`[VaultManager] External add: ${relativePath}`)
  }

  private async handleExternalChange(relativePath: string): Promise<void> {
    const existing = this.db!.getNoteByPath(relativePath)
    if (!existing) {
      console.warn(`[VaultManager] Change event for unknown note: ${relativePath}`)
      return
    }

    const absolutePath = path.join(this.vaultPath!, relativePath)
    const raw = await fs.readFile(absolutePath, "utf8")
    const newHash = computeHash(raw)
    const parsed = parseFrontmatter(raw)

    // Sync display_name from frontmatter title
    const newDisplayName = parsed.title || path.basename(relativePath, ".md")

    this.db!.updateNoteHashAndTime(existing.note_id, newHash, Date.now())
    if (newDisplayName !== existing.display_name) {
      this.db!.updateNote(existing.note_id, { display_name: newDisplayName })
    }

    // Sync tags from frontmatter
    if (parsed.tags) {
      this.db!.setNoteTags(existing.note_id, parsed.tags)
    }

    this.emit(EVENTS.NOTE_UPDATED, {
      note_id: existing.note_id,
      path: relativePath,
      updated_at: Date.now(),
      content_hash: newHash,
      source: "external",
    } as NoteUpdatedPayload)

    console.log(`[VaultManager] External change: ${relativePath}`)
  }

  private async handleExternalDelete(relativePath: string): Promise<void> {
    const existing = this.db!.getNoteByPath(relativePath)
    if (!existing) {
      return
    }

    this.db!.softDeleteNote(existing.note_id)

    this.emit(EVENTS.NOTE_DELETED, {
      note_id: existing.note_id,
      path: relativePath,
      trashed: false,
      source: "external",
    } as NoteDeletedPayload)

    console.log(`[VaultManager] External delete: ${relativePath}`)
  }

  // ==================== CRUD OPERATIONS ====================

  /**
   * Create a new note
   */
  async createNote(
    folderPath: string,
    title: string,
    content: string = "",
    tags: string[] = []
  ): Promise<NoteMeta> {
    if (!this.vaultPath || !this.db) {
      throw new Error("Vault not initialized")
    }

    // === INPUT VALIDATION ===
    const trimmedTitle = title.trim()
    if (!trimmedTitle) throw new Error("Note title cannot be empty")
    if (trimmedTitle.length > 200) throw new Error("Note title too long (max 200 chars)")

    // Prevent path traversal
    const sanitizedFolder = folderPath.replace(/\.\./g, "").replace(/^\//, "")

    const noteId = uuidv4()
    const createdAt = Date.now()

    const filename = this.sanitizeFilename(trimmedTitle) + ".md"
    const fullFolderPath = path.join(this.vaultPath, sanitizedFolder)
    await ensureDir(fullFolderPath)

    const absolutePath = path.join(fullFolderPath, filename)
    const relativePath = toPosix(path.relative(this.vaultPath, absolutePath))

    // Check for path collision
    if (this.db.getNoteByPath(relativePath)) {
      throw new Error(`A note already exists at path: ${relativePath}`)
    }

    const frontmatter: Record<string, any> = { title: trimmedTitle }
    if (tags.length > 0) frontmatter.tags = tags

    const fileContent = stringifyFrontmatter(content, frontmatter)
    await atomicWrite(absolutePath, fileContent)

    if (this.watcher) {
      this.watcher.markInternalWrite(relativePath)
    }

    const noteMeta: NoteMeta = {
      note_id: noteId,
      path: relativePath,
      display_name: trimmedTitle,
      folder_path: sanitizedFolder === "." ? "" : sanitizedFolder,
      created_at: createdAt,
      updated_at: createdAt,
      content_hash: computeHash(fileContent),
      source: "md",
      embedding_status: "pending",
    }

    this.db.insertNote(noteMeta)

    if (tags.length > 0) {
      this.db.setNoteTags(noteId, tags)
    }

    this.emit(EVENTS.NOTE_CREATED, {
      note_id: noteId,
      path: relativePath,
      folder_path: noteMeta.folder_path,
      display_name: trimmedTitle,
      created_at: createdAt,
      source: "internal",
    } as NoteCreatedPayload)

    return noteMeta
  }

  /**
   * Read note content + metadata
   */
  async readNote(noteId: NoteID): Promise<NoteWithContent> {
    if (!this.vaultPath || !this.db) {
      throw new Error("Vault not initialized")
    }

    const meta = this.db.getNoteById(noteId)
    if (!meta) {
      throw new Error(`Note not found: ${noteId}`)
    }

    const absolutePath = path.join(this.vaultPath, meta.path)
    const raw = await fs.readFile(absolutePath, "utf8")
    const parsed = parseFrontmatter(raw)

    return {
      meta,
      content: parsed.content,
      userFrontmatter: parsed.userFrontmatter,
    }
  }

  /**
   * Update note content (with conflict detection).
   * Also accepts an optional tags array to update tags in DB.
   */
  async updateNote(
    noteId: NoteID,
    newContent: string,
    tags?: string[]
  ): Promise<void> {
    if (!this.vaultPath || !this.db) {
      throw new Error("Vault not initialized")
    }

    const meta = this.db.getNoteById(noteId)
    if (!meta) {
      throw new Error(`Note not found: ${noteId}`)
    }

    const absolutePath = path.join(this.vaultPath, meta.path)

    const diskContent = await fs.readFile(absolutePath, "utf8")
    const diskHash = computeHash(diskContent)

    if (meta.content_hash && detectConflict(meta.content_hash, diskHash)) {
      const conflictPath = await saveConflict(
        this.vaultPath,
        noteId,
        meta.path,
        newContent,
        meta.content_hash,
        diskHash
      )

      this.emit(EVENTS.CONFLICT_DETECTED, {
        note_id: noteId,
        path: meta.path,
        dbHash: meta.content_hash,
        diskHash,
        conflictPath,
        timestamp: Date.now(),
      } as ConflictDetectedPayload)

      throw new Error(`Conflict detected: file changed externally. Check ${conflictPath}`)
    }

    const parsed = parseFrontmatter(diskContent)

    // Merge new tags into frontmatter if provided
    const frontmatter = { ...parsed.userFrontmatter }
    if (tags !== undefined) {
      if (tags.length > 0) {
        frontmatter.tags = tags
      } else {
        delete frontmatter.tags
      }
    }

    const updatedContent = stringifyFrontmatter(newContent, frontmatter)
    await atomicWrite(absolutePath, updatedContent)

    if (this.watcher) {
      this.watcher.markInternalWrite(meta.path)
    }

    const newHash = computeHash(updatedContent)
    this.db.updateNoteHashAndTime(noteId, newHash, Date.now())

    // Sync display_name if frontmatter title changed
    const newDisplayName = frontmatter.title || path.basename(meta.path, ".md")
    if (newDisplayName !== meta.display_name) {
      this.db.updateNote(noteId, { display_name: newDisplayName })
    }

    // Sync tags in DB
    if (tags !== undefined) {
      this.db.setNoteTags(noteId, tags)
    } else if (parsed.tags) {
      this.db.setNoteTags(noteId, parsed.tags)
    }

    this.emit(EVENTS.NOTE_UPDATED, {
      note_id: noteId,
      path: meta.path,
      updated_at: Date.now(),
      content_hash: newHash,
      source: "internal",
    } as NoteUpdatedPayload)
  }

  /**
   * Delete note.
   * - Soft delete (default): moves file to .trash, records original path for restore.
   * - Permanent: hard deletes file and DB record.
   */
  async deleteNote(noteId: NoteID, permanent: boolean = false): Promise<void> {
    if (!this.vaultPath || !this.db) {
      throw new Error("Vault not initialized")
    }

    const meta = this.db.getNoteById(noteId)
    if (!meta) {
      throw new Error(`Note not found: ${noteId}`)
    }

    const absolutePath = path.join(this.vaultPath, meta.path)

    if (permanent) {
      await fs.unlink(absolutePath)
      this.db.deleteNote(noteId)
    } else {
      // Move to .trash with a unique filename
      const trashDir = path.join(this.vaultPath, ".trash")
      const timestamp = Date.now()
      const trashFilename = `${path.basename(meta.path, ".md")}_${timestamp}.md`
      const trashAbsPath = path.join(trashDir, trashFilename)
      const trashRelPath = toPosix(path.relative(this.vaultPath, trashAbsPath))

      await fs.rename(absolutePath, trashAbsPath)

      // Record original path so restore is possible
      this.db.softDeleteNoteWithPath(noteId, trashRelPath, meta.path)
    }

    if (this.watcher) {
      this.watcher.markInternalWrite(meta.path)
    }

    this.emit(EVENTS.NOTE_DELETED, {
      note_id: noteId,
      path: meta.path,
      trashed: !permanent,
      source: "internal",
    } as NoteDeletedPayload)
  }

  // ==================== QUERY OPERATIONS ====================

  /**
   * List notes with optional filter, sort, and pagination.
   */
  async listNotes(options: ListNotesOptions = {}): Promise<NoteMeta[]> {
    if (!this.db) throw new Error("Vault not initialized")
    return this.db.listNotes(options)
  }

  /** Search notes by title (LIKE match) */
  async searchNotes(query: string): Promise<NoteMeta[]> {
    if (!this.db) throw new Error("Vault not initialized")
    return this.db.searchNotes(query)
  }

  /** Search notes that have ALL of the given tags */
  async searchByTags(tags: string[]): Promise<NoteMeta[]> {
    if (!this.db) throw new Error("Vault not initialized")
    return this.db.searchByTags(tags)
  }

  /** Get all unique tags used in the vault with usage counts */
  async getAllTags(): Promise<{ tag: string; count: number }[]> {
    if (!this.db) throw new Error("Vault not initialized")
    return this.db.getAllTags()
  }

  /** List all DB-tracked folders, optionally filtered by parent */
  async listFolders(parentPath?: string): Promise<Folder[]> {
    if (!this.db) throw new Error("Vault not initialized")
    return this.db.listFolders(parentPath)
  }

  /** List notes currently in the trash */
  async listTrashedNotes(): Promise<NoteMeta[]> {
    if (!this.db) throw new Error("Vault not initialized")
    return this.db.listTrashedNotes()
  }

  /**
   * Get vault statistics
   */
  async getVaultStats(): Promise<VaultStats> {
    if (!this.vaultPath || !this.db) throw new Error("Vault not initialized")
    return {
      totalNotes: this.db.countNotes(),
      totalFolders: this.db.listFolders().length,
      vaultPath: this.vaultPath,
      lastScan: Date.now(),
      storageVersion: this.db.getConfig("storage_version") || "unknown",
    }
  }

  // ==================== NOTE RENAME / MOVE ====================

  /**
   * Rename a note: updates filename, frontmatter title, and DB display_name.
   */
  async renameNote(noteId: NoteID, newTitle: string): Promise<NoteMeta> {
    if (!this.vaultPath || !this.db) throw new Error("Vault not initialized")

    const trimmed = newTitle.trim()
    if (!trimmed) throw new Error("Title cannot be empty")
    if (trimmed.length > 200) throw new Error("Title too long (max 200 chars)")

    const meta = this.db.getNoteById(noteId)
    if (!meta) throw new Error(`Note not found: ${noteId}`)

    const oldAbsPath = path.join(this.vaultPath, meta.path)
    const newFilename = this.sanitizeFilename(trimmed) + ".md"
    const newAbsPath = path.join(path.dirname(oldAbsPath), newFilename)
    const newRelPath = toPosix(path.relative(this.vaultPath, newAbsPath))

    if (newAbsPath !== oldAbsPath && this.db.getNoteByPath(newRelPath)) {
      throw new Error(`A note already exists at path: ${newRelPath}`)
    }

    // Update frontmatter title in file
    const raw = await fs.readFile(oldAbsPath, "utf8")
    const parsed = parseFrontmatter(raw)
    const updatedContent = stringifyFrontmatter(parsed.content, {
      ...parsed.userFrontmatter,
      title: trimmed,
    })

    await atomicWrite(newAbsPath, updatedContent)

    if (newAbsPath !== oldAbsPath) {
      await fs.unlink(oldAbsPath)
      if (this.watcher) {
        this.watcher.markInternalWrite(meta.path)
        this.watcher.markInternalWrite(newRelPath)
      }
    } else if (this.watcher) {
      this.watcher.markInternalWrite(newRelPath)
    }

    const newHash = computeHash(updatedContent)
    this.db.updateNote(noteId, {
      path: newRelPath,
      display_name: trimmed,
      content_hash: newHash,
      updated_at: Date.now(),
      embedding_status: "stale",
    })

    const updated = this.db.getNoteById(noteId)!

    this.emit(EVENTS.NOTE_RENAMED, {
      note_id: noteId,
      oldPath: meta.path,
      newPath: newRelPath,
      oldDisplayName: meta.display_name,
      newDisplayName: trimmed,
    } as NoteRenamedPayload)

    return updated
  }

  /**
   * Move a note to a different folder.
   */
  async moveNote(noteId: NoteID, newFolderPath: string): Promise<NoteMeta> {
    if (!this.vaultPath || !this.db) throw new Error("Vault not initialized")

    const sanitizedFolder = newFolderPath.replace(/\.\./g, "").replace(/^\//, "")
    const meta = this.db.getNoteById(noteId)
    if (!meta) throw new Error(`Note not found: ${noteId}`)

    const basename = path.basename(meta.path)
    const newRelPath = sanitizedFolder
      ? toPosix(path.join(sanitizedFolder, basename))
      : basename

    if (newRelPath === meta.path) return meta // No-op

    if (this.db.getNoteByPath(newRelPath)) {
      throw new Error(`A note already exists at: ${newRelPath}`)
    }

    const oldAbsPath = path.join(this.vaultPath, meta.path)
    const newAbsPath = path.join(this.vaultPath, newRelPath)
    await ensureDir(path.dirname(newAbsPath))
    await fs.rename(oldAbsPath, newAbsPath)

    if (this.watcher) {
      this.watcher.markInternalWrite(meta.path)
      this.watcher.markInternalWrite(newRelPath)
    }

    this.db.updateNote(noteId, {
      path: newRelPath,
      folder_path: sanitizedFolder,
      updated_at: Date.now(),
    })

    const updated = this.db.getNoteById(noteId)!

    this.emit(EVENTS.NOTE_MOVED, {
      note_id: noteId,
      oldPath: meta.path,
      newPath: newRelPath,
      oldFolderPath: meta.folder_path,
      newFolderPath: sanitizedFolder,
    } as NoteMovedPayload)

    return updated
  }

  /**
   * Update only the tags on a note (without touching content).
   */
  async updateNoteTags(noteId: NoteID, tags: string[]): Promise<void> {
    if (!this.db) throw new Error("Vault not initialized")
    const meta = this.db.getNoteById(noteId)
    if (!meta) throw new Error(`Note not found: ${noteId}`)

    this.db.setNoteTags(noteId, tags)

    // Also persist tags to frontmatter
    if (this.vaultPath) {
      const absPath = path.join(this.vaultPath, meta.path)
      const raw = await fs.readFile(absPath, "utf8")
      const parsed = parseFrontmatter(raw)
      const frontmatter = { ...parsed.userFrontmatter }
      if (tags.length > 0) {
        frontmatter.tags = tags
      } else {
        delete frontmatter.tags
      }
      const updated = stringifyFrontmatter(parsed.content, frontmatter)
      await atomicWrite(absPath, updated)
      if (this.watcher) this.watcher.markInternalWrite(meta.path)
      const newHash = computeHash(updated)
      this.db.updateNoteHashAndTime(noteId, newHash, Date.now())
    }
  }

  // ==================== FOLDER OPERATIONS ====================

  /**
   * Create a new folder on disk and register it in the DB.
   */
  async createFolder(
    folderPath: string,
    options: { icon?: string; pinned?: boolean } = {}
  ): Promise<Folder> {
    if (!this.vaultPath || !this.db) throw new Error("Vault not initialized")

    const sanitized = folderPath.replace(/\.\./g, "").replace(/^\//, "")
    if (!sanitized) throw new Error("Folder path cannot be empty")

    const absPath = path.join(this.vaultPath, sanitized)
    await ensureDir(absPath)

    // Check if already tracked
    const existing = this.db.getFolderByPath(sanitized)
    if (existing) return existing

    const segments = sanitized.split("/")
    const name = segments[segments.length - 1] ?? sanitized
    const parentPath = segments.slice(0, -1).join("/")

    const folder: Folder = {
      folder_id: uuidv4(),
      path: sanitized,
      name,
      parent_path: parentPath,
      created_at: Date.now(),
      sort_order: 0,
      icon: options.icon,
      pinned: options.pinned ?? false,
    }

    this.db.insertFolder(folder)

    this.emit(EVENTS.FOLDER_CREATED, {
      folder_id: folder.folder_id,
      path: folder.path,
      name: folder.name,
      parent_path: folder.parent_path,
    } as FolderCreatedPayload)

    return folder
  }

  /**
   * Rename a folder — renames the directory on disk and updates all
   * affected note paths and child folder paths in the DB.
   */
  async renameFolder(folderId: FolderID, newName: string): Promise<Folder> {
    if (!this.vaultPath || !this.db) throw new Error("Vault not initialized")

    const trimmedName = newName.trim()
    if (!trimmedName) throw new Error("Folder name cannot be empty")

    const folder = this.db.getFolderById(folderId)
    if (!folder) throw new Error(`Folder not found: ${folderId}`)

    const segments = folder.path.split("/")
    segments[segments.length - 1] = this.sanitizeFilename(trimmedName)
    const newPath = segments.join("/")

    if (newPath === folder.path) return folder // No-op

    if (this.db.getFolderByPath(newPath)) {
      throw new Error(`A folder already exists at: ${newPath}`)
    }

    const oldAbsPath = path.join(this.vaultPath, folder.path)
    const newAbsPath = path.join(this.vaultPath, newPath)
    await fs.rename(oldAbsPath, newAbsPath)

    const affectedNotes = this.db.renameFolderPath(folder.path, newPath)

    const updated = this.db.getFolderById(folderId)!

    this.emit(EVENTS.FOLDER_RENAMED, {
      folder_id: folderId,
      oldPath: folder.path,
      newPath,
      oldName: folder.name,
      newName: trimmedName,
      affectedNotes,
    } as FolderRenamedPayload)

    return updated
  }

  async moveFolder(folderId: FolderID, newParentPath: string): Promise<Folder> {
    if (!this.vaultPath || !this.db) throw new Error("Vault not initialized")

    const sanitized = newParentPath.replace(/\.\./g, "").replace(/^\//, "")
    const folder = this.db.getFolderById(folderId)
    if (!folder) throw new Error(`Folder not found: ${folderId}`)

    const newPath = sanitized ? `${sanitized}/${folder.name}` : folder.name
    if (newPath === folder.path) return folder

    if (this.db.getFolderByPath(newPath)) {
      throw new Error(`A folder already exists at: ${newPath}`)
    }

    const oldAbsPath = path.join(this.vaultPath, folder.path)
    const newAbsPath = path.join(this.vaultPath, newPath)
    await ensureDir(path.dirname(newAbsPath))
    await fs.rename(oldAbsPath, newAbsPath)

    const affectedNotes = this.db.renameFolderPath(folder.path, newPath)
    this.db.updateFolder(folderId, { parent_path: sanitized })

    const updated = this.db.getFolderById(folderId)!

    this.emit(EVENTS.FOLDER_MOVED, {
      oldPath: folder.path,
      newPath,
      affectedNotes,
    } as FolderMovedPayload)

    return updated
  }

  async deleteFolder(folderId: FolderID, force: boolean = false): Promise<void> {
    if (!this.vaultPath || !this.db) throw new Error("Vault not initialized")

    const folder = this.db.getFolderById(folderId)
    if (!folder) throw new Error(`Folder not found: ${folderId}`)

    // Find all notes in this folder tree
    const allNotes = this.db.listNotes()
    const affectedNotes = allNotes.filter(
      (n) => n.folder_path === folder.path || n.folder_path.startsWith(folder.path + "/")
    )

    if (affectedNotes.length > 0 && !force) {
      throw new Error(
        `Folder "${folder.name}" contains ${affectedNotes.length} note(s). Use force=true to trash them all.`
      )
    }

    // Trash all notes in folder tree
    for (const note of affectedNotes) {
      try {
        await this.deleteNote(note.note_id, false)
      } catch (err) {
        console.error(`[VaultManager] Failed to trash note ${note.note_id}:`, err)
      }
    }

    // Remove folder from disk (should be empty or only system files now)
    const absPath = path.join(this.vaultPath, folder.path)
    try {
      await fs.rm(absPath, { recursive: true, force: true })
    } catch (err) {
      console.error(`[VaultManager] Failed to delete folder on disk: ${folder.path}`, err)
    }

    // Remove folder and descendants from DB
    this.db.deleteFolderByPath(folder.path)

    this.emit(EVENTS.FOLDER_DELETED, {
      folder_id: folderId,
      path: folder.path,
      affectedNotes: affectedNotes.length,
    } as FolderDeletedPayload)
  }

  // ==================== TRASH OPERATIONS ====================

  /**
   * Restore a note from the trash to its original location.
   */
  async restoreFromTrash(noteId: NoteID): Promise<NoteMeta> {
    if (!this.vaultPath || !this.db) throw new Error("Vault not initialized")

    // Get the note including its deleted_at (must use a raw DB query)
    const trashNotes = this.db.listTrashedNotes()
    const trashed = trashNotes.find((n) => n.note_id === noteId)
    if (!trashed) throw new Error(`No trashed note found with id: ${noteId}`)

    // Get the trash file path (stored as current `path` in DB)
    const trashAbsPath = path.join(this.vaultPath, trashed.path)
    const originalRelPath = await this.db.restoreNoteFromTrash(noteId)!

    if (!originalRelPath) {
      throw new Error(`Cannot restore: original path unknown for note ${noteId}`)
    }

    const originalAbsPath = path.join(this.vaultPath, originalRelPath)
    await ensureDir(path.dirname(originalAbsPath))

    // Move file back from trash
    try {
      await fs.rename(trashAbsPath, originalAbsPath)
    } catch (err) {
      // If rename fails (cross-device), fall back to copy + delete
      await fs.copyFile(trashAbsPath, originalAbsPath)
      await fs.unlink(trashAbsPath)
    }

    if (this.watcher) {
      this.watcher.markInternalWrite(originalRelPath)
    }

    const restored = this.db.getNoteById(noteId)!

    this.emit(EVENTS.NOTE_CREATED, {
      note_id: noteId,
      path: originalRelPath,
      folder_path: restored.folder_path,
      display_name: restored.display_name,
      created_at: restored.created_at,
      source: "internal",
    } as NoteCreatedPayload)

    return restored
  }

  // ==================== RAG OPERATIONS ====================

  /**
   * Read all active notes with their full content.
   * Intended for initial RAG indexing of the entire vault.
   */
  async getAllNotesWithContent(): Promise<RAGNoteInfo[]> {
    if (!this.vaultPath || !this.db) throw new Error("Vault not initialized")

    const notes = this.db.listNotes()
    const results: RAGNoteInfo[] = []

    for (const meta of notes) {
      try {
        const absPath = path.join(this.vaultPath, meta.path)
        const raw = await fs.readFile(absPath, "utf8")
        const parsed = parseFrontmatter(raw)
        results.push({ meta, content: parsed.content })
      } catch (err) {
        console.error(`[VaultManager] Failed to read note ${meta.path}:`, err)
      }
    }

    return results
  }

  /**
   * Get notes modified since a given timestamp (epoch ms).
   * Use this for incremental RAG re-indexing runs.
   */
  async getNotesModifiedSince(sinceMs: number): Promise<RAGNoteInfo[]> {
    if (!this.vaultPath || !this.db) throw new Error("Vault not initialized")

    const notes = this.db.getNotesModifiedSince(sinceMs)
    const results: RAGNoteInfo[] = []

    for (const meta of notes) {
      try {
        const absPath = path.join(this.vaultPath, meta.path)
        const raw = await fs.readFile(absPath, "utf8")
        const parsed = parseFrontmatter(raw)
        results.push({ meta, content: parsed.content })
      } catch (err) {
        console.error(`[VaultManager] Failed to read note ${meta.path}:`, err)
      }
    }

    return results
  }

  /**
   * Get notes that the RAG pipeline needs to (re)index.
   * Covers: never embedded (pending), content changed (stale), or previous error.
   */
  async getNotesNeedingReindex(): Promise<RAGNoteInfo[]> {
    if (!this.vaultPath || !this.db) throw new Error("Vault not initialized")

    const notes = this.db.getNotesNeedingReindex()
    const results: RAGNoteInfo[] = []

    for (const meta of notes) {
      try {
        const absPath = path.join(this.vaultPath, meta.path)
        const raw = await fs.readFile(absPath, "utf8")
        const parsed = parseFrontmatter(raw)
        results.push({ meta, content: parsed.content })
      } catch (err) {
        console.error(`[VaultManager] Failed to read note ${meta.path}:`, err)
      }
    }

    return results
  }

  /**
   * Update the embedding status for a note.
   * Called by the RAG pipeline after successfully indexing (or on failure).
   *
   * @example
   * await vault.updateEmbeddingStatus(noteId, "indexed")
   * await vault.updateEmbeddingStatus(noteId, "error")
   */
  async updateEmbeddingStatus(noteId: NoteID, status: EmbeddingStatus): Promise<void> {
    if (!this.db) throw new Error("Vault not initialized")
    this.db.updateEmbeddingStatus(noteId, status)
  }

  // ==================== HELPERS ====================

  /**
   * Sanitize filename (remove invalid characters)
   */
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "") // Remove invalid chars
      .replace(/\s+/g, "-") // Replace spaces with dashes
      .toLowerCase()
      .slice(0, 100) // Limit length
  }

  /**
   * Close database and cleanup
   */
  async close(): Promise<void> {
    await this.stopWatcher()
    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.vaultPath = null
  }
}
