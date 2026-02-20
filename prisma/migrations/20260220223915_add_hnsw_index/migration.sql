-- Add HNSW index for pgvector cosine similarity search on invoice_embeddings.
-- HNSW (Hierarchical Navigable Small World) gives fast approximate nearest-neighbor
-- queries used by the vector retriever.
--   m = 16              max connections per layer (higher = better recall, more memory)
--   ef_construction=64  beam width during index build (higher = better quality, slower build)
--
-- Note: CREATE INDEX without CONCURRENTLY runs inside the migration transaction.
-- Use CONCURRENTLY only when adding to a live table with existing data outside a transaction.

CREATE INDEX IF NOT EXISTS invoice_embeddings_embedding_idx
ON invoice_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
