/**
 * Tests for parseDatabaseUrl utility.
 *
 * Verifies that DATABASE_URL connection strings (Render, Heroku, RDS, etc.)
 * are correctly decomposed into host, port, name, username, and password.
 */

import { describe, it, expect } from 'vitest';
import { parseDatabaseUrl } from '../../../src/utils/parse-database-url.js';

// ─────────────────────────────────────────────
// Standard PostgreSQL URLs
// ─────────────────────────────────────────────

describe('parseDatabaseUrl – standard URLs', () => {
  it('parses a standard postgres URL with all fields', () => {
    const result = parseDatabaseUrl('postgres://user:pass@host.example.com:5432/mydb');
    expect(result).toEqual({
      host: 'host.example.com',
      port: 5432,
      name: 'mydb',
      username: 'user',
      password: 'pass',
    });
  });

  it('parses postgresql:// scheme (alias for postgres://)', () => {
    const result = parseDatabaseUrl('postgresql://admin:secret@db.host.io:5433/proddb');
    expect(result).toEqual({
      host: 'db.host.io',
      port: 5433,
      name: 'proddb',
      username: 'admin',
      password: 'secret',
    });
  });

  it('defaults port to 5432 when port is omitted', () => {
    const result = parseDatabaseUrl('postgres://user:pass@host.example.com/mydb');
    expect(result.port).toBe(5432);
  });

  it('returns correct host, name, username, password when port is omitted', () => {
    const result = parseDatabaseUrl('postgres://user:pass@host.example.com/mydb');
    expect(result.host).toBe('host.example.com');
    expect(result.name).toBe('mydb');
    expect(result.username).toBe('user');
    expect(result.password).toBe('pass');
  });
});

// ─────────────────────────────────────────────
// URL-encoded characters
// ─────────────────────────────────────────────

describe('parseDatabaseUrl – URL-encoded characters', () => {
  it('decodes URL-encoded username', () => {
    const result = parseDatabaseUrl('postgres://user%40domain:pass@host:5432/db');
    expect(result.username).toBe('user@domain');
  });

  it('decodes URL-encoded password with @ symbol', () => {
    const result = parseDatabaseUrl('postgres://user:p%40ss@host:5432/db');
    expect(result.password).toBe('p@ss');
  });

  it('decodes password with # symbol', () => {
    const result = parseDatabaseUrl('postgres://user:p%23ss@host:5432/db');
    expect(result.password).toBe('p#ss');
  });

  it('decodes password with % symbol', () => {
    const result = parseDatabaseUrl('postgres://user:p%25ss@host:5432/db');
    expect(result.password).toBe('p%ss');
  });

  it('decodes password with spaces', () => {
    const result = parseDatabaseUrl('postgres://user:my%20pass%20word@host:5432/db');
    expect(result.password).toBe('my pass word');
  });

  it('decodes username and password with multiple special characters', () => {
    const result = parseDatabaseUrl('postgres://u%40s%2Fer:p%40%23%25@host:5432/db');
    expect(result.username).toBe('u@s/er');
    expect(result.password).toBe('p@#%');
  });
});

// ─────────────────────────────────────────────
// Render-style internal URLs
// ─────────────────────────────────────────────

describe('parseDatabaseUrl – Render / managed provider URLs', () => {
  it('parses Render-style internal URL', () => {
    const url = 'postgres://accordo_user:AbCdEfG123@dpg-abc123-a.oregon-postgres.render.com:5432/accordo_db';
    const result = parseDatabaseUrl(url);
    expect(result).toEqual({
      host: 'dpg-abc123-a.oregon-postgres.render.com',
      port: 5432,
      name: 'accordo_db',
      username: 'accordo_user',
      password: 'AbCdEfG123',
    });
  });

  it('parses Heroku-style URL', () => {
    const url = 'postgres://heroku_user:heroku_pass@ec2-54-123-456-78.compute-1.amazonaws.com:5432/d1234abcdef';
    const result = parseDatabaseUrl(url);
    expect(result.host).toBe('ec2-54-123-456-78.compute-1.amazonaws.com');
    expect(result.name).toBe('d1234abcdef');
  });

  it('parses Supabase-style URL with long password', () => {
    const url = 'postgres://postgres.abcdefghij:MyL0ngP%40ssw0rd@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
    const result = parseDatabaseUrl(url);
    expect(result.host).toBe('aws-0-us-east-1.pooler.supabase.com');
    expect(result.port).toBe(6543);
    expect(result.name).toBe('postgres');
    expect(result.password).toBe('MyL0ngP@ssw0rd');
  });
});

// ─────────────────────────────────────────────
// Query parameters (should be ignored)
// ─────────────────────────────────────────────

describe('parseDatabaseUrl – query parameters', () => {
  it('ignores sslmode query parameter', () => {
    const result = parseDatabaseUrl('postgres://user:pass@host:5432/mydb?sslmode=require');
    expect(result).toEqual({
      host: 'host',
      port: 5432,
      name: 'mydb',
      username: 'user',
      password: 'pass',
    });
  });

  it('ignores multiple query parameters', () => {
    const result = parseDatabaseUrl('postgres://user:pass@host:5432/mydb?sslmode=require&connect_timeout=10');
    expect(result.name).toBe('mydb');
    expect(result.host).toBe('host');
  });
});

// ─────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────

describe('parseDatabaseUrl – edge cases', () => {
  it('handles numeric-only password', () => {
    const result = parseDatabaseUrl('postgres://user:123456@host:5432/db');
    expect(result.password).toBe('123456');
  });

  it('handles empty database name (path is just "/")', () => {
    const result = parseDatabaseUrl('postgres://user:pass@host:5432/');
    expect(result.name).toBe('');
  });

  it('handles non-standard port', () => {
    const result = parseDatabaseUrl('postgres://user:pass@host:6543/db');
    expect(result.port).toBe(6543);
  });

  it('handles localhost URL', () => {
    const result = parseDatabaseUrl('postgres://postgres:postgres@localhost:5432/accordo');
    expect(result).toEqual({
      host: 'localhost',
      port: 5432,
      name: 'accordo',
      username: 'postgres',
      password: 'postgres',
    });
  });

  it('handles 127.0.0.1 IP address', () => {
    const result = parseDatabaseUrl('postgres://postgres:postgres@127.0.0.1:5432/accordo');
    expect(result.host).toBe('127.0.0.1');
  });

  it('throws on invalid URL', () => {
    expect(() => parseDatabaseUrl('not-a-url')).toThrow();
  });
});
