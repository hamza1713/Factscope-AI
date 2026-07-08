import React, { useState } from 'react';
import { Shield, Key, ExternalLink, CheckCircle2, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';

interface ApiKeySetupProps {
  onSave: (key: string) => void;
  isModal?: boolean; // true = update from settings, false = first-launch full screen
  currentKey?: string | null;
  onClose?: () => void;
}

declare global {
  interface Window {
    electronAPI?: {
      getApiKey: () => Promise<string | null>;
      setApiKey: (key: string) => Promise<void>;
      clearApiKey: () => Promise<void>;
      isFirstLaunch: () => Promise<boolean>;
      getAppVersion: () => Promise<string>;
      getServerUrl: () => Promise<string>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}

const ApiKeySetup: React.FC<ApiKeySetupProps> = ({ onSave, isModal = false, currentKey, onClose }) => {
  const [apiKey, setApiKey] = useState(currentKey || '');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const isElectron = !!window.electronAPI;

  const handleSave = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setErrorMsg('Please enter your Gemini API key.');
      setStatus('error');
      return;
    }
    if (!trimmed.startsWith('AI') || trimmed.length < 20) {
      setErrorMsg('This does not look like a valid Gemini API key. Keys typically start with "AI" and are at least 20 characters long.');
      setStatus('error');
      return;
    }

    setStatus('saving');
    setErrorMsg('');

    try {
      if (isElectron && window.electronAPI) {
        await window.electronAPI.setApiKey(trimmed);
      }
      setStatus('success');
      setTimeout(() => {
        onSave(trimmed);
      }, 800);
    } catch (err) {
      setErrorMsg('Failed to save the API key. Please try again.');
      setStatus('error');
    }
  };

  const handleOpenApiKeyPage = async () => {
    if (isElectron && window.electronAPI) {
      await window.electronAPI.openExternal('https://aistudio.google.com/app/apikey');
    } else {
      window.open('https://aistudio.google.com/app/apikey', '_blank');
    }
  };

  const content = (
    <div className={`flex flex-col gap-6 ${isModal ? '' : 'items-center justify-center py-8'}`}>
      {!isModal && (
        <div className="flex flex-col items-center gap-4 mb-2">
          <div className="relative">
            <div className="absolute inset-0 rounded-3xl bg-indigo-500/30 blur-2xl" />
            <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-600 to-cyan-500 flex items-center justify-center shadow-2xl">
              <Shield className="w-10 h-10 text-white" />
            </div>
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white tracking-tight">Welcome to Factscope AI</h1>
            <p className="text-slate-400 mt-2 text-base max-w-sm">
              To get started, enter your Google Gemini API key. It's stored securely on your device and never sent to any external servers.
            </p>
          </div>
        </div>
      )}

      {isModal && (
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
            <Key className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-white font-semibold text-lg">API Key Configuration</h2>
            <p className="text-slate-400 text-sm">Update your Gemini API key</p>
          </div>
        </div>
      )}

      {/* Key Input */}
      <div className="flex flex-col gap-2 w-full">
        <label className="text-sm font-medium text-slate-300">Gemini API Key</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setStatus('idle'); setErrorMsg(''); }}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            placeholder="AIza..."
            className="w-full bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-3 pr-12 text-white placeholder-slate-500 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors p-1"
            aria-label={showKey ? 'Hide key' : 'Show key'}
          >
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {/* Status messages */}
        {status === 'error' && (
          <div className="flex items-start gap-2 text-red-400 text-sm mt-1">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {status === 'success' && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm mt-1">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>API key saved successfully!</span>
          </div>
        )}
      </div>

      {/* Get Key Button */}
      <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-800/40 border border-slate-700/50">
        <div className="flex-1">
          <p className="text-slate-300 text-sm font-medium">Need a free API key?</p>
          <p className="text-slate-500 text-xs mt-0.5">Get one in seconds at Google AI Studio</p>
        </div>
        <button
          onClick={handleOpenApiKeyPage}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 text-sm font-medium hover:bg-indigo-600/30 transition-all"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Get Key
        </button>
      </div>

      {/* Action Buttons */}
      <div className={`flex gap-3 ${isModal ? 'justify-end' : 'w-full'}`}>
        {isModal && onClose && (
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-slate-700 text-slate-300 text-sm font-medium hover:bg-slate-800 transition-all"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={status === 'saving' || status === 'success'}
          className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg ${
            isModal ? '' : 'w-full'
          } ${
            status === 'saving' || status === 'success'
              ? 'bg-indigo-600/50 text-indigo-300 cursor-not-allowed'
              : 'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white hover:from-indigo-500 hover:to-indigo-400 hover:shadow-indigo-500/25'
          }`}
        >
          {status === 'saving' && <Loader2 className="w-4 h-4 animate-spin" />}
          {status === 'success' && <CheckCircle2 className="w-4 h-4" />}
          {status === 'saving' ? 'Saving...' : status === 'success' ? 'Saved!' : 'Save & Continue'}
        </button>
      </div>

      {!isModal && (
        <p className="text-slate-600 text-xs text-center max-w-xs">
          Your API key is stored locally in your system's secure app data folder and is never transmitted anywhere.
        </p>
      )}
    </div>
  );

  if (!isModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0f1e]">
        <div className="w-full max-w-md px-6">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl p-7 w-full max-w-md shadow-2xl">
        {content}
      </div>
    </div>
  );
};

export default ApiKeySetup;
