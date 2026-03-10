import { NextResponse } from 'next/server';
import { getResearchRunSnapshot } from '@/lib/research/repository';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const snapshot = await getResearchRunSnapshot(id);
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load research run.' },
      { status: 404 },
    );
  }
}
