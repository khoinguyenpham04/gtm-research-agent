import { notFound } from "next/navigation";

import { DeepResearchReportRenderer } from "@/components/deep-research/report-renderer";
import { getDeepResearchRunResponse, getSessionSummary } from "@/lib/deep-research/repository";

export const dynamic = "force-dynamic";

export default async function DeepResearchReportPrintPage({
  params,
}: {
  params: Promise<{ runId: string; sessionId: string }>;
}) {
  const { runId, sessionId } = await params;
  const [session, run] = await Promise.all([
    getSessionSummary(sessionId),
    getDeepResearchRunResponse(runId),
  ]);

  if (!session || !run || run.sessionId !== sessionId || !run.finalReportMarkdown) {
    notFound();
  }

  return (
    <main className="fixed inset-0 z-50 overflow-y-auto bg-white text-zinc-900 print:static print:inset-auto print:z-auto print:overflow-visible">
      <div className="mx-auto w-full max-w-4xl px-6 py-10 print:max-w-none print:px-8 print:py-8">
        <header className="mb-10 border-b border-zinc-200 pb-6 print:mb-8">
          <div className="print:hidden">
            <p className="text-sm text-zinc-500">
              Open your browser&apos;s print dialog to save this report as PDF.
            </p>
          </div>
          <div className="mt-3 space-y-3 print:mt-0">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-zinc-500">
              {run.workspace?.name ?? "Workspace report"}
            </p>
            <div className="space-y-2">
              <h1 className="text-4xl font-semibold tracking-[-0.04em] text-zinc-950">
                {run.topic}
              </h1>
              <p className="text-sm text-zinc-500">
                Generated {new Date(run.updatedAt).toLocaleString("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </div>
          </div>
        </header>

        <article className="print:text-black">
          <DeepResearchReportRenderer markdown={run.finalReportMarkdown} />
        </article>
      </div>
    </main>
  );
}
