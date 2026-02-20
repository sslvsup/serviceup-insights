-- Update invoice_embeddings.embedding from vector(768) to vector(3072).
-- gemini-embedding-001 (the embedding model available on our API key) produces 3072-dim vectors.
-- The table is empty in dev so no data migration is needed.
--
-- NOTE on HNSW index: pgvector's HNSW supports max 2000 dimensions for vector type.
-- For 3072 dims, use halfvec(3072) with halfvec_cosine_ops (pgvector 0.7.0+).
-- For now we skip the HNSW index and rely on exact search (fine for dev/small data).
-- Add the HNSW index before production via halfvec or by enabling text-embedding-004 (768 dims).

ALTER TABLE invoice_embeddings ALTER COLUMN embedding TYPE vector(3072);
