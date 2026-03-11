'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Navigation from '@/app/components/Navigation';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

interface DebugEventRecord {
  id: number;
  stage: string;
  eventType: string;
  message: string;
  payloadJson: Record<string, unknown>;
  createdAt: string;
}

interface DebugResponse {
  run: {
    id: string;
    topic: string;
    status: string;
    currentStage: string;
    engineVersion: string;
    internalStage: string | null;
    loopIteration: number;
    planJson: {
      repairHistory?: Array<Record<string, unknown>>;
    } | null;
    errorMessage: string | null;
  };
  workflowStateJson: Record<string, unknown> | null;
  events: DebugEventRecord[];
  error?: string;
}

function isTerminal(status: string) {
  return status === 'completed' || status === 'failed';
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function getArray<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export default function ResearchDebugPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;
  const [snapshot, setSnapshot] = useState<DebugResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const poller = useRef<number | null>(null);
  const runStatus = snapshot?.run.status ?? null;

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch(`/api/research/runs/${runId}/debug`, {
          cache: 'no-store',
        });
        const data = (await response.json()) as DebugResponse;
        if (!active) {
          return;
        }
        if (!response.ok) {
          setError(data.error ?? 'Failed to load debug snapshot.');
          return;
        }
        setSnapshot(data);
        setError(null);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : 'Failed to load debug snapshot.');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [runId]);

  useEffect(() => {
    if (!runStatus || isTerminal(runStatus)) {
      if (poller.current) {
        window.clearInterval(poller.current);
        poller.current = null;
      }
      return;
    }

    poller.current = window.setInterval(async () => {
      const response = await fetch(`/api/research/runs/${runId}/debug`, {
        cache: 'no-store',
      });
      const data = (await response.json()) as DebugResponse;
      if (response.ok) {
        setSnapshot(data);
      }
    }, 2000);

    return () => {
      if (poller.current) {
        window.clearInterval(poller.current);
        poller.current = null;
      }
    };
  }, [runId, runStatus]);

  const workflow = snapshot?.workflowStateJson ?? null;
  const brief = workflow && typeof workflow.brief === 'object' ? workflow.brief : null;
  const requestedResolvedVendors = getArray<string>(
    workflow?.requestedResolvedVendors ?? workflow?.supportedVendors,
  );
  const selectedComparisonVendors = getArray<string>(
    workflow?.selectedComparisonVendors ?? workflow?.supportedVendors,
  );
  const rejectedResolvedVendors = getArray<string>(workflow?.rejectedResolvedVendors);
  const unresolvedRequestedVendors = getArray<string>(
    workflow?.unresolvedRequestedVendors ?? workflow?.unsupportedVendors,
  );
  const sectionStates = getArray(workflow?.sectionStates);
  const workerPlan = getArray(workflow?.workerPlan ?? workflow?.taskQueue);
  const completedTasks = getArray(workflow?.workerOutputs ?? workflow?.completedTasks);
  const queryLedger = getArray(workflow?.queryLedger);
  const sourceFetchLedger = getArray(workflow?.sourceFetchLedger);
  const rejectedSearchCandidates = getArray(workflow?.rejectedSearchCandidates);
  const repairHistory = getArray(snapshot?.run.planJson?.repairHistory);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-10 sm:px-6 lg:px-8">
        {loading ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-500">Loading debug view…</CardContent>
          </Card>
        ) : snapshot ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Badge variant="outline">Research debug</Badge>
                  <Badge variant="secondary">{snapshot.run.status}</Badge>
                </div>
                <h1 className="max-w-4xl text-3xl font-semibold text-slate-900">
                  {snapshot.run.topic}
                </h1>
                <p className="text-xs text-slate-500">
                  Engine {snapshot.run.engineVersion} · stage {snapshot.run.currentStage} · internal{' '}
                  {snapshot.run.internalStage ?? 'unknown'} · loop {snapshot.run.loopIteration}
                </p>
              </div>
              <div className="flex gap-3">
                <Link
                  href={`/research/${runId}`}
                  className="inline-flex items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
                >
                  Report view
                </Link>
                <Link
                  href="/research"
                  className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  New run
                </Link>
              </div>
            </div>

            {error && (
              <Card className="border-rose-200 bg-rose-50">
                <CardContent className="p-4 text-sm text-rose-700">{error}</CardContent>
              </Card>
            )}

            {snapshot.run.errorMessage && (
              <Card className="border-amber-200 bg-amber-50">
                <CardContent className="p-4 text-sm text-amber-800">
                  {snapshot.run.errorMessage}
                </CardContent>
              </Card>
            )}

            <section className="grid gap-6 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Brief</CardTitle>
                  <CardDescription>Structured scope extracted for the worker loop.</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                    {formatJson(brief ?? {})}
                  </pre>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Section States</CardTitle>
                  <CardDescription>Coverage status, selected evidence, and open gaps.</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                    {formatJson(sectionStates)}
                  </pre>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Vendor Resolution</CardTitle>
                  <CardDescription>Resolved, selected, and excluded vendors before worker planning.</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                    {formatJson({
                      requestedResolvedVendors,
                      selectedComparisonVendors,
                      rejectedResolvedVendors,
                      unresolvedRequestedVendors,
                    })}
                  </pre>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Task Queue</CardTitle>
                  <CardDescription>Planned workers for the current run.</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                    {formatJson(workerPlan)}
                  </pre>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Completed Tasks</CardTitle>
                  <CardDescription>Worker outputs persisted so far.</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                    {formatJson(completedTasks)}
                  </pre>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Query Ledger</CardTitle>
                  <CardDescription>Queries issued and their evidence yield.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[360px]">
                    <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                      {formatJson(queryLedger)}
                    </pre>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Fetched URLs</CardTitle>
                  <CardDescription>Shortlisted pages fetched during the loop.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[360px]">
                    <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                      {formatJson(sourceFetchLedger)}
                    </pre>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Rejected Candidates</CardTitle>
                  <CardDescription>
                    Search results rejected before fetch, with rejection reasons.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[360px]">
                    <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                      {formatJson(rejectedSearchCandidates)}
                    </pre>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Repair History</CardTitle>
                  <CardDescription>Persisted repair deltas used for stall detection.</CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                    {formatJson(repairHistory)}
                  </pre>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Events</CardTitle>
                  <CardDescription>Persisted supervisor and stage events.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[360px]">
                    <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                      {formatJson(snapshot.events)}
                    </pre>
                  </ScrollArea>
                </CardContent>
              </Card>
            </section>

            <Card>
              <CardHeader>
                <CardTitle>Raw Workflow State</CardTitle>
                <CardDescription>Full checkpointed LangGraph state for this run.</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[560px]">
                  <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                    {formatJson(workflow ?? {})}
                  </pre>
                </ScrollArea>
              </CardContent>
            </Card>
          </>
        ) : null}
      </main>
    </div>
  );
}
