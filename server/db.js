"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setDbPath = setDbPath;
exports.getAnalyses = getAnalyses;
exports.saveAnalysis = saveAnalysis;
exports.getCachedAnalysis = getCachedAnalysis;
exports.getDashboardStats = getDashboardStats;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ─── Database file path ──────────────────────────────────────────────────────
// Default: store OUTSIDE the server/ directory so tsx watch and Vite's
// file watcher do not restart/reload the app when analysis results are saved.
// In Electron packaged mode, this is overridden to use the OS userData directory
// (e.g., %APPDATA%/factscope-ai/ on Windows) via setDbPath().
let DB_FILE = path_1.default.resolve('data/db.json');
/**
 * Override the database file path. Called by Electron's main process to
 * redirect storage to the OS user data directory so data persists across
 * app updates and is not stored inside the app bundle.
 */
function setDbPath(dir) {
    DB_FILE = path_1.default.join(dir, 'db.json');
    console.log(`[DB] Database path set to: ${DB_FILE}`);
    initDb();
}
// Initialize database file
function initDb() {
    try {
        const dir = path_1.default.dirname(DB_FILE);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        if (!fs_1.default.existsSync(DB_FILE)) {
            fs_1.default.writeFileSync(DB_FILE, JSON.stringify({ analyses: [] }, null, 2), 'utf-8');
        }
    }
    catch (err) {
        console.warn('Unable to initialize local JSON database file:', err);
    }
}
// Read database
function getAnalyses() {
    initDb();
    try {
        if (fs_1.default.existsSync(DB_FILE)) {
            const data = fs_1.default.readFileSync(DB_FILE, 'utf-8');
            const parsed = JSON.parse(data);
            return parsed.analyses || [];
        }
    }
    catch (err) {
        console.error('Failed to read database:', err);
    }
    return [];
}
// Save analysis record
function saveAnalysis(record) {
    initDb();
    try {
        const analyses = getAnalyses();
        // Prepend to show latest first
        analyses.unshift(record);
        fs_1.default.writeFileSync(DB_FILE, JSON.stringify({ analyses }, null, 2), 'utf-8');
    }
    catch (err) {
        console.warn('Database write is not supported in this environment (e.g. serverless read-only).');
    }
}
// Check for cached analysis in the last 24 hours
function getCachedAnalysis(input, isUrl) {
    try {
        const analyses = getAnalyses();
        const normalizedInput = input.trim().toLowerCase();
        // Find a matching record
        const match = analyses.find(record => {
            const recordInput = record.original_input.trim().toLowerCase();
            return record.is_url === isUrl && recordInput === normalizedInput;
        });
        if (!match)
            return null;
        // Check if it's less than 24 hours old
        const recordTime = new Date(match.timestamp).getTime();
        const now = Date.now();
        const diffHours = (now - recordTime) / (1000 * 60 * 60);
        if (diffHours < 24) {
            return match;
        }
    }
    catch (err) {
        console.error('Failed checking cached analysis:', err);
    }
    return null;
}
// Get dashboard statistics
function getDashboardStats() {
    const analyses = getAnalyses();
    const totalChecks = analyses.length;
    const verdictCounts = {
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
        }
        else {
            verdictCounts[record.label] = 1;
        }
        totalConfidence += record.confidence;
    });
    const averageConfidence = totalChecks > 0 ? parseFloat((totalConfidence / totalChecks).toFixed(1)) : 0;
    // Recent 10 analyses
    const recentAnalyses = analyses.slice(0, 10);
    // Collect FALSE or MISLEADING claims
    const debunkedClaims = [];
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
//# sourceMappingURL=db.js.map