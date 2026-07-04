import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';
import { getCachedAnalysis, saveAnalysis } from '../server/db';

// Serverless function handler for Vercel
export default async function handler(req: any, res: any) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { input, isUrl } = req.body;

    if (!input || typeof input !== 'string') {
       return res.status(400).json({ error: 'Invalid input provided' });
    }

    // Check database cache first to avoid redundant API charges
    const cachedResult = getCachedAnalysis(input, !!isUrl);
    if (cachedResult) {
      return res.status(200).json(cachedResult);
    }

    let contentToAnalyze = input;

    if (isUrl) {
      try {
        new URL(input);
      } catch (_) {
        return res.status(400).json({ error: 'Invalid URL provided' });
      }

      try {
        contentToAnalyze = await scrapeUrl(input);
      } catch (err: any) {
        console.error('Scraping Error:', err.message || err);
        return res.status(422).json({ error: `Failed to scrape webpage: ${err.message || 'Unknown error'}` });
      }
    } else {
      if (input.trim().length < 30) {
         return res.status(400).json({ error: 'Input too short for analysis' });
      }
    }

    if (!process.env.GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is not set in environment variables");
      return res.status(500).json({ error: 'Server Configuration Error' });
    }

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
        console.log(`[AI Serverless] Tier 1: Trying primary model (${PRIMARY_MODEL}) with search grounding...`);
        return await aiInstance.models.generateContent({ ...params, model: PRIMARY_MODEL });
      } catch (primaryErr: any) {
        if (!isQuotaError(primaryErr)) {
          throw primaryErr;
        }

        console.warn(
          `[AI Serverless] Tier 1 (${PRIMARY_MODEL}) quota exceeded. Trying Tier 2 fallback...`,
          primaryErr?.message || primaryErr
        );

        try {
          console.log(`[AI Serverless] Tier 2: Trying fallback model (${FALLBACK_MODEL}) with search grounding...`);
          return await aiInstance.models.generateContent({ ...params, model: FALLBACK_MODEL });
        } catch (fallbackErr: any) {
          if (!isQuotaError(fallbackErr)) {
            throw fallbackErr;
          }

          console.warn(
            `[AI Serverless] Tier 2 (${FALLBACK_MODEL}) search tool or request quota exceeded. Falling back to Tier 3 (Searchless mode)...`,
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

          console.log(`[AI Serverless] Tier 3: Trying fallback model (${FALLBACK_MODEL}) WITHOUT search grounding...`);
          return await aiInstance.models.generateContent(searchlessParams);
        }
      }
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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
    
    // Extract JSON in case model includes triple backticks
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}') + 1;
    let jsonString = text.slice(jsonStart, jsonEnd);
    
    // Fallback if formatting was slightly off
    if (!jsonString || jsonStart === -1) {
        jsonString = text.replace(/```json\n?|\n?```/g, '');
    }
    
    if (!jsonString) throw new Error("AI did not return a valid JSON structure.");
    
    const parsedData = JSON.parse(jsonString);
    
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

    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Serverless Function Error:', error.message || error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

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

// Global scope helper for html entity decoding
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
