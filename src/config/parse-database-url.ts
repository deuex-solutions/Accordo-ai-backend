/**
 * Parse a DATABASE_URL connection string into individual fields.
 * Format: postgres://user:password@host:port/database
 *
 * Extracted from src/config/env.ts so it can be unit-tested independently.
 */
export function parseDatabaseUrl(url: string): {
  host: string;
  port: number;
  name: string;
  username: string;
  password: string;
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 5432,
    name: parsed.pathname.replace(/^\//, ''),
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  };
}
