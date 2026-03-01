import matter from "gray-matter"
import yaml from "js-yaml"

/**
 * Parse frontmatter from markdown content (DB-First approach)
 * - Does NOT inject system IDs into files
 * - Only extracts user-provided metadata
 * - Preserves all user frontmatter as-is
 */
export function parseFrontmatter(rawText: string) {
  const parsed = matter(rawText)

  // Extract user metadata if present (optional fields)
  const title = parsed.data.title || null
  const tags = parsed.data.tags || []
  const created_at = parsed.data.created_at || null
  const description = parsed.data.description || null

  return {
    // User frontmatter (preserved)
    title,
    tags,
    created_at,
    description,
    userFrontmatter: parsed.data, // Full user frontmatter

    // Content
    content: parsed.content,
    rawText, // Original unmodified text
  }
}

/**
 * Create frontmatter string from object (for new notes)
 */
export function stringifyFrontmatter(
  content: string,
  frontmatter?: Record<string, any>
): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    return content // No frontmatter, just content
  }

  // Use yaml.dump directly (js-yaml v4 removed safeDump; matter.stringify uses it)
  const frontmatterStr = yaml.dump(frontmatter, { lineWidth: -1 }).trimEnd()
  const body = content.startsWith("\n") ? content : `\n${content}`
  return `---\n${frontmatterStr}\n---${body}`
}

/**
 * Remove specific keys from frontmatter (migration helper)
 * Used to clean up old system-injected IDs if they exist
 */
export function removeFrontmatterKeys(
  rawText: string,
  keysToRemove: string[]
): string {
  const parsed = matter(rawText)

  // Remove specified keys
  keysToRemove.forEach((key) => {
    delete parsed.data[key]
  })

  // If no frontmatter left, return just content
  if (Object.keys(parsed.data).length === 0) {
    return parsed.content
  }

  return matter.stringify(parsed.content, parsed.data)
}