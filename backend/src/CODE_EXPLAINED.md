# backend/src — Line-by-Line Explanation (for beginners)

This document explains **every file in `backend/src`**, line by line, in plain language.
Read files in this order for the best learning path:
`db.js` → `migrate.js` → `ingest.js` → `retrieve.js` → `generate.js` → `patients.js` → `seedPatients.js` → `routes/*.js` → `server.js`

---

## 1. `db.js` — Database Connection

```js
import pg from "pg";
import dotenv from "dotenv";
```
- `pg` is the official PostgreSQL driver for Node.js. It lets JavaScript talk to a Postgres database.
- `dotenv` reads secret/config values (like passwords) from a `.env` file instead of hardcoding them in code.

```js
dotenv.config();
```
- Loads the `.env` file into `process.env` so `process.env.DATABASE_URL` becomes available below.

```js
const { Pool } = pg;
```
- `pg` exports several things; we pull out just `Pool` — a class that manages a set of reusable database connections (a "connection pool"), which is faster than opening a new connection for every query.

```js
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
```
- Creates one shared `Pool` instance using the connection string from `.env` (e.g. `postgres://user:pass@host:port/dbname`).
- `export`ed so every other file (`ingest.js`, `retrieve.js`, `patients.js`, etc.) can `import { pool }` and reuse the **same** connection pool instead of creating new ones. This is the single source of truth for talking to the database.

---

## 2. `migrate.js` — Database Schema Migrations

Migrations are just SQL files that create/change tables. This file makes sure they run automatically, in order, exactly once.

```js
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./db.js";
```
- `fs/promises`: Node's file-system module (promise-based version) — used to read the `migrations` folder and each `.sql` file.
- `path`: helps safely build file paths that work on any OS.
- `fileURLToPath`: converts a `file://` URL to a normal path string (used later to detect "was this file run directly?").
- `pool`: the shared DB connection from `db.js`.

```js
const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");
```
- Builds an absolute path to the `backend/migrations` folder, relative to wherever the process was started (`process.cwd()` = current working directory, normally `backend/`).

```js
async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);
}
```
- Creates a bookkeeping table `schema_migrations` if it doesn't already exist. It stores the filename of every migration that has already run, so we never re-run the same migration twice.

```js
async function getAppliedMigrations() {
  const result = await pool.query("SELECT name FROM schema_migrations");
  return new Set(result.rows.map((r) => r.name));
}
```
- Fetches all migration names already applied and puts them into a `Set` (a list with fast "does it contain X?" lookups).

```js
export async function runMigrations() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
```
- `runMigrations` is the main function, called once when the server starts (see `server.js`).
- Reads every filename inside `migrations/`, keeps only `.sql` files, and sorts them alphabetically (which is why migration files are named `001_...`, `002_...` — sorting = correct execution order).

```js
  for (const file of files) {
    if (applied.has(file)) continue;
```
- Loops through each migration file. If it's already been applied (tracked in the `applied` set), skip it.

