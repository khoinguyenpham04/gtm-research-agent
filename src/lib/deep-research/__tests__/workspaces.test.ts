import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkspaceFolderTree,
  findInvalidWorkspaceDocumentSelections,
  type WorkspaceDocumentAttachment,
  type WorkspaceFolder,
} from "@/lib/workspaces";

const folders: WorkspaceFolder[] = [
  {
    id: "folder-1",
    workspaceId: "workspace-1",
    name: "Reports",
    createdAt: "2026-03-11T10:00:00.000Z",
    updatedAt: "2026-03-11T10:00:00.000Z",
  },
  {
    id: "folder-2",
    workspaceId: "workspace-1",
    name: "Regional",
    parentFolderId: "folder-1",
    createdAt: "2026-03-11T10:05:00.000Z",
    updatedAt: "2026-03-11T10:05:00.000Z",
  },
];

const attachments: WorkspaceDocumentAttachment[] = [
  {
    workspaceId: "workspace-1",
    documentId: "doc-1",
    attachedAt: "2026-03-11T10:10:00.000Z",
    assetType: "uploaded_document",
    document: {
      id: "doc-1",
      file_name: "global-overview.pdf",
      file_type: "application/pdf",
      file_size: 100,
      upload_date: "2026-03-11T10:00:00.000Z",
      total_chunks: 3,
    },
  },
  {
    workspaceId: "workspace-1",
    documentId: "doc-2",
    folderId: "folder-1",
    attachedAt: "2026-03-11T10:11:00.000Z",
    assetType: "uploaded_document",
    document: {
      id: "doc-2",
      file_name: "analyst-report.pdf",
      file_type: "application/pdf",
      file_size: 100,
      upload_date: "2026-03-11T10:00:00.000Z",
      total_chunks: 6,
    },
  },
  {
    workspaceId: "workspace-1",
    documentId: "doc-3",
    folderId: "folder-2",
    attachedAt: "2026-03-11T10:12:00.000Z",
    assetType: "uploaded_document",
    document: {
      id: "doc-3",
      file_name: "uk-fintech.txt",
      file_type: "text/plain",
      file_size: 100,
      upload_date: "2026-03-11T10:00:00.000Z",
      total_chunks: 2,
    },
  },
];

test("buildWorkspaceFolderTree groups documents under nested folders", () => {
  const tree = buildWorkspaceFolderTree(folders, attachments);

  assert.equal(tree.rootDocuments.length, 1);
  assert.equal(tree.rootDocuments[0]?.documentId, "doc-1");
  assert.equal(tree.folderTree.length, 1);
  assert.equal(tree.folderTree[0]?.documents[0]?.documentId, "doc-2");
  assert.equal(tree.folderTree[0]?.children[0]?.documents[0]?.documentId, "doc-3");
});

test("findInvalidWorkspaceDocumentSelections rejects documents outside the workspace", () => {
  const invalidIds = findInvalidWorkspaceDocumentSelections(
    ["doc-1", "doc-2"],
    ["doc-2", "doc-3"],
  );

  assert.deepEqual(invalidIds, ["doc-3"]);
});
