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

// ─── Dynamic API Base URL ──────────────────────────────────────────────────
let apiBase = '';

if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.getServerUrl === 'function') {
  window.electronAPI.getServerUrl().then((url) => {
    apiBase = url;
  }).catch((err) => {
    console.error('Failed to get Electron server URL:', err);
  });
}

const getUrl = (path: string): string => {
  return `${apiBase}${path}`;
};

export const analyzeContent = async (
  input: string,
  isUrl = false,
  externalSignal?: AbortSignal
): Promise<AnalysisResult> => {
  // Combine caller's AbortSignal with a 90-second timeout
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(new DOMException('Request timed out after 90 seconds', 'TimeoutError')), 90_000);

  // Merge signals: abort if either fires
  const signal = externalSignal
    ? AbortSignal.any
      ? AbortSignal.any([externalSignal, timeoutController.signal])
      : timeoutController.signal
    : timeoutController.signal;

  try {
    const response = await fetch(getUrl('/api/analyze'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, isUrl }),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error || `API Error: ${response.statusText}`);
    }

    return response.json() as Promise<AnalysisResult>;
  } finally {
    clearTimeout(timeoutId);
  }
};

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface ChatResponse {
  text: string;
  sources: GroundingSource[];
}

export interface DashboardStats {
  totalChecks: number;
  verdictCounts: Record<string, number>;
  averageConfidence: number;
  recentAnalyses: AnalysisResult[];
  debunkedClaims: Array<{
    claim_text: string;
    verdict: string;
    reason: string;
    source_url: string;
  }>;
}

export const fetchDashboardStats = async (): Promise<DashboardStats> => {
  const response = await fetch(getUrl('/api/dashboard'));
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error || `API Error: ${response.statusText}`);
  }
  return response.json();
};

export const sendChatMessage = async (
  message: string,
  history: ChatMessage[],
  context: AnalysisResult
): Promise<ChatResponse> => {
  const response = await fetch(getUrl('/api/chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, history, context }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error || `API Error: ${response.statusText}`);
  }

  return response.json();
};
