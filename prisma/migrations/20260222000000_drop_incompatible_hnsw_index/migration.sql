-- Drop the HNSW index created in migration 20260220223915_add_hnsw_index.
-- That index was built on vector(768) with vector_cosine_ops. Migration
-- 20260220235000_update_vector_dimension resized the column to vector(3072),
-- but pgvector's HNSW only supports up to 2000 dimensions for the vector type.
-- The index is now incompatible and must be dropped.
--
-- For production with 3072-dim embeddings, use halfvec(3072) + halfvec_cosine_ops
-- (pgvector 0.7.0+), or switch to a <=2000-dim embedding model.

DROP INDEX IF EXISTS invoice_embeddings_embedding_idx;
