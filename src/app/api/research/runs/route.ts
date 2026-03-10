import { NextResponse } from 'next/server';
import { createResearchRun, listResearchRuns } from '@/lib/research/repository';
import { createResearchRunInputSchema } from '@/lib/research/schemas';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const runs = await listResearchRuns();
    return NextResponse.json({ runs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load research runs.' },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const input = createResearchRunInputSchema.parse(body);
    const run = await createResearchRun(input);

    return NextResponse.json({ runId: run.id, run }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create research run.' },
      { status: 400 },
    );
  }
}
