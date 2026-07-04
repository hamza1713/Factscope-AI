import { GoogleGenAI } from '@google/genai';

// Vercel serverless function for follow-up chat
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { message, history, context } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!context || typeof context !== 'object') {
      return res.status(400).json({ error: 'Context is required' });
    }

    if (!process.env.GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is not set in environment variables");
      return res.status(500).json({ error: 'Server Configuration Error' });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Map history to Gemini content format
    const contentsArray = (history || []).map((msg: any) => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));

    // Add latest user question
    contentsArray.push({
      role: 'user',
      parts: [{ text: message }]
    });

    const systemInstruction = `You are a helpful AI fact-checking assistant for Factscope-AI. You are engaging in a follow-up Q&A conversation about a news credibility report.

Here is the full context of the analyzed content and report:
=========================================
ORIGINAL NEWS INPUT:
${context.original_input || context.content_snippet}

CREDIBILITY VERDICT:
Label: ${context.label} (Confidence: ${context.confidence}%)

VERDICT SUMMARY:
${context.summary}

DETAILED JUSTIFICATION:
${context.explanation}

CLAIMS EVALUATED:
${JSON.stringify(context.claims, null, 2)}

SOURCES USED IN VERIFICATION:
${JSON.stringify(context.sources, null, 2)}
=========================================

## Response Formatting Rules
Always format your responses using rich Markdown:
- Use **## headings** to separate major sections of a long answer
- Use **bold** to highlight key terms, verdicts, and important facts
- Use *italics* for emphasis or quotes
- Use numbered lists (1. 2. 3.) when explaining step-by-step processes or ranking items
- Use bullet points (- item) for listing features, sources, or multiple data points
- Use \`inline code\` for specific data values, IDs, percentages, or technical terms
- Use blockquotes (> text) for quoting source content or verbatim claims
- Use horizontal rules (---) to separate major sections in long responses
- Keep paragraphs short and scannable — do not write walls of text
- When citing sources, format them clearly at the end of the relevant section

## Behavioral Rules
- Answer truthfully and concisely, grounded in the report context above
- If a question requires new information from the web, use the Google Search tool
- Cite your sources explicitly when making factual claims
- If you are unsure, say so — do not fabricate information
- Stay focused on fact-checking, credibility analysis, and source verification`;

    const PRIMARY_MODEL = 'gemini-2.5-flash';
    const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

    function isQuotaError(err: any): boolean {
      const msg: string = (err?.message || err?.toString() || '').toLowerCase();
      const status: number = err?.status ?? err?.httpStatusCode ?? 0;
      return (
        status === 429 ||
        msg.includes('resource_exhausted') ||
        msg.includes('quota') ||
        msg.includes('rate limit') ||
        msg.includes('rateLimitExceeded') ||
        msg.includes('too many requests')
      );
    }

    async function generateWithFallback(
      aiInstance: GoogleGenAI,
      params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>
    ) {
      try {
        console.log(`[AI Chat Serverless] Tier 1: Trying primary model (${PRIMARY_MODEL}) with search grounding...`);
        return await aiInstance.models.generateContent({ ...params, model: PRIMARY_MODEL });
      } catch (primaryErr: any) {
        if (!isQuotaError(primaryErr)) {
          throw primaryErr;
        }

        console.warn(
          `[AI Chat Serverless] Tier 1 (${PRIMARY_MODEL}) quota exceeded. Trying Tier 2 fallback...`,
          primaryErr?.message || primaryErr
        );

        try {
          console.log(`[AI Chat Serverless] Tier 2: Trying fallback model (${FALLBACK_MODEL}) with search grounding...`);
          return await aiInstance.models.generateContent({ ...params, model: FALLBACK_MODEL });
        } catch (fallbackErr: any) {
          if (!isQuotaError(fallbackErr)) {
            throw fallbackErr;
          }

          console.warn(
            `[AI Chat Serverless] Tier 2 (${FALLBACK_MODEL}) search tool or request quota exceeded. Falling back to Tier 3 (Searchless mode)...`,
            fallbackErr?.message || fallbackErr
          );

          const searchlessParams: any = {
            ...params,
            model: FALLBACK_MODEL,
          };

          if (searchlessParams.config) {
            searchlessParams.config = {
              ...searchlessParams.config,
            };
            delete searchlessParams.config.tools;
          }

          console.log(`[AI Chat Serverless] Tier 3: Trying fallback model (${FALLBACK_MODEL}) WITHOUT search grounding...`);
          return await aiInstance.models.generateContent(searchlessParams);
        }
      }
    }

    const response = await generateWithFallback(ai, {
      contents: contentsArray,
      config: {
        systemInstruction,
        tools: [{ googleSearch: {} }]
      }
    });

    const replyText = response.text;
    if (!replyText) throw new Error("AI did not return any text.");

    // Extract search grounding sources if available
    const sources: Array<{ title: string, uri: string }> = [];
    const metadata = response.candidates?.[0]?.groundingMetadata;
    if (metadata?.groundingChunks) {
      metadata.groundingChunks.forEach((chunk: any) => {
        if (chunk.web?.title && chunk.web?.uri) {
          // Avoid duplicate links
          const exists = sources.some(s => s.uri === chunk.web.uri);
          if (!exists) {
            sources.push({
              title: chunk.web.title,
              uri: chunk.web.uri
            });
          }
        }
      });
    }

    return res.status(200).json({
      text: replyText,
      sources
    });
  } catch (error: any) {
    console.error('Chat Serverless Function Error:', error.message || error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
