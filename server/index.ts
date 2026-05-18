import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(express.json({ limit: '1mb' }));

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

// Error handling middleware
const errorHandler = (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Backend Error:', err.message || err);
  res.status(500).json({ error: 'Internal Server Error' });
};

// Routes
app.post('/api/analyze', async (req, res, next) => {
  try {
    const { input } = req.body;

    if (!input || typeof input !== 'string') {
       res.status(400).json({ error: 'Invalid input provided' });
       return;
    }

    if (input.trim().length < 30) {
       res.status(400).json({ error: 'Input too short for analysis' });
       return;
    }

    const ai = getGeminiAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Analyze the following news content for credibility. 

NEWS CONTENT:
${input}

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
    const jsonString = text.slice(jsonStart, jsonEnd);
    
    if (!jsonString) throw new Error("AI did not return a valid JSON structure.");
    
    const parsedData = JSON.parse(jsonString);
    
    // Attach metadata securely on the backend
    const result = {
      ...parsedData,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      content_snippet: input.substring(0, 100) + (input.length > 100 ? "..." : "")
    };

    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Secure backend server running on http://localhost:${port}`);
});
