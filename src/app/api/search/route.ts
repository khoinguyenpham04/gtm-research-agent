import OpenAI from 'openai';
import { NextResponse } from 'next/server';
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
  try {
    const { supabase } = createSupabaseClients();
    const { query } = await req.json();
    const emb = await openai.embeddings.create({ model: 'text-embedding-3-small', input: query });
    const { data: results, error } = await supabase.rpc('match_documents', {
      query_embedding: JSON.stringify(emb.data[0].embedding),
      match_threshold: 0.0,
      match_count: 5,
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
