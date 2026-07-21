CREATE TABLE IF NOT EXISTS document_chunks (
    id SERIAL PRIMARY KEY,
    source_file TEXT NOT NULL,
    chunk_text TEXT NOT NULL,
    chunk_index INT NOT NULL,
    embedding VECTOR(768),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Ensures re-ingesting a file updates its chunks instead of duplicating them.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'document_chunks_source_chunk_unique'
    ) THEN
        ALTER TABLE document_chunks
            ADD CONSTRAINT document_chunks_source_chunk_unique UNIQUE (source_file, chunk_index);
    END IF;
END $$;
