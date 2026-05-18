import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';

// Serverless function handler for Vercel
export default async function handler(req: any, res: any) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { input } = req.body;

    if (!input || typeof input !== 'string') {
       return res.status(400).json({ error: 'Invalid input provided' });
    }

    if (input.trim().length < 30) {
       return res.status(400).json({ error: 'Input too short for analysis' });
    }

    if (!process.env.GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is not set in environment variables");
      return res.status(500).json({ error: 'Server Configuration Error' });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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
      content_snippet: input.substring(0, 100) + (input.length > 100 ? "..." : "")
    };

    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Serverless Function Error:', error.message || error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
