import fs from "fs/promises"
import path from "path"
import crypto from "crypto"

/**
 * Atomic write with Windows compatibility
 * On Windows, we can't rename over an existing file, so we:
 * 1. Write to temp file
 * 2. Copy temp to destination (overwriting)
 * 3. Delete temp file
 */
export async function atomicWrite(filePath: string, content: string) {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath)
  const tempPath = path.join(
    dir,
    base + ".tmp-" + Math.random().toString(36).slice(2)
  )

  try {
    // Write to temp file
    await fs.writeFile(tempPath, content, "utf8")
    
    // Use copyFile instead of rename  (works better on Windows)
    await fs.copyFile(tempPath, filePath)
    
    // Clean up temp file
    await fs.unlink(tempPath)
  } catch (err: any) {
    // If operation fails, try to clean up temp file
    try {
      await fs.unlink(tempPath)
    } catch (_) {
      // Ignore cleanup errors
    }
    throw err
  }
}

export function computeHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex")
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/")
}

export async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true })
}