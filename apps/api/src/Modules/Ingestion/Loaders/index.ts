import fs from "node:fs/promises";
import path from "node:path";

import { readPdf } from "./pdf.loader";
import { readTxt } from "./text.loader";
import { readMarkdown } from "./markdown.loader";
import { readHtml } from "./html.loader";
import { readDocx } from "./docx.loader";
import { readCsv } from "./csv.loader";
import { readPdfStructured } from "./pdf.structured.loader";

import type {
  PdfStructuredOptions,
  StructuredDocument,
} from "../Document/types";

export interface LoadDocumentOptions {
  structured?: boolean;
  pdf?: PdfStructuredOptions;
}

export async function loadDocument(
  filePath: string,
  options: LoadDocumentOptions = {},
): Promise<string | StructuredDocument> {
  const extension = path.extname(filePath).toLowerCase();

  if (options.structured) {
    if (extension === ".pdf") {
      return readPdfStructured(filePath, options.pdf);
    }

    const text = await loadDocument(filePath);

    if (typeof text !== "string") {
      throw new Error("Expected plain text document");
    }

    return {
      fileName: path.basename(filePath),
      totalPages: 1,
      pages: [
        {
          pageNumber: 1,
          text,
          headers: [],
          tables: [],
          images: [],
          markdown: text,
        },
      ],
      markdown: text,
      text,
      headers: [],
      tableCount: 0,
      imageCount: 0,
    };
  }

  switch (extension) {
    case ".pdf":
      return readPdf(filePath);

    case ".txt":
      return readTxt(filePath);

    case ".md":
      return readMarkdown(filePath);

    case ".html":
    case ".htm":
      return readHtml(filePath);

    case ".docx":
      return readDocx(filePath);

    case ".csv":
      return readCsv(filePath);

    case ".json":
      return (await fs.readFile(path.resolve(filePath), "utf-8")).trim();

    default:
      throw new Error(`Unsupported document type: ${extension}`);
  }
}
