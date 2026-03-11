import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import { getDatabaseConnectionString } from "@/lib/deep-research/config";

let checkpointerPromise: Promise<PostgresSaver> | undefined;

export async function getDeepResearchCheckpointer() {
  if (!checkpointerPromise) {
    checkpointerPromise = (async () => {
      const connectionString = getDatabaseConnectionString();
      if (!connectionString) {
        throw new Error(
          "Missing SUPABASE_DB_URL or DATABASE_URL for deep research checkpointing.",
        );
      }

      const saver = PostgresSaver.fromConnString(connectionString);
      await saver.setup();
      return saver;
    })().catch((error) => {
      checkpointerPromise = undefined;
      throw error;
    });
  }

  return checkpointerPromise;
}
