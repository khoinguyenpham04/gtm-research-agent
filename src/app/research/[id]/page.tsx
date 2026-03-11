'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
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
import { Separator } from '@/components/ui/separator';
import { useParams } from 'next/navigation';

interface Snapshot {
  run: {
    id: string;
    topic: string;
    objective: string | null;
    status: string;
    currentStage: string;
    engineVersion: string;
    internalStage: string | null;
    loopIteration: number;
    awaitingClarification: boolean;
    clarificationQuestion: string | null;
    lastProgressAt: string | null;
    planJson: {
      researchQuestions: string[];
      searchQueries: Array<{
        intent: string;
        sectionKey: string;
        subtopic: string;
        query: string;
        sourcePreference: string;
        claimType: string;
        evidenceMode: string;
        vendorTarget: string | null;
      }>;
      sections: Array<{ key: string; title: string; description: string }>;
      brief?: {
        topic: string;
        productCategory: string | null;
        targetBuyer: string | null;
      };
    } | null;
    finalReportMarkdown: string | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  };
  linkedDocuments: Array<{
    id: string;
    documentExternalId: string;
    fileName: string | null;
  }>;
  sources: Array<{
    id: string;
    sourceType: string;
    title: string;
    url: string | null;
    snippet: string | null;
    metadataJson: Record<string, unknown>;
    createdAt: string;
  }>;
  findings: Array<{
    id: string;
    sectionKey: string;
    claimType: string;
    claim: string;
    evidenceJson: Array<{
      evidenceId: string;
      sourceId: string;
      sourceType: string;
      title: string;
      url: string | null;
      excerpt: string;
      documentExternalId?: string | null;
      documentChunkId?: number | null;
    }>;
    evidenceMode: string;
    inferenceLabel: string;
    confidence: string;
    status: string;
    verificationNotes: string;
    gapsJson: string[];
    contradictionsJson: string[];
    createdAt: string;
  }>;
  evidence: Array<{
    id: string;
    sourceType: string;
    sourceId: string | null;
    title: string;
    url: string | null;
    excerpt: string;
    sectionKey: string | null;
    documentExternalId: string | null;
    documentChunkId: number | null;
    metadataJson: Record<string, unknown>;
    createdAt: string;
  }>;
  retrievalCandidates: Array<{
    id: string;
    sourceType: string;
    retrieverType: string;
    sectionKey: string | null;
    query: string;
    title: string;
    claimType: string;
    evidenceMode: string;
    vendorTarget: string | null;
    rawScore: number;
    fusedScore: number | null;
    selected: boolean;
  }>;
  reportSections: Array<{
    id: string;
    sectionKey: string;
    title: string;
    contentMarkdown: string;
    citationsJson: string[];
    status: string;
    statusNotesJson: string[];
    createdAt: string;
  }>;
  error?: string;
}

interface EventRecord {
  id: number;
  stage: string;
  eventType: string;
  message: string;
  createdAt: string;
}

const stageOrder = [
  'plan',
  'web_search',
  'document_retrieval',
  'draft_report',
  'verification',
  'finalize',
];

