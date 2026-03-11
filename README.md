This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, create your local env file:

```bash
cp .env.example .env.local
```

Set at least these variables in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
OPENAI_API_KEY=your-openai-api-key
TAVILY_API_KEY=your-tavily-api-key
```

For uploads, deletes, and the deep research runtime, also set:

```bash
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_DB_URL=postgresql://postgres:password@db.your-project-ref.supabase.co:5432/postgres
```

`SUPABASE_DB_URL` (or `DATABASE_URL`) is required for the LangGraph Postgres checkpointer and the additive `deep_research_*` tables.

Then run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Deep Research MVP

The MVP deep research flow lives in `/dashboard`.

- Upload supporting files in `/documents`
- Create a run from `/dashboard`
- Choose the uploaded documents that should be searched
- The backend runs a server-side LangGraph workflow with clarification, supervisor delegation, sub-researchers, selected-document retrieval, Tavily search, and final report generation

API routes:

- `POST /api/deep-research/runs`
- `GET /api/deep-research/runs/[id]`
- `POST /api/deep-research/runs/[id]/resume`
- `POST /api/deep-research/runs/[id]/retry`

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# gtm-research-agent
