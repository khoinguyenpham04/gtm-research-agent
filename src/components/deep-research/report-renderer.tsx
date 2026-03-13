import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

export const DEEP_RESEARCH_REPORT_MARKDOWN_CLASS =
  "mx-auto w-full max-w-3xl break-words text-[15px] leading-8 text-zinc-800 text-pretty [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:decoration-primary/40 [&_a]:underline-offset-4 hover:[&_a]:text-primary/80 [&_blockquote]:my-6 [&_blockquote]:border-l-[3px] [&_blockquote]:border-zinc-300 [&_blockquote]:bg-zinc-50 [&_blockquote]:py-2 [&_blockquote]:pl-4 [&_blockquote]:text-zinc-700 [&_code]:rounded-md [&_code]:bg-zinc-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.92em] [&_em]:text-zinc-700 [&_h1]:mb-6 [&_h1]:text-[2.15rem] [&_h1]:font-semibold [&_h1]:leading-tight [&_h1]:tracking-[-0.03em] [&_h2]:mt-11 [&_h2]:mb-4 [&_h2]:border-b [&_h2]:border-zinc-200 [&_h2]:pb-2 [&_h2]:text-[1.55rem] [&_h2]:font-semibold [&_h2]:leading-tight [&_h2]:tracking-[-0.025em] [&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:text-[1.18rem] [&_h3]:font-semibold [&_h3]:leading-7 [&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-base [&_h4]:font-semibold [&_hr]:my-8 [&_hr]:border-zinc-200 [&_li]:my-1.5 [&_li]:pl-1 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_p]:my-4 [&_p]:text-zinc-800 [&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:border [&_pre]:border-zinc-800 [&_pre]:bg-zinc-950 [&_pre]:p-4 [&_pre]:text-[13px] [&_pre]:leading-6 [&_pre]:text-zinc-50 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_table]:my-6 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-2xl [&_table]:border [&_table]:border-zinc-200 [&_tbody_tr]:border-t [&_tbody_tr]:border-zinc-200 [&_thead]:bg-zinc-50 [&_thead]:border-b [&_thead]:border-zinc-300 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_ul]:my-5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6";

export function DeepResearchReportRenderer({
  className,
  markdown,
}: {
  markdown: string;
  className?: string;
}) {
  return (
    <div className={cn(DEEP_RESEARCH_REPORT_MARKDOWN_CLASS, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}
