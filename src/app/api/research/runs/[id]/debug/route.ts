import { NextResponse } from 'next/server';
import {
  getResearchRun,
  getResearchRunSnapshot,
  listResearchEvents,
} from '@/lib/research/repository';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const [run, snapshot, events] = await Promise.all([
      getResearchRun(id),
      getResearchRunSnapshot(id),
      listResearchEvents(id),
    ]);

    return NextResponse.json({
      run: snapshot.run,
      workflowStateJson: run.workflowStateJson,
      events,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load research debug state.' },
      { status: 404 },
    );
  }
}
