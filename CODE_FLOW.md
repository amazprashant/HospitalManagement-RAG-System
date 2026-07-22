# Code Flow — Hospital Management RAG System

Brief walkthrough of how a request travels through this codebase.

## 1. Big Picture

```
React (Vite) frontend  <-- fetch -->  Express backend  <-- SQL -->  Postgres (pgvector)
                                            |
                                            v
                                     Google Gemini API (embeddings + generation)
```

Two independent flows exist:
- **Hospital Policy Q&A** — RAG over ingested documents (`backend/documents/*.txt`, PDFs).
- **Patient Lookup Q&A** — Q&A grounded in a patient's DB record (no vector search).

## 2. Startup

1. `backend/src/server.js` runs, loads `.env`, calls `runMigrations()` (`migrate.js`), which applies any new SQL file in `backend/migrations/` in order (tracked in `schema_migrations` table).
2. Express app mounts three routers: `/api/ask`, `/api/upload`, `/api/patients`, then starts listening.
3. Frontend (`frontend/src/main.jsx`) mounts `App.jsx`, which renders a tab switch between `ChatWindow` (policies) and `PatientLookup` (patients).

## 3. Document Ingestion Flow (one-time / on upload)

```
file (txt/pdf)
  -> ingest.js: extractText()      (pdf-parse for PDFs, raw text otherwise)
  -> ingest.js: chunkText()        (500 chars, 100 overlap)
  -> ingest.js: embedChunk()       (Gemini gemini-embedding-001 -> 768-dim vector)
  -> db.js pool.query INSERT       (document_chunks table, upsert by source_file+chunk_index)
```

Two entry points trigger this:
- **CLI**: `node src/ingest.js` → `ingestDirectory("documents/")` → ingests every file in `backend/documents/`.
- **HTTP**: `POST /api/upload` (`routes/upload.js`) → multer saves file to `documents/` → `ingestFile()` runs the same pipeline for that one file.

## 4. Hospital Policy Q&A Flow (RAG)

```
User types question in ChatWindow.jsx
  -> api.js askQuestion()               fetch POST /api/ask
  -> routes/ask.js
       -> retrieve.js retrieveTopChunks()
            -> ingest.js embedChunk(question)      (embed the question itself)
            -> pool.query ORDER BY embedding <=> $1 LIMIT 3   (pgvector cosine search)
       -> generate.js generateAnswer(question, chunks)
            -> builds context string from top chunks
            -> Gemini generateContent() with SYSTEM_PROMPT + context + question
  <- routes/ask.js responds { answer, sources }
  -> ChatWindow renders MessageBubble -> SourceCitation (shows file/chunk/similarity)
```

Key file for the vector search step: [backend/src/retrieve.js](backend/src/retrieve.js). It sets `ivfflat.probes = 100` so small tables still return correct nearest neighbors.

## 5. Patient Lookup Q&A Flow (no vector search)

```
PatientLookup.jsx loads list on mount
  -> api.js listPatients()      fetch GET /api/patients
  -> routes/patients.js GET /   -> patients.js listPatients()  -> SELECT from patients table

User selects/searches a patient
  -> api.js getPatient(id)      fetch GET /api/patients/:id
  -> routes/patients.js GET /:id -> patients.js getPatientProfile()
       -> SELECT patients WHERE id
       -> SELECT patient_medical_history WHERE patient_id
       -> SELECT patient_medications WHERE patient_id

User asks a question about that patient
  -> api.js askPatientQuestion(id, question)   fetch POST /api/patients/:id/ask
  -> routes/patients.js POST /:id/ask
       -> patients.js getPatientProfile(id)      (re-fetch record)
       -> generate.js generatePatientAnswer(question, profile)
            -> builds context string (patient info + history + medications)
            -> Gemini generateContent() with PATIENT_SYSTEM_PROMPT + context + question
  <- responds { answer, patient }
  -> PatientLookup renders answer in its own message list
```

## 6. Database Tables (from `backend/migrations/`)

| Migration | Table/feature |
|---|---|
| 001 | Enable `pgvector` extension |
| 002 | `document_chunks` (source_file, chunk_index, chunk_text, embedding) |
| 003 | ivfflat index on `document_chunks.embedding` |
| 004 | `patients` |
| 005 | `patient_medical_history` |
| 006 | `patient_medications` |

## 7. File Map (who calls whom)

**Backend**
- `server.js` → mounts routers, runs migrations
- `routes/ask.js` → `retrieve.js` + `generate.js`
- `routes/upload.js` → `ingest.js`
- `routes/patients.js` → `patients.js` + `generate.js`
- `retrieve.js` → `ingest.js` (reuses `embedChunk`) + `db.js`
- `ingest.js` → `db.js` + Gemini SDK
- `patients.js` → `db.js`
- `generate.js` → Gemini SDK (no DB access)
- `db.js` → pg `Pool` shared by everyone

**Frontend**
- `main.jsx` → `App.jsx`
- `App.jsx` → `ChatWindow.jsx` / `PatientLookup.jsx`
- `ChatWindow.jsx` → `MessageBubble.jsx` → `SourceCitation.jsx`
- `PatientLookup.jsx` → own message rendering
- Both components → `api.js` → backend HTTP endpoints
