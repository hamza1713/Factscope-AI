export interface Claim {
  claim_text: string;
  verdict: 'TRUE' | 'FALSE' | 'UNPROVEN' | 'CONTEXT_NEEDED';
  reason: string;
  source_title: string;
  source_url: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface AnalysisResult {
  id: string;
  timestamp: string;
  content_snippet: string;
  label: 'REAL' | 'FAKE' | 'MISLEADING' | 'SATIRE' | 'UNVERIFIED';
  confidence: number;
  summary: string;
  explanation: string;
  claims: Claim[];
  sources: GroundingSource[];
}

export const analyzeContent = async (input: string): Promise<AnalysisResult> => {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error || `API Error: ${response.statusText}`);
  }

  const data = await response.json();
  return data as AnalysisResult;
};
