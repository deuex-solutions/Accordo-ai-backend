import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";
import dotenv from "dotenv";
import zlib from "zlib";
import logger from "../../../../config/logger.js";
import { env } from "../../../../config/env.js";

dotenv.config();

/**
 * Wraps the checkpointer serializer to implement state compression for long conversations.
 * Compresses JSON blobs using Gzip if they exceed 512 bytes.
 * Handles backward compatibility seamlessly (if type is not "json/gzip", passes it to base).
 */
export function wrapSerializer(baseSerde: any) {
  return {
    ...baseSerde,
    async dumpsTyped(value: any): Promise<[string, Uint8Array]> {
      const [type, blob] = await baseSerde.dumpsTyped(value);
      
      // Only compress json type if it exceeds 512 bytes to avoid overhead on tiny updates.
      // Do not compress metadata objects (which have "source" and "step" keys) because
      // the Postgres checkpointer database schema stores metadata as a JSONB column (not binary bytea),
      // and attempts to write gzip bytes to JSONB will fail serialization.
      const isMetadata = value && typeof value === "object" && "source" in value && "step" in value;
      if (type === "json" && blob.length > 512 && !isMetadata) {
        try {
          const compressed = zlib.gzipSync(blob);
          logger.debug(`[Checkpointer] Compressed state from ${blob.length} to ${compressed.length} bytes`);
          return ["json/gzip", compressed];
        } catch (err) {
          logger.error(`[Checkpointer] Failed to compress state blob, falling back to uncompressed`, err);
        }
      }
      return [type, blob];
    },
    async loadsTyped(type: string, blob: Uint8Array): Promise<any> {
      if (type === "json/gzip") {
        try {
          const decompressed = zlib.gunzipSync(blob);
          return baseSerde.loadsTyped("json", decompressed);
        } catch (err) {
          logger.error(`[Checkpointer] Failed to decompress state blob`, err);
          throw err;
        }
      }
      return baseSerde.loadsTyped(type, blob);
    }
  };
}

/**
 * Shared Postgres checkpointer for state persistence.
 * This allows agents to be interrupted, restarted, and scaled.
 */
let checkpointer: PostgresSaver | null = null;

export async function getCheckpointer() {
  if (checkpointer) return checkpointer;

  const connectionString = process.env.DATABASE_URL || 
    `postgres://${process.env.DB_USERNAME || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'accordo'}`;
  
  // Use connectionString if available, otherwise construct config from env.database
  const poolConfig = connectionString
    ? {
        connectionString,
        ssl: env.database.ssl
          ? { rejectUnauthorized: env.database.sslRejectUnauthorized }
          : false,
      }
    : {
        host: env.database.host,
        port: env.database.port,
        database: env.database.name,
        user: env.database.username,
        password: env.database.password,
        ssl: env.database.ssl
          ? { rejectUnauthorized: env.database.sslRejectUnauthorized }
          : undefined,
      };

  // Optimize pool configuration to minimize database connection exhaustion
  const pool = new Pool({
    ...poolConfig,
    max: 20,                       // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,      // Close idle clients after 30 seconds
    connectionTimeoutMillis: 2000, // Timeout after 2 seconds if connection fails
  });

  checkpointer = new PostgresSaver(pool);
  
  // Apply the compression decorator
  checkpointer.serde = wrapSerializer(checkpointer.serde);
  
  return checkpointer;
}
