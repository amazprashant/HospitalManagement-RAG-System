# Hospital Management RAG Q&A Chatbot

A Retrieval-Augmented Generation (RAG) chatbot that answers questions about a hospital's internal documents (policies, SOPs, handbooks) using real retrieval from PostgreSQL + pgvector instead of relying purely on an LLM's memory.

See [`hospital-rag-project-plan.md`](../hospital-rag-project-plan.md) for the full build plan.

## Project Structure

```
hospital-rag/
├── backend/
│   ├── src/
│   │   ├── db.js
│   │   ├── ingest.js
│   │   ├── retrieve.js
│   │   ├── generate.js
│   │   ├── routes/
│   │   │   ├── ask.js
│   │   │   └── upload.js
│   │   └── server.js
│   ├── documents/
│   ├── .env
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── ChatWindow.jsx
│   │   │   ├── MessageBubble.jsx
│   │   │   └── SourceCitation.jsx
│   │   └── api.js
│   └── package.json
└── README.md
```

## What Each File Does

### Backend (`backend/`)

| File | Purpose |
|---|---|
| `src/db.js` | Sets up the Postgres connection pool and enables/configures the `pgvector` extension. Every other backend module imports the DB client from here. |
| `src/ingest.js` | The ingestion pipeline: reads raw documents from `documents/` (via `pdf-parse`), splits them into overlapping text chunks, generates embeddings (Gemini `gemini-embedding-001`, 768 dims) for each chunk, and inserts them into the `document_chunks` table. |
| `src/retrieve.js` | The retriever: embeds an incoming user question, then runs a cosine-similarity (`<=>`) query against `document_chunks` to fetch the top-K most relevant chunks. |
| `src/generate.js` | Calls Gemini (`gemma-4-26b-a4b-it`) with the user's question plus the retrieved chunks as context, using the "answer only from context" prompt template, and returns the generated answer. |
| `src/routes/ask.js` | Express route handler for `POST /api/ask`. Orchestrates retrieve → generate and returns `{ answer, sources }`. |
| `src/routes/upload.js` | Express route handler for `POST /api/upload`. Accepts a new document upload and runs it through the ingestion pipeline so it becomes searchable. |
| `src/server.js` | Express app entrypoint — wires up middleware (CORS, JSON body parsing), mounts the routes, and starts the HTTP server. |
| `documents/` | Drop raw hospital PDFs/text files here to be picked up by `ingest.js`. |
| `.env` | Environment variables: `DATABASE_URL`, `GEMINI_API_KEY`, `PORT`. Never commit this file. |
| `package.json` | Backend dependencies (`express`, `pg`, `pdf-parse`, `dotenv`, `@google/genai`, `cors`, `multer`) and npm scripts. |

### Frontend (`frontend/`)

| File | Purpose |
|---|---|
| `src/App.jsx` | Root React component — renders the overall chat page layout. |
| `src/components/ChatWindow.jsx` | Renders the scrolling message history and the input box for asking questions. |
| `src/components/MessageBubble.jsx` | Renders a single chat message (user question or bot answer). |
| `src/components/SourceCitation.jsx` | Renders the source file/chunk citations under a bot answer (e.g. "Source: discharge_policy.pdf"). |
| `src/api.js` | Thin wrapper around `fetch`/`axios` for calling the backend `POST /api/ask` (and `/api/upload`) endpoints. |
| `package.json` | Frontend dependencies and Vite scripts. |

## Data Flow

```
User Question (React UI)
   → POST /api/ask (routes/ask.js)
   → retrieve.js: embed question, pgvector similarity search
   → generate.js: send question + top-K chunks to LLM
   → { answer, sources } returned to UI
   → MessageBubble + SourceCitation render the result
```

## Getting Started

1. **Database**: PostgreSQL with the `pgvector` extension enabled on a `hospital_rag` database. Requires a one-time superuser `CREATE EXTENSION vector;` (can't be automated by npm — needs DB admin access).
2. **Configure** `backend/.env` with `DATABASE_URL` and `GEMINI_API_KEY`.
3. **One-command setup** — installs dependencies, runs all pending migrations, and seeds both the patients table and the document embeddings:
   ```bash
   cd backend
   npm run setup
   ```
   This runs `npm install && npm run migrate && npm run seed:patients && npm run seed` in order. Safe to re-run any time — migrations are tracked and skipped once applied, and seeding is idempotent (patients are truncated/reseeded, documents are upserted by chunk).
4. **Run the backend**:
   ```bash
   npm run dev
   ```
5. **Run the frontend**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Open the printed local URL (default `http://localhost:5173`) and chat.

### Individual scripts (if you don't want the full `setup`)

| Script | Purpose |
|---|---|
| `npm run migrate` | Apply any pending SQL migrations from `backend/migrations/`. |
| `npm run seed:patients` | Reseed the 20 synthetic patients + their history/medications. |
| `npm run seed` | Ingest/re-ingest all documents in `backend/documents/` into `document_chunks`. |

For the full step-by-step teaching plan, see [`hospital-rag-project-plan.md`](../hospital-rag-project-plan.md).
