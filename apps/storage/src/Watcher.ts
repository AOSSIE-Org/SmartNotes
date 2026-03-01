import chokidar, { FSWatcher } from "chokidar"
import path from "path"
import type { NoteID } from "./types"

/**
 * File system watcher with debouncing and internal write suppression
 * Detects external changes to notes (edits in VS Code, etc.)
 */

export type WatcherEventType = "add" | "change" | "unlink"

export interface WatcherEvent {
  type: WatcherEventType
  path: string // Absolute path
  relativePath: string // Vault-relative POSIX path
  isInternal: boolean // True if triggered by our own write
}

export type WatcherHandler = (event: WatcherEvent) => void | Promise<void>

export default class Watcher {
  private vaultPath: string
  private watcher: FSWatcher | null = null
  private handler: WatcherHandler | null = null

  // Track recent internal writes to suppress echoes
  private recentWrites = new Map<string, number>() // path -> expiry timestamp
  private suppressionWindow = 500 // ms

  // Debounce settings
  private debounceTimers = new Map<string, NodeJS.Timeout>()
  private debounceDelay = 300 // ms

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath
  }

  /**
   * Start watching the vault folder
   */
  start(handler: WatcherHandler): void {
    if (this.watcher) {
      console.warn("Watcher already started")
      return
    }

    this.handler = handler

    this.watcher = chokidar.watch(this.vaultPath, {
      ignored: [
        // Ignore system folders
        /(^|[\/\\])\../, // Dot files/folders (.grimoire, .conflicts, .git)
        "**/node_modules/**",
        "**/.trash/**",
        "**/.conflicts/**",
        "**/.derived/**",
      ],
      ignoreInitial: true, // Don't fire events for existing files
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 100, // Wait 100ms for file to stabilize
        pollInterval: 50,
      },
    })

    // Listen to events
    this.watcher
      .on("add", (filePath) => this.handleEvent("add", filePath))
      .on("change", (filePath) => this.handleEvent("change", filePath))
      .on("unlink", (filePath) => this.handleEvent("unlink", filePath))
      .on("error", (error) => console.error("Watcher error:", error))

    console.log(`Watcher started for: ${this.vaultPath}`)
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
      this.handler = null
      console.log("Watcher stopped")
    }
  }

  /**
   * Mark a path as recently written internally
   * This prevents the watcher from treating our own writes as external edits
   */
  markInternalWrite(relativePath: string): void {
    const expiryTime = Date.now() + this.suppressionWindow
    this.recentWrites.set(relativePath, expiryTime)

    // Clean up after expiry
    setTimeout(() => {
      this.recentWrites.delete(relativePath)
    }, this.suppressionWindow)
  } 

  /**
   * Check if a path was recently written internally
   */
  private isInternalWrite(relativePath: string): boolean {
    const expiry = this.recentWrites.get(relativePath)
    if (!expiry) return false

    const now = Date.now()
    if (now > expiry) {
      this.recentWrites.delete(relativePath)
      return false
    }

    return true
  }

  /**
   * Handle file system event with debouncing
   */
  private handleEvent(type: WatcherEventType, absolutePath: string): void {
    // Only watch .md files for now
    if (!absolutePath.endsWith(".md")) {
      return
    }

    const relativePath = this.toRelativePosix(absolutePath)

    // Clear existing debounce timer
    const timerId = this.debounceTimers.get(relativePath)
    if (timerId) {
      clearTimeout(timerId)
    }

    // Set new debounce timer
    const newTimer = setTimeout(() => {
      this.debounceTimers.delete(relativePath)
      this.emitEvent(type, absolutePath, relativePath)
    }, this.debounceDelay)

    this.debounceTimers.set(relativePath, newTimer)
  }

  /**
   * Emit the event to handler
   */
  private emitEvent(
    type: WatcherEventType,
    absolutePath: string,
    relativePath: string
  ): void {
    if (!this.handler) return

    const isInternal = this.isInternalWrite(relativePath)

    const event: WatcherEvent = {
      type,
      path: absolutePath,
      relativePath,
      isInternal,
    }

    // Skip internal writes (they're echo events from our own operations)
    if (isInternal) {
      console.log(`[Watcher] Suppressed internal write: ${relativePath}`)
      return
    }

    console.log(
      `[Watcher] External ${type}: ${relativePath} (internal=${isInternal})`
    )

    this.handler(event)
  }

  /**
   * Convert absolute path to vault-relative POSIX path
   */
  private toRelativePosix(absolutePath: string): string {
    let relative = path.relative(this.vaultPath, absolutePath)

    // Convert to POSIX (forward slashes)
    relative = relative.split(path.sep).join("/")

    return relative
  }
}
