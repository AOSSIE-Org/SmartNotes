import fs from "fs/promises"
import path from "path"
import { ensureDir } from "./fsutils"
import type { NoteID, Conflict } from "./types"

/**
 * Conflict detection and resolution helpers
 * Uses hash comparison to detect external modifications
 */

/**
 * Detect if a conflict exists between DB and disk
 * @returns true if hashes don't match (conflict exists)
 */
export function detectConflict(dbHash: string, diskHash: string): boolean {
  return dbHash !== diskHash
}

/**
 * Save conflicting content to .conflicts directory
 * @returns path to saved conflict file
 */
export async function saveConflict(
  vaultPath: string,
  noteId: NoteID,
  notePath: string,
  content: string,
  dbHash: string,
  diskHash: string
): Promise<string> {
  const conflictsDir = path.join(vaultPath, ".conflicts")
  await ensureDir(conflictsDir)

  // Create unique conflict filename: noteId_timestamp.md
  const timestamp = Date.now()
  const basename = path.basename(notePath, ".md")
  const conflictFilename = `${basename}_${noteId.slice(0, 8)}_${timestamp}.md`
  const conflictPath = path.join(conflictsDir, conflictFilename)

  // Add header explaining the conflict
  const header = `<!--
CONFLICT DETECTED
Original file: ${notePath}
Note ID: ${noteId}
Timestamp: ${new Date(timestamp).toISOString()}
DB Hash: ${dbHash}
Disk Hash: ${diskHash}

This file contains your attempted changes.
The actual file on disk was modified externally.

To resolve:
1. Open both files side-by-side
2. Manually merge the changes you want to keep
3. Save the merged version to the original location
4. Delete this conflict file
-->

`

  await fs.writeFile(conflictPath, header + content, "utf8")

  // Log conflict to conflicts.json for audit trail
  await logConflict(vaultPath, {
    note_id: noteId,
    originalPath: notePath,
    conflictPath: conflictPath,
    timestamp,
    dbHash,
    diskHash,
    resolved: false,
  })

  return conflictPath
}

/**
 * Log conflict to .grimoire/conflicts.json for audit
 */
async function logConflict(vaultPath: string, conflict: Conflict) {
  const conflictsLog = path.join(vaultPath, ".grimoire", "conflicts.json")

  let conflicts: Conflict[] = []

  try {
    const existing = await fs.readFile(conflictsLog, "utf8")
    conflicts = JSON.parse(existing)
  } catch (err) {
    // File doesn't exist yet, that's fine
  }

  conflicts.push(conflict)

  await fs.writeFile(conflictsLog, JSON.stringify(conflicts, null, 2), "utf8")
}

/**
 * Get list of unresolved conflicts
 */
export async function getUnresolvedConflicts(
  vaultPath: string
): Promise<Conflict[]> {
  const conflictsLog = path.join(vaultPath, ".grimoire", "conflicts.json")

  try {
    const data = await fs.readFile(conflictsLog, "utf8")
    const conflicts: Conflict[] = JSON.parse(data)
    return conflicts.filter((c) => !c.resolved)
  } catch (err) {
    return []
  }
}

/**
 * Mark a conflict as resolved
 */
export async function markConflictResolved(
  vaultPath: string,
  noteId: NoteID,
  timestamp: number
) {
  const conflictsLog = path.join(vaultPath, ".grimoire", "conflicts.json")

  try {
    const data = await fs.readFile(conflictsLog, "utf8")
    const conflicts: Conflict[] = JSON.parse(data)

    const conflict = conflicts.find(
      (c) => c.note_id === noteId && c.timestamp === timestamp
    )

    if (conflict) {
      conflict.resolved = true
      await fs.writeFile(
        conflictsLog,
        JSON.stringify(conflicts, null, 2),
        "utf8"
      )
    }
  } catch (err) {
    // Log doesn't exist, that's fine
  }
}
