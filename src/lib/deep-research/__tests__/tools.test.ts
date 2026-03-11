import assert from "node:assert/strict";
import test from "node:test";

import {
  filterAndRankDocumentChunks,
  formatDocumentSearchResults,
  type SearchableDocumentChunk,
} from "@/lib/deep-research/tools";

test("filterAndRankDocumentChunks keeps only selected document ids", () => {
  const chunks: SearchableDocumentChunk[] = [
    {
      id: 1,
      content: "Primary document chunk",
      metadata: {
        document_id: "doc-1",
        file_name: "doc-1.pdf",
        chunk_index: 0,
        total_chunks: 2,
      },
      embedding: [1, 0],
    },
    {
      id: 2,
      content: "Unselected document chunk",
      metadata: {
        document_id: "doc-2",
        file_name: "doc-2.pdf",
        chunk_index: 0,
        total_chunks: 1,
      },
      embedding: [0, 1],
    },
  ];

  const matches = filterAndRankDocumentChunks(chunks, ["doc-1"], [1, 0], 5);

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.metadata.document_id, "doc-1");
});

test("formatDocumentSearchResults preserves citation metadata", () => {
  const rendered = formatDocumentSearchResults([
    {
      id: 10,
      content: "Quoted evidence from the uploaded document.",
      similarity: 0.99,
      metadata: {
        document_id: "doc-1",
        file_name: "analyst-report.pdf",
        chunk_index: 1,
        total_chunks: 4,
        file_url: "https://example.com/analyst-report.pdf",
      },
    },
  ]);

  assert.match(rendered, /analyst-report\.pdf/);
  assert.match(rendered, /Document ID: doc-1/);
  assert.match(rendered, /https:\/\/example\.com\/analyst-report\.pdf/);
});
