/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from "motion/react";
import {
  AnalysisResult,
  analyzeContent,
  fetchDashboardStats,
  sendChatMessage,
  ChatMessage,
  DashboardStats,
  GroundingSource
} from './geminiServices';
import ApiKeySetup from './components/ApiKeySetup';
import {
  Shield,
  Search,
  Trash2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
  ExternalLink,
  Copy,
  ChevronRight,
  Info,
  Loader2,
  RefreshCw,
  History,
  MessageSquare,
  Send,
  WifiOff,
  ChevronDown,
  Settings,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const EXAMPLES = [
  {
    label: "Fake News Example",
    text: "BREAKING: Scientists confirm that drinking hot lemon water every morning completely cures type 2 diabetes within 30 days. A study from Harvard Medical School involving 50,000 patients showed 100% success rate. Big pharma is trying to suppress this information."
  },
  {
    label: "Credible News Example",
    text: "The global average temperature in 2023 was the highest on record, surpassing previous records by a significant margin according to multiple climate agencies including NASA and NOAA. Scientists warn this trend will continue."
  }
];

const LOADING_MESSAGES = [
  "Scanning content with AI...",
  "Extracting key claims...",
  "Verifying claims with Google Search...",
  "Generating credibility report..."
];

// ─── Markdown Chat Renderer ───────────────────────────────────────────────────
/**
 * Renders a markdown string into rich HTML-like JSX.
 * Handles: headings (h1-h3), bold, italic, inline code, code blocks,
 * numbered lists, bullet lists, blockquotes, horizontal rules, and links.
 */
function MarkdownMessage({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  // Helper: parse inline markdown (bold, italic, code, links)
  const parseInline = (raw: string, keyPrefix: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    // Combined regex for **bold**, *italic*, `code`, [text](url)
    const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\((https?:\/\/[^\)]+)\))/g;
    let last = 0;
    let match: RegExpExecArray | null;
    let idx = 0;

    while ((match = regex.exec(raw)) !== null) {
      if (match.index > last) {
        parts.push(<span key={`${keyPrefix}-t${idx++}`}>{raw.slice(last, match.index)}</span>);
      }
      if (match[2]) {
        parts.push(<strong key={`${keyPrefix}-b${idx++}`} className="font-bold text-slate-100">{match[2]}</strong>);
      } else if (match[3]) {
        parts.push(<em key={`${keyPrefix}-i${idx++}`} className="italic text-slate-300">{match[3]}</em>);
      } else if (match[4]) {
        parts.push(
          <code key={`${keyPrefix}-c${idx++}`} className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-blue-300 font-mono text-[10px]">
            {match[4]}
          </code>
        );
      } else if (match[5] && match[6]) {
        parts.push(
          <a key={`${keyPrefix}-l${idx++}`} href={match[6]} target="_blank" rel="noopener noreferrer"
            className="text-blue-400 underline underline-offset-2 hover:text-blue-300 transition-colors">
            {match[5]}
          </a>
        );
      }
      last = match.index + match[0].length;
    }
    if (last < raw.length) {
      parts.push(<span key={`${keyPrefix}-tail`}>{raw.slice(last)}</span>);
    }
    return parts;
  };

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block ──────────────────────────────────────────────────
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={`code-${i}`} className="my-3 rounded-lg bg-slate-950 border border-slate-800 p-3 overflow-x-auto">
          {lang && (
            <div className="text-[9px] font-mono font-bold uppercase tracking-widest text-slate-600 mb-2">{lang}</div>
          )}
          <code className="text-[11px] font-mono text-green-300 leading-relaxed">{codeLines.join('\n')}</code>
        </pre>
      );
      i++;
      continue;
    }

    // ── Headings ────────────────────────────────────────────────────────────
    const h1 = line.match(/^#{1}\s+(.+)/);
    const h2 = line.match(/^#{2}\s+(.+)/);
    const h3 = line.match(/^#{3}\s+(.+)/);

    if (h1) {
      elements.push(
        <h2 key={`h1-${i}`} className="text-base font-black text-white mt-4 mb-2 pb-1 border-b border-slate-700">
          {parseInline(h1[1], `h1-${i}`)}
        </h2>
      );
      i++; continue;
    }
    if (h2) {
      elements.push(
        <h3 key={`h2-${i}`} className="text-sm font-bold text-slate-100 mt-3 mb-1.5">
          {parseInline(h2[1], `h2-${i}`)}
        </h3>
      );
      i++; continue;
    }
    if (h3) {
      elements.push(
        <h4 key={`h3-${i}`} className="text-xs font-bold text-blue-300 mt-2.5 mb-1 uppercase tracking-wide">
          {parseInline(h3[1], `h3-${i}`)}
        </h4>
      );
      i++; continue;
    }

    // ── Horizontal Rule ──────────────────────────────────────────────────────
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      elements.push(<hr key={`hr-${i}`} className="my-3 border-slate-700" />);
      i++; continue;
    }

    // ── Blockquote ───────────────────────────────────────────────────────────
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={`bq-${i}`} className="my-2 pl-3 border-l-2 border-blue-500 text-slate-400 italic text-[11px] leading-relaxed">
          {parseInline(line.slice(2), `bq-${i}`)}
        </blockquote>
      );
      i++; continue;
    }

    // ── Numbered list ─────────────────────────────────────────────────────────
    if (/^\d+\.\s/.test(line)) {
      const listItems: React.ReactNode[] = [];
      let num = 1;
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        const content = lines[i].replace(/^\d+\.\s/, '');
        listItems.push(
          <li key={`li-${i}`} className="flex gap-2 items-start leading-relaxed">
            <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-[9px] font-bold text-blue-400 mt-0.5">
              {num++}
            </span>
            <span className="text-slate-300 text-[11px]">{parseInline(content, `li-${i}`)}</span>
          </li>
        );
        i++;
      }
      elements.push(<ol key={`ol-${i}`} className="my-2 space-y-2 pl-0">{listItems}</ol>);
      continue;
    }

    // ── Bullet list ───────────────────────────────────────────────────────────
    if (/^[-*•]\s/.test(line)) {
      const bulletItems: React.ReactNode[] = [];
      while (i < lines.length && /^[-*•]\s/.test(lines[i])) {
        const content = lines[i].replace(/^[-*•]\s/, '');
        bulletItems.push(
          <li key={`bl-${i}`} className="flex gap-2 items-start leading-relaxed">
            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5"></span>
            <span className="text-slate-300 text-[11px]">{parseInline(content, `bl-${i}`)}</span>
          </li>
        );
        i++;
      }
      elements.push(<ul key={`ul-${i}`} className="my-2 space-y-1.5 pl-0">{bulletItems}</ul>);
      continue;
    }

    // ── Empty line ────────────────────────────────────────────────────────────
    if (line.trim() === '') {
      elements.push(<div key={`gap-${i}`} className="h-1.5" />);
      i++; continue;
    }

    // ── Default paragraph ─────────────────────────────────────────────────────
    elements.push(
      <p key={`p-${i}`} className="text-[11px] leading-relaxed text-slate-300">
        {parseInline(line, `p-${i}`)}
      </p>
    );
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

