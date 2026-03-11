import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import mammoth from 'mammoth';
import { createSupabaseClients } from '@/lib/supabase';

const openai = new OpenAI();

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

function safeDecodeURIComponent(str: string): string {
  try { return decodeURIComponent(str); }
  catch { try { return decodeURIComponent(str.replace(/%/g, '%25')); } catch { return str; } }
}

async function extractTextFromFile(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith('.pdf')) {
    const PDFParser = (await import('pdf2json')).default;
    return new Promise((resolve, reject) => {
      const pdfParser = new PDFParser(null, true);
      pdfParser.on('pdfParser_dataError', (err: Error | { parserError: Error }) => {
        const parserError =
          err instanceof Error ? err.message : err.parserError.message;
        reject(new Error(`PDF parsing error: ${parserError}`));
      });
      pdfParser.on('pdfParser_dataReady', (pdfData: PdfParseData) => {
        try {
          let fullText = '';
          pdfData.Pages?.forEach((page) => page.Texts?.forEach((text) => text.R?.forEach((run) => {
            if (run.T) {
              fullText += `${safeDecodeURIComponent(run.T)} `;
            }
          })));
          resolve(fullText.trim());
        } catch (error: unknown) {
          reject(new Error(`Error extracting text: ${error instanceof Error ? error.message : 'Unknown PDF parse failure'}`));
        }
      });
      pdfParser.parseBuffer(buffer);
    });
  } else if (fileName.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } else if (fileName.endsWith('.txt')) {
    return buffer.toString('utf-8');
  } else {
    throw new Error('Unsupported file type. Please upload PDF, DOCX, or TXT files.');
  }
}

export async function POST(req: Request) {
  try {
    const { supabase, supabaseStorage } = createSupabaseClients();
    const file = (await req.formData()).get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    const documentId = crypto.randomUUID();
    const uploadDate = new Date().toISOString();
    const filePath = `${documentId}.${file.name.split('.').pop() || 'bin'}`;

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const { error: storageError } = await supabaseStorage.storage.from('documents').upload(filePath, fileBuffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (storageError) {
      const msg = storageError.message || 'Unknown storage error';
      if (msg.includes('row-level security') || msg.includes('RLS')) {
        return NextResponse.json({ success: false, error: `Storage RLS error: ${msg}. Ensure SUPABASE_SERVICE_ROLE_KEY is set.` }, { status: 500 });
      }
      return NextResponse.json({ success: false, error: `Failed to store file: ${msg}` }, { status: 500 });
    }
    const { data: urlData } = supabaseStorage.storage.from('documents').getPublicUrl(filePath);
    const text = await extractTextFromFile(file);
    if (!text || text.trim().length === 0) return NextResponse.json({ error: 'Could not extract text from file' }, { status: 400 });
    const chunks = await (new RecursiveCharacterTextSplitter({ chunkSize: 800, chunkOverlap: 100 })).splitText(text);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      const emb = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: chunk,
      });

      const { error } = await supabase.from('documents').insert({
        content: chunk,
        metadata: { 
          source: file.name,
          document_id: documentId,
          file_name: file.name,
          file_type: file.type || file.name.split('.').pop(),
          file_size: file.size,
          upload_date: uploadDate,
          chunk_index: i,
          total_chunks: chunks.length,
          file_path: filePath,
          file_url: urlData.publicUrl,
        },
        embedding: JSON.stringify(emb.data[0].embedding),
      });

      if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, documentId, fileName: file.name, chunks: chunks.length, textLength: text.length, fileUrl: urlData.publicUrl });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed to process file' }, { status: 500 });
  }
}
