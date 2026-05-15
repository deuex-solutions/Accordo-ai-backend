"use strict";

/**
 * pgvector migration
 *
 * Enables the `vector` extension and converts the three embedding columns
 * (negotiation_patterns.embedding, deal_embeddings.embedding,
 *  message_embeddings.embedding) from ARRAY(FLOAT) → vector(1024).
 *
 * Adds HNSW indices with cosine ops for fast approximate-nearest-neighbor
 * search. Idempotent: safe to re-run on a partially-migrated DB.
 *
 * Down: reverses the column type back to ARRAY(FLOAT) and drops the indices.
 * Extension itself is NOT dropped on down() — other databases on the same
 * instance might depend on it.
 */

const TABLES = [
  {
    table: "negotiation_patterns",
    indexName: "idx_negotiation_patterns_embedding_hnsw",
  },
  { table: "deal_embeddings", indexName: "idx_deal_embeddings_embedding_hnsw" },
  {
    table: "message_embeddings",
    indexName: "idx_message_embeddings_embedding_hnsw",
  },
];

const VECTOR_DIM = 1024;

async function columnIsArrayType(queryInterface, table) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT data_type, udt_name
       FROM information_schema.columns
      WHERE table_name = :table AND column_name = 'embedding'`,
    { replacements: { table } },
  );
  if (!rows || rows.length === 0) return false;
  // ARRAY(FLOAT) shows up as data_type='ARRAY', udt_name='_float4'.
  // vector(n) shows up as data_type='USER-DEFINED', udt_name='vector'.
  return rows[0].data_type === "ARRAY";
}

async function columnIsVectorType(queryInterface, table) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT udt_name FROM information_schema.columns
      WHERE table_name = :table AND column_name = 'embedding'`,
    { replacements: { table } },
  );
  if (!rows || rows.length === 0) return false;
  return rows[0].udt_name === "vector";
}

async function indexExists(queryInterface, indexName) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = :indexName`,
    { replacements: { indexName } },
  );
  return rows && rows.length > 0;
}

module.exports = {
  async up(queryInterface /* , Sequelize */) {
    // Step 1: enable extension (idempotent).
    await queryInterface.sequelize.query(
      "CREATE EXTENSION IF NOT EXISTS vector",
    );

    for (const { table, indexName } of TABLES) {
      // Skip if table doesn't exist yet (fresh DB before vectors-ml migration).
      const [tableRows] = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = :table`,
        { replacements: { table } },
      );
      if (!tableRows || tableRows.length === 0) continue;

      // Step 2: only convert if still ARRAY type. Idempotent for re-runs.
      if (await columnIsArrayType(queryInterface, table)) {
        // 2a: add a staging vector column
        await queryInterface.sequelize.query(
          `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS embedding_v vector(${VECTOR_DIM})`,
        );

        // 2b: backfill existing rows. ARRAY(FLOAT)::text → pgvector accepts
        // '[1.0,2.0,...]' literal form; cast through text to bridge the types.
        // Only rows with non-null + correctly-sized embedding can convert.
        await queryInterface.sequelize.query(
          `UPDATE "${table}"
              SET embedding_v = ('[' || array_to_string(embedding, ',') || ']')::vector
            WHERE embedding IS NOT NULL
              AND array_length(embedding, 1) = ${VECTOR_DIM}
              AND embedding_v IS NULL`,
        );

        // 2c: drop the old column and rename
        await queryInterface.sequelize.query(
          `ALTER TABLE "${table}" DROP COLUMN embedding`,
        );
        await queryInterface.sequelize.query(
          `ALTER TABLE "${table}" RENAME COLUMN embedding_v TO embedding`,
        );
      }

      // Step 3: HNSW index for cosine similarity (idempotent).
      // HNSW is the recommended index for pgvector ≥ 0.5 — fast approximate
      // search with good recall. `vector_cosine_ops` because our embeddings
      // are L2-normalized so cosine ≡ dot-product in result ordering.
      if (
        (await columnIsVectorType(queryInterface, table)) &&
        !(await indexExists(queryInterface, indexName))
      ) {
        await queryInterface.sequelize.query(
          `CREATE INDEX ${indexName} ON "${table}"
             USING hnsw (embedding vector_cosine_ops)`,
        );
      }
    }
  },

  async down(queryInterface /* , Sequelize */) {
    for (const { table, indexName } of TABLES) {
      const [tableRows] = await queryInterface.sequelize.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = :table`,
        { replacements: { table } },
      );
      if (!tableRows || tableRows.length === 0) continue;

      if (await indexExists(queryInterface, indexName)) {
        await queryInterface.sequelize.query(
          `DROP INDEX IF EXISTS ${indexName}`,
        );
      }

      if (await columnIsVectorType(queryInterface, table)) {
        await queryInterface.sequelize.query(
          `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS embedding_arr float4[]`,
        );
        // Reverse the cast: vector → text → split → float4[]
        await queryInterface.sequelize.query(
          `UPDATE "${table}"
              SET embedding_arr = string_to_array(
                    trim(both '[]' from embedding::text), ','
                  )::float4[]
            WHERE embedding IS NOT NULL
              AND embedding_arr IS NULL`,
        );
        await queryInterface.sequelize.query(
          `ALTER TABLE "${table}" DROP COLUMN embedding`,
        );
        await queryInterface.sequelize.query(
          `ALTER TABLE "${table}" RENAME COLUMN embedding_arr TO embedding`,
        );
      }
    }
    // Extension is intentionally NOT dropped on down(); other DBs may use it.
  },
};