```js
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Applied migration: ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration failed (${file}): ${err.message}`);
    } finally {
      client.release();
    }
  }
}
```
- Reads the raw SQL text from the file.
- `pool.connect()` grabs one dedicated connection from the pool (needed because a transaction must run on a single connection).
- `BEGIN` / `COMMIT` / `ROLLBACK` = a **transaction**: either the whole migration + the "mark as applied" insert succeed together, or if anything fails, everything is undone (`ROLLBACK`) so the database is never left half-migrated.
- `client.release()` (in `finally`, so it always runs) gives the connection back to the pool for reuse.

```js
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations()
    .then(() => {
      console.log("All migrations applied.");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```
- This check means "was this exact file executed directly from the terminal (e.g. `node src/migrate.js`), rather than just imported by another file?"
- If yes, run the migrations immediately and exit — `process.exit(0)` means success, `process.exit(1)` means failure (standard Unix exit code convention).
- If the file was only `import`ed (like `server.js` does), this block is skipped, and only the `export`ed `runMigrations` function is used.

---

## 3. `ingest.js` — Turning Documents into Searchable Vectors

This is the heart of the "RAG" (Retrieval-Augmented Generation) system: it reads documents, breaks them into pieces, converts each piece into a list of numbers ("embedding"), and stores them for later search.

```js
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pdfParse from "pdf-parse";
import { GoogleGenAI } from "@google/genai";
import { pool } from "./db.js";
```
- `pdfParse`: a library that extracts plain text out of PDF files.
- `GoogleGenAI`: Google's SDK for calling Gemini AI models (used here for embeddings and later for text generation).
- Rest are the same as before.

```js
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
```
- Creates one client object authenticated with your Gemini API key (from `.env`). All AI calls go through this object.

```js
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 100;
```
- Documents are split into pieces ("chunks") of **500 characters** each.
- Each chunk **overlaps** the previous one by **100 characters**, so a sentence that gets cut in half at a chunk boundary still appears whole in the neighboring chunk — this avoids losing meaning at the edges.

```js
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
```
- Splits one long string of text into several overlapping smaller strings.
- `start` = where the current chunk begins; `end` = where it stops (either 500 chars later, or the end of the text, whichever comes first).
- `chunks.push(...)` saves the chunk (`.trim()` removes extra whitespace at the edges).
- `if (end === text.length) break;` — if we just grabbed the last chunk (reached the end of the text), stop looping.
- `start += chunkSize - overlap` — move the start forward by 400 (500 - 100), so the next chunk starts 100 characters before the previous one ended = the overlap.
- `.filter(...)` at the end removes any empty chunks (e.g., from trailing whitespace).

```js
export async function extractText(filePath) {
  const buffer = await fs.readFile(filePath);

  if (filePath.toLowerCase().endsWith(".pdf")) {
    const data = await pdfParse(buffer);
    return data.text;
  }

  return buffer.toString("utf-8");
}
```
- Reads the raw file into memory as a `Buffer` (raw bytes).
- If the filename ends in `.pdf`, use `pdfParse` to pull the text out of the PDF structure.
- Otherwise (e.g. `.txt`), just convert the raw bytes into a normal text string using UTF-8 encoding.

```js
export async function embedChunk(text) {
  const response = await genai.models.embedContent({
    model: "gemini-embedding-001",
    contents: text,
    config: { outputDimensionality: 768 },
  });
  return response.embeddings[0].values;
}
```
- Sends a piece of text to Google's embedding model (`gemini-embedding-001`).
- An "embedding" is a list of 768 numbers that represents the *meaning* of the text as coordinates in space. Similar meanings end up as nearby numbers — this is what makes semantic search possible later.
- `response.embeddings[0].values` pulls out that array of 768 numbers from the API response.
- Note: this same function is reused in `retrieve.js` to embed the user's *question* (so the question and the document chunks live in the same "meaning space" and can be compared).

```js
export async function ingestFile(filePath) {
  const sourceFile = path.basename(filePath);
  const text = await extractText(filePath);
  const chunks = chunkText(text);
```
- `path.basename` extracts just the filename (e.g. `diabetes.txt`) from a full path (e.g. `/backend/documents/diabetes.txt`) — used as an identifier in the database.
- Extracts the text, then splits it into chunks, using the functions defined above.

```js
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
```
- Loops through every chunk, one at a time (`i` = chunk index, e.g. 0, 1, 2...).
- For each chunk: generate its embedding, then save `(filename, chunk text, chunk index, embedding)` into the `document_chunks` table.
- `$1, $2, $3, $4` are placeholders — the actual values are passed separately in the array `[sourceFile, chunks[i], i, ...]`. This is called a **parameterized query** and it prevents SQL injection attacks (never build SQL by directly gluing strings together).
- `ON CONFLICT (source_file, chunk_index) DO UPDATE ...` — if a row with the same file+chunk-index already exists (e.g. you re-uploaded the same file), **update** it instead of failing with a duplicate error. This is called an "upsert" (update-or-insert).
- `JSON.stringify(embedding)` converts the array of 768 numbers into a text format that Postgres's `pgvector` extension can parse into its native `vector` type.
- `inserted++` counts how many chunks were successfully saved.

```js
  await pool.query(
    "DELETE FROM document_chunks WHERE source_file = $1 AND chunk_index >= $2",
    [sourceFile, chunks.length]
  );

  return { file: sourceFile, chunksAdded: inserted };
}
```
- Cleanup step: if this file previously had, say, 10 chunks, but the updated file now only produces 7 chunks, this deletes the leftover old chunks (index 7, 8, 9) so stale data doesn't linger.
- Returns a small summary object describing what happened.

```js
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
```
- Lists everything inside a folder (e.g. `backend/documents/`).
- For each entry, `fs.stat` checks metadata (is it a file or a subfolder?). `stat.isFile()` skips subfolders.
- Calls `ingestFile` on every actual file found, collecting the results and logging progress.

```js
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
```
- Same "run directly" pattern as `migrate.js`. Lets you run `node src/ingest.js` from the terminal to bulk-ingest every file in `backend/documents/` in one go (used for initial setup).

---

## 4. `retrieve.js` — Semantic Search (Finding Relevant Chunks)

```js
import { pool } from "./db.js";
import { embedChunk } from "./ingest.js";
```
- Reuses the database pool and, importantly, reuses `embedChunk` from `ingest.js` — the same function used to embed documents is used here to embed the user's question, so both are comparable in the same "vector space."

```js
export async function retrieveTopChunks(question, topK = 3) {
  const questionEmbedding = await embedChunk(question);
```
- `topK` = how many top matching chunks to return (default 3).
- Converts the user's question into its own 768-number embedding, exactly like a document chunk.

```js
  const client = await pool.connect();
  try {
    await client.query("SET ivfflat.probes = 100");
```
- Grabs a dedicated connection (needed so the `SET` setting below applies to the *same* connection that runs the search query right after it).
- `ivfflat` is the index type used on the `embedding` column (see migration 003) — it speeds up nearest-neighbor search by dividing vectors into "lists" (clusters) and only checking a few by default.
- The comment explains: with a small table, checking only 1 default cluster can miss the real best match. Setting `probes = 100` tells Postgres to check all clusters, guaranteeing correct results even though the table is small (at large scale you'd tune this differently for speed).

```js
    const result = await client.query(
      `SELECT chunk_text, source_file, chunk_index,
              1 - (embedding <=> $1) AS similarity
       FROM document_chunks
       ORDER BY embedding <=> $1
       LIMIT $2`,
      [JSON.stringify(questionEmbedding), topK]
    );

    return result.rows;
  } finally {
    client.release();
  }
}
```
- The core semantic search query:
  - `embedding <=> $1` is pgvector's **cosine distance** operator — smaller means "more similar meaning" to the question.
  - `ORDER BY embedding <=> $1` sorts all chunks from most similar to least similar.
  - `LIMIT $2` keeps only the top `topK` (3) results.
  - `1 - (embedding <=> $1) AS similarity` converts "distance" into a more intuitive "similarity" score (closer to 1 = more similar).
- `client.release()` in `finally` always returns the connection to the pool, even if the query throws an error.
- Returns the matching rows: each has the chunk's text, which file it came from, its index, and its similarity score.

---

## 5. `generate.js` — Asking Gemini to Answer Using Context

This file has two near-identical halves: one for general hospital-policy questions, one for patient-specific questions.

```js
import { GoogleGenAI } from "@google/genai";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
```
- Same Gemini client setup as `ingest.js` (a separate instance, since this is a separate file/module).

```js
const SYSTEM_PROMPT = `You are a hospital assistant. Answer the question using ONLY the context below.
If the answer isn't in the context, say "I don't have that information."`;
```
- A fixed instruction prepended to every policy question. It tells the AI model to stick strictly to the provided document chunks and admit when it doesn't know — this reduces "hallucination" (the AI making up plausible-sounding but false answers).

```js
export async function generateAnswer(question, chunks) {
  const context = chunks
    .map((c) => `[${c.source_file} #${c.chunk_index}] ${c.chunk_text}`)
    .join("\n\n");
```
- Takes the chunks found by `retrieveTopChunks` and formats them into one big text block, each labeled with its source (e.g. `[diabetes.txt #2] ...text...`) so the model (and later, the citation UI) knows where each fact came from.
- `.join("\n\n")` puts a blank line between each chunk for readability.

```js
  const response = await genai.models.generateContent({
    model: "gemma-4-26b-a4b-it",
    contents: `${SYSTEM_PROMPT}\n\nContext:\n${context}\n\nQuestion: ${question}`,
  });

  return response.text;
}
```
- Sends one combined prompt to the Gemini model: the system instructions, the retrieved context, and the actual question — all as one string.
- `response.text` is the model's plain-text answer, which is returned to the caller (`routes/ask.js`).

```js
const PATIENT_SYSTEM_PROMPT = `You are a hospital assistant answering questions about a specific patient.
Answer the question using ONLY the patient record below. If the answer isn't in the record, say "I don't have that information."`;
```
- Same idea as `SYSTEM_PROMPT`, but scoped to one patient's record instead of document chunks.

```js
export async function generatePatientAnswer(question, profile) {
  const { patient, history, medications } = profile;
```
- `profile` is the object returned by `getPatientProfile` in `patients.js` — destructured into its three parts.

```js
  const historyText = history.length
    ? history
        .map(
          (h) =>
            `- ${h.condition_name} (status: ${h.status}${h.diagnosed_date ? `, diagnosed: ${h.diagnosed_date.toISOString().slice(0, 10)}` : ""})${h.notes ? ` — ${h.notes}` : ""}`
        )
        .join("\n")
    : "No recorded medical history.";
```
- If the patient has history entries, format each one as a bullet point line: condition name, status, diagnosis date (formatted as `YYYY-MM-DD` via `.toISOString().slice(0, 10)`), and notes if present.
- The `${condition ? "text" : ""}` pattern is a ternary — it only adds the date/notes part *if* that data exists (avoids printing "diagnosed: undefined").
- If there's no history at all, use a friendly fallback string.

```js
  const medicationsText = medications.length
    ? medications
        .map(
          (m) =>
            `- ${m.medication_name}${m.dosage ? `, ${m.dosage}` : ""}${m.frequency ? `, ${m.frequency}` : ""}${m.prescribed_by ? ` (prescribed by ${m.prescribed_by})` : ""}`
        )
        .join("\n")
    : "No current medications.";
```
- Same pattern as above, but for the medications list (name, dosage, frequency, prescribing doctor).

```js
  const context = `Patient: ${patient.name}, Age: ${patient.age}, Gender: ${patient.gender}, Blood Group: ${patient.blood_group || "unknown"}

Medical History:
${historyText}

Medications:
${medicationsText}`;
```
- Builds one readable text block describing the whole patient — this becomes the "context" the AI is only allowed to answer from.
- `patient.blood_group || "unknown"` — if blood group is missing/null, fall back to the word "unknown".

```js
  const response = await genai.models.generateContent({
    model: "gemma-4-26b-a4b-it",
    contents: `${PATIENT_SYSTEM_PROMPT}\n\nPatient Record:\n${context}\n\nQuestion: ${question}`,
  });

  return response.text;
}
```
- Same as `generateAnswer`, but using the patient-specific prompt and context.

---

## 6. `patients.js` — Reading Patient Data from the Database

```js
import { pool } from "./db.js";

export async function listPatients() {
  const result = await pool.query(
    "SELECT id, name, age, gender FROM patients ORDER BY id"
  );
  return result.rows;
}
```
- A simple query that returns a short summary (id, name, age, gender) for every patient, sorted by id. Used to populate a dropdown/list in the frontend.

```js
export async function getPatientProfile(id) {
  const patientResult = await pool.query(
    "SELECT * FROM patients WHERE id = $1",
    [id]
  );
  const patient = patientResult.rows[0];
  if (!patient) return null;
```
- Looks up one patient by id (`SELECT *` = all columns). `$1` placeholder + `[id]` parameter, again to avoid SQL injection.
- `.rows[0]` — a `SELECT ... WHERE id = $1` should match at most one row, so grab the first (only) result.
- If no patient was found (`patient` is `undefined`), return `null` immediately — the caller (route) treats this as "404 not found."

```js
  const historyResult = await pool.query(
    `SELECT condition_name, diagnosed_date, status, notes
     FROM patient_medical_history
     WHERE patient_id = $1
     ORDER BY diagnosed_date DESC NULLS LAST`,
    [id]
  );
```
- Fetches all medical history rows for this patient, newest diagnosis first. `NULLS LAST` means rows without a diagnosis date go to the bottom instead of the top (Postgres normally sorts `NULL` first in `DESC` order by default, which would be confusing here).

```js
  const medicationsResult = await pool.query(
    `SELECT medication_name, dosage, frequency, start_date, end_date, prescribed_by
     FROM patient_medications
     WHERE patient_id = $1
     ORDER BY start_date DESC NULLS LAST`,
    [id]
  );
```
- Same idea, for the patient's medications, newest first.

```js
  return {
    patient,
    history: historyResult.rows,
    medications: medicationsResult.rows,
  };
}
```
- Bundles all three pieces of data into one object — this is the `profile` object consumed by `routes/patients.js` and `generate.js`'s `generatePatientAnswer`.

---

## 7. `seedPatients.js` — Filling the Database with Fake/Demo Patients

This is a developer utility to populate the database with realistic sample data for testing/demo purposes.

```js
import { fileURLToPath } from "url";
import { pool } from "./db.js";
```
- Standard imports as seen before.

```js
const CONDITION_MEDICATIONS = {
  Diabetes: { medication_name: "Metformin", dosage: "500mg", frequency: "Twice daily" },
  ...
};
```
- A lookup table mapping each medical condition (e.g. `"Diabetes"`) to a typical medication (name, dosage, frequency). Used so seeded patients get medically-plausible prescriptions instead of random data.

```js
const DOCTORS = ["Dr. Mehta", "Dr. Rao", "Dr. Iyer", "Dr. Sharma", "Dr. Kapoor"];
```
- A small pool of fictional doctor names to assign to patients/prescriptions.

```js
const PATIENTS = [
  { name: "Aarav Sharma", age: 45, gender: "Male", blood_group: "B+", conditions: ["Diabetes", "Hypertension"] },
  ...
];
```
- A hardcoded list of 20 fake patients, each with basic demographics and a list of conditions they're diagnosed with.

```js
function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
```
- A helper: given a number of days, returns the date that many days before today, formatted as `YYYY-MM-DD`. Used to generate believable admission dates, diagnosis dates, etc. instead of hardcoding fixed dates that would go stale.

```js
export async function seedPatients() {
  await pool.query(
    "TRUNCATE patient_medications, patient_medical_history, patients RESTART IDENTITY CASCADE"
  );
```
- `TRUNCATE` empties these three tables completely (faster than `DELETE` for wiping all rows).
- `RESTART IDENTITY` resets the auto-incrementing id counters back to 1, so re-seeding always produces the same ids.
- `CASCADE` also clears out any dependent rows in other tables that reference these via foreign keys, so nothing is left orphaned.
- Listing all three tables together in one `TRUNCATE` avoids foreign-key errors (you can't truncate `patients` alone while `patient_medications` still references it).

```js
  for (let i = 0; i < PATIENTS.length; i++) {
    const p = PATIENTS[i];
    const doctor = DOCTORS[i % DOCTORS.length];
```
- Loops through each fake patient by index `i`.
- `DOCTORS[i % DOCTORS.length]` cycles through the 5 doctors repeatedly (modulo wraps the index back to 0 after reaching the end) so doctors get reused across patients.

```js
    const patientResult = await pool.query(
      `INSERT INTO patients (name, age, gender, contact_number, blood_group, admission_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        p.name,
        p.age,
        p.gender,
        `+91-90000${String(10000 + i).slice(-5)}`,
        p.blood_group,
        daysAgo(30 + i * 5),
      ]
    );
    const patientId = patientResult.rows[0].id;
```
- Inserts one patient row. `RETURNING id` asks Postgres to hand back the newly generated id right away (instead of running a separate `SELECT` afterward).
- The phone number is generated as a fake but uniquely-numbered Indian-format number (`+91-90000` + a 5-digit padded number derived from `i`).
- `admission_date` is set to a staggered date in the past (30 days ago for the first patient, 35 for the next, etc.) so patients don't all share the exact same admission date.
- `patientId` is grabbed from the query result to link the history/medication rows to this patient below.

```js
    for (const condition of p.conditions) {
      await pool.query(
        `INSERT INTO patient_medical_history (patient_id, condition_name, diagnosed_date, status, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          patientId,
          condition,
          daysAgo(180 + i * 10),
          "active",
          `Diagnosed during routine checkup, being managed by ${doctor}.`,
        ]
      );
```
- For every condition this patient has, insert a matching history row: linked by `patientId`, a diagnosis date further in the past, status hardcoded as `"active"`, and an auto-generated note mentioning the assigned doctor.

```js
      const med = CONDITION_MEDICATIONS[condition];
      await pool.query(
        `INSERT INTO patient_medications (patient_id, medication_name, dosage, frequency, start_date, prescribed_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [patientId, med.medication_name, med.dosage, med.frequency, daysAgo(150 + i * 10), doctor]
      );
    }
```
- Looks up the standard medication for this condition from `CONDITION_MEDICATIONS`, then inserts a matching medication row, prescribed by the same doctor, starting a bit after the diagnosis.

```js
    console.log(`Seeded patient: ${p.name} (id ${patientId}), conditions: ${p.conditions.join(", ")}`);
  }
}
```
- Logs progress to the terminal so you can watch the seeding happen live.

```js
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  seedPatients()
    .then(() => {
      console.log("Patient seeding complete.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Patient seeding failed:", err);
      process.exit(1);
    });
}
```
- Same "run directly" pattern — lets you run `node src/seedPatients.js` from the terminal to (re)populate demo patient data.

---

## 8. `routes/ask.js` — HTTP Endpoint for Hospital Policy Questions

```js
import { Router } from "express";
import { retrieveTopChunks } from "../retrieve.js";
import { generateAnswer } from "../generate.js";

const router = Router();
```
- `Router()` creates a mini, self-contained set of routes that can be "mounted" onto the main app (done in `server.js` via `app.use("/api/ask", askRouter)`).

```js
router.post("/", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "question is required" });
    }
```
- Defines what happens on `POST /api/ask` (the `/` here is relative to wherever this router gets mounted).
- Pulls `question` out of the JSON request body (this requires `express.json()` middleware, set up in `server.js`).
- Validates: if there's no question, or it's not a string, immediately respond with HTTP 400 (Bad Request) and stop.

```js
    const chunks = await retrieveTopChunks(question, 3);
    const answer = await generateAnswer(question, chunks);
```
- Calls the retrieval step (find 3 most relevant document chunks) then the generation step (ask Gemini to answer using those chunks) — this is the full RAG pipeline in two lines.

```js
    res.json({
      answer,
      sources: chunks.map((c) => ({
        file: c.source_file,
        chunk: c.chunk_index,
        similarity: Number(c.similarity.toFixed(4)),
      })),
    });
```
- Sends back a JSON response with the AI's answer plus a `sources` list, so the frontend can show "this answer came from these document chunks" (for transparency/trust).
- `.toFixed(4)` rounds similarity scores to 4 decimal places for cleaner display; `Number(...)` converts the resulting string back into a number.

```js
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to answer question" });
  }
});

export default router;
```
- If anything throws an error anywhere above (bad API key, DB down, etc.), log it on the server and return a generic HTTP 500 (Internal Server Error) to the client, instead of crashing the whole app.
- `export default router` makes this router importable in `server.js`.

---

## 9. `routes/patients.js` — HTTP Endpoints for Patient Data

```js
import { Router } from "express";
import { listPatients, getPatientProfile } from "../patients.js";
import { generatePatientAnswer } from "../generate.js";

const router = Router();
```
- Same setup pattern as `ask.js`.

```js
router.get("/", async (req, res) => {
  try {
    const patients = await listPatients();
    res.json({ patients });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list patients" });
  }
});
```
- Handles `GET /api/patients` — returns the full list of patients (id/name/age/gender) as JSON. Same try/catch error-handling pattern as before.

```js
router.get("/:id", async (req, res) => {
  try {
    const profile = await getPatientProfile(req.params.id);
    if (!profile) {
      return res.status(404).json({ error: "Patient not found" });
    }
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch patient" });
  }
});
```
- Handles `GET /api/patients/:id` — `:id` is a route parameter, so a request to `/api/patients/5` makes `req.params.id === "5"`.
- Fetches the full profile (patient + history + medications). If nothing was found, respond with HTTP 404 (Not Found).

```js
router.post("/:id/ask", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "question is required" });
    }

    const profile = await getPatientProfile(req.params.id);
    if (!profile) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const answer = await generatePatientAnswer(question, profile);

    res.json({
      answer,
      patient: { id: profile.patient.id, name: profile.patient.name },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to answer question" });
  }
});

export default router;
```
- Handles `POST /api/patients/:id/ask` — validates the question the same way `ask.js` does, loads that specific patient's profile, generates an AI answer grounded only in that patient's record, and returns the answer plus a small identifying snippet of which patient it was about.

---

## 10. `routes/upload.js` — HTTP Endpoint for Uploading New Documents

```js
import { Router } from "express";
import multer from "multer";
import path from "path";
import { ingestFile } from "../ingest.js";

const router = Router();
```
- `multer` is Express middleware specifically for handling `multipart/form-data` — i.e., file uploads (regular `express.json()` can't parse file uploads).

```js
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.resolve(process.cwd(), "documents")),
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });
```
- Configures multer to save uploaded files straight to disk (as opposed to keeping them only in memory).
- `destination`: tells multer to save every uploaded file into the `backend/documents/` folder. `cb(null, ...)` is a "callback" pattern — the first argument is an error (`null` = no error), the second is the actual value.
- `filename`: keeps the original uploaded filename as-is (e.g. `newpolicy.txt`) rather than renaming it to something random.
- `upload` is the configured middleware, ready to be used on a specific route.

```js
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "file is required" });
    }
```
- `upload.single("file")` is middleware that runs *before* the route handler — it expects the uploaded file to be sent under the form field name `"file"`, saves it to disk (per the `storage` config above), and attaches info about it to `req.file`.
- If no file was actually sent, `req.file` will be undefined — respond with 400.

```js
    const result = await ingestFile(req.file.path);

    res.json({
      status: "success",
      chunksAdded: result.chunksAdded,
      file: result.file,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to ingest file" });
  }
});

export default router;
```
- `req.file.path` is the full path where multer just saved the uploaded file. This is passed straight into `ingestFile` (from `ingest.js`) — the exact same function used by the bulk `node src/ingest.js` CLI script — so uploading via the API and ingesting via command line both go through identical logic (no duplicated code).
- Responds with how many chunks were created from the new file.

---

## 11. `server.js` — The Application Entry Point

```js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { runMigrations } from "./migrate.js";
import askRouter from "./routes/ask.js";
import uploadRouter from "./routes/upload.js";
import patientsRouter from "./routes/patients.js";

dotenv.config();
```
- `express`: the web server framework itself.
- `cors`: middleware that allows the frontend (running on a different port/origin, e.g. `localhost:5173`) to make requests to this backend (`localhost:5000`) — browsers block cross-origin requests by default unless the server explicitly allows it.
- Imports all three route modules and the migration runner.
- Loads `.env` variables again (each file that needs `process.env` calls `dotenv.config()` independently — it's safe to call multiple times).

```js
const app = express();
app.use(cors());
app.use(express.json());
```
- `express()` creates the actual web application instance.
- `app.use(cors())` applies the CORS middleware to every incoming request, unlocking cross-origin access.
- `app.use(express.json())` applies middleware that automatically parses incoming JSON request bodies into `req.body` — without this, `req.body` in `ask.js`/`patients.js` would be `undefined`.

```js
app.use("/api/ask", askRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/patients", patientsRouter);
```
- "Mounts" each router at a URL prefix. E.g. because `askRouter` defines a route at `"/"`, and it's mounted at `/api/ask`, the full effective route becomes `POST /api/ask`. Same logic gives us `POST /api/upload`, and `/api/patients`, `/api/patients/:id`, `/api/patients/:id/ask`.

```js
app.get("/health", (req, res) => res.json({ status: "ok" }));
```
- A simple "health check" endpoint — useful for monitoring tools or deployment platforms to verify the server is alive and responding.

```js
const PORT = process.env.PORT || 5000;
```
- Reads the port number from the environment (`.env`), falling back to `5000` if not set.

```js
runMigrations()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to run migrations:", err);
    process.exit(1);
  });
```
- Before accepting any web traffic, the app first runs all pending database migrations (from `migrate.js`) to make sure the schema is up to date.
- Only *after* migrations succeed does it call `app.listen(PORT, ...)`, which actually starts the server listening for HTTP requests.
- If migrations fail (e.g. bad SQL, DB not reachable), the error is logged and the process exits immediately with code 1 — deliberately preventing the server from starting with a broken/out-of-date database schema.

---

## Quick Glossary (for beginners)

- **Middleware**: a function that runs on every (or matching) request before your route handler, e.g. to parse JSON, allow CORS, or handle file uploads.
- **Route / Router**: a mapping from an HTTP method + URL path (e.g. `POST /api/ask`) to a handler function.
- **`async`/`await`**: lets you write asynchronous code (waiting for a database or API call) that reads top-to-bottom like normal synchronous code, instead of nested callbacks.
- **Parameterized query (`$1`, `$2`...)**: placeholders in SQL filled in safely by the driver — prevents SQL injection.
- **Connection pool**: a reusable set of open database connections, shared across the app for efficiency.
- **Embedding**: a list of numbers representing the meaning of a piece of text, used to compare texts by similarity.
- **pgvector / `<=>`**: a Postgres extension and operator for storing vectors (embeddings) and computing similarity/distance between them directly in SQL.
- **RAG (Retrieval-Augmented Generation)**: retrieve relevant real data first, then feed it to an AI model as context so it answers using facts rather than guessing.