function displayStage(stage: string) {
  return stage === 'mock_document_retrieval'
    ? 'document retrieval'
    : stage.replaceAll('_', ' ');
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusVariant(status: string) {
  switch (status) {
    case 'completed':
      return 'success' as const;
    case 'failed':
      return 'destructive' as const;
    case 'verifying':
      return 'secondary' as const;
    default:
      return 'secondary' as const;
  }
}

function isTerminal(status: string) {
  return status === 'completed' || status === 'failed';
}

export default function ResearchRunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [executeState, setExecuteState] = useState<'idle' | 'starting' | 'running'>('idle');
  const [clarificationDraft, setClarificationDraft] = useState('');
  const [clarificationSubmitting, setClarificationSubmitting] = useState(false);
  const executionStarted = useRef(false);
  const runStatus = snapshot?.run.status;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [snapshotRes, eventsRes] = await Promise.all([
          fetch(`/api/research/runs/${runId}`, { cache: 'no-store' }),
          fetch(`/api/research/runs/${runId}/events`, { cache: 'no-store' }),
        ]);

        const snapshotData = (await snapshotRes.json()) as Snapshot;
        const eventsData = (await eventsRes.json()) as { events?: EventRecord[]; error?: string };

        if (snapshotData.error) {
          throw new Error(snapshotData.error);
        }

        if (eventsData.error) {
          throw new Error(eventsData.error);
        }

        if (!cancelled) {
          setSnapshot(snapshotData);
          setEvents(eventsData.events ?? []);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load research run.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    let timer: number | null = null;

    if (!runStatus || !isTerminal(runStatus)) {
      timer = window.setInterval(() => {
        void load();
      }, 2000);
    }

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [runId, runStatus]);

  useEffect(() => {
    if (
      !snapshot ||
      isTerminal(snapshot.run.status) ||
      snapshot.run.awaitingClarification ||
      executionStarted.current
    ) {
      return;
    }

    executionStarted.current = true;
    setExecuteState('starting');

    void (async () => {
      try {
        const response = await fetch(`/api/research/runs/${runId}/execute`, {
          method: 'POST',
        });
        const payload = (await response.json()) as Snapshot;

        if (!response.ok) {
          setError(payload.error || payload.run?.errorMessage || 'Research execution failed.');
        }

        if (payload.run) {
          setSnapshot(payload);
        }
      } catch (executeError) {
        setError(executeError instanceof Error ? executeError.message : 'Failed to start research execution.');
      } finally {
        setExecuteState('running');
      }
    })();
  }, [runId, snapshot]);

  const progressIndex = snapshot ? stageOrder.indexOf(snapshot.run.currentStage) : -1;

  async function submitClarification() {
    if (!clarificationDraft.trim()) {
      setError('Enter a clarification response before resuming the run.');
      return;
    }

    setClarificationSubmitting(true);
    try {
      const response = await fetch(`/api/research/runs/${runId}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clarificationResponse: clarificationDraft.trim(),
        }),
      });
      const payload = (await response.json()) as Snapshot;

      if (!response.ok) {
        throw new Error(payload.error || payload.run?.errorMessage || 'Failed to resume research execution.');
      }

      setSnapshot(payload);
      setClarificationDraft('');
      setError(null);
      executionStarted.current = true;
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Failed to resume research execution.',
      );
    } finally {
      setClarificationSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <Navigation />
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        {loading && !snapshot ? (
          <p className="text-sm text-slate-500">Loading run…</p>
        ) : error && !snapshot ? (
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-rose-600">{error}</p>
            </CardContent>
          </Card>
        ) : snapshot ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Badge variant="outline">Research run</Badge>
                  <Badge variant={statusVariant(snapshot.run.status)}>{snapshot.run.status}</Badge>
                  {executeState === 'starting' && <Badge variant="secondary">starting</Badge>}
                </div>
                <h1 className="max-w-4xl text-3xl font-semibold text-slate-900">{snapshot.run.topic}</h1>
                {snapshot.run.objective && (
                  <p className="max-w-3xl text-sm text-slate-600">{snapshot.run.objective}</p>
                )}
                {!isTerminal(snapshot.run.status) && (
                  <p className="text-sm text-slate-500">
                    Progress refreshes automatically every 2 seconds while the run is active.
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  Engine {snapshot.run.engineVersion} · internal stage{' '}
                  {snapshot.run.internalStage ?? 'unknown'} · loop {snapshot.run.loopIteration}
                </p>
              </div>
              <div className="flex gap-3">
                <Link
                  href={`/research/${snapshot.run.id}/debug`}
                  className="inline-flex items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
                >
                  Debug view
                </Link>
                <Link
                  href="/research"
                  className="inline-flex items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
                >
                  New run
                </Link>
                <Link
                  href="/documents"
                  className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  Documents
                </Link>
              </div>
            </div>

            <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-6">
                {error && (
                  <Card className="border-rose-200 bg-rose-50">
                    <CardContent className="p-4">
                      <p className="text-sm text-rose-700">{error}</p>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader>
                    <CardTitle>Stage progress</CardTitle>
                    <CardDescription>{displayStage(snapshot.run.currentStage)}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {snapshot.run.awaitingClarification && snapshot.run.clarificationQuestion && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                        <p className="text-sm font-medium text-amber-900">
                          Clarification needed
                        </p>
                        <p className="mt-1 text-sm text-amber-800">
                          {snapshot.run.clarificationQuestion}
                        </p>
                        <textarea
                          value={clarificationDraft}
                          onChange={(event) => setClarificationDraft(event.target.value)}
                          placeholder="Add the missing GTM scope details here."
                          className="mt-3 min-h-28 w-full rounded-md border border-amber-200 bg-white p-3 text-sm text-slate-900 shadow-sm outline-none ring-0"
                        />
                        <button
                          type="button"
                          onClick={() => void submitClarification()}
                          disabled={clarificationSubmitting}
                          className="mt-3 inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                        >
                          {clarificationSubmitting ? 'Resuming…' : 'Resume research'}
                        </button>
                      </div>
                    )}
                    {stageOrder.map((stage, index) => {
                      const isActive = snapshot.run.currentStage === stage;
                      const isComplete = progressIndex > index || snapshot.run.status === 'completed';

                      return (
                        <div key={stage} className="flex items-center gap-3">
                          <div
                            className={`h-3 w-3 rounded-full ${
                              isComplete ? 'bg-emerald-500' : isActive ? 'bg-slate-900' : 'bg-slate-300'
                            }`}
                          />
                          <div>
                            <p className="text-sm font-medium text-slate-900">{displayStage(stage)}</p>
                            <p className="text-xs text-slate-500">
                              {isComplete ? 'Completed' : isActive ? 'In progress' : 'Pending'}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Event timeline</CardTitle>
                    <CardDescription>Persisted stage-by-stage progress.</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[360px]">
                      <div className="space-y-0">
                        {events.length === 0 ? (
                          <p className="p-6 text-sm text-slate-500">
                            {executeState === 'starting'
                              ? 'Starting execution… first events will appear here.'
                              : 'No events yet.'}
                          </p>
                        ) : (
                          events.map((event, index) => (
                            <div key={event.id}>
                              <div className="space-y-1 p-6">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-sm font-medium text-slate-900">{event.message}</p>
                                  <Badge variant="outline">{event.stage}</Badge>
                                </div>
                                <p className="text-xs uppercase tracking-wide text-slate-500">{event.eventType}</p>
                                <p className="text-xs text-slate-400">{formatDate(event.createdAt)}</p>
                              </div>
                              {index < events.length - 1 && <Separator />}
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Linked documents</CardTitle>
                    <CardDescription>Linked files used for run-scoped document retrieval.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {snapshot.linkedDocuments.length === 0 ? (
                      <p className="text-sm text-slate-500">No linked documents.</p>
                    ) : (
                      snapshot.linkedDocuments.map((document) => (
                        <div key={document.id} className="rounded-lg border border-slate-200 p-3">
                          <p className="font-medium text-slate-900">
                            {document.fileName ?? `Document ${document.documentExternalId}`}
                          </p>
                          <p className="text-xs text-slate-500">{document.documentExternalId}</p>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Section quality</CardTitle>
                    <CardDescription>Section policy outcomes after retrieval and verification.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {snapshot.reportSections.length === 0 ? (
                      <p className="text-sm text-slate-500">No section statuses yet.</p>
                    ) : (
                      snapshot.reportSections.map((section) => (
                        <div key={section.id} className="rounded-lg border border-slate-200 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-medium text-slate-900">{section.title}</p>
                            <Badge
                              variant={
                                section.status === 'ready'
                                  ? 'success'
                                  : section.status === 'needs-review'
                                    ? 'secondary'
                                    : 'destructive'
                              }
                            >
                              {section.status}
                            </Badge>
                          </div>
                          {section.statusNotesJson.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {section.statusNotesJson.map((note) => (
                                <p key={`${section.id}-${note}`} className="text-xs text-slate-500">
                                  {note}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Evidence ledger</CardTitle>
                    <CardDescription>Persisted web snippets and retrieved document chunks used by claims.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {snapshot.evidence.length === 0 ? (
                      <p className="text-sm text-slate-500">No evidence yet.</p>
                    ) : (
                      snapshot.evidence.map((record) => (
                        <div key={record.id} className="rounded-lg border border-slate-200 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-slate-900">{record.title}</p>
                              {record.url && (
                                <a
                                  href={record.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-sm text-slate-600 underline-offset-4 hover:underline"
                                >
                                  {record.url}
                                </a>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <Badge variant="outline">{record.sourceType}</Badge>
                              {typeof record.metadataJson.qualityLabel === 'string' && (
                                <Badge
                                  variant={
                                    record.metadataJson.qualityLabel === 'high'
                                      ? 'success'
                                      : record.metadataJson.qualityLabel === 'medium'
                                        ? 'secondary'
                                        : 'destructive'
                                  }
                                >
                                  {String(record.metadataJson.qualityLabel)}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                            {record.sectionKey && <span>section: {record.sectionKey}</span>}
                            {typeof record.metadataJson.claimType === 'string' && (
                              <span>claim type: {String(record.metadataJson.claimType)}</span>
                            )}
                            {typeof record.metadataJson.evidenceMode === 'string' && (
                              <span>evidence mode: {String(record.metadataJson.evidenceMode)}</span>
                            )}
                            {typeof record.metadataJson.vendorTarget === 'string' && (
                              <span>vendor: {String(record.metadataJson.vendorTarget)}</span>
                            )}
                            {typeof record.metadataJson.queryIntent === 'string' && (
                              <span>intent: {String(record.metadataJson.queryIntent)}</span>
                            )}
                            {typeof record.metadataJson.sourceCategory === 'string' && (
                              <span>category: {String(record.metadataJson.sourceCategory)}</span>
                            )}
                            {typeof record.metadataJson.qualityScore === 'number' && (
                              <span>score: {Number(record.metadataJson.qualityScore).toFixed(2)}</span>
                            )}
                            {typeof record.metadataJson.recency === 'string' && (
                              <span>recency: {String(record.metadataJson.recency)}</span>
                            )}
                            {typeof record.metadataJson.publishedYear === 'number' && (
                              <span>year: {String(record.metadataJson.publishedYear)}</span>
                            )}
                            {typeof record.metadataJson.similarity === 'number' && (
                              <span>
                                similarity: {Number(record.metadataJson.similarity).toFixed(4)}
                              </span>
                            )}
                            {typeof record.metadataJson.usedInSynthesis === 'boolean' && (
                              <span>
                                synthesis: {record.metadataJson.usedInSynthesis ? 'included' : 'excluded'}
                              </span>
                            )}
                            {record.documentExternalId && <span>document: {record.documentExternalId}</span>}
                          </div>
                          <p className="mt-3 text-sm leading-6 text-slate-600">{record.excerpt}</p>
                          {typeof record.metadataJson.rationale === 'string' && (
                            <p className="mt-2 text-xs text-slate-500">{String(record.metadataJson.rationale)}</p>
                          )}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Draft findings</CardTitle>
                    <CardDescription>Claims with confidence and evidence links.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {snapshot.findings.length === 0 ? (
                      <p className="text-sm text-slate-500">No findings yet.</p>
                    ) : (
                      snapshot.findings.map((finding) => (
                        <div key={finding.id} className="rounded-lg border border-slate-200 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
                              {finding.sectionKey}
                            </p>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">{finding.claimType}</Badge>
                              <Badge variant="outline">{finding.evidenceMode}</Badge>
                              <Badge
                                variant={
                                  finding.inferenceLabel === 'direct'
                                    ? 'success'
                                    : finding.inferenceLabel === 'inferred'
                                      ? 'secondary'
                                      : 'destructive'
                                }
                              >
                                {finding.inferenceLabel}
                              </Badge>
                              <Badge variant="secondary">{finding.confidence}</Badge>
                              <Badge variant={finding.status === 'verified' ? 'success' : finding.status === 'needs-review' ? 'destructive' : 'outline'}>
                                {finding.status}
                              </Badge>
                            </div>
                          </div>
                          <p className="mt-2 text-sm text-slate-900">{finding.claim}</p>
                          {finding.verificationNotes && (
                            <p className="mt-2 text-xs text-slate-500">{finding.verificationNotes}</p>
                          )}
                          {finding.gapsJson.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {finding.gapsJson.map((gap) => (
                                <p key={`${finding.id}-${gap}`} className="text-xs text-amber-700">
                                  Gap: {gap}
                                </p>
                              ))}
                            </div>
                          )}
                          {finding.contradictionsJson.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {finding.contradictionsJson.map((contradiction) => (
                                <p key={`${finding.id}-${contradiction}`} className="text-xs text-rose-700">
                                  Contradiction: {contradiction}
                                </p>
                              ))}
                            </div>
                          )}
                          <div className="mt-3 space-y-1">
                            {finding.evidenceJson.map((evidence) => (
                              <div key={`${finding.id}-${evidence.evidenceId}`} className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                                <p className="font-medium text-slate-700">
                                  {evidence.url ? (
                                    <a
                                      href={evidence.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="underline-offset-4 hover:underline"
                                    >
                                      {evidence.title}
                                    </a>
                                  ) : (
                                    evidence.title
                                  )}
                                </p>
                                <p className="mt-1">{evidence.excerpt}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Draft report</CardTitle>
                    <CardDescription>Markdown assembled from persisted report sections.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {snapshot.run.errorMessage && (
                      <p className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-600">
                        {snapshot.run.errorMessage}
                      </p>
                    )}
                    <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-5 text-sm leading-7 text-slate-100">
                      {snapshot.run.finalReportMarkdown ?? 'Report not ready yet.'}
                    </pre>
                  </CardContent>
                </Card>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
