/**
 * Sequelize custom type for pgvector's `vector(n)` column.
 *
 * Sequelize doesn't ship a native pgvector type, so we declare a minimal
 * ABSTRACT-extending type that:
 *   - serializes JS `number[]` → pgvector text literal '[1.0,2.0,...]'
 *   - parses incoming strings/arrays back into `number[]`
 *
 * Model definitions use this in place of `DataTypes.ARRAY(DataTypes.FLOAT)`,
 * keeping the public Model API the same — callers still see `emb.embedding`
 * as a `number[]`.
 */

import { DataTypes } from "sequelize";

/** PG text-literal serializer: [0.1, 0.2, 0.3] → "[0.1,0.2,0.3]" */
function toPgvectorLiteral(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value; // already a literal
  if (!Array.isArray(value)) {
    throw new TypeError(
      `pgvector value must be a number[], got ${typeof value}`,
    );
  }
  return `[${value.join(",")}]`;
}

/** Parser: "[0.1,0.2,0.3]" or already-parsed array → number[] */
function fromPgvectorLiteral(value: unknown): number[] | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value as number[];
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/^\[/, "").replace(/\]$/, "");
    if (!trimmed) return [];
    return trimmed.split(",").map((s) => Number.parseFloat(s));
  }
  throw new TypeError(`Cannot parse pgvector value: ${typeof value}`);
}

/**
 * Vector(n) data type for Sequelize.
 *
 * Usage:
 *   embedding: {
 *     type: VECTOR(1024),
 *     allowNull: true,
 *   }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function VECTOR(dimension: number): any {
  // We extend ABSTRACT and override the bits Sequelize cares about. Cast to any
  // because Sequelize's type definitions don't expose the protected hooks we use.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Abstract = (DataTypes as any).ABSTRACT;

  class VECTOR_T extends Abstract {
    static key = "VECTOR";
    key = "VECTOR";
    dimension: number;

    constructor(dim: number) {
      super();
      this.dimension = dim;
    }

    toSql(): string {
      return `vector(${this.dimension})`;
    }

    // Sequelize serializes a value with `_stringify` (legacy) / `_value` paths.
    // Provide both so node-postgres receives the pgvector text literal.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _stringify(value: unknown, _options: any): string | null {
      return toPgvectorLiteral(value);
    }

    stringify(value: unknown): string | null {
      return toPgvectorLiteral(value);
    }

    _sanitize(value: unknown): number[] | null {
      return fromPgvectorLiteral(value);
    }

    _isChanged(value: unknown, originalValue: unknown): boolean {
      if (value === originalValue) return false;
      if (!Array.isArray(value) || !Array.isArray(originalValue)) return true;
      if (value.length !== originalValue.length) return true;
      for (let i = 0; i < value.length; i++) {
        if (value[i] !== originalValue[i]) return true;
      }
      return false;
    }
  }

  return new VECTOR_T(dimension);
}

/**
 * Compose a pgvector literal directly for raw SQL parameters.
 * Use when the embedding is passed via `replacements` in `sequelize.query`.
 */
export function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
