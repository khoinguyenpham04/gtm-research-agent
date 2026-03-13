"use client"

import { startTransition, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Folder, FolderPlus, Globe, Link2, Sparkles, Upload } from "lucide-react"

import PDFViewerModal from "@/app/components/PDFViewerModal"
import type { DocumentSummary } from "@/lib/documents"
import type {
  WorkspaceDetail,
  WorkspaceDocumentAttachment,
  WorkspaceFolderNode,
  WorkspaceSummary,
} from "@/lib/workspaces"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTimestamp(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-GB", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
}

interface WorkspaceDocumentRowProps {
  attachment: WorkspaceDocumentAttachment
  folderOptions: { id: string; label: string }[]
  submitting: boolean
  onMove: (documentId: string, folderId: string | null) => void
}

function WorkspaceDocumentRow({
  attachment,
  folderOptions,
  submitting,
  onMove,
}: WorkspaceDocumentRowProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-background px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {attachment.document.file_name}
          </p>
          <p className="text-xs text-muted-foreground">
            {attachment.document.total_chunks} chunks ·{" "}
            {formatFileSize(attachment.document.file_size)}
          </p>
        </div>
        <Select
          disabled={submitting}
          onValueChange={(value) =>
            onMove(attachment.documentId, value === "root" ? null : value)
          }
          value={attachment.folderId ?? "root"}
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="Move to folder" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="root">Current Workspace</SelectItem>
            {folderOptions.map((folder) => (
              <SelectItem key={folder.id} value={folder.id}>
                {folder.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function FolderBranch({
  node,
  folderOptions,
  submitting,
  onMove,
  depth = 0,
}: {
  node: WorkspaceFolderNode
  folderOptions: { id: string; label: string }[]
  submitting: boolean
  onMove: (documentId: string, folderId: string | null) => void
  depth?: number
}) {
  return (
    <div className="space-y-2">
      <div
        className="flex items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-sm font-medium"
        style={{ marginLeft: `${depth * 12}px` }}
      >
        <Folder className="size-4 text-muted-foreground" />
        <span className="truncate">{node.name}</span>
      </div>

      <div className="space-y-2">
        {node.documents.map((attachment) => (
          <div key={attachment.documentId} style={{ marginLeft: `${(depth + 1) * 12}px` }}>
            <WorkspaceDocumentRow
              attachment={attachment}
              folderOptions={folderOptions}
              onMove={onMove}
              submitting={submitting}
            />
          </div>
        ))}
        {node.children.map((child) => (
          <FolderBranch
            key={child.id}
            depth={depth + 1}
            folderOptions={folderOptions}
            node={child}
            onMove={onMove}
            submitting={submitting}
          />
        ))}
      </div>
    </div>
  )
}

function filterFolderTreeForUploadedDocuments(
  nodes: WorkspaceFolderNode[],
): WorkspaceFolderNode[] {
  return nodes
    .map((node) => {
      const children = filterFolderTreeForUploadedDocuments(node.children)
      const documents = node.documents.filter(
        (attachment) => attachment.assetType === "uploaded_document",
      )

      if (children.length === 0 && documents.length === 0) {
        return null
      }

      return {
        ...node,
        children,
        documents,
      }
    })
    .filter((node): node is WorkspaceFolderNode => node !== null)
}

function GeneratedReportRow({
  attachment,
}: {
  attachment: WorkspaceDocumentAttachment
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">
              {attachment.generatedReport?.title || attachment.document.file_name}
            </p>
            <Badge className="rounded-full" variant="secondary">
              Generated report
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {attachment.document.total_chunks} chunks · Generated{" "}
            {formatTimestamp(
              attachment.generatedReport?.generatedAt ?? attachment.attachedAt,
            )}
          </p>
        </div>
        {attachment.generatedReport?.sessionId ? (
          <Button asChild size="sm" variant="outline">
            <Link
              href={`/dashboard/chat/sessions/${attachment.generatedReport.sessionId}?runId=${attachment.generatedReport.runId ?? ""}`}
            >
              Open source
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function DataLibraryConsole({
  initialDocuments,
  initialWorkspace,
  initialWorkspaces,
}: {
  initialDocuments: DocumentSummary[]
  initialWorkspace: WorkspaceDetail | null
  initialWorkspaces: WorkspaceSummary[]
}) {
  const [documents, setDocuments] = useState(initialDocuments)
  const [workspaces, setWorkspaces] = useState(initialWorkspaces)
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(
    initialWorkspace,
  )
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    initialWorkspace?.id ?? initialWorkspaces[0]?.id ?? "",
  )
  const [workspaceName, setWorkspaceName] = useState("")
  const [folderName, setFolderName] = useState("")
  const [folderParentId, setFolderParentId] = useState("root")
  const [fileUrl, setFileUrl] = useState("")
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [selectedPreview, setSelectedPreview] = useState<{
    url: string
    name: string
    id?: string
    isPDF?: boolean
  } | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const workspaceDocumentIdSet = useMemo(
    () => new Set(workspace?.documents.map((attachment) => attachment.documentId) ?? []),
    [workspace?.documents],
  )
  const folderOptions = useMemo(() => {
    const options: { id: string; label: string }[] = []
    const visit = (nodes: WorkspaceFolderNode[], prefix: string) => {
      for (const node of nodes) {
        const label = prefix ? `${prefix} / ${node.name}` : node.name
        options.push({ id: node.id, label })
        visit(node.children, label)
      }
    }

    visit(workspace?.folderTree ?? [], "")
    return options
  }, [workspace?.folderTree])
  const uploadedRootDocuments = useMemo(
    () =>
      workspace?.rootDocuments.filter(
        (attachment) => attachment.assetType === "uploaded_document",
      ) ?? [],
    [workspace?.rootDocuments],
  )
  const uploadedFolderTree = useMemo(
    () => filterFolderTreeForUploadedDocuments(workspace?.folderTree ?? []),
    [workspace?.folderTree],
  )

  useEffect(() => {
    if (!activeWorkspaceId || workspace?.id === activeWorkspaceId) {
      return
    }

    let cancelled = false
    const loadWorkspace = async () => {
      try {
        setWorkspaceLoading(true)
        const response = await fetch(`/api/workspaces/${activeWorkspaceId}`, {
          cache: "no-store",
        })
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load workspace.")
        }
        if (cancelled) {
          return
        }

        startTransition(() => {
          setWorkspace(payload)
        })
      } catch (workspaceError) {
        if (!cancelled) {
          setError(
            workspaceError instanceof Error
              ? workspaceError.message
              : "Failed to load workspace.",
          )
        }
      } finally {
        if (!cancelled) {
          setWorkspaceLoading(false)
        }
      }
    }

    void loadWorkspace()
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, workspace?.id])

  const refreshDocuments = async () => {
    const response = await fetch("/api/documents", { cache: "no-store" })
    const payload = await response.json()
    if (!response.ok) {
      throw new Error(payload.error || "Failed to refresh documents.")
    }

    startTransition(() => {
      setDocuments(payload.documents ?? [])
    })
  }

  const refreshWorkspace = async (workspaceId: string) => {
    const response = await fetch(`/api/workspaces/${workspaceId}`, {
      cache: "no-store",
    })
    const payload = await response.json()
    if (!response.ok) {
      throw new Error(payload.error || "Failed to refresh workspace.")
    }

    startTransition(() => {
      setWorkspace(payload)
    })
  }

  const refreshWorkspaces = async (nextWorkspaceId?: string) => {
    const response = await fetch("/api/workspaces", { cache: "no-store" })
    const payload = await response.json()
    if (!response.ok) {
      throw new Error(payload.error || "Failed to refresh workspaces.")
    }

    startTransition(() => {
      setWorkspaces(payload.workspaces ?? [])
      if (nextWorkspaceId) {
        setActiveWorkspaceId(nextWorkspaceId)
      }
    })
  }

  const handleCreateWorkspace = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: workspaceName }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create workspace.")
      }

      await refreshWorkspaces(payload.id)
      await refreshWorkspace(payload.id)
      startTransition(() => {
        setWorkspaceName("")
      })
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Failed to create workspace.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleAttachDocument = async (documentId: string) => {
    if (!activeWorkspaceId) {
      setError("Create or select a workspace first.")
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${activeWorkspaceId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentIds: [documentId] }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to attach document.")
      }

      startTransition(() => {
        setWorkspace(payload)
      })
      await refreshWorkspaces(activeWorkspaceId)
    } catch (attachError) {
      setError(
        attachError instanceof Error
          ? attachError.message
          : "Failed to attach document.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateFolder = async () => {
    if (!activeWorkspaceId) {
      setError("Create or select a workspace first.")
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${activeWorkspaceId}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: folderName,
          parentFolderId: folderParentId === "root" ? undefined : folderParentId,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create folder.")
      }

      startTransition(() => {
        setWorkspace(payload)
        setFolderName("")
        setFolderParentId("root")
      })
    } catch (folderError) {
      setError(
        folderError instanceof Error
          ? folderError.message
          : "Failed to create folder.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleMoveDocument = async (documentId: string, folderId: string | null) => {
    if (!activeWorkspaceId) {
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/workspaces/${activeWorkspaceId}/documents/${documentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId }),
        },
      )
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to move document.")
      }

      startTransition(() => {
        setWorkspace(payload)
      })
    } catch (moveError) {
      setError(
        moveError instanceof Error
          ? moveError.message
          : "Failed to move document.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpload = async () => {
    if (!activeWorkspaceId || !uploadFile) {
      setError("Choose a workspace and file first.")
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append("file", uploadFile)
      formData.append("workspaceId", activeWorkspaceId)

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to upload document.")
      }

      await Promise.all([
        refreshDocuments(),
        refreshWorkspaces(activeWorkspaceId),
        refreshWorkspace(activeWorkspaceId),
      ])
      startTransition(() => {
        setUploadFile(null)
      })
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Failed to upload document.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleImportUrl = async () => {
    if (!activeWorkspaceId || fileUrl.trim().length === 0) {
      setError("Choose a workspace and URL first.")
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${activeWorkspaceId}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to import document.")
      }

      await Promise.all([
        refreshDocuments(),
        refreshWorkspaces(activeWorkspaceId),
        refreshWorkspace(activeWorkspaceId),
      ])
      startTransition(() => {
        setFileUrl("")
      })
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Failed to import document.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (documentId: string, fileName: string) => {
    if (!confirm(`Delete "${fileName}" from the canonical library?`)) {
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/documents?id=${documentId}`, {
        method: "DELETE",
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to delete document.")
      }

      await Promise.all([
        refreshDocuments(),
        activeWorkspaceId ? refreshWorkspace(activeWorkspaceId) : Promise.resolve(),
        refreshWorkspaces(activeWorkspaceId || undefined),
      ])
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete document.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  const openPreview = (document: DocumentSummary) => {
    const isPDF = document.file_name.toLowerCase().endsWith(".pdf")
    setSelectedPreview({
      url: `/api/documents?id=${document.id}&file=true${isPDF ? "&view=true" : ""}`,
      name: document.file_name,
      id: document.id,
      isPDF,
    })
    setShowPreview(true)
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(360px,0.92fr)_minmax(0,1.08fr)]">
      <div className="space-y-6">
        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Workspace Knowledge</CardTitle>
            <CardDescription>
              Workspaces do not duplicate files. They attach and organize the
              subset of your canonical library used for retrieval, chat, and deep
              research.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium">Active workspace</label>
              <Select
                onValueChange={setActiveWorkspaceId}
                value={activeWorkspaceId || undefined}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Create or select a workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">New workspace</label>
              <div className="flex gap-2">
                <Input
                  placeholder="Workspace name"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                />
                <Button
                  disabled={submitting || workspaceName.trim().length === 0}
                  onClick={handleCreateWorkspace}
                  variant="outline"
                >
                  Create
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Card className="border border-border/60 bg-muted/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <Folder className="size-4 text-muted-foreground" />
                    <p className="text-sm font-medium">Workspace knowledge</p>
                  </div>
                  <p className="mt-2 text-2xl font-semibold">
                    {workspace?.documents.length ?? 0}
                  </p>
                </CardContent>
              </Card>
              <Card className="border border-border/60 bg-muted/20">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <Globe className="size-4 text-muted-foreground" />
                    <p className="text-sm font-medium">Global docs</p>
                  </div>
                  <p className="mt-2 text-2xl font-semibold">{documents.length}</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Card className="border border-border/60 bg-background">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <Folder className="size-4 text-muted-foreground" />
                    <p className="text-sm font-medium">Uploaded docs</p>
                  </div>
                  <p className="mt-2 text-2xl font-semibold">
                    {workspace?.uploadedDocumentCount ?? 0}
                  </p>
                </CardContent>
              </Card>
              <Card className="border border-border/60 bg-background">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-muted-foreground" />
                    <p className="text-sm font-medium">Generated reports</p>
                  </div>
                  <p className="mt-2 text-2xl font-semibold">
                    {workspace?.generatedReportCount ?? 0}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">Knowledge intake</p>
                <p className="text-xs leading-5 text-muted-foreground">
                  Add source material into the global library, then attach it to the
                  active workspace.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Upload className="size-4 text-muted-foreground" />
                <p className="text-sm font-medium">Upload file</p>
              </div>
              <Input
                accept=".pdf,.docx,.txt,.md,.markdown"
                onChange={(event) =>
                  setUploadFile(event.target.files?.[0] ?? null)
                }
                type="file"
              />
              <Button
                className="w-full"
                disabled={submitting || !uploadFile || !activeWorkspaceId}
                onClick={handleUpload}
                variant="outline"
              >
                Upload and attach
              </Button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Link2 className="size-4 text-muted-foreground" />
                <p className="text-sm font-medium">Import direct file URL</p>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                Paste a direct PDF, DOCX, TXT, or Markdown file link. Viewer pages
                and article URLs are not supported.
              </p>
              <Input
                placeholder="https://example.com/report.pdf"
                value={fileUrl}
                onChange={(event) => setFileUrl(event.target.value)}
              />
              <Button
                className="w-full"
                disabled={submitting || !activeWorkspaceId || fileUrl.trim().length === 0}
                onClick={handleImportUrl}
                variant="outline"
              >
                Import and attach
              </Button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <FolderPlus className="size-4 text-muted-foreground" />
                <p className="text-sm font-medium">Organize workspace</p>
              </div>
              <Input
                placeholder="Folder name"
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
              />
              <Select onValueChange={setFolderParentId} value={folderParentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose parent folder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">Current Workspace</SelectItem>
                  {folderOptions.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                className="w-full"
                disabled={submitting || !activeWorkspaceId || folderName.trim().length === 0}
                onClick={handleCreateFolder}
                variant="outline"
              >
                Create folder
              </Button>
            </div>

            {error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Attached workspace knowledge</CardTitle>
            <CardDescription>
              Uploaded source material can be organized into folders. Generated
              reports stay available as workspace-native knowledge beside those
              source files.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!workspace ? (
              <p className="text-sm text-muted-foreground">
                Select a workspace to see its attached documents.
              </p>
            ) : workspaceLoading ? (
              <p className="text-sm text-muted-foreground">Loading workspace…</p>
            ) : (
              <>
                <div className="rounded-xl border border-dashed border-border/70 px-3 py-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Folder className="size-4 text-muted-foreground" />
                    <span>{workspace.name}</span>
                    <Badge variant="outline">{workspace.documentCount}</Badge>
                  </div>
                </div>

                {workspace.generatedReports.length > 0 ? (
                  <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">Generated reports</p>
                        <p className="text-xs text-muted-foreground">
                          Published deep research outputs now available in this workspace.
                        </p>
                      </div>
                      <Badge variant="outline">
                        {workspace.generatedReports.length}
                      </Badge>
                    </div>

                    <div className="space-y-3">
                      {workspace.generatedReports.map((attachment) => (
                        <GeneratedReportRow
                          attachment={attachment}
                          key={attachment.documentId}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-3 rounded-2xl border border-border/60 bg-background p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Uploaded documents</p>
                      <p className="text-xs text-muted-foreground">
                        Source files attached from the global library.
                      </p>
                    </div>
                    <Badge variant="outline">
                      {workspace.uploadedDocumentCount}
                    </Badge>
                  </div>

                {uploadedRootDocuments.map((attachment) => (
                  <WorkspaceDocumentRow
                    key={attachment.documentId}
                    attachment={attachment}
                    folderOptions={folderOptions}
                    onMove={handleMoveDocument}
                    submitting={submitting}
                  />
                ))}
                {uploadedFolderTree.map((node) => (
                  <FolderBranch
                    key={node.id}
                    folderOptions={folderOptions}
                    node={node}
                    onMove={handleMoveDocument}
                    submitting={submitting}
                  />
                ))}
                </div>

                {workspace.documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Attach documents or publish reports to build this workspace.
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle>Global Library</CardTitle>
            <CardDescription>
              Canonical files and generated markdown reports live here once, then
              get attached into workspaces as needed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No canonical documents yet. Upload one above or open{" "}
                <Link className="underline" href="/dashboard?mode=chat">
                  Ask Workspace
                </Link>{" "}
                after you attach knowledge to a workspace.
              </p>
            ) : (
              <div className="space-y-3">
                {documents.map((document) => {
                  const attached = workspaceDocumentIdSet.has(document.id)
                  return (
                    <div
                      key={document.id}
                      className="rounded-xl border border-border/60 bg-background px-4 py-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {document.file_name}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {document.file_name.toLowerCase().endsWith(".md") ? (
                              <Badge variant="secondary">Generated report</Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {document.total_chunks} chunks ·{" "}
                            {formatFileSize(document.file_size)} · Uploaded{" "}
                            {formatTimestamp(document.upload_date)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={submitting}
                            onClick={() => openPreview(document)}
                            size="sm"
                            variant="outline"
                          >
                            Preview
                          </Button>
                          <Button
                            disabled={submitting || attached || !activeWorkspaceId}
                            onClick={() => handleAttachDocument(document.id)}
                            size="sm"
                            variant={attached ? "secondary" : "outline"}
                          >
                            {attached ? "Attached" : "Attach"}
                          </Button>
                          <Button
                            disabled={submitting}
                            onClick={() => handleDelete(document.id, document.file_name)}
                            size="sm"
                            variant="destructive"
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedPreview ? (
        <PDFViewerModal
          documentId={selectedPreview.id}
          fileName={selectedPreview.name}
          fileUrl={selectedPreview.url}
          isOpen={showPreview}
          isPDF={selectedPreview.isPDF !== false}
          onClose={() => {
            setShowPreview(false)
            setSelectedPreview(null)
          }}
        />
      ) : null}
    </div>
  )
}
