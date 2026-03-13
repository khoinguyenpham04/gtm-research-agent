import { auth } from "@clerk/nextjs/server";
import OpenAI from 'openai';
import { NextResponse } from 'next/server';

import { listDocuments } from "@/lib/documents";
import { createSupabaseClients } from '@/lib/supabase';

const openai = new OpenAI();

interface SearchResultRow {
  content: string;
  metadata?: {
    source?: string;
    file_name?: string;
  };
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { supabaseAdmin } = createSupabaseClients();
    const { query } = await req.json();
    const ownedDocuments = await listDocuments(userId);
    const selectedDocumentIds = ownedDocuments.map((document) => document.id);

    if (selectedDocumentIds.length === 0) {
      return NextResponse.json({
        answer: "I do not have any documents in your library to answer from yet.",
        sources: [],
      });
    }

    const emb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: query });
    const queryEmbedding = emb.data[0]?.embedding ?? [];
    const { data: results, error } = await supabaseAdmin.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.0,
      match_count: 5,
      selected_document_ids: selectedDocumentIds,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const typedResults = (results ?? []) as SearchResultRow[];
    const context = typedResults.map((result) => result.content).join('\n---\n');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Use the provided context to answer. If the answer is not in the context, say you do not know.' },
        { role: 'user', content: `Context: ${context}\n\nQuestion: ${query}` }
      ],
    });
    return NextResponse.json({ answer: completion.choices[0].message.content, sources: typedResults });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Search failed' }, { status: 500 });
  }
}
