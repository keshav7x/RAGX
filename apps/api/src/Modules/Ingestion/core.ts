import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFParse } from "pdf-parse";

// NOTE: local dev helper only — never imported by the request path.
// It takes an explicit local path (no URLs, no client input) and returns
// text to the caller. It must never log document contents: server logs
// are the wrong place for potentially sensitive file text.
export async function readPdf(filePath: string) {

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const absolutePath = path.resolve(__dirname, filePath);

  const fileBuffer = await fs.readFile(absolutePath);

  const parser = new PDFParse({
    data: fileBuffer,
  });

  const result = await parser.getText();

  await parser.destroy();

  return result.text;
}
