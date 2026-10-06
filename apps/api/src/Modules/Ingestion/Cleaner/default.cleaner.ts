import { tableToMarkdown } from "../Document/tables"
import type {
  CleanBlock,
  CleanDocument,
  CleanPage,
  DocumentMetadata,
  ParsedBlock,
  ParsedDocument,
} from "../Document/types"
import { DocumentCleaningError } from "../Errors/document.errors"
import type { Cleaner } from "./cleaner"

export interface DefaultCleanerOptions {
  /** Minimum pages before header/footer detection runs. Default 3. */
  headerFooterMinPages?: number
  /** Min fraction of pages carrying the repeat. Default 0.6. */
  headerFooterMinCoverage?: number
  /**
   * Repair non-hyphenated mid-word line splits ("tok\nens" → "tokens").
   * Default false: without a dictionary this heuristic can merge two
   * legitimate short words, so conservative cleaning keeps the space.
   */
  repairWordSplits?: boolean
}

const LIGATURES: Record<string, string> = {
  ﬁ: "fi",
  ﬂ: "fl",
  ﬀ: "ff",
  ﬃ: "ffi",
  ﬄ: "ffl",
  ﬆ: "st",
  ﬅ: "st",
}

const LIGATURE_RE = /[ﬁﬂﬀﬃﬄﬆﬅ]/g
const ZW_RE = /[​‌‍﻿]/g

function normalizeUnicode(value: string): string {
  return value
    .normalize("NFC")
    .replace(LIGATURE_RE, (m) => LIGATURES[m] ?? m)
    .replace(/ /g, " ")
    .replace(ZW_RE, "")
}

function collapseSpaces(value: string): string {
  return value.replace(/[ \t\f\v]+/g, " ").trim()
}

/** Single-line normalization for headings and table cells. */
function cleanInline(value: string): string {
  return collapseSpaces(normalizeUnicode(value).replace(/\s*\n\s*/g, " "))
}

