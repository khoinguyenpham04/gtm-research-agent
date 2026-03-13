import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import OpenAI from "openai";
import mammoth from "mammoth";

import type { DocumentSummary } from "@/lib/documents";
import { attachDocumentsToWorkspace, recordDocumentSource } from "@/lib/workspaces";
import { createSupabaseClients } from "@/lib/supabase";

interface PdfTextRun {
  T?: string;
}

interface PdfTextEntry {
  R?: PdfTextRun[];
}

interface PdfPage {
  Texts?: PdfTextEntry[];
}

interface PdfParseData {
  Pages?: PdfPage[];
}

export interface IngestDocumentInput {
  clerkUserId: string;
  fileBuffer: Buffer;
  fileName: string;
  fileType?: string;
  workspaceId?: string;
  sourceType: "upload" | "agent_download" | "url_ingest" | "generated_report";
  sourceUrl?: string;
  generatedFromRunId?: string;
  metadata?: Record<string, unknown>;
}

export interface IngestDocumentResult {
  document: DocumentSummary;
  documentId: string;
  chunks: number;
  textLength: number;
  attachedToWorkspace: boolean;
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    try {
      return decodeURIComponent(value.replace(/%/g, "%25"));
    } catch {
      return value;
    }
  }
}

async function extractTextFromBuffer(
  fileBuffer: Buffer,
  fileName: string,
): Promise<string> {
  const normalizedFileName = fileName.toLowerCase();

  if (normalizedFileName.endsWith(".pdf")) {
    const PDFParser = (await import("pdf2json")).default;
    return new Promise((resolve, reject) => {
      const parser = new PDFParser(null, true);
      parser.on("pdfParser_dataError", (error: Error | { parserError: Error }) => {
        const parserError =
          error instanceof Error ? error.message : error.parserError.message;
        reject(new Error(`PDF parsing error: ${parserError}`));
      });
      parser.on("pdfParser_dataReady", (pdfData: PdfParseData) => {
        try {
          let fullText = "";
          pdfData.Pages?.forEach((page) =>
            page.Texts?.forEach((text) =>
              text.R?.forEach((run) => {
                if (run.T) {
                  fullText += `${safeDecodeURIComponent(run.T)} `;
                }
              }),
            ),
          );
          resolve(fullText.trim());
        } catch (error) {
          reject(
            new Error(
              `Error extracting text: ${
                error instanceof Error ? error.message : "Unknown PDF parse failure"
              }`,
            ),
          );
        }
      });
      parser.parseBuffer(fileBuffer);
    });
  }

  if (normalizedFileName.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    return result.value;
  }

  if (normalizedFileName.endsWith(".txt")) {
    return fileBuffer.toString("utf-8");
  }

  if (normalizedFileName.endsWith(".md") || normalizedFileName.endsWith(".markdown")) {
    return fileBuffer.toString("utf-8");
  }

  throw new Error(
    "Unsupported file type. Please upload PDF, DOCX, TXT, or Markdown files.",
  );
}

export async function ingestDocumentToLibrary(
  input: IngestDocumentInput,
): Promise<IngestDocumentResult> {
  const { supabaseAdmin, supabaseStorage } = createSupabaseClients();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const documentId = crypto.randomUUID();
  const uploadDate = new Date().toISOString();
  const extension = input.fileName.split(".").pop() || "bin";
  const filePath = `${documentId}.${extension}`;

  const { error: storageError } = await supabaseStorage.storage
    .from("documents")
    .upload(filePath, input.fileBuffer, {
      contentType: input.fileType || "application/octet-stream",
      upsert: false,
    });

  if (storageError) {
    throw new Error(storageError.message || "Failed to store file.");
  }

  const extractedText = await extractTextFromBuffer(input.fileBuffer, input.fileName);
  if (!extractedText.trim()) {
    throw new Error("Could not extract text from file.");
  }

  const chunks = await new RecursiveCharacterTextSplitter({
    chunkSize: 800,
    chunkOverlap: 100,
  }).splitText(extractedText);

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: chunk,
    });

    const { error } = await supabaseAdmin.from("documents").insert({
      clerk_user_id: input.clerkUserId,
      content: chunk,
      document_external_id: documentId,
      metadata: {
        source: input.fileName,
        document_id: documentId,
        file_name: input.fileName,
        file_type: input.fileType || extension,
        file_size: input.fileBuffer.length,
        upload_date: uploadDate,
        chunk_index: index,
        total_chunks: chunks.length,
        file_path: filePath,
        ...(input.metadata ?? {}),
      },
      embedding: JSON.stringify(embedding.data[0].embedding),
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  await recordDocumentSource({
    clerkUserId: input.clerkUserId,
    documentId,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    generatedFromRunId: input.generatedFromRunId,
    metadata: {
      fileName: input.fileName,
      fileType: input.fileType || extension,
      ...(input.metadata ?? {}),
    },
  });

  let attachedToWorkspace = false;
  if (input.workspaceId) {
    await attachDocumentsToWorkspace(input.workspaceId, [documentId], input.clerkUserId);
    attachedToWorkspace = true;
  }

  return {
    documentId,
    document: {
      id: documentId,
      file_name: input.fileName,
      file_type: input.fileType || extension,
      file_size: input.fileBuffer.length,
      upload_date: uploadDate,
      total_chunks: chunks.length,
      file_path: filePath,
    },
    chunks: chunks.length,
    textLength: extractedText.length,
    attachedToWorkspace,
  };
}
