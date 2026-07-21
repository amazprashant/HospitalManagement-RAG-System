import { pool } from "./db.js";
import { embedChunk } from "./ingest.js";

export async function retrieveTopChunks(question, topK = 3) {
  const questionEmbedding = await embedChunk(question);

  const client = await pool.connect();
  try {
    // ivfflat only probes 1 of its "lists" partitions by default, which misses
    // matches when the table is small relative to `lists = 100`. Probing all
    // partitions keeps results correct at small scale without hurting
    // correctness at larger scale.
    await client.query("SET ivfflat.probes = 100");

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
