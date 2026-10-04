import fs from "node:fs/promises"
import path from "node:path"

import { DefaultCleaner } from "../Cleaner"
import type { Cleaner } from "../Cleaner"
import type { CleanDocument, ParsedDocument } from "../Document/types"
import {
  DocumentEmptyError,
  DocumentLoadError,
} from "../Errors/document.errors"
import { parserRegistry } from "../Parsers"
import type { ParserRegistry } from "../Parsers"
import { BadRequestError, NotFoundError } from "@/Utils/httpError"

export interface IngestInput {
  /** Raw file bytes (Loader output). */
  data: Buffer | Uint8Array
  fileName: string
  /** Optional override; otherwise detected from the file extension. */
  mimeType?: string
  /** Optional id for logs/stats. Defaults to the file name. */
  documentId?: string
}

export interface IngestionStats {
  documentId: string
  fileName: string
  mimeType: string
  parser: string
  cleaner: string
  pageCount: number
  blockCount: number
  cleanedBlockCount: number
  removedBlockCount: number
  durationMs: number
}

export interface IngestionResult {
  /** Normalized parser output (pre-cleaning). */
  parsed: ParsedDocument
  /** Cleaned document — the handoff for the future chunker. STOP here. */
  cleaned: CleanDocument
  stats: IngestionStats
}

export interface IngestionDeps {
  registry?: ParserRegistry
  cleaner?: Cleaner
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".html": "text/html",
  ".htm": "text/html",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
}

export function detectMimeType(fileName: string, explicit?: string): string {
  if (explicit && explicit.trim().length > 0) {
    return explicit.split(";")[0]!.trim().toLowerCase()
  }
  const mime = MIME_BY_EXTENSION[path.extname(fileName).toLowerCase()]
  if (!mime) {
    throw new BadRequestError(
      `Cannot detect document type for file: ${fileName}`,
    )
  }
  return mime
}

function countBlocks(document: { pages: { blocks: unknown[] }[] }): number {
  return document.pages.reduce((n, page) => n + page.blocks.length, 0)
}

export interface IngestionLogger {
  info(message: string, fields: Record<string, unknown>): void
}

const defaultLogger: IngestionLogger = {
  info(message, fields) {
    // Structured metadata only — never document contents.
    console.info(message, fields)
  },
}

/**
 * Upload → Load → Parse → Clean → STOP.
 *
 * Loader output (raw bytes) → ParserRegistry → Parser → ParsedDocument →
 * Cleaner → CleanDocument. Chunking/embeddings are later stages and are
 * intentionally not connected here.
 */
export async function ingestDocument(
  input: IngestInput,
  deps: IngestionDeps = {},
  logger: IngestionLogger = defaultLogger,
): Promise<IngestionResult> {
  const startedAt = Date.now()

  if (!input || !input.fileName || typeof input.fileName !== "string") {
    throw new BadRequestError("fileName is required")
  }
  const size = input.data?.length ?? 0
  if (!input.data || size === 0) {
    throw new DocumentEmptyError("Document is empty (0 bytes)")
  }

  const registry = deps.registry ?? parserRegistry
  const cleaner = deps.cleaner ?? new DefaultCleaner()
  const documentId = input.documentId ?? input.fileName
  const mimeType = detectMimeType(input.fileName, input.mimeType)

  const parser = registry.get(mimeType)
  const parsed = await parser.parse({
    data: input.data,
    fileName: input.fileName,
    mimeType,
  })
  const cleaned = cleaner.clean(parsed)

  const blockCount = countBlocks(parsed)
  const cleanedBlockCount = countBlocks(cleaned)
  const stats: IngestionStats = {
    documentId,
    fileName: input.fileName,
    mimeType,
    parser: parser.name,
    cleaner: cleaner.name,
    pageCount: cleaned.pages.length,
    blockCount,
    cleanedBlockCount,
    removedBlockCount: blockCount - cleanedBlockCount,
    durationMs: Date.now() - startedAt,
  }

  logger.info("document.ingested", { ...stats })

  return { parsed, cleaned, stats }
}

/**
 * File-based entry point: loads bytes with Bun, detects the MIME type,
 * then runs the standard ingestDocument flow.
 */
export async function ingestFile(
  filePath: string,
  deps: IngestionDeps = {},
  logger: IngestionLogger = defaultLogger,
  options: { documentId?: string; mimeType?: string } = {},
): Promise<IngestionResult> {
  const absolutePath = path.resolve(filePath)

  try {
    const stats = await fs.stat(absolutePath)
    if (stats.isDirectory()) {
      throw new NotFoundError(`Document path is a directory: ${filePath}`)
    }
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new NotFoundError(`Document file not found: ${filePath}`)
  }

  let data: Buffer
  try {
    data = await fs.readFile(absolutePath)
  } catch (error) {
    throw new DocumentLoadError(`Failed to read document file: ${filePath}`, {
      cause: error,
    })
  }

  return ingestDocument(
    {
      data,
      fileName: path.basename(absolutePath),
      mimeType: options.mimeType,
      documentId: options.documentId,
    },
    deps,
    logger,
  )
}
