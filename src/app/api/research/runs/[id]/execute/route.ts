import { NextResponse } from 'next/server';
import { executeResearchRun } from '@/lib/research/runtime';
import { getResearchRunSnapshot } from '@/lib/research/repository';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let body: { clarificationResponse?: string | null } | null = null;

  try {
    body = (await req.json()) as { clarificationResponse?: string | null };
  } catch {
    body = null;
  }

  try {
    const snapshot = await executeResearchRun(id, {
      clarificationResponse: body?.clarificationResponse ?? null,
    });
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
