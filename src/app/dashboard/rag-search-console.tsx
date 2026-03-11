"use client"

import { useState } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

interface SearchSource {
  content: string
  metadata?: {
    source?: string
    file_name?: string
  }
}

export function RagSearchConsole() {
  const [query, setQuery] = useState("")
  const [answer, setAnswer] = useState("")
  const [loading, setLoading] = useState(false)
  const [sources, setSources] = useState<SearchSource[]>([])

  const handleSearch = async () => {
    if (!query.trim()) {
      return
    }

    setLoading(true)
    setAnswer("")
    setSources([])

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      })
      const payload = await response.json()
      if (payload.error) {
        setAnswer(`Error: ${payload.error}`)
      } else {
        setAnswer(payload.answer || "No answer generated")
        setSources(payload.sources || [])
      }
    } catch (error) {
      setAnswer(
        `Error: ${error instanceof Error ? error.message : "Search failed"}`,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
      <div className="space-y-6">
        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Ask the corpus</CardTitle>
            <CardDescription>
              Query the embedded document library directly. Use this for quick
              retrieval before escalating to deep research.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              className="min-h-40"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  void handleSearch()
                }
              }}
              placeholder="Ask a question about your uploaded documents..."
              value={query}
            />
            <div className="flex flex-wrap gap-3">
              <Button disabled={loading || !query.trim()} onClick={handleSearch}>
                {loading ? "Searching..." : "Search"}
              </Button>
              <Button asChild variant="outline">
                <Link href="/dashboard/data-library">Open data library</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Press Cmd/Ctrl + Enter to search.
            </p>
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Answer</CardTitle>
            <CardDescription>
              Direct answer generated from retrieved chunks.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {answer ? (
              <p className="whitespace-pre-wrap text-sm leading-6">{answer}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Run a search to see the answer here.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Retrieved sources</CardTitle>
            <CardDescription>
              Matching chunks used by the search response.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sources.length > 0 ? (
              <div className="space-y-3">
                {sources.map((source, index) => (
                  <div
                    key={`${source.metadata?.file_name ?? "source"}-${index}`}
                    className="rounded-xl border border-border/60 bg-background px-3 py-3"
                  >
                    <p className="text-sm font-medium">
                      {source.metadata?.source ||
                        source.metadata?.file_name ||
                        "Unknown source"}
                    </p>
                    <p className="mt-2 line-clamp-5 text-sm text-muted-foreground">
                      {source.content}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Retrieved sources will appear here after a search.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
