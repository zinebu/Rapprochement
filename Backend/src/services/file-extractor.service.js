import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import { execFile } from "child_process";
import { promisify } from "util";
import { parse } from "csv-parse/sync";
import { XMLParser } from "fast-xml-parser";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

console.log("LOADED file-extractor.service.js VERSION OCR");
function hasEnoughText(text) {
  if (!text || typeof text !== "string") return false;
  return text.replace(/\s+/g, " ").trim().length >= 80;
}
const execFileAsync = promisify(execFile);
function resolveGhostscriptPath() {
  const candidates = [
    process.env.GHOSTSCRIPT_PATH,
    "C:\\Program Files\\gs\\gs10.07.0\\bin\\gswin64c.exe",
    "C:\\Program Files\\gs\\gs10.06.0\\bin\\gswin64c.exe",
    "C:\\Program Files\\gs\\gs10.05.1\\bin\\gswin64c.exe",
    "gswin64c.exe",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (candidate.toLowerCase().endsWith(".exe")) {
        if (fs.existsSync(candidate)) return candidate;
      } else {
        return candidate;
      }
    } catch {}
  }

  throw new Error(
    "Ghostscript introuvable. Défini GHOSTSCRIPT_PATH ou installe gswin64c.exe."
  );
}
async function extractPdfNativeText(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  let fullText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");

    fullText += pageText + "\n";
  }

  return fullText.trim();
}

async function preprocessImage(inputPath) {
  const outputPath = path.join(
    os.tmpdir(),
    `ocr-${Date.now()}-${path.basename(inputPath)}.png`
  );

  await sharp(inputPath)
    .rotate()
    .grayscale()
    .normalize()
    .sharpen()
    .threshold(180)
    .resize({ width: 2200, withoutEnlargement: false })
    .png()
    .toFile(outputPath);

  return outputPath;
}

async function ocrImage(imagePath) {
  const preprocessed = await preprocessImage(imagePath);

  try {
    const result = await Tesseract.recognize(preprocessed, "fra+eng", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          console.log("Tesseract progress:", m.progress);
        }
      },
    });

    const text = (result?.data?.text || "").trim();

    console.log("OCR IMAGE PATH:", imagePath);
    console.log("OCR PREPROCESSED PATH:", preprocessed);
    console.log("OCR TEXT LENGTH:", text.length);
    console.log("OCR TEXT PREVIEW:", text.slice(0, 500));

    return text;
  } finally {
    if (fs.existsSync(preprocessed)) fs.unlinkSync(preprocessed);
  }
}

async function convertPdfPagesToImages(filePath) {
  console.log("convertPdfPagesToImages INPUT:", filePath);
  console.log("PDF FILE EXISTS:", fs.existsSync(filePath), filePath);

  const gsPath = resolveGhostscriptPath();
  console.log("Ghostscript used:", gsPath);

  const outputDir = path.join(os.tmpdir(), `pdf-pages-${Date.now()}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPattern = path.join(outputDir, "page-%03d.png");

  const args = [
    "-dSAFER",
    "-dBATCH",
    "-dNOPAUSE",
    "-sDEVICE=png16m",
    "-r300",
    "-dTextAlphaBits=4",
    "-dGraphicsAlphaBits=4",
    `-sOutputFile=${outputPattern}`,
    filePath,
  ];

  try {
    const { stdout, stderr } = await execFileAsync(gsPath, args, {
      windowsHide: true,
    });

    if (stdout) console.log("Ghostscript stdout:", stdout);
    if (stderr) console.log("Ghostscript stderr:", stderr);
  } catch (error) {
    console.error("Ghostscript PDF->PNG ERROR:", error);
    if (error.stdout) console.error("Ghostscript stdout:", error.stdout);
    if (error.stderr) console.error("Ghostscript stderr:", error.stderr);
    throw error;
  }

  const pages = fs
    .readdirSync(outputDir)
    .filter((name) => /^page-\d+\.png$/i.test(name))
    .map((name) => path.join(outputDir, name))
    .sort();

  console.log("Ghostscript generated pages:", pages);

  return { pages };
}

async function ocrPdfScanned(filePath) {
  const { pages } = await convertPdfPagesToImages(filePath);

  console.log("OCR PDF -> pages generated:", pages.length);
  console.log("OCR PDF -> pages paths:", pages);

  if (!pages.length) {
    return {
      text: "",
      pageImages: [],
      error: "Aucune page PDF convertie en image",
    };
  }

  let text = "";

  for (const pagePath of pages) {
    const pageText = await ocrImage(pagePath);
    text += pageText + "\n";
  }

  const finalText = text.trim();

  console.log("OCR FINAL TEXT LENGTH:", finalText.length);

  return {
    text: finalText,
    pageImages: pages,
    error: null,
  };
}
export async function extractDocumentContent(filePath, mimeType, originalName) {
  try {
    if (mimeType === "application/pdf") {
      const nativeText = await extractPdfNativeText(filePath);

      if (hasEnoughText(nativeText)) {
        return {
          kind: "pdf_text",
          method: "pdf_native_text",
          text: nativeText,
          structuredData: null,
          pageImages: [],
        };
      }

      const ocrResult = await ocrPdfScanned(filePath);

      return {
        kind: "pdf_ocr",
        method: "pdf_ocr_tesseract",
        text: ocrResult.text || null,
        structuredData: null,
        pageImages: ocrResult.pageImages || [],
      };
    }

    if (
      ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(mimeType)
    ) {
      const text = await ocrImage(filePath);

      return {
        kind: "image_ocr",
        method: "image_ocr_tesseract",
        text: text || null,
        structuredData: null,
        pageImages: [filePath],
      };
    }

    if (
      mimeType === "text/csv" ||
      originalName.toLowerCase().endsWith(".csv")
    ) {
      const content = fs.readFileSync(filePath, "utf-8");

      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
      });

      return {
        kind: "csv",
        method: "csv_parse",
        text: content,
        structuredData: records,
        pageImages: [],
      };
    }

    if (
      mimeType === "application/xml" ||
      mimeType === "text/xml" ||
      originalName.toLowerCase().endsWith(".xml")
    ) {
      const content = fs.readFileSync(filePath, "utf-8");

      const parser = new XMLParser({
        ignoreAttributes: false,
      });

      const parsed = parser.parse(content);

      return {
        kind: "xml",
        method: "xml_parse",
        text: content,
        structuredData: parsed,
        pageImages: [],
      };
    }

    return {
      kind: "unknown",
      method: "unsupported",
      text: null,
      structuredData: null,
      pageImages: [],
    };
  } catch (error) {
    console.error("extractDocumentContent error:", error);

    return {
      kind: "error",
      method: "error",
      text: null,
      structuredData: null,
      pageImages: [],
      error: String(error),
    };
  }
}