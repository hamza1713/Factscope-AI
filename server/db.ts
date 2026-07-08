import fs from 'fs';
import path from 'path';

// Define the schema
export interface AnalysisRecord {
  id: string;
  timestamp: string;
  original_input: string;
  content_snippet: string;
  is_url: boolean;
  label: 'REAL' | 'FAKE' | 'MISLEADING' | 'SATIRE' | 'UNVERIFIED';
  confidence: number;
  summary: string;
  explanation: string;
  claims: Array<{
    claim_text: string;
    verdict: 'TRUE' | 'FALSE' | 'UNPROVEN' | 'CONTEXT_NEEDED';
    reason: string;
    source_title: string;
    source_url: string;
  }>;
  sources: Array<{ title: string, uri: string }>;
}

export interface DashboardStats {
  totalChecks: number;
  verdictCounts: Record<string, number>;
  averageConfidence: number;
  recentAnalyses: Array<AnalysisRecord>;
  debunkedClaims: Array<{
    claim_text: string;
    verdict: string;
    reason: string;
    source_url: string;
  }>;
}

// ─── Database file path ──────────────────────────────────────────────────────
// Default: store OUTSIDE the server/ directory so tsx watch and Vite's
// file watcher do not restart/reload the app when analysis results are saved.
// In Electron packaged mode, this is overridden to use the OS userData directory
// (e.g., %APPDATA%/factscope-ai/ on Windows) via setDbPath().
let DB_FILE = path.resolve('data/db.json');

/**
 * Override the database file path. Called by Electron's main process to
 * redirect storage to the OS user data directory so data persists across
 * app updates and is not stored inside the app bundle.
 */
export function setDbPath(dir: string): void {
  DB_FILE = path.join(dir, 'db.json');
  console.log(`[DB] Database path set to: ${DB_FILE}`);
  initDb();
}

// Initialize database file
function initDb() {
  try {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify({ analyses: [] }, null, 2), 'utf-8');
    }
  } catch (err) {
    console.warn('Unable to initialize local JSON database file:', err);
  }
}

// Read database
export function getAnalyses(): AnalysisRecord[] {
  initDb();
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      return parsed.analyses || [];
    }
  } catch (err) {
    console.error('Failed to read database:', err);
  }
  return [];
}

// Save analysis record
export function saveAnalysis(record: AnalysisRecord): void {
  initDb();
  try {
    const analyses = getAnalyses();
    // Prepend to show latest first
    analyses.unshift(record);
    fs.writeFileSync(DB_FILE, JSON.stringify({ analyses }, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Database write is not supported in this environment (e.g. serverless read-only).');
  }
}

// Check for cached analysis in the last 24 hours
export function getCachedAnalysis(input: string, isUrl: boolean): AnalysisRecord | null {
  try {
    const analyses = getAnalyses();
    const normalizedInput = input.trim().toLowerCase();
    
    // Find a matching record
    const match = analyses.find(record => {
      const recordInput = record.original_input.trim().toLowerCase();
      return record.is_url === isUrl && recordInput === normalizedInput;
    });

    if (!match) return null;

    // Check if it's less than 24 hours old
    const recordTime = new Date(match.timestamp).getTime();
    const now = Date.now();
    const diffHours = (now - recordTime) / (1000 * 60 * 60);

    if (diffHours < 24) {
      return match;
    }
  } catch (err) {
    console.error('Failed checking cached analysis:', err);
  }
  return null;
}

// Get dashboard statistics
export function getDashboardStats(): DashboardStats {
  const analyses = getAnalyses();
  const totalChecks = analyses.length;
  
  const verdictCounts: Record<string, number> = {
    REAL: 0,
    FAKE: 0,
    MISLEADING: 0,
    SATIRE: 0,
    UNVERIFIED: 0
  };

  let totalConfidence = 0;
  analyses.forEach(record => {
    if (verdictCounts[record.label] !== undefined) {
      verdictCounts[record.label]++;
    } else {
      verdictCounts[record.label] = 1;
    }
    totalConfidence += record.confidence;
  });

  const averageConfidence = totalChecks > 0 ? parseFloat((totalConfidence / totalChecks).toFixed(1)) : 0;

  // Recent 10 analyses
  const recentAnalyses = analyses.slice(0, 10);

  // Collect FALSE or MISLEADING claims
  const debunkedClaims: Array<{
    claim_text: string;
    verdict: string;
    reason: string;
    source_url: string;
  }> = [];

  analyses.forEach(record => {
    if (record.claims) {
      record.claims.forEach(claim => {
        if (claim.verdict === 'FALSE' && debunkedClaims.length < 5) {
          // Avoid duplicate claims in the list
          const exists = debunkedClaims.some(c => c.claim_text.toLowerCase() === claim.claim_text.toLowerCase());
          if (!exists) {
            debunkedClaims.push({
              claim_text: claim.claim_text,
              verdict: claim.verdict,
              reason: claim.reason,
              source_url: claim.source_url
            });
          }
        }
      });
    }
  });

  return {
    totalChecks,
    verdictCounts,
    averageConfidence,
    recentAnalyses,
    debunkedClaims
  };
}