// ─── sessionStorage keys ─────────────────────────────────────────────────────
const SS_INPUT      = 'fs_input';
const SS_INPUT_TYPE = 'fs_input_type';
const SS_ANALYZING  = 'fs_was_analyzing';

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  // Initialize from sessionStorage so a page reload never loses the user's work
  const [input, setInput] = useState(() => sessionStorage.getItem(SS_INPUT) ?? '');
  const [inputType, setInputType] = useState<'text' | 'url'>(
    () => (sessionStorage.getItem(SS_INPUT_TYPE) === 'url' ? 'url' : 'text')
  );
  const [loading, setLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // analysisError is shown in the main content panel (separate from sidebar error)
  const [analysisError, setAnalysisError] = useState<string | null>(
    // If the page reloaded while an analysis was in progress, surface a recovery message
    () => sessionStorage.getItem(SS_ANALYZING) === 'true'
      ? 'The page reloaded while analysis was running. Your input has been preserved — click “Try Again” to resubmit.'
      : null
  );
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [copied, setCopied] = useState(false);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  // Ref to abort in-flight analyze requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Dashboard
  const [showDashboard, setShowDashboard] = useState(false);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatSources, setChatSources] = useState<GroundingSource[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  // ── Electron desktop integration ──────────────────────────────────────────
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
  const [showApiKeySetup, setShowApiKeySetup] = useState(false);
  const [isFirstLaunch, setIsFirstLaunch] = useState(false);

  // Check on mount if we're in Electron and need the first-launch setup screen
  useEffect(() => {
    if (!isElectron || !window.electronAPI) return;
    window.electronAPI.isFirstLaunch().then((firstLaunch) => {
      if (firstLaunch) {
        setIsFirstLaunch(true);
        setShowApiKeySetup(true);
      }
    });
  }, [isElectron]);

  // Listen for the "open-settings" IPC event triggered by the app menu (Ctrl+,)
  useEffect(() => {
    if (!isElectron) return;
    const ipcRenderer = (window as any).ipcRenderer;
    // Use a custom event dispatched by the preload for menu-triggered settings
    const handler = () => setShowApiKeySetup(true);
    window.addEventListener('electron-open-settings', handler);
    return () => window.removeEventListener('electron-open-settings', handler);
  }, [isElectron]);

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  // Reset chat when result changes
  useEffect(() => {
    setChatMessages([]);
    setChatInput('');
    setChatError(null);
    setChatSources([]);
  }, [result]);

  // ── Persist input to sessionStorage so page reloads never clear the user's work ──
  useEffect(() => { sessionStorage.setItem(SS_INPUT, input); }, [input]);
  useEffect(() => { sessionStorage.setItem(SS_INPUT_TYPE, inputType); }, [inputType]);

  // ── Track in-progress analyses so a reload surfaces a recovery message ──────
  useEffect(() => {
    sessionStorage.setItem(SS_ANALYZING, loading ? 'true' : 'false');
    // Once analysis finishes successfully, clear the interrupted flag
    if (!loading) sessionStorage.removeItem(SS_ANALYZING);
  }, [loading]);

  // ── Backend health check on mount ─────────────────────────────────────────
  useEffect(() => {
    const checkHealth = async () => {
      try {
        let url = '/api/dashboard';
        if (window.electronAPI && typeof window.electronAPI.getServerUrl === 'function') {
          const apiBaseUrl = await window.electronAPI.getServerUrl();
          url = `${apiBaseUrl}/api/dashboard`;
        }
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        setBackendOnline(res.ok || res.status !== 404);
      } catch {
        setBackendOnline(false);
      }
    };
    checkHealth();
  }, []);

  // Loading message rotation
  useEffect(() => {
    let interval: number;
    if (loading) {
      interval = window.setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
      }, 2000);
    } else {
      setLoadingMessageIndex(0);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const loadDashboard = useCallback(async () => {
    setShowDashboard(true);
    setDashboardLoading(true);
    setDashboardError(null);
    setResult(null);
    try {
      const stats = await fetchDashboardStats();
      setDashboardStats(stats);
      setBackendOnline(true);
    } catch (err: any) {
      console.error(err);
      setDashboardError("Failed to load dashboard metrics. " + (err.message || ''));
      if (err.message?.includes('Not Found') || err.message?.includes('Failed to fetch')) {
        setBackendOnline(false);
      }
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const handleSendChatMessage = useCallback(async () => {
    if (!chatInput.trim() || !result || chatLoading) return;

    const userMessage: ChatMessage = { role: 'user', text: chatInput.trim() };
    const historySnapshot = [...chatMessages];

    // Optimistic UI update
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');
    setChatLoading(true);
    setChatError(null);

    try {
      const reply = await sendChatMessage(userMessage.text, historySnapshot, result);
      setChatMessages(prev => [...prev, { role: 'model', text: reply.text }]);
      setChatSources(reply.sources || []);
      setBackendOnline(true);
      // Re-focus input for faster follow-ups
      setTimeout(() => chatInputRef.current?.focus(), 50);
    } catch (err: any) {
      console.error(err);
      // Roll back the optimistic message so user can retry
      setChatMessages(historySnapshot);
      setChatInput(userMessage.text);
      setChatError("Message delivery failed. " + (err.message || 'Check that the backend server is running.'));
      if (err.message?.includes('Not Found') || err.message?.includes('Failed to fetch')) {
        setBackendOnline(false);
      }
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, chatMessages, result, chatLoading]);

  const handleAnalyze = useCallback(async () => {
    if (loading) return;
    if (inputType === 'text') {
      if (input.trim().length < 50) {
        setError("Please enter at least 50 characters for accurate analysis.");
        return;
      }
    } else {
      try {
        new URL(input);
      } catch (_) {
        setError("Please enter a valid absolute URL (e.g. https://example.com/article).");
        return;
      }
    }

    // Cancel any previous in-flight request
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(null);
    setAnalysisError(null);
    setResult(null);

    try {
      const data = await analyzeContent(input, inputType === 'url', abortControllerRef.current.signal);
      setResult(data);
      setHistory(prev => [data, ...prev.slice(0, 4)]);
      setShowDashboard(false);
      setBackendOnline(true);
      setAnalysisError(null);
    } catch (err: any) {
      // Ignore abort errors (user navigated away or re-submitted)
      if (err.name === 'AbortError') return;
      console.error('Analysis error:', err);
      const isConnectionError = err.message?.includes('Failed to fetch') ||
        err.message?.includes('NetworkError') ||
        err.message?.includes('Load failed') ||
        err.message?.includes('ERR_CONNECTION_REFUSED');
      const isServerRestart = err.message?.includes('ECONNRESET') ||
        err.message?.includes('socket hang up') ||
        err.message?.includes('fetch failed');

      let userMessage: string;
      if (isConnectionError || isServerRestart) {
        userMessage = 'Connection to the backend was lost mid-analysis. This usually happens when the server restarted. Your result may have been cached — try clicking Analyze again.';
        setBackendOnline(false);
      } else if (err.message?.includes('timed out') || err.name === 'TimeoutError') {
        userMessage = 'The analysis took too long (>90s). The AI may be overloaded. Please try again in a moment.';
      } else {
        userMessage = err.message || 'An unexpected error occurred. Please try again.';
      }

      setAnalysisError(userMessage);
      setError('Analysis failed — see main panel for details.');
    } finally {
      setLoading(false);
    }
  }, [input, inputType, loading]);

  const handleClear = useCallback(() => {
    setInput('');
    setError(null);
    setResult(null);
  }, []);

  const handleCopyResults = useCallback(() => {
    if (!result) return;
    const report = `Factscope-AI Analysis Report
=======================
Verdict: ${result.label} (Confidence: ${result.confidence}%)

Summary:
${result.summary}

Key Claims Verified:
${result.claims.map((c, i) => `${i + 1}. [${c.verdict}] ${c.claim_text}
   Reason: ${c.reason}
   Source: ${c.source_title} (${c.source_url})`).join('\n\n')}

Analysis & Reasoning:
${result.explanation}

Grounding Sources:
${result.sources.map((s, i) => `${i + 1}. ${s.title} - ${s.uri}`).join('\n')}

Generated on: ${new Date(result.timestamp).toLocaleString()}
ID: ${result.id}
`;
    navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

  const getLabelColor = (label: string) => {
    switch (label) {
      case 'REAL': return 'text-green-500 border-green-500/30 bg-green-950/10 shadow-green-900/20';
      case 'FAKE': return 'text-red-500 border-red-500/30 bg-red-950/10 shadow-red-900/20';
      case 'MISLEADING': return 'text-orange-500 border-orange-500/30 bg-orange-950/10 shadow-orange-900/20';
      case 'SATIRE': return 'text-yellow-500 border-yellow-500/30 bg-yellow-950/10 shadow-yellow-900/20';
      default: return 'text-slate-500 border-slate-500/30 bg-slate-950/10 shadow-slate-900/20';
    }
  };

  const getVerdictBadge = (verdict: string) => {
    switch (verdict) {
      case 'TRUE': return <span className="rounded bg-green-500/20 px-2 py-0.5 text-[9px] font-bold text-green-400">TRUE</span>;
      case 'FALSE': return <span className="rounded bg-red-500/20 px-2 py-0.5 text-[9px] font-bold text-red-400">FALSE</span>;
      case 'CONTEXT_NEEDED': return <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[9px] font-bold text-amber-400">CONTEXT NEEDED</span>;
      default: return <span className="rounded bg-slate-500/20 px-2 py-0.5 text-[9px] font-bold text-slate-400 uppercase">UNPROVEN</span>;
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden font-sans text-slate-200 bg-[#0f172a]">

      {/* ── Electron: First-launch API key setup / Settings modal ────────────── */}
      {showApiKeySetup && (
        <ApiKeySetup
          isModal={!isFirstLaunch}
          currentKey={null}
          onSave={(key) => {
            setIsFirstLaunch(false);
            setShowApiKeySetup(false);
            // Small delay to let the server pick up the new key
            setTimeout(() => setBackendOnline(null), 500);
          }}
          onClose={isFirstLaunch ? undefined : () => setShowApiKeySetup(false)}
        />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-80 flex-col border-r border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/20">
            <Shield className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold tracking-tight text-white leading-tight">Factscope-AI</h1>
            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">AI Fact Verification</p>
          </div>
          {/* Settings button (Electron desktop only) */}
          {isElectron && (
            <button
              onClick={() => setShowApiKeySetup(true)}
              title="Settings (Ctrl+,)"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-all"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto pr-1">
          {/* Backend status indicator */}
          {backendOnline === false && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 p-2.5 rounded-lg border border-red-500/30 bg-red-500/10 text-[10px] text-red-400"
            >
              <WifiOff className="w-3 h-3 shrink-0" />
              <span>Backend offline. Run <code className="font-mono bg-slate-900 px-1 rounded">npm run dev</code> to start both servers.</span>
            </motion.div>
          )}

          <button
            onClick={loadDashboard}
            className={`w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all border ${showDashboard ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20' : 'border-slate-800 bg-slate-900/30 text-slate-400 hover:bg-slate-850 hover:text-slate-200'}`}
          >
            <History className="w-3.5 h-3.5" />
            Global Dashboard
          </button>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Analyze Content</label>
              <div className="flex gap-2 bg-slate-950 p-0.5 rounded border border-slate-800">
                <button
                  onClick={() => { setInputType('text'); setInput(''); setError(null); }}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider transition-colors ${inputType === 'text' ? 'bg-blue-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  Text
                </button>
                <button
                  onClick={() => { setInputType('url'); setInput(''); setError(null); }}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider transition-colors ${inputType === 'url' ? 'bg-blue-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  URL
                </button>
              </div>
            </div>

            <div className="relative">
              {inputType === 'text' ? (
                <textarea
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs leading-relaxed text-slate-300 placeholder:text-slate-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all resize-none"
                  placeholder="Paste news article or social media post here..."
                  rows={10}
                  value={input}
                  onChange={(e) => setInput(e.target.value.slice(0, 5000))}
                  onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleAnalyze(); }}
                />
              ) : (
                <input
                  type="url"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs leading-relaxed text-slate-300 placeholder:text-slate-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                  placeholder="Paste news article URL (e.g. https://...)"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAnalyze(); }}
                />
              )}
              {input.length > 0 && (
                <button
                  onClick={() => setInput('')}
                  className="absolute top-2 right-2 p-1 text-slate-600 hover:text-red-400 transition-colors"
                  title="Clear input"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between text-[10px] font-medium text-slate-500">
              <span>{inputType === 'text' ? `${input.length} / 5000 chars` : 'URL Mode'}</span>
              {inputType === 'text' && (
                <span className="text-slate-600">Ctrl+Enter to analyze</span>
              )}
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="p-2 border border-red-500/30 bg-red-500/10 rounded text-[10px] text-red-400 flex items-start gap-2"
                >
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            disabled={loading || !input.trim()}
            onClick={handleAnalyze}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-sm font-bold text-white transition-all hover:bg-blue-500 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 shadow-lg shadow-blue-900/20"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-white" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {loading ? 'Analyzing...' : 'Analyze Now'}
          </button>

          {/* Demo Examples */}
          <div className="space-y-3 pt-4 border-t border-slate-800">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Demo Examples</p>
            <div className="space-y-2">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => { setInputType('text'); setInput(ex.text); }}
                  className="w-full text-left p-2.5 rounded-lg border border-slate-800 bg-slate-900/30 hover:bg-slate-800 hover:border-slate-700 transition-all group"
                >
                  <p className="text-[10px] font-bold text-slate-400 mb-1 flex items-center gap-2">
                    <ChevronRight className="w-3 h-3 text-blue-500 group-hover:translate-x-0.5 transition-transform" />
                    {ex.label}
                  </p>
                  <p className="text-[9px] text-slate-500 line-clamp-2 italic leading-relaxed">"{ex.text}"</p>
                </button>
              ))}
            </div>
          </div>

          {/* Session History */}
          {history.length > 0 && (
            <div className="space-y-3 pt-4 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Session History ({history.length})</p>
                <button onClick={() => setHistory([])} className="text-[10px] text-slate-600 hover:text-red-400 transition-colors">Clear</button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {history.map((h, i) => (
                  <div
                    key={i}
                    onClick={() => { setResult(h); setShowDashboard(false); }}
                    className="cursor-pointer rounded border border-slate-800 bg-slate-900/80 p-2 hover:bg-slate-800 transition-colors group"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className={`rounded px-1.5 py-0.5 text-[8px] font-bold ${h.label === 'REAL' ? 'bg-green-500/10 text-green-400' : h.label === 'FAKE' ? 'bg-red-500/10 text-red-400' : 'bg-orange-500/10 text-orange-400'}`}>
                        {h.label}
                      </span>
                      <span className="text-[8px] text-slate-600 font-mono">{new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p className="truncate text-[10px] text-slate-400 group-hover:text-slate-300">"{h.content_snippet}"</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main Content ──────────────────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden">

        {/* Top Header */}
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/50 px-6 py-3 shrink-0">
          <div className="flex items-center gap-4 text-[10px] uppercase font-bold tracking-widest text-slate-500">
            <span className="flex items-center gap-2">Engine: <span className="text-blue-400">Gemini 2.5 Flash</span></span>
            <span className="h-1 w-1 rounded-full bg-slate-700"></span>
            <span className="flex items-center gap-2">Grounding: <span className="text-green-400">Google Search</span></span>
            {backendOnline !== null && (
              <>
                <span className="h-1 w-1 rounded-full bg-slate-700"></span>
                <span className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${backendOnline ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`}></span>
                  <span className={backendOnline ? 'text-green-400' : 'text-red-400'}>
                    {backendOnline ? 'API Online' : 'API Offline'}
                  </span>
                </span>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              disabled={!result || copied}
              onClick={handleCopyResults}
              className={`flex items-center gap-2 rounded border px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-50 ${copied ? 'border-green-500/50 bg-green-500/10 text-green-400' : 'border-slate-700 bg-slate-900/50 text-slate-400 hover:bg-slate-800 hover:text-white'}`}
            >
              {copied ? (
                <><CheckCircle2 className="w-3 h-3" /> Copied!</>
              ) : (
                <><Copy className="w-3 h-3" /> Copy Report</>
              )}
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <AnimatePresence mode="wait">

            {/* ── Dashboard ── */}
            {showDashboard ? (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <div>
                    <h2 className="text-xl font-bold text-white">Global Analytics Dashboard</h2>
                    <p className="text-xs text-slate-500">Live summary of credibility statistics and debunked claims from historical records.</p>
                  </div>
                  <button
                    onClick={() => setShowDashboard(false)}
                    className="px-3 py-1.5 rounded border border-slate-800 bg-slate-900 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white transition-all"
                  >
                    Back to Check
                  </button>
                </div>

                {dashboardLoading ? (
                  <div className="h-64 flex flex-col items-center justify-center space-y-3">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                    <p className="text-xs text-slate-500 font-bold uppercase tracking-widest animate-pulse">Loading Database Metrics...</p>
                  </div>
                ) : dashboardError ? (
                  <div className="h-64 flex flex-col items-center justify-center space-y-3 max-w-sm mx-auto text-center">
                    <AlertCircle className="w-10 h-10 text-red-500" />
                    <p className="text-xs text-red-400">{dashboardError}</p>
                    <button onClick={loadDashboard} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-xs font-bold text-white transition-all">Retry</button>
                  </div>
                ) : dashboardStats ? (
                  <div className="space-y-6">
                    {/* Stats Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-5 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Checks Registered</p>
                          <p className="text-3xl font-black text-white mt-1">{dashboardStats.totalChecks}</p>
                        </div>
                        <div className="w-12 h-12 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
                          <Shield className="w-6 h-6 text-blue-500" />
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-5 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Average Analysis Confidence</p>
                          <p className="text-3xl font-black text-white mt-1">{dashboardStats.averageConfidence}%</p>
                        </div>
                        <div className="w-12 h-12 rounded-lg bg-green-600/10 border border-green-500/20 flex items-center justify-center">
                          <CheckCircle2 className="w-6 h-6 text-green-500" />
                        </div>
                      </div>
                    </div>

                    {/* Main Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Verdict Distribution */}
                      <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-5 space-y-4">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Verdict Distribution</h3>
                        <div className="space-y-3.5">
                          {Object.entries(dashboardStats.verdictCounts).map(([label, count]) => {
                            const countNum = count as number;
                            const percentage = dashboardStats.totalChecks > 0
                              ? Math.round((countNum / dashboardStats.totalChecks) * 100)
                              : 0;
                            return (
                              <div key={label} className="space-y-1.5">
                                <div className="flex justify-between text-[10px] font-bold text-slate-400">
                                  <span className="flex items-center gap-1.5">
                                    <span className={`w-1.5 h-1.5 rounded-full ${label === 'REAL' ? 'bg-green-500' : label === 'FAKE' ? 'bg-red-500' : label === 'MISLEADING' ? 'bg-orange-500' : label === 'SATIRE' ? 'bg-yellow-500' : 'bg-slate-500'}`}></span>
                                    {label}
                                  </span>
                                  <span>{count} records ({percentage}%)</span>
                                </div>
                                <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800/80">
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${percentage}%` }}
                                    transition={{ duration: 0.8, ease: 'easeOut' }}
                                    className={`h-full rounded-full ${label === 'REAL' ? 'bg-green-500' : label === 'FAKE' ? 'bg-red-500' : label === 'MISLEADING' ? 'bg-orange-500' : label === 'SATIRE' ? 'bg-yellow-500' : 'bg-slate-500'}`}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Debunked Claims */}
                      <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-5 space-y-4">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Debunked Claims</h3>
                        <div className="space-y-3">
                          {dashboardStats.debunkedClaims.length === 0 ? (
                            <p className="text-xs text-slate-600 italic">No fake claims stored in the database yet.</p>
                          ) : (
                            dashboardStats.debunkedClaims.map((claim, idx) => (
                              <div key={idx} className="p-3 rounded-lg bg-slate-950/40 border border-slate-800/80 space-y-1.5">
                                <span className="text-[8px] font-black tracking-widest uppercase bg-red-500/10 text-red-400 px-2 py-0.5 rounded">FALSE CLAIM</span>
                                <p className="text-xs font-bold text-slate-300 leading-snug">"{claim.claim_text}"</p>
                                <p className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed">{claim.reason}</p>
                                {claim.source_url && (
                                  <a href={claim.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[9px] text-blue-400 hover:underline">
                                    Verification Source <ExternalLink className="w-2 h-2" />
                                  </a>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Recent Records */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-5 space-y-4">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Recent Database Records</h3>
                      {dashboardStats.recentAnalyses.length === 0 ? (
                        <p className="text-xs text-slate-600 italic">Database is empty. Submit a claim in the sidebar to register the first record.</p>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                          {dashboardStats.recentAnalyses.map((rec) => (
                            <div
                              key={rec.id}
                              onClick={() => { setResult(rec); setShowDashboard(false); }}
                              className="cursor-pointer p-3.5 rounded-lg border border-slate-800 bg-slate-950/40 hover:bg-slate-850 hover:border-slate-700 transition-all space-y-2 group"
                            >
                              <div className="flex justify-between items-center text-[10px]">
                                <span className={`px-2 py-0.5 rounded text-[8px] font-bold ${rec.label === 'REAL' ? 'bg-green-500/10 text-green-400' : rec.label === 'FAKE' ? 'bg-red-500/10 text-red-400' : 'bg-orange-500/10 text-orange-400'}`}>
                                  {rec.label}
                                </span>
                                <span className="text-slate-600 font-mono">{new Date(rec.timestamp).toLocaleDateString()}</span>
                              </div>
                              <p className="text-xs font-bold text-slate-350 group-hover:text-white line-clamp-1">"{rec.content_snippet}"</p>
                              <p className="text-[10px] text-slate-550 line-clamp-2 leading-relaxed italic">"{rec.summary}"</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </motion.div>

            /* ── Empty / Error State ── */
            ) : !result && !loading ? (
              analysisError ? (
                /* ── Analysis Failed State (shown in main panel) ── */
                <motion.div
                  key="error"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="h-full flex flex-col items-center justify-center text-center space-y-6 max-w-lg mx-auto"
                >
                  <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                    <AlertCircle className="w-10 h-10 text-red-500" />
                  </div>
                  <div className="space-y-3">
                    <h2 className="text-xl font-bold text-red-400">Analysis Failed</h2>
                    <p className="text-sm text-slate-400 leading-relaxed">{analysisError}</p>
                  </div>
                  <div className="flex flex-col gap-3 w-full max-w-xs">
                    <button
                      onClick={() => { setAnalysisError(null); handleAnalyze(); }}
                      className="flex items-center justify-center gap-2 w-full rounded-lg bg-blue-600 hover:bg-blue-500 py-3 text-sm font-bold text-white transition-all active:scale-95 shadow-lg shadow-blue-900/20"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Try Again
                    </button>
                    <button
                      onClick={() => setAnalysisError(null)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 text-xs font-bold text-slate-400 hover:text-white transition-all"
                    >
                      Dismiss
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-600 italic">
                    Tip: If this happens repeatedly, run <code className="font-mono bg-slate-900 px-1 py-0.5 rounded text-slate-400">npm run dev</code> to restart both servers.
                  </p>
                </motion.div>
              ) : (
                /* ── Default Empty State ── */
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full flex flex-col items-center justify-center text-center space-y-6"
                >
                  <div className="w-24 h-24 bg-slate-900/50 rounded-full flex items-center justify-center border border-slate-800 shadow-inner">
                    <Info className="w-10 h-10 text-slate-700" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-bold text-slate-300">Ready for Analysis</h2>
                    <p className="text-sm text-slate-500 max-w-sm mx-auto">Paste a news article or claim in the sidebar to perform a deep credibility check using Gemini AI and Google Search grounding.</p>
                  </div>
                </motion.div>
              )

            /* ── Loading State ── */
            ) : loading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full flex flex-col items-center justify-center"
              >
                <div className="relative mb-8">
                  <div className="w-20 h-20 border-2 border-blue-500/10 rounded-full"></div>
                  <div className="absolute inset-0 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <div className="absolute inset-4 border-2 border-purple-500 border-b-transparent rounded-full animate-[spin_1.5s_linear_infinite_reverse]"></div>
                </div>
                <div className="space-y-4 text-center">
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={loadingMessageIndex}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="text-lg font-bold text-blue-400 tracking-tight"
                    >
                      {LOADING_MESSAGES[loadingMessageIndex]}
                    </motion.p>
                  </AnimatePresence>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">Performing Deep Verification...</p>
                </div>
              </motion.div>

            /* ── Results ── */
            ) : result ? (
              <motion.div
                key="results"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-6"
              >
                {/* Verdict + Confidence */}
                <div className="flex flex-col lg:flex-row items-stretch gap-4">
                  <div className={`relative flex flex-1 flex-col items-center justify-center rounded-2xl border ${getLabelColor(result.label)} p-8 shadow-2xl`}>
                    <div className="absolute left-4 top-4 font-mono text-[9px] uppercase tracking-widest text-slate-500 opacity-60">ID: {result.id}</div>
                    <div className="absolute right-4 top-4 font-mono text-[9px] uppercase tracking-widest text-slate-500 opacity-60 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" /> {new Date(result.timestamp).toLocaleTimeString()}
                    </div>
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", damping: 12 }}
                      className="mb-2 text-6xl font-black tracking-tighter"
                    >
                      {result.label}
                    </motion.div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Overall Credibility Verdict</p>
                  </div>
                  <div className="flex w-full lg:w-72 flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-center shadow-xl">
                    <ConfidenceGauge score={result.confidence} colorClass={getLabelColor(result.label).split(' ')[0]} />
                  </div>
                </div>

                {/* Detail Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-6">
                    {/* Summary */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 shadow-lg">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1 h-3 bg-blue-500 rounded-full"></div>
                        <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">Content Summary</h3>
                      </div>
                      <p className="text-sm leading-relaxed text-slate-300 italic">"{result.summary}"</p>
                    </div>

                    {/* Claims */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 shadow-lg">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-1 h-3 bg-purple-500 rounded-full"></div>
                        <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">Key Claims Verification</h3>
                      </div>
                      <div className="space-y-5">
                        {result.claims.map((claim, idx) => (
                          <div key={idx} className={`space-y-2 pb-4 ${idx < result.claims.length - 1 ? 'border-b border-slate-800' : ''}`}>
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-bold italic text-slate-500 uppercase text-[9px] tracking-tight">Claim {String(idx + 1).padStart(2, '0')}</span>
                              {getVerdictBadge(claim.verdict)}
                            </div>
                            <p className="text-sm font-bold text-slate-200 leading-snug">"{claim.claim_text}"</p>
                            <p className="text-[11px] leading-relaxed text-slate-400">{claim.reason}</p>
                            <a
                              href={claim.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors group"
                            >
                              <span className="opacity-50">Source:</span> {claim.source_title}
                              <ExternalLink className="w-2.5 h-2.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    {/* Reasoning */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 shadow-lg bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.03),transparent_40%)]">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-1 h-3 bg-orange-500 rounded-full"></div>
                        <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">AI Analysis & Reasoning</h3>
                      </div>
                      <p className="text-[11px] leading-relaxed italic text-slate-400 underline decoration-slate-800 decoration-dotted underline-offset-4 decoration-2">
                        {result.explanation}
                      </p>
                    </div>

                    {/* Grounding Sources */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 shadow-lg">
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-1 h-3 bg-green-500 rounded-full"></div>
                        <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">Grounding Sources</h3>
                      </div>
                      <ul className="space-y-2">
                        {result.sources.map((source, idx) => (
                          <li key={idx} className="flex items-start gap-3 group">
                            <div className="mt-1 p-1 rounded bg-slate-800/50 border border-slate-700/50">
                              <ExternalLink className="h-2.5 w-2.5 text-slate-500 group-hover:text-blue-400 transition-colors" />
                            </div>
                            <a
                              href={source.uri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-400 hover:text-blue-300 hover:underline transition-colors leading-snug"
                            >
                              {source.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                {/* ── Chat Section ── */}
                <div className="mt-8 rounded-xl border border-slate-800 bg-slate-950/40 p-5 shadow-2xl">
                  <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
                    <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">Contextual Follow-up Chat</h3>
                    {chatMessages.length > 0 && (
                      <span className="ml-auto text-[9px] font-mono font-bold bg-slate-900 border border-slate-800 text-slate-500 px-1.5 py-0.5 rounded">
                        {chatMessages.length} msg{chatMessages.length > 1 ? 's' : ''}
                      </span>
                    )}
                    {chatMessages.length > 0 && (
                      <button
                        onClick={() => { setChatMessages([]); setChatSources([]); setChatError(null); }}
                        className="text-[9px] font-bold text-slate-600 hover:text-red-400 transition-colors uppercase tracking-wider"
                        title="Clear chat history"
                      >
                        Clear
                      </button>
                    )}
                    <span className="text-[9px] uppercase tracking-wider text-slate-600 bg-slate-900 px-1.5 py-0.5 rounded font-mono font-bold">
                      Grounding Active
                    </span>
                  </div>

                  {/* Message Thread */}
                  <div className="space-y-3 max-h-[480px] min-h-[120px] overflow-y-auto pr-2 mb-4 flex flex-col scroll-smooth">
                    {chatMessages.length === 0 ? (
                      <p className="text-xs text-slate-600 italic py-6 text-center">
                        Ask follow-up questions about this report — e.g. "How was the confidence score determined?" or "Are there any counter-claims?"
                      </p>
                    ) : (
                      chatMessages.map((msg, idx) => (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2 }}
                          className={`flex flex-col rounded-xl p-4 ${
                            msg.role === 'user'
                              ? 'self-end max-w-[75%] bg-blue-600/15 border border-blue-500/25 text-blue-100'
                              : 'self-start w-full bg-slate-900/70 border border-slate-800'
                          }`}
                        >
                          <span className={`text-[8px] font-mono uppercase font-bold mb-2 ${msg.role === 'user' ? 'text-blue-400' : 'text-slate-500'}`}>
                            {msg.role === 'user' ? '▲ You' : '◆ Factscope AI'}
                          </span>
                          {msg.role === 'user' ? (
                            <p className="text-xs leading-relaxed">{msg.text}</p>
                          ) : (
                            <MarkdownMessage text={msg.text} />
                          )}
                        </motion.div>
                      ))
                    )}

                    {/* Typing Indicator */}
                    {chatLoading && (
                      <div className="self-start bg-slate-900/70 border border-slate-800 rounded-xl p-4 flex items-center gap-3 text-xs text-slate-500">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 shrink-0" />
                        <span>Searching sources & composing reply...</span>
                      </div>
                    )}

                    {/* Scroll anchor */}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Cited Sources */}
                  <AnimatePresence>
                    {chatSources.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mb-4 p-3 rounded-lg border border-slate-800 bg-slate-900/30 text-[10px] text-slate-450 space-y-1.5 overflow-hidden"
                      >
                        <span className="font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                          <ExternalLink className="w-2.5 h-2.5" /> Cited in Answer:
                        </span>
                        <ul className="space-y-1">
                          {chatSources.map((src, i) => (
                            <li key={i} className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
                              <a href={src.uri} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate">
                                {src.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Error Banner */}
                  <AnimatePresence>
                    {chatError && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mb-3 p-3 border border-red-500/30 bg-red-500/10 rounded-lg text-[10px] text-red-400 flex items-start gap-2 overflow-hidden"
                      >
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold">Failed to send message</p>
                          <p className="opacity-80 mt-0.5">{chatError}</p>
                        </div>
                        <button onClick={() => setChatError(null)} className="ml-auto text-red-500 hover:text-red-300">
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Input Box */}
                  <div className="flex gap-2 items-end">
                    <input
                      ref={chatInputRef}
                      type="text"
                      disabled={chatLoading}
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) handleSendChatMessage(); }}
                      placeholder="Ask a follow-up question... (Enter to send)"
                      className="flex-1 rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300 placeholder:text-slate-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all disabled:opacity-50"
                    />
                    <button
                      disabled={chatLoading || !chatInput.trim()}
                      onClick={handleSendChatMessage}
                      className="flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-3 text-xs font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Send
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between border-t border-slate-800 bg-slate-950 px-6 py-4 text-[10px] text-slate-500 shrink-0">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">Powered by <span className="font-bold text-slate-300">Google Gemini AI</span></span>
            <span className="h-3 w-px bg-slate-800"></span>
            <span className="flex items-center gap-1.5 font-bold uppercase tracking-widest">Analyses: <span className="text-blue-500">{history.length}</span></span>
          </div>
          <p className="italic max-w-md text-right opacity-60">Analysis results are generated based on search grounding. Verify critical data independently.</p>
        </footer>
      </main>
    </div>
  );
}

// ─── Confidence Gauge ─────────────────────────────────────────────────────────

function ConfidenceGauge({ score, colorClass }: { score: number; colorClass: string }) {
  const strokeColor =
    colorClass === 'text-red-500' ? 'stroke-red-500' :
    colorClass === 'text-green-500' ? 'stroke-green-500' :
    colorClass === 'text-orange-500' ? 'stroke-orange-500' :
    colorClass === 'text-yellow-500' ? 'stroke-yellow-500' :
    'stroke-blue-500';

  return (
    <div className="relative h-32 w-32 flex flex-col items-center justify-center">
      <svg className="h-32 w-32 drop-shadow-[0_0_15px_rgba(30,41,59,0.5)]" viewBox="0 0 36 36">
        <path
          className="stroke-slate-800"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          strokeWidth="2.5"
        />
        <motion.path
          initial={{ strokeDasharray: "0, 100" }}
          animate={{ strokeDasharray: `${score}, 100` }}
          transition={{ duration: 2, ease: "easeOut" }}
          className={strokeColor}
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black text-white">{score}%</span>
        <span className="text-[9px] uppercase font-black tracking-widest text-slate-500">Confidence</span>
      </div>
    </div>
  );
}
