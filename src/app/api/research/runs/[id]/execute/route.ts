import { NextResponse } from 'next/server';
import { executeResearchRun } from '@/lib/research/runtime';
import { getResearchRunSnapshot } from '@/lib/research/repository';

export const dynamic = 'force-dynamic';

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const snapshot = await executeResearchRun(id);
    return NextResponse.json(snapshot);
  } catch (error) {
    try {
      const snapshot = await getResearchRunSnapshot(id);
      return NextResponse.json(
        {
          ...snapshot,
          error: error instanceof Error ? error.message : 'Research run failed.',
        },
        { status: 500 },
      );
    } catch (snapshotError) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : snapshotError instanceof Error
                ? snapshotError.message
                : 'Research run failed.',
        },
        { status: 500 },
      );
    }
  }
}
