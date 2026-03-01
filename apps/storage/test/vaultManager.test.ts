import { describe, it, expect, beforeEach, afterEach } from "vitest"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { VaultManager, EVENTS } from "../src/index"
import type {
  NoteCreatedPayload,
  NoteUpdatedPayload,
  NoteDeletedPayload,
  NoteRenamedPayload,
  NoteMovedPayload,
  FolderCreatedPayload,
  FolderMovedPayload,
  VaultReadyPayload,
} from "../src/types"

const makeTempDir = () => fs.mkdtemp(path.join(os.tmpdir(), "smart-notes-test-"))

describe("VaultManager", () => {
  let vault: VaultManager
  let vaultPath: string

  beforeEach(async () => {
    vault = new VaultManager()
    vaultPath = await makeTempDir()
    await vault.initializeVault(vaultPath)
  })

  afterEach(async () => {
    await vault.close()
    await fs.rm(vaultPath, { recursive: true, force: true })
  })

  describe("Vault initialization", () => {
    it("creates system directories on init", async () => {
      await expect(fs.stat(path.join(vaultPath, ".grimoire"))).resolves.toBeTruthy()
      await expect(fs.stat(path.join(vaultPath, ".trash"))).resolves.toBeTruthy()
      await expect(fs.stat(path.join(vaultPath, ".conflicts"))).resolves.toBeTruthy()
    })

    it("emits VAULT_READY with correct payload", async () => {
      const v2 = new VaultManager()
      const dir = await makeTempDir()
      const events: VaultReadyPayload[] = []
      v2.on(EVENTS.VAULT_READY, (p: VaultReadyPayload) => events.push(p))
      await v2.initializeVault(dir)
      await v2.close()
      await fs.rm(dir, { recursive: true, force: true })
      expect(events).toHaveLength(1)
      expect(events[0]).toBeDefined()
      expect(events[0]!.vaultPath).toBe(dir)
      expect(typeof events[0]!.scanTimeMs).toBe("number")
    })

    it("preserves note IDs across vault re-opens", async () => {
      const meta = await vault.createNote("", "Stable ID Note", "content")
      await vault.close()
      vault = new VaultManager()
      await vault.initializeVault(vaultPath)
      const notes = await vault.listNotes()
      expect(notes).toHaveLength(1)
      expect(notes[0]).toBeDefined()
      expect(notes[0]!.note_id).toBe(meta.note_id)
    })

    it("soft-deletes DB-tracked notes that no longer exist on disk", async () => {
      const meta = await vault.createNote("", "Will Vanish", "")
      const absPath = path.join(vaultPath, meta.path)
      await fs.unlink(absPath)
      await vault.close()
      vault = new VaultManager()
      await vault.initializeVault(vaultPath)
      const notes = await vault.listNotes()
      expect(notes).toHaveLength(0)
    })

    it("throws when vault path is not a directory", async () => {
      const v2 = new VaultManager()
      const filePath = path.join(vaultPath, "file.txt")
      await fs.writeFile(filePath, "content")
      await expect(v2.initializeVault(filePath)).rejects.toThrow("directory")
      await v2.close()
    })

    it("is safe to call initializeVault twice on same instance", async () => {
      await vault.createNote("", "Note A", "")
      await vault.initializeVault(vaultPath)
      const notes = await vault.listNotes()
      expect(notes).toHaveLength(1)
    })
  })

  describe("Note CRUD", () => {
    it("creates a note and returns metadata", async () => {
      const meta = await vault.createNote("", "Hello World", "body text")
      expect(meta.note_id).toBeTruthy()
      expect(meta.display_name).toBe("Hello World")
      expect(meta.folder_path).toBe("")
      expect(meta.embedding_status).toBe("pending")
      expect(meta.source).toBe("md")
    })

    it("creates the note file with frontmatter on disk", async () => {
      const meta = await vault.createNote("", "Disk Check", "some body")
      const raw = await fs.readFile(path.join(vaultPath, meta.path), "utf8")
      expect(raw).toContain("title: Disk Check")
      expect(raw).toContain("some body")
    })

    it("creates a note inside a subfolder, creating directories", async () => {
      const meta = await vault.createNote("projects/work", "Work Note", "")
      expect(meta.folder_path).toBe("projects/work")
      await expect(
        fs.stat(path.join(vaultPath, "projects", "work", "work-note.md"))
      ).resolves.toBeTruthy()
    })

    it("reads note content and user frontmatter", async () => {
      const m = await vault.createNote("", "Read Test", "Hello content", ["tag1"])
      const { content, userFrontmatter } = await vault.readNote(m.note_id)
      expect(content.trim()).toBe("Hello content")
      expect(userFrontmatter?.tags).toContain("tag1")
    })

    it("updates note content and marks embedding as stale", async () => {
      const meta = await vault.createNote("", "Update Test", "original")
      await vault.updateNote(meta.note_id, "updated body")
      const { content } = await vault.readNote(meta.note_id)
      expect(content.trim()).toBe("updated body")
      const [updated] = await vault.listNotes()
      expect(updated).toBeDefined()
      expect(updated!.embedding_status).toBe("stale")
    })

    it("updates note with new tags", async () => {
      const meta = await vault.createNote("", "Tag Update", "body", ["old"])
      await vault.updateNote(meta.note_id, "body", ["new1", "new2"])
      const tags = await vault.getAllTags()
      const tagNames = tags.map((t) => t.tag)
      expect(tagNames).toContain("new1")
      expect(tagNames).toContain("new2")
      expect(tagNames).not.toContain("old")
    })

    it("soft-deletes a note to trash", async () => {
      const meta = await vault.createNote("", "To Trash", "")
      await vault.deleteNote(meta.note_id)
      expect(await vault.listNotes()).toHaveLength(0)
      const trashed = await vault.listTrashedNotes()
      expect(trashed).toHaveLength(1)
      expect(trashed[0]).toBeDefined()
      expect(trashed[0]!.note_id).toBe(meta.note_id)
    })

    it("soft-delete moves file to .trash directory", async () => {
      const meta = await vault.createNote("", "Trash File", "")
      const originalAbs = path.join(vaultPath, meta.path)
      await vault.deleteNote(meta.note_id)
      await expect(fs.stat(originalAbs)).rejects.toThrow()
      const trashEntries = await fs.readdir(path.join(vaultPath, ".trash"))
      expect(trashEntries.length).toBeGreaterThan(0)
    })

    it("permanently deletes a note from disk and DB", async () => {
      const meta = await vault.createNote("", "Permanent Delete", "")
      const absPath = path.join(vaultPath, meta.path)
      await vault.deleteNote(meta.note_id, true)
      await expect(fs.stat(absPath)).rejects.toThrow()
      expect(await vault.listNotes()).toHaveLength(0)
      expect(await vault.listTrashedNotes()).toHaveLength(0)
    })

    it("throws on read for unknown note ID", async () => {
      await expect(vault.readNote("nonexistent-id")).rejects.toThrow("not found")
    })

    it("throws when creating a note with an empty title", async () => {
      await expect(vault.createNote("", "  ", "body")).rejects.toThrow("empty")
    })

    it("throws on title exceeding 200 characters", async () => {
      await expect(vault.createNote("", "a".repeat(201), "")).rejects.toThrow("long")
    })

    it("throws on duplicate note path in same folder", async () => {
      await vault.createNote("", "Duplicate", "")
      await expect(vault.createNote("", "Duplicate", "")).rejects.toThrow()
    })

    it("sanitizes path traversal in folder path", async () => {
      const meta = await vault.createNote("../../etc", "Traversal Note", "")
      expect(meta.folder_path).not.toContain("..")
    })
  })

  describe("Conflict detection", () => {
    it("detects conflict when file is modified externally between read and write", async () => {
      const meta = await vault.createNote("", "Conflict Note", "original content")
      const absPath = path.join(vaultPath, meta.path)
      await fs.writeFile(absPath, "---\ntitle: Conflict Note\n---\nexternally modified\n", "utf8")
      const events: any[] = []
      vault.on(EVENTS.CONFLICT_DETECTED, (p) => events.push(p))
      await expect(vault.updateNote(meta.note_id, "my attempted change")).rejects.toThrow("Conflict detected")
      expect(events).toHaveLength(1)
      expect(events[0]!.note_id).toBe(meta.note_id)
    })

    it("saves conflict file to .conflicts directory", async () => {
      const meta = await vault.createNote("", "Conflict Save", "original")
      const absPath = path.join(vaultPath, meta.path)
      await fs.writeFile(absPath, "---\ntitle: Conflict Save\n---\nexternal edit\n", "utf8")
      try {
        await vault.updateNote(meta.note_id, "attempted")
      } catch {}
      const conflictEntries = await fs.readdir(path.join(vaultPath, ".conflicts"))
      expect(conflictEntries.some((f) => !f.endsWith(".json"))).toBe(true)
    })
  })

  describe("Note rename and move", () => {
    it("renames a note — updates file name, frontmatter title, and DB display_name", async () => {
      const meta = await vault.createNote("", "Old Title", "body")
      const updated = await vault.renameNote(meta.note_id, "New Title")
      expect(updated.display_name).toBe("New Title")
      const { userFrontmatter } = await vault.readNote(meta.note_id)
      expect(userFrontmatter?.title).toBe("New Title")
      await expect(fs.stat(path.join(vaultPath, "new-title.md"))).resolves.toBeTruthy()
      await expect(fs.stat(path.join(vaultPath, "old-title.md"))).rejects.toThrow()
    })

    it("rename is a no-op when the sanitized filename does not change", async () => {
      const meta = await vault.createNote("", "Same Name", "")
      const updated = await vault.renameNote(meta.note_id, "Same Name")
      expect(updated.note_id).toBe(meta.note_id)
    })

    it("throws on rename to empty title", async () => {
      const meta = await vault.createNote("", "Rename Me", "")
      await expect(vault.renameNote(meta.note_id, "  ")).rejects.toThrow("empty")
    })

    it("throws on rename collision with existing note", async () => {
      const a = await vault.createNote("", "Note A", "")
      await vault.createNote("", "Note B", "")
      await expect(vault.renameNote(a.note_id, "Note B")).rejects.toThrow()
    })

    it("moves a note to a different folder", async () => {
      const meta = await vault.createNote("", "Move Me", "body")
      await vault.createFolder("archive")
      const moved = await vault.moveNote(meta.note_id, "archive")
      expect(moved.folder_path).toBe("archive")
      await expect(fs.stat(path.join(vaultPath, "archive", "move-me.md"))).resolves.toBeTruthy()
      await expect(fs.stat(path.join(vaultPath, "move-me.md"))).rejects.toThrow()
    })

    it("moveNote to same folder is a no-op", async () => {
      const meta = await vault.createNote("base", "No-op Move", "")
      const result = await vault.moveNote(meta.note_id, "base")
      expect(result.path).toBe(meta.path)
    })

    it("emits NOTE_RENAMED with old and new display names", async () => {
      const meta = await vault.createNote("", "Rename Event", "")
      const events: NoteRenamedPayload[] = []
      vault.on(EVENTS.NOTE_RENAMED, (p: NoteRenamedPayload) => events.push(p))
      await vault.renameNote(meta.note_id, "Renamed")
      expect(events[0]).toBeDefined()
      expect(events[0]!.oldDisplayName).toBe("Rename Event")
      expect(events[0]!.newDisplayName).toBe("Renamed")
    })

    it("emits NOTE_MOVED with correct folder paths", async () => {
      const meta = await vault.createNote("", "Move Event", "")
      await vault.createFolder("dest")
      const events: NoteMovedPayload[] = []
      vault.on(EVENTS.NOTE_MOVED, (p: NoteMovedPayload) => events.push(p))
      await vault.moveNote(meta.note_id, "dest")
      expect(events[0]).toBeDefined()
      expect(events[0]!.oldFolderPath).toBe("")
      expect(events[0]!.newFolderPath).toBe("dest")
    })
  })

  describe("Tags", () => {
    it("creates a note with tags stored in DB and frontmatter", async () => {
      const meta = await vault.createNote("", "Tagged Note", "", ["work", "urgent"])
      const tags = await vault.getAllTags()
      const tagNames = tags.map((t) => t.tag)
      expect(tagNames).toContain("work")
      expect(tagNames).toContain("urgent")
      const { userFrontmatter } = await vault.readNote(meta.note_id)
      expect(userFrontmatter?.tags).toContain("work")
    })

    it("searches notes by a single tag", async () => {
      await vault.createNote("", "Note A", "", ["alpha"])
      await vault.createNote("", "Note B", "", ["beta"])
      const results = await vault.searchByTags(["alpha"])
      expect(results).toHaveLength(1)
      expect(results[0]).toBeDefined()
      expect(results[0]!.display_name).toBe("Note A")
    })

    it("searches notes matching any of multiple tags", async () => {
      await vault.createNote("", "Note A", "", ["alpha"])
      await vault.createNote("", "Note B", "", ["beta"])
      await vault.createNote("", "Note C", "", ["gamma"])
      const results = await vault.searchByTags(["alpha", "beta"])
      expect(results).toHaveLength(2)
    })

    it("updateNoteTags persists to DB and frontmatter without touching content", async () => {
      const meta = await vault.createNote("", "Tag Update", "original content")
      await vault.updateNoteTags(meta.note_id, ["new-tag"])
      const { content } = await vault.readNote(meta.note_id)
      expect(content.trim()).toBe("original content")
      const tags = await vault.getAllTags()
      expect(tags.map((t) => t.tag)).toContain("new-tag")
    })

    it("getAllTags returns usage counts", async () => {
      await vault.createNote("", "A", "", ["shared"])
      await vault.createNote("", "B", "", ["shared"])
      await vault.createNote("", "C", "", ["unique"])
      const tags = await vault.getAllTags()
      const shared = tags.find((t) => t.tag === "shared")
      expect(shared?.count).toBe(2)
    })

    it("clears all tags when empty array is passed to updateNoteTags", async () => {
      const meta = await vault.createNote("", "Clear Tags", "", ["old"])
      await vault.updateNoteTags(meta.note_id, [])
      const tags = await vault.getAllTags()
      expect(tags).toHaveLength(0)
    })

    it("normalises tags to lowercase", async () => {
      const meta = await vault.createNote("", "Case Tags", "", ["Work", "URGENT"])
      const tags = await vault.getAllTags()
      const tagNames = tags.map((t) => t.tag)
      expect(tagNames).toContain("work")
      expect(tagNames).toContain("urgent")
    })
  })

  describe("Folder operations", () => {
    it("creates a root-level folder and registers it in DB", async () => {
      const folder = await vault.createFolder("projects")
      expect(folder.name).toBe("projects")
      expect(folder.parent_path).toBe("")
      expect(folder.folder_id).toBeTruthy()
      await expect(fs.stat(path.join(vaultPath, "projects"))).resolves.toBeTruthy()
    })

    it("creates a nested folder with correct parent_path", async () => {
      const folder = await vault.createFolder("projects/client-x")
      expect(folder.parent_path).toBe("projects")
      expect(folder.name).toBe("client-x")
    })

    it("createFolder is idempotent — returns same folder if already exists", async () => {
      const f1 = await vault.createFolder("dup")
      const f2 = await vault.createFolder("dup")
      expect(f1.folder_id).toBe(f2.folder_id)
    })

    it("creates a folder with icon and pinned options", async () => {
      const folder = await vault.createFolder("pinned-folder", { icon: "📌", pinned: true })
      expect(folder.icon).toBe("📌")
      expect(folder.pinned).toBe(true)
    })

    it("renames a folder on disk and cascades path updates to all notes", async () => {
      const folder = await vault.createFolder("old-name")
      await vault.createNote("old-name", "Inner Note", "body")
      const renamed = await vault.renameFolder(folder.folder_id, "new-name")
      expect(renamed.name).toBe("new-name")
      expect(renamed.path).toBe("new-name")
      const notes = await vault.listNotes()
      expect(notes[0]).toBeDefined()
      expect(notes[0]!.folder_path).toBe("new-name")
      await expect(fs.stat(path.join(vaultPath, "new-name"))).resolves.toBeTruthy()
      await expect(fs.stat(path.join(vaultPath, "old-name"))).rejects.toThrow()
    })

    it("renames a folder containing a nested subfolder and cascades all paths", async () => {
      await vault.createFolder("parent")
      await vault.createFolder("parent/child")
      await vault.createNote("parent/child", "Deep Note", "")
      const [parent] = await vault.listFolders("") as any[]
      await vault.renameFolder(parent.folder_id, "renamed-parent")
      const notes = await vault.listNotes()
      expect(notes[0]).toBeDefined()
      expect(notes[0]!.folder_path).toBe("renamed-parent/child")
      const childFolders = await vault.listFolders("renamed-parent")
      expect(childFolders).toHaveLength(1)
      expect(childFolders[0]).toBeDefined()
      expect(childFolders[0]!.path).toBe("renamed-parent/child")
    })

    it("throws on rename to empty name", async () => {
      const folder = await vault.createFolder("to-rename")
      await expect(vault.renameFolder(folder.folder_id, "  ")).rejects.toThrow("empty")
    })

    it("throws on rename collision with existing folder", async () => {
      const f1 = await vault.createFolder("folder-a")
      await vault.createFolder("folder-b")
      await expect(vault.renameFolder(f1.folder_id, "folder-b")).rejects.toThrow()
    })

    it("moves a folder to a new parent and updates all note paths", async () => {
      const source = await vault.createFolder("source")
      await vault.createFolder("destination")
      await vault.createNote("source", "Source Note", "body")
      const moved = await vault.moveFolder(source.folder_id, "destination")
      expect(moved.path).toBe("destination/source")
      expect(moved.parent_path).toBe("destination")
      const notes = await vault.listNotes()
      expect(notes[0]).toBeDefined()
      expect(notes[0]!.folder_path).toBe("destination/source")
      await expect(
        fs.stat(path.join(vaultPath, "destination", "source"))
      ).resolves.toBeTruthy()
      await expect(fs.stat(path.join(vaultPath, "source"))).rejects.toThrow()
    })

    it("moves a nested folder to the vault root with empty parent path", async () => {
      await vault.createFolder("parent")
      const child = await vault.createFolder("parent/child")
      const moved = await vault.moveFolder(child.folder_id, "")
      expect(moved.path).toBe("child")
      expect(moved.parent_path).toBe("")
      await expect(fs.stat(path.join(vaultPath, "child"))).resolves.toBeTruthy()
    })

    it("moveFolder is a no-op when destination resolves to the same path", async () => {
      const folder = await vault.createFolder("stable")
      const result = await vault.moveFolder(folder.folder_id, "")
      expect(result.path).toBe("stable")
    })

    it("throws on moveFolder collision", async () => {
      const movable = await vault.createFolder("movable")
      await vault.createFolder("target")
      await vault.createFolder("target/movable")
      await expect(vault.moveFolder(movable.folder_id, "target")).rejects.toThrow()
    })

    it("emits FOLDER_MOVED event with correct paths", async () => {
      const movable = await vault.createFolder("movable")
      await vault.createFolder("target")
      const events: FolderMovedPayload[] = []
      vault.on(EVENTS.FOLDER_MOVED, (p: FolderMovedPayload) => events.push(p))
      await vault.moveFolder(movable.folder_id, "target")
      expect(events).toHaveLength(1)
      expect(events[0]).toBeDefined()
      expect(events[0]!.oldPath).toBe("movable")
      expect(events[0]!.newPath).toBe("target/movable")
    })

    it("safe-deletes an empty folder from disk and DB", async () => {
      const folder = await vault.createFolder("empty")
      await vault.deleteFolder(folder.folder_id)
      await expect(fs.stat(path.join(vaultPath, "empty"))).rejects.toThrow()
      const folders = await vault.listFolders()
      expect(folders.find((f) => f.folder_id === folder.folder_id)).toBeUndefined()
    })

    it("throws when deleting a non-empty folder without force flag", async () => {
      const folder = await vault.createFolder("occupied")
      await vault.createNote("occupied", "Resident", "")
      await expect(vault.deleteFolder(folder.folder_id)).rejects.toThrow()
    })

    it("force-deletes folder and moves all contained notes to trash", async () => {
      const folder = await vault.createFolder("to-nuke")
      await vault.createNote("to-nuke", "Will Be Trashed", "")
      await vault.deleteFolder(folder.folder_id, true)
      expect(await vault.listNotes()).toHaveLength(0)
      expect(await vault.listTrashedNotes()).toHaveLength(1)
    })

    it("listFolders filters by parent path", async () => {
      await vault.createFolder("root-a")
      await vault.createFolder("root-a/child-1")
      await vault.createFolder("root-a/child-2")
      await vault.createFolder("root-b")
      const children = await vault.listFolders("root-a")
      expect(children).toHaveLength(2)
      expect(children.every((f) => f.parent_path === "root-a")).toBe(true)
    })

    it("emits FOLDER_CREATED with correct payload", async () => {
      const events: FolderCreatedPayload[] = []
      vault.on(EVENTS.FOLDER_CREATED, (p: FolderCreatedPayload) => events.push(p))
      await vault.createFolder("new-folder")
      expect(events).toHaveLength(1)
      expect(events[0]).toBeDefined()
      expect(events[0]!.name).toBe("new-folder")
      expect(events[0]!.parent_path).toBe("")
    })
  })

  describe("Trash and restore", () => {
    it("restores a note from trash to its original path", async () => {
      const meta = await vault.createNote("", "Restorable", "restore content")
      const originalPath = meta.path
      await vault.deleteNote(meta.note_id)
      const restored = await vault.restoreFromTrash(meta.note_id)
      expect(restored.path).toBe(originalPath)
      await expect(fs.stat(path.join(vaultPath, originalPath))).resolves.toBeTruthy()
      expect(await vault.listTrashedNotes()).toHaveLength(0)
      expect(await vault.listNotes()).toHaveLength(1)
    })

    it("restored note content is intact after restore", async () => {
      const meta = await vault.createNote("", "Content Restore", "important body")
      await vault.deleteNote(meta.note_id)
      await vault.restoreFromTrash(meta.note_id)
      const { content } = await vault.readNote(meta.note_id)
      expect(content.trim()).toBe("important body")
    })

    it("throws when restoring a non-existent trash item", async () => {
      await expect(vault.restoreFromTrash("fake-id")).rejects.toThrow()
    })
  })

  describe("Search and listing", () => {
    it("lists notes sorted by display_name ascending", async () => {
      await vault.createNote("", "Zeta", "")
      await vault.createNote("", "Alpha", "")
      const notes = await vault.listNotes({ orderBy: "display_name", direction: "asc" })
      expect(notes[0]).toBeDefined()
      expect(notes[0]!.display_name).toBe("Alpha")
      expect(notes[1]).toBeDefined()
      expect(notes[1]!.display_name).toBe("Zeta")
    })

    it("paginates results with limit and offset", async () => {
      await vault.createNote("", "Note 1", "")
      await vault.createNote("", "Note 2", "")
      await vault.createNote("", "Note 3", "")
      const page1 = await vault.listNotes({ limit: 2, offset: 0, orderBy: "display_name", direction: "asc" })
      const page2 = await vault.listNotes({ limit: 2, offset: 2, orderBy: "display_name", direction: "asc" })
      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(1)
    })

    it("filters notes by folder path", async () => {
      await vault.createNote("", "Root Note", "")
      await vault.createNote("sub", "Sub Note", "")
      const sub = await vault.listNotes({ folderPath: "sub" })
      expect(sub).toHaveLength(1)
      expect(sub[0]).toBeDefined()
      expect(sub[0]!.display_name).toBe("Sub Note")
    })

    it("searches notes by title with partial match", async () => {
      await vault.createNote("", "Alpha Beta", "")
      await vault.createNote("", "Gamma Delta", "")
      const results = await vault.searchNotes("alpha")
      expect(results).toHaveLength(1)
      expect(results[0]).toBeDefined()
      expect(results[0]!.display_name).toBe("Alpha Beta")
    })

    it("search returns empty array when no matches", async () => {
      await vault.createNote("", "Something", "")
      const results = await vault.searchNotes("xxxxxxx")
      expect(results).toHaveLength(0)
    })

    it("searchByTags returns empty array when given no tags", async () => {
      await vault.createNote("", "Tagged", "", ["x"])
      const results = await vault.searchByTags([])
      expect(results).toHaveLength(0)
    })
  })

  describe("Vault stats", () => {
    it("returns correct note count, folder count, and vaultPath", async () => {
      await vault.createNote("", "Note 1", "")
      await vault.createNote("", "Note 2", "")
      await vault.createFolder("folder1")
      const stats = await vault.getVaultStats()
      expect(stats.totalNotes).toBe(2)
      expect(stats.totalFolders).toBe(1)
      expect(stats.vaultPath).toBe(vaultPath)
      expect(stats.storageVersion).toBeTruthy()
    })

    it("does not count trashed notes", async () => {
      const meta = await vault.createNote("", "Trashed", "")
      await vault.deleteNote(meta.note_id)
      const stats = await vault.getVaultStats()
      expect(stats.totalNotes).toBe(0)
    })
  })

  describe("RAG pipeline methods", () => {
    it("getNotesNeedingReindex returns notes with pending status", async () => {
      await vault.createNote("", "Unindexed", "")
      const reindex = await vault.getNotesNeedingReindex()
      expect(reindex.length).toBeGreaterThan(0)
      expect(reindex[0]!.meta.embedding_status).toBe("pending")
    })

    it("updateEmbeddingStatus marks a note as indexed", async () => {
      const meta = await vault.createNote("", "Index Me", "")
      await vault.updateEmbeddingStatus(meta.note_id, "indexed")
      const [note] = await vault.listNotes()
      expect(note!.embedding_status).toBe("indexed")
    })

    it("updateEmbeddingStatus marks a note as error", async () => {
      const meta = await vault.createNote("", "Fail Index", "")
      await vault.updateEmbeddingStatus(meta.note_id, "error")
      const reindex = await vault.getNotesNeedingReindex()
      const found = reindex.find((r) => r.meta.note_id === meta.note_id)
      expect(found).toBeTruthy()
    })

    it("indexed notes do not appear in getNotesNeedingReindex", async () => {
      const meta = await vault.createNote("", "Already Indexed", "")
      await vault.updateEmbeddingStatus(meta.note_id, "indexed")
      const reindex = await vault.getNotesNeedingReindex()
      const found = reindex.find((r) => r.meta.note_id === meta.note_id)
      expect(found).toBeUndefined()
    })

    it("getNotesModifiedSince returns notes created after the given timestamp", async () => {
      const before = Date.now() - 5000
      await vault.createNote("", "Recent Note", "")
      const results = await vault.getNotesModifiedSince(before)
      expect(results).toHaveLength(1)
      expect(results[0]!.meta.display_name).toBe("Recent Note")
    })

    it("getNotesModifiedSince excludes notes created before the timestamp", async () => {
      const after = Date.now() + 5000
      await vault.createNote("", "Old Note", "")
      const results = await vault.getNotesModifiedSince(after)
      expect(results).toHaveLength(0)
    })

    it("getAllNotesWithContent returns full note content", async () => {
      await vault.createNote("", "Content Note", "Full body here")
      const results = await vault.getAllNotesWithContent()
      expect(results).toHaveLength(1)
      expect(results[0]!.content.trim()).toBe("Full body here")
    })

    it("getAllNotesWithContent excludes trashed notes", async () => {
      const meta = await vault.createNote("", "Will Trash", "")
      await vault.deleteNote(meta.note_id)
      const results = await vault.getAllNotesWithContent()
      expect(results).toHaveLength(0)
    })
  })

  describe("Event system", () => {
    it("emits NOTE_CREATED with internal source on create", async () => {
      const events: NoteCreatedPayload[] = []
      vault.on(EVENTS.NOTE_CREATED, (p: NoteCreatedPayload) => events.push(p))
      const meta = await vault.createNote("", "Event Note", "")
      expect(events).toHaveLength(1)
      expect(events[0]!.note_id).toBe(meta.note_id)
      expect(events[0]!.source).toBe("internal")
    })

    it("emits NOTE_UPDATED on content update", async () => {
      const meta = await vault.createNote("", "Update Event", "")
      const events: NoteUpdatedPayload[] = []
      vault.on(EVENTS.NOTE_UPDATED, (p: NoteUpdatedPayload) => events.push(p))
      await vault.updateNote(meta.note_id, "new content")
      expect(events).toHaveLength(1)
      expect(events[0]!.note_id).toBe(meta.note_id)
      expect(events[0]!.source).toBe("internal")
    })

    it("emits NOTE_DELETED with trashed=true on soft delete", async () => {
      const meta = await vault.createNote("", "Delete Event", "")
      const events: NoteDeletedPayload[] = []
      vault.on(EVENTS.NOTE_DELETED, (p: NoteDeletedPayload) => events.push(p))
      await vault.deleteNote(meta.note_id)
      expect(events[0]!.trashed).toBe(true)
      expect(events[0]!.note_id).toBe(meta.note_id)
    })

    it("emits NOTE_DELETED with trashed=false on permanent delete", async () => {
      const meta = await vault.createNote("", "Perm Delete Event", "")
      const events: NoteDeletedPayload[] = []
      vault.on(EVENTS.NOTE_DELETED, (p: NoteDeletedPayload) => events.push(p))
      await vault.deleteNote(meta.note_id, true)
      expect(events[0]!.trashed).toBe(false)
    })
  })
})
