import { Pool, type PoolClient } from "pg";

import { getDatabaseConnectionString } from "@/lib/deep-research/config";

let pool: Pool | undefined;
let ensurePromise: Promise<void> | undefined;

export function getPgPool() {
  if (!pool) {
    const connectionString = getDatabaseConnectionString();
    if (!connectionString) {
      throw new Error(
        "Missing SUPABASE_DB_URL or DATABASE_URL for deep research database access.",
      );
    }

    pool = new Pool({
      connectionString,
      max: 5,
      ssl:
        process.env.PGSSLMODE === "disable"
          ? undefined
          : { rejectUnauthorized: false },
    });
  }

  return pool;
}

export async function withPgTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
) {
  const client = await getPgPool().connect();

  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function ensureDeepResearchDatabase() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const pgPool = getPgPool();
      await pgPool.query("select 1");
    })().catch((error) => {
      ensurePromise = undefined;
      throw error;
    });
  }

  await ensurePromise;
}
