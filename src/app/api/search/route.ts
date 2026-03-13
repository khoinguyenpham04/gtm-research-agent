import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RETIRED_MESSAGE =
  "Standalone RAG Search has been retired. Use Ask Workspace inside a session."

export async function GET() {
  return NextResponse.json(
    {
      error: RETIRED_MESSAGE,
    },
    { status: 410 },
  )
}

export async function POST() {
  return NextResponse.json(
    {
      error: RETIRED_MESSAGE,
    },
    { status: 410 },
  )
}
