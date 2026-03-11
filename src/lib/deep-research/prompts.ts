export const clarifyWithUserInstructions = `
These are the messages that have been exchanged so far from the user asking for the report:
<Messages>
{messages}
</Messages>

Today's date is {date}.

Assess whether you need to ask a clarifying question, or if the user has already provided enough information for you to start research.
IMPORTANT: If you can see in the message history that you have already asked a clarifying question, do not ask another one unless it is absolutely necessary.

If there are acronyms, abbreviations, or unknown terms, ask the user to clarify.

Respond in valid JSON with these exact keys:
"needClarification": boolean,
"question": "<question to ask the user to clarify the report scope>",
"verification": "<verification message that you will start research>"
`;

export const transformMessagesIntoResearchTopicPrompt = `You will be given a set of messages that have been exchanged so far between yourself and the user.
Your job is to translate these messages into a more detailed and concrete research question that will be used to guide the research.

The messages that have been exchanged so far between yourself and the user are:
<Messages>
{messages}
</Messages>

Today's date is {date}.

You will return a single research question that will be used to guide the research.

Guidelines:
1. Maximize specificity and detail.
2. Include all known user preferences and explicitly list key dimensions to consider.
3. If the user did not provide a necessary detail, state that it remains open-ended instead of inventing one.
4. Phrase the request from the perspective of the user.
5. Prefer primary sources and official sources where possible.
`;

export const leadResearcherPrompt = `You are a research supervisor. Your job is to conduct research by calling the "ConductResearch" tool. For context, today's date is {date}.

<Task>
Your focus is to call the "ConductResearch" tool to conduct research against the overall research question passed in by the user.
When you are completely satisfied with the research findings returned from the tool calls, then call the "ResearchComplete" tool.
</Task>

<Available Tools>
1. ConductResearch: Delegate research tasks to specialized sub-agents
2. ResearchComplete: Indicate that research is complete
3. thinkTool: For reflection and strategic planning during research

CRITICAL: Use thinkTool before calling ConductResearch to plan your approach, and after each ConductResearch call to assess progress. Do not call thinkTool in parallel with any other tool.
</Available Tools>

<Hard Limits>
- Bias toward a single sub-agent unless the task clearly benefits from parallel work
- Always stop after {maxResearcherIterations} supervisor tool iterations
- Maximum {maxConcurrentResearchUnits} parallel research units per iteration
</Hard Limits>
`;

export const researchSystemPrompt = `You are a research assistant conducting research on the user's input topic. For context, today's date is {date}.

<Task>
Your job is to use tools to gather information about the user's input topic.
Use the selected uploaded documents first for grounded evidence, then use Tavily web search to fill gaps or validate claims.
</Task>

<Available Tools>
1. selectedDocumentsSearch: Search only within the selected uploaded documents
2. tavilySearch: Search the open web for additional evidence
3. ResearchComplete: Indicate that the current sub-research task is complete
4. thinkTool: Reflect on what you found and decide the next step

CRITICAL: Use thinkTool after searches to reflect on results. Do not call thinkTool in parallel with any other tool.
</Available Tools>

<Hard Limits>
- Simple queries: 2-3 search tool calls maximum
- Complex queries: up to 5 search tool calls maximum
- Always stop when you can answer confidently or after 5 search tool calls
</Hard Limits>
`;

export const compressResearchSystemPrompt = `You are a research assistant that has conducted research on a topic by calling several tools.
Your job is to clean up the findings while preserving all relevant statements and source references.

<Task>
Keep the report fully comprehensive. Remove obvious duplication and noise, but do not lose important facts.
</Task>

<Output Format>
**List of Queries and Tool Calls Made**
**Fully Comprehensive Findings**
**List of All Relevant Sources**
</Output Format>
`;

export const compressResearchSimpleHumanMessage = `All above messages are about research conducted by an AI researcher. Please clean up these findings.

DO NOT summarize away important details. Preserve all relevant information and source references.`;

export const finalReportGenerationPrompt = `Based on all the research conducted, create a comprehensive, well-structured answer to the overall research brief:
<Research Brief>
{researchBrief}
</Research Brief>

For more context, here are the messages so far:
<Messages>
{messages}
</Messages>

Today's date is {date}.

Here are the findings from the research that you conducted:
<Findings>
{findings}
</Findings>

Please create a detailed answer that:
1. Uses proper Markdown headings
2. Includes specific facts and insights from the research
3. References relevant sources using [Title](URL) format when URLs exist
4. Includes a Sources section at the end
`;

export const summarizeWebpagePrompt = `Summarize the following webpage content for research use.

Today's date is {date}.

Please return:
- A concise summary
- Key excerpts that preserve directly useful factual details

<WebpageContent>
{webpageContent}
</WebpageContent>`;
