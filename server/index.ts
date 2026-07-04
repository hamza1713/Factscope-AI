import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import { getCachedAnalysis, saveAnalysis, getDashboardStats } from './db';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(express.json({ limit: '1mb' }));

// ─── Model configuration ─────────────────────────────────────────────────────
// Primary model — highest quality, used by default.
const PRIMARY_MODEL = 'gemini-2.5-flash';
// Fallback model — used when the primary model hits a quota / rate-limit error.
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

// Initialize Gemini API (Server-side only)
let aiInstance: GoogleGenAI | null = null;
const getGeminiAI = () => {
  if (!aiInstance) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set in backend environment variables.");
    }
    aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return aiInstance;
};

/**
 * Returns true when an error from the Gemini API indicates a quota or
 * rate-limit problem (HTTP 429 / RESOURCE_EXHAUSTED).
 */
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

/**
 * Wraps ai.models.generateContent with a robust 3-tier automatic fallback:
 *  - Tier 1: PRIMARY_MODEL (gemini-2.5-flash) with Google Search grounding
 *  - Tier 2: FALLBACK_MODEL (gemini-3.1-flash-lite) with Google Search grounding
 *  - Tier 3: FALLBACK_MODEL (gemini-3.1-flash-lite) WITHOUT search tools (relying on pre-trained knowledge)
 */
async function generateWithFallback(
  ai: GoogleGenAI,
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>
) {
  // Tier 1: Try PRIMARY_MODEL (gemini-2.5-flash) with Search tools
  try {
    console.log(`[AI] Tier 1: Trying primary model (${PRIMARY_MODEL}) with search grounding...`);
    return await ai.models.generateContent({ ...params, model: PRIMARY_MODEL });
  } catch (primaryErr: any) {
    if (!isQuotaError(primaryErr)) {
      throw primaryErr;
    }

    console.warn(
      `[AI] Tier 1 (${PRIMARY_MODEL}) quota exceeded. Trying Tier 2 fallback...`,
      primaryErr?.message || primaryErr
    );

    // Tier 2: Try FALLBACK_MODEL (gemini-3.1-flash-lite) with Search tools
    try {
      console.log(`[AI] Tier 2: Trying fallback model (${FALLBACK_MODEL}) with search grounding...`);
      return await ai.models.generateContent({ ...params, model: FALLBACK_MODEL });
    } catch (fallbackErr: any) {
      if (!isQuotaError(fallbackErr)) {
        throw fallbackErr;
      }

      console.warn(
        `[AI] Tier 2 (${FALLBACK_MODEL}) search tool or request quota exceeded. Falling back to Tier 3 (Searchless mode)...`,
        fallbackErr?.message || fallbackErr
      );

      // Tier 3: Try FALLBACK_MODEL (gemini-3.1-flash-lite) WITHOUT search tools
      // This bypasses the Google Search tool quota limit entirely, using pre-trained knowledge.
      const searchlessParams: any = {
        ...params,
        model: FALLBACK_MODEL,
      };

      if (searchlessParams.config) {
        searchlessParams.config = {
          ...searchlessParams.config,
        };
        // Delete tools array to completely disable search grounding
        delete searchlessParams.config.tools;
      }

      console.log(`[AI] Tier 3: Trying fallback model (${FALLBACK_MODEL}) WITHOUT search grounding...`);
      return await ai.models.generateContent(searchlessParams);
    }
  }
}

// Error handling middleware
const errorHandler = (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Backend Error:', err.message || err);
  res.status(500).json({ error: 'Internal Server Error' });
};

