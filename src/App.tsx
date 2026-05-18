/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from "motion/react";
import { AnalysisResult, analyzeContent } from './geminiServices';
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
  History
} from "lucide-react";

// Types imported from geminiServices

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

export default function App() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [copied, setCopied] = useState(false);

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

  const handleAnalyze = async () => {
    if (input.trim().length < 50) {
      setError("Please enter at least 30 characters for accurate analysis.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await analyzeContent(input);
      
      setResult(data);
      setHistory(prev => [data, ...prev.slice(0, 4)]);
    } catch (err: any) {
      console.error(err);
      setError("Analysis failed. " + (err.message || 'Error parsing AI response'));
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setInput('');
    setError(null);
    setResult(null);
  };

  const handleCopyResults = () => {
    if (result) {
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
      navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

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
      {/* Sidebar - Analysis Control */}
      <aside className="hidden md:flex w-80 flex-col border-r border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/20">
            <Shield className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white leading-tight">Factscope-AI</h1>
            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">AI Fact Verification</p>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto pr-1">
          <div className="space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Analyze Content</label>
            <div className="relative">
              <textarea
                className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs leading-relaxed text-slate-300 placeholder:text-slate-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all resize-none"
                placeholder="Paste news article or social media post here..."
                rows={10}
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, 5000))}
              />
              <div className="absolute top-2 right-2 flex items-center gap-2 group">
                 {input.length > 0 && (
                   <button 
                     onClick={() => setInput('')}
                     className="p-1 text-slate-600 hover:text-red-400 transition-colors"
                     title="Clear input"
                   >
                     <Trash2 className="w-3.5 h-3.5" />
                   </button>
                 )}
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] font-medium text-slate-500">
              <span>{input.length} / 5000 chars</span>
              <button onClick={() => setInput('')} className="hover:text-slate-300 transition-colors">Reset</button>
            </div>
            
            {error && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-2 border border-red-500/30 bg-red-500/10 rounded text-[10px] text-red-400 flex items-start gap-2"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}
          </div>

          <button
            disabled={loading}
            onClick={handleAnalyze}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 text-sm font-bold text-white transition-all hover:bg-blue-500 active:scale-95 disabled:opacity-50 disabled:active:scale-100 shadow-lg shadow-blue-900/20"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-white" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {loading ? 'Analyzing...' : 'Analyze Now'}
          </button>

          <div className="space-y-3 pt-4 border-t border-slate-800">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Demo Examples</p>
            <div className="space-y-2">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => setInput(ex.text)}
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

          {history.length > 0 && (
            <div className="space-y-3 pt-4 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Session History ({history.length})</p>
                <button onClick={() => setHistory([])} className="text-[10px] text-slate-600 hover:text-red-400">Clear</button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {history.map((h, i) => (
                  <div
                    key={i}
                    onClick={() => setResult(h)}
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

      {/* Main Content Area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header */}
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/50 px-6 py-3 shrink-0">
          <div className="flex items-center gap-4 text-[10px] uppercase font-bold tracking-widest text-slate-500">
            <span className="flex items-center gap-2">Analysis Engine: <span className="text-blue-400">Gemini 2.0 Flash</span></span>
            <span className="h-1 w-1 rounded-full bg-slate-700"></span>
            <span className="flex items-center gap-2">Grounding: <span className="text-green-400">Enabled</span></span>
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

        {/* Content Section */}
        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <AnimatePresence mode="wait">
            {!result && !loading ? (
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
                <div className="flex md:hidden flex-col gap-4 w-full max-w-xs">
                   {/* Mobile input indicator or placeholder */}
                   <p className="text-xs text-blue-400 animate-pulse">Please use the desktop sidebar for analysis</p>
                </div>
              </motion.div>
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
            ) : result ? (
              <motion.div
                key="results"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-6"
              >
                {/* Result Section Header */}
                <div className="flex flex-col lg:flex-row items-stretch gap-4">
                  {/* Verdict Badge */}
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

                  {/* Confidence Monitor */}
                  <div className="flex w-full lg:w-72 flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-center shadow-xl">
                    <ConfidenceGauge score={result.confidence} colorClass={getLabelColor(result.label).split(' ')[0]} />
                  </div>
                </div>

                {/* Main Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-6">
                    {/* Summary */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 shadow-lg group">
                      <div className="flex items-center gap-2 mb-3">
                         <div className="w-1 h-3 bg-blue-500 rounded-full"></div>
                         <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">Content Summary</h3>
                      </div>
                      <p className="text-sm leading-relaxed text-slate-300 italic">
                        "{result.summary}"
                      </p>
                    </div>

                    {/* Claims Verification */}
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
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Footer Bar */}
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

function ConfidenceGauge({ score, colorClass }: { score: number, colorClass: string }) {
  // Use the SVG style from the design theme
  const radius = 15.9155;
  const circumference = 2 * Math.PI * radius; // Approx 100
  
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
          className={colorClass === 'text-red-500' ? 'stroke-red-500' : colorClass === 'text-green-500' ? 'stroke-green-500' : colorClass === 'text-orange-500' ? 'stroke-orange-500' : 'stroke-blue-500'}
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

