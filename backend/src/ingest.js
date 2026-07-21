import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pdfParse from "pdf-parse";
import { GoogleGenAI } from "@google/genai";
import { pool } from "./db.js";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 100;

export function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end).trim());
    if (end === text.length) break;
    start += chunkSize - overlap;
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

export async function extractText(filePath) {
  const buffer = await fs.readFile(filePath);

  if (filePath.toLowerCase().endsWith(".pdf")) {
    const data = await pdfParse(buffer);
    return data.text;
  }

  return buffer.toString("utf-8");
}

export async function embedChunk(text) {
  const response = await genai.models.embedContent({
    model: "gemini-embedding-001",
    contents: text,
    config: { outputDimensionality: 768 },
  });
  return response.embeddings[0].values;
}

export async function ingestFile(filePath) {
  const sourceFile = path.basename(filePath);
  const text = await extractText(filePath);
  const chunks = chunkText(text);

  let inserted = 0;
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedChunk(chunks[i]);
    await pool.query(
      `INSERT INTO document_chunks (source_file, chunk_text, chunk_index, embedding)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source_file, chunk_index)
       DO UPDATE SET chunk_text = EXCLUDED.chunk_text, embedding = EXCLUDED.embedding`,
      [sourceFile, chunks[i], i, JSON.stringify(embedding)]
    );
    inserted++;
  }

  // Remove any leftover chunks from a previous ingest of this file that no
  // longer exist (e.g. the file got shorter and now produces fewer chunks).
  await pool.query(
    "DELETE FROM document_chunks WHERE source_file = $1 AND chunk_index >= $2",
    [sourceFile, chunks.length]
  );

  return { file: sourceFile, chunksAdded: inserted };
}

export async function ingestDirectory(dirPath) {
  const files = await fs.readdir(dirPath);
  const results = [];

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const stat = await fs.stat(fullPath);
    if (stat.isFile()) {
      const result = await ingestFile(fullPath);
      results.push(result);
      console.log(`Ingested ${result.file}: ${result.chunksAdded} chunks`);
    }
  }

  return results;
}

// Run directly: `node src/ingest.js` to ingest everything in backend/documents/
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const documentsDir = path.resolve(process.cwd(), "documents");
  ingestDirectory(documentsDir)
    .then(() => {
      console.log("Ingestion complete.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Ingestion failed:", err);
      process.exit(1);
    });
}