// Routes
app.post('/api/analyze', async (req, res, next) => {
  try {
    const { input, isUrl } = req.body;

    if (!input || typeof input !== 'string') {
       res.status(400).json({ error: 'Invalid input provided' });
       return;
    }

    // Check database cache first to avoid redundant API charges
    const cachedResult = getCachedAnalysis(input, !!isUrl);
    if (cachedResult) {
      res.json(cachedResult);
      return;
    }

    let contentToAnalyze = input;

    if (isUrl) {
      try {
        new URL(input);
      } catch (_) {
        res.status(400).json({ error: 'Invalid URL provided' });
        return;
      }

      try {
        contentToAnalyze = await scrapeUrl(input);
      } catch (err: any) {
        console.error('Scraping Error:', err.message || err);
        res.status(422).json({ error: `Failed to scrape webpage: ${err.message || 'Unknown error'}` });
        return;
      }
    } else {
      if (input.trim().length < 30) {
         res.status(400).json({ error: 'Input too short for analysis' });
         return;
      }
    }

    const ai = getGeminiAI();
    const response = await generateWithFallback(ai, {
      contents: `Analyze the following news content for credibility. 

NEWS CONTENT:
${contentToAnalyze}

Instructions:
1. Classify the overall credibility.
2. Provide a confidence score from 0 to 100.
3. Write a short 1-2 sentence summary.
4. Extract 2-4 key factual claims.
5. For each claim, assign a verdict, reason, and source URL.
6. Write a concise explanation (under 100 words) justifying the label.
7. List the grounding sources used.

Return ONLY a valid JSON object matching the required schema. Do not include markdown code fences or any other text.
Required JSON Structure:
{
  "label": "REAL | FAKE | MISLEADING | SATIRE | UNVERIFIED",
  "confidence": number,
  "summary": "string",
  "explanation": "string",
  "claims": [
    { "claim_text": "string", "verdict": "TRUE | FALSE | UNPROVEN | CONTEXT_NEEDED", "reason": "string", "source_title": "string", "source_url": "string" }
  ],
  "sources": [
    { "title": "string", "uri": "string" }
  ]
}`,
      config: {
        systemInstruction: "You are an expert AI-powered fact-checker. Extract claims, verify using web search, classify content, and provide a verdict grounded in real sources.",
        tools: [{ googleSearch: {} }]
      }
    });

    const text = response.text;
    if (!text) throw new Error("AI did not return any text.");

    // Robustly extract JSON from the AI response.
    // Gemini may wrap the JSON in markdown code fences or add preamble text.
    let jsonString = '';

    // 1. Try stripping markdown fences first (```json ... ```)
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonString = fenceMatch[1].trim();
    } else {
      // 2. Fall back to extracting the outermost { ... } block
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}') + 1;
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        jsonString = text.slice(jsonStart, jsonEnd);
      }
    }

    if (!jsonString) {
      const preview = text.substring(0, 200);
      throw new Error(`AI did not return a valid JSON structure. Response preview: "${preview}"`);
    }

    let parsedData: any;
    try {
      parsedData = JSON.parse(jsonString);
    } catch (parseErr: any) {
      const preview = jsonString.substring(0, 200);
      throw new Error(`Failed to parse AI JSON response: ${parseErr.message}. Snippet: "${preview}"`);
    }
    
    // Attach metadata securely on the backend
    const result = {
      ...parsedData,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      content_snippet: isUrl 
        ? `[URL: ${input}] ${contentToAnalyze.replace(/^Title:\s*/i, '').substring(0, 80)}...`
        : input.substring(0, 100) + (input.length > 100 ? "..." : "")
    };

    // Save to local database for caching and dashboard aggregation
    saveAnalysis({
      ...result,
      original_input: input,
      is_url: !!isUrl
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/dashboard', (req, res) => {
  try {
    const stats = getDashboardStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/chat', async (req, res, next) => {
  try {
    const { message, history, context } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    if (!context || typeof context !== 'object') {
      res.status(400).json({ error: 'Context is required' });
      return;
    }

    const ai = getGeminiAI();

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

    res.json({
      text: replyText,
      sources
    });
  } catch (error) {
    next(error);
  }
});

// Helper functions for URL scraping and cleaning
async function scrapeUrl(urlString: string): Promise<string> {
  const url = new URL(urlString);
  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    throw new Error('Provided URL did not return HTML content.');
  }

  const html = await response.text();
  const { title, text } = extractTextFromHtml(html);
  
  if (!text || text.length < 100) {
    throw new Error('Extracted text content from the page is too short or empty (requires Javascript or is a single-page app).');
  }

  return `Title: ${title}\n\nContent:\n${text}`;
}

function extractTextFromHtml(html: string): { title: string, text: string } {
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : 'Scraped Article';

  let cleaned = html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
  cleaned = cleaned.replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  cleaned = cleaned.replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ');
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, ' ');

  cleaned = cleaned.replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr)>/gi, '\n');
  cleaned = cleaned.replace(/<(br|hr)[^>]*>/gi, '\n');

  cleaned = cleaned.replace(/<[^>]+>/g, ' ');

  const htmlEntities: { [key: string]: string } = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&ldquo;': '"',
    '&rdquo;': '"',
    '&lsquo;': "'",
    '&rsquo;': "'",
    '&ndash;': '-',
    '&mdash;': '—'
  };
  
  Object.keys(htmlEntities).forEach(entity => {
    cleaned = cleaned.replace(new RegExp(entity, 'g'), htmlEntities[entity]);
  });
  
  cleaned = cleaned.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec));

  cleaned = cleaned
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n');

  return {
    title: decodeHtmlEntities(title),
    text: cleaned
  };
}

function decodeHtmlEntities(str: string): string {
  const entities: { [key: string]: string } = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'"
  };
  let decoded = str;
  Object.keys(entities).forEach(entity => {
    decoded = decoded.replace(new RegExp(entity, 'g'), entities[entity]);
  });
  decoded = decoded.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec));
  return decoded.trim();
}

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Secure backend server running on http://localhost:${port}`);
});