function endsWithTerminalPunctuation(line: string): boolean {
  return /[.!?:;…"”'"")\]}»]$/.test(line)
}

function reflowParagraphLines(lines: string[], repairWordSplits: boolean): string {
  const paragraphs: string[] = []
  let current = ""

  const push = () => {
    const cleaned = collapseSpaces(current)
    if (cleaned.length > 0) paragraphs.push(cleaned)
    current = ""
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (current.length === 0) {
      current = line
      continue
    }

    const nextFirst = line.split(" ")[0] ?? ""
    const currentWords = current.split(" ")
    const currentLast = currentWords[currentWords.length - 1] ?? ""

    if (
      (current.endsWith("-") || current.endsWith("­")) &&
      /^[A-Za-z0-9]/.test(line)
    ) {
      // Hyphenated line break: "token-\nization" → "tokenization".
      current = current.slice(0, -1) + line
    } else if (
      repairWordSplits &&
      /[a-z]$/.test(current) &&
      /^[a-z]/.test(line) &&
      /^[a-z]{2,4}$/.test(currentLast) &&
      /^[a-z]{2,}/.test(nextFirst) &&
      current.length < 80
    ) {
      // Opt-in heuristic for non-hyphenated splits ("tok\nens" → "tokens").
      current = current + line
    } else if (
      !endsWithTerminalPunctuation(current) &&
      /^[a-z0-9]/.test(line)
    ) {
      // Wrapped prose: "JWT tokens\nare useful" → "JWT tokens are useful".
      current = `${current} ${line}`
    } else {
      push()
      current = line
    }
  }
  push()

  return paragraphs.join("\n").replace(/\n{3,}/g, "\n\n")
}

function cleanTextContent(content: string, repairWordSplits: boolean): string {
  const normalized = normalizeUnicode(content)
  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return ""
  return reflowParagraphLines(lines, repairWordSplits)
}

function cleanBlock(
  block: ParsedBlock,
  repairWordSplits: boolean,
): CleanBlock | null {
  switch (block.type) {
    case "text": {
      const content = cleanTextContent(block.content, repairWordSplits)
      return content.length > 0 ? { type: "text", content } : null
    }
    case "header": {
      const content = cleanInline(block.content)
      return content.length > 0
        ? { type: "header", level: block.level, content }
        : null
    }
    case "table": {
      const rows = block.rows
        .map((row) => row.map((cell) => cleanInline(cell)))
        .filter((row) => row.some((cell) => cell.length > 0))
      if (rows.length === 0) return null
      return { type: "table", content: tableToMarkdown(rows), rows }
    }
    case "image": {
      // Structural information only; never drop or alter.
      return { ...block }
    }
    default: {
      return null;
    }
  }
}

function edgeLine(
  page: CleanPage,
  edge: "first" | "last",
): string | null {
  const block =
    edge === "first" ? page.blocks[0] : page.blocks[page.blocks.length - 1]
  if (!block || (block.type !== "text" && block.type !== "header")) {
    return null
  }
  // Headers/footers often share their block with body text (single "\n",
  // no blank line), so match on the edge LINE, not the whole block.
  const lines = block.content.split("\n")
  const raw = edge === "first" ? lines[0]! : lines[lines.length - 1]!
  const text = cleanInline(raw)
  if (text.length === 0 || text.length > 120) return null
  return text
}

/**
 * Find a repeated header (first line of first block) or footer (last line
 * of last block) across pages. Conservative: exact normalized match,
 * short text only, high coverage.
 */
function findRepeatedEdge(
  pages: CleanPage[],
  edge: "first" | "last",
  minPages: number,
  minCoverage: number,
): string | null {
  if (pages.length < minPages) return null
  const counts = new Map<string, number>()
  for (const page of pages) {
    const text = edgeLine(page, edge)
    if (text) counts.set(text, (counts.get(text) ?? 0) + 1)
  }
  const required = Math.max(minPages, Math.ceil(pages.length * minCoverage))
  for (const [text, count] of counts) {
    if (count >= required) return text
  }
  return null
}

function stripEdgeLine(
  block: CleanBlock,
  edge: "first" | "last",
  repeated: string,
): CleanBlock | null {
  if (block.type !== "text" && block.type !== "header") return block
  const lines = block.content.split("\n")
  const idx = edge === "first" ? 0 : lines.length - 1
  if (cleanInline(lines[idx]!) !== repeated) return block
  const rest = edge === "first" ? lines.slice(1) : lines.slice(0, -1)
  const content = rest.join("\n").trim()
  if (content.length === 0) return null
  return block.type === "header"
    ? { type: "header", level: block.level, content: cleanInline(content) }
    : { type: "text", content }
}

function cleanMetadata(metadata: DocumentMetadata): DocumentMetadata {
  const cleaned: DocumentMetadata = {}
  for (const [key, value] of Object.entries(metadata)) {
    cleaned[key] = typeof value === "string" ? value.trim() : value
  }
  return cleaned
}

/**
 * Safe, format-agnostic normalization. Operates only on the normalized
 * ParsedDocument: no PDF/DOCX knowledge lives here.
 */
export class DefaultCleaner implements Cleaner {
  readonly name = "default"

  constructor(private readonly options: DefaultCleanerOptions = {}) {}

  clean(document: ParsedDocument): CleanDocument {
    try {
      if (!document || !Array.isArray(document.pages)) {
        throw new Error("Invalid parsed document: pages must be an array")
      }
      const repairWordSplits = this.options.repairWordSplits ?? false

      let pages: CleanPage[] = document.pages.map((page) => ({
        pageNumber: page.pageNumber,
        blocks: page.blocks
          .map((block) => cleanBlock(block, repairWordSplits))
          .filter((block): block is CleanBlock => block !== null),
      }))

      const minPages = this.options.headerFooterMinPages ?? 3
      const minCoverage = this.options.headerFooterMinCoverage ?? 0.6
      const header = findRepeatedEdge(pages, "first", minPages, minCoverage)
      const footer = findRepeatedEdge(pages, "last", minPages, minCoverage)

      if (header !== null || footer !== null) {
        pages = pages.map((page) => {
          let blocks = page.blocks
          if (header !== null && blocks.length > 0) {
            const stripped = stripEdgeLine(blocks[0]!, "first", header)
            blocks = stripped ? [stripped, ...blocks.slice(1)] : blocks.slice(1)
          }
          if (footer !== null && blocks.length > 0) {
            const stripped = stripEdgeLine(
              blocks[blocks.length - 1]!,
              "last",
              footer,
            )
            blocks = stripped
              ? [...blocks.slice(0, -1), stripped]
              : blocks.slice(0, -1)
          }
          return { pageNumber: page.pageNumber, blocks }
        })
      }

      return { pages, metadata: cleanMetadata(document.metadata ?? {}) }
    } catch (error) {
      if (error instanceof DocumentCleaningError) throw error
      throw new DocumentCleaningError("Failed to clean document", {
        cause: error,
      })
    }
  }
}
