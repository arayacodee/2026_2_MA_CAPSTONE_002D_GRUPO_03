import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

const adapter = new PrismaNeon({
  connectionString: env.DATABASE_URL,
});

export const prisma = new PrismaClient({
  adapter,
});

export function isTransactionConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === 'P2034') return true;
  // Neon can expose the driver error directly when PostgreSQL aborts the commit.
  const cause = 'cause' in error ? error.cause : undefined;
  return typeof cause === 'object' && cause !== null && 'kind' in cause &&
    cause.kind === 'TransactionWriteConflict';
}
