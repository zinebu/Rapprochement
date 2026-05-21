import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export async function getPdfPageCount(buffer) {
  if (!buffer?.length) return 0;
  try {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    return pdf.numPages || 0;
  } catch {
    return 0;
  }
}

/**
 * Extrait une plage de pages (1-based, inclusive) dans un nouveau PDF.
 */
export async function extractPdfPageRange(sourceBuffer, pageStart, pageEnd) {
  const start = Math.max(1, Math.floor(Number(pageStart) || 1));
  const end = Math.max(start, Math.floor(Number(pageEnd) || start));
  const src = await PDFDocument.load(sourceBuffer);
  const out = await PDFDocument.create();

  for (let page = start; page <= end; page++) {
    const pageIndex = page - 1;
    if (pageIndex >= src.getPageCount()) break;
    const [copied] = await out.copyPages(src, [pageIndex]);
    out.addPage(copied);
  }

  return Buffer.from(await out.save());
}
