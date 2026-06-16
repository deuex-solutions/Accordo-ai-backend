import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

/**
 * Shared Postgres checkpointer for state persistence.
 * This allows agents to be interrupted, restarted, and scaled.
 */
let checkpointer: PostgresSaver | null = null;

export async function getCheckpointer() {
  if (checkpointer) return checkpointer;

  const connectionString = process.env.DATABASE_URL || 
    `postgres://${process.env.DB_USERNAME || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'accordo'}`;

  const pool = new Pool({
    connectionString,
    // Add additional pool config if needed
  });

  checkpointer = new PostgresSaver(pool);
  
  // Note: In production, you might want to call checkpointer.setup() 
  // during application bootstrap.
  
  return checkpointer;
}
