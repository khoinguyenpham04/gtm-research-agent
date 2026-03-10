import { NextResponse } from 'next/server';
import { listResearchEvents } from '@/lib/research/repository';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const events = await listResearchEvents(id);
    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load research events.' },
      { status: 404 },
    );
  }
}
