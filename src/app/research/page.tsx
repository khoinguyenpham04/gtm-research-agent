'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Navigation from '@/app/components/Navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

interface DocumentOption {
  id: string;
  file_name: string;
  file_type: string;
  upload_date: string;
}

interface RunListItem {
  id: string;
  topic: string;
  objective: string | null;
  status: string;
  currentStage: string;
  updatedAt: string;
  createdAt: string;
}

function statusVariant(status: string) {
  switch (status) {
    case 'completed':
      return 'success' as const;
    case 'failed':
      return 'destructive' as const;
    default:
      return 'secondary' as const;
  }
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

export default function ResearchPage() {
  const [topic, setTopic] = useState('');
  const [objective, setObjective] = useState('');
  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedCountLabel = useMemo(() => {
    if (selectedDocumentIds.length === 0) {
      return 'No linked documents';
    }

    return `${selectedDocumentIds.length} linked document${selectedDocumentIds.length === 1 ? '' : 's'}`;
  }, [selectedDocumentIds.length]);

  useEffect(() => {
    void loadInitialData();
  }, []);

  async function loadInitialData() {
    setLoading(true);
    setError(null);

    try {
      const [documentsRes, runsRes] = await Promise.all([
        fetch('/api/documents', { cache: 'no-store' }),
        fetch('/api/research/runs', { cache: 'no-store' }),
      ]);

      const documentsData = (await documentsRes.json()) as { documents?: DocumentOption[]; error?: string };
      const runsData = (await runsRes.json()) as { runs?: RunListItem[]; error?: string };

      if (documentsData.error) {
        throw new Error(documentsData.error);
      }

      if (runsData.error) {
        throw new Error(runsData.error);
      }

      setDocuments(documentsData.documents ?? []);
      setRuns(runsData.runs ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load research workspace.');
    } finally {
      setLoading(false);
    }
  }

  function toggleDocument(documentId: string) {
    setSelectedDocumentIds((current) =>
      current.includes(documentId)
        ? current.filter((id) => id !== documentId)
        : [...current, documentId],
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/research/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topic,
          objective: objective || undefined,
          selectedDocumentIds,
        }),
      });

      const data = (await response.json()) as { runId?: string; error?: string };

      if (!response.ok || data.error || !data.runId) {
        throw new Error(data.error || 'Failed to create research run.');
      }

      window.location.href = `/research/${data.runId}`;
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to create research run.');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <Navigation />
      <main className="mx-auto flex max-w-7xl flex-col gap-8 px-4 pb-12 sm:px-6 lg:px-8">
        <section className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-stone-200 bg-white">
            <CardHeader>
              <Badge variant="outline" className="w-fit border-slate-300">
                Research-first workflow
              </Badge>
              <CardTitle className="text-3xl">Launch a GTM research run</CardTitle>
              <CardDescription>
                Start a persisted run that plans research, searches the web, links uploaded documents,
                and drafts a structured brief with evidence.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700" htmlFor="topic">
                    Topic
                  </label>
                  <Input
                    id="topic"
                    placeholder="e.g. GTM strategy for home battery storage systems targeting owner-occupied UK households"
                    value={topic}
                    onChange={(event) => setTopic(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700" htmlFor="objective">
                    Objective
                  </label>
                  <Textarea
                    id="objective"
                    placeholder="Describe the decision this report should support."
                    value={objective}
                    onChange={(event) => setObjective(event.target.value)}
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-medium text-slate-700">Linked documents</h2>
                      <p className="text-sm text-slate-500">{selectedCountLabel}</p>
                    </div>
                    <Link href="/documents" className="text-sm text-slate-600 underline-offset-4 hover:underline">
                      Manage uploads
                    </Link>
                  </div>
                  <Card className="border-dashed border-stone-300 bg-stone-50">
                    <CardContent className="p-0">
                      <ScrollArea className="h-72">
                        <div className="space-y-2 p-4">
                          {loading ? (
                            <p className="text-sm text-slate-500">Loading documents…</p>
                          ) : documents.length === 0 ? (
                            <p className="text-sm text-slate-500">
                              No uploaded documents yet. Upload files first if you want them linked to the run.
                            </p>
                          ) : (
                            documents.map((document) => (
                              <label
                                key={document.id}
                                className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent bg-white p-3 transition hover:border-stone-200"
                              >
                                <input
                                  type="checkbox"
                                  className="mt-1 h-4 w-4 rounded border-slate-300"
                                  checked={selectedDocumentIds.includes(document.id)}
                                  onChange={() => toggleDocument(document.id)}
                                />
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-slate-900">{document.file_name}</p>
                                  <p className="text-xs text-slate-500">
                                    {document.file_type} · uploaded {formatDate(document.upload_date)}
                                  </p>
                                </div>
                              </label>
                            ))
                          )}
                        </div>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>
                {error && <p className="text-sm text-rose-600">{error}</p>}
                <Button type="submit" disabled={submitting || !topic.trim()}>
                  {submitting ? 'Creating run…' : 'Start research run'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="border-stone-200 bg-[#f4f0e8]">
            <CardHeader>
              <CardTitle>What this slice does</CardTitle>
              <CardDescription>Deterministic flow, real persistence, mocked retrieval.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-700">
              <div>
                <p className="font-medium text-slate-900">Stages</p>
                <p>Plan, web search, mock document retrieval, report draft, finalize.</p>
              </div>
              <Separator />
              <div>
                <p className="font-medium text-slate-900">Evidence model</p>
                <p>Web sources are persisted. Linked documents are attached to the run and surfaced as mocked context.</p>
              </div>
              <Separator />
              <div>
                <p className="font-medium text-slate-900">Output</p>
                <p>A structured markdown report with persisted sections, findings, citations, and event history.</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <Card className="border-stone-200 bg-white">
            <CardHeader>
              <CardTitle>Recent runs</CardTitle>
              <CardDescription>Reopen completed or failed workflows.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-slate-500">Loading run history…</p>
              ) : runs.length === 0 ? (
                <p className="text-sm text-slate-500">No research runs yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Topic</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Stage</TableHead>
                        <TableHead>Updated</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runs.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell className="max-w-[420px]">
                            <div className="space-y-1">
                              <p className="font-medium text-slate-900">{run.topic}</p>
                              {run.objective && (
                                <p className="line-clamp-2 text-sm text-slate-500">{run.objective}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                          </TableCell>
                          <TableCell className="text-slate-500">{run.currentStage}</TableCell>
                          <TableCell className="text-slate-500">{formatDate(run.updatedAt)}</TableCell>
                          <TableCell>
                            <Link
                              href={`/research/${run.id}`}
                              className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50 sm:w-auto"
                            >
                              Open run
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
