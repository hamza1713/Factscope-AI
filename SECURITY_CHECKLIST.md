# 🔐 Factscope-AI Security Checklist & Architecture Guide

This document outlines the security improvements made to Factscope-AI and provides a checklist for maintaining a secure deployment.

## 🚨 Addressed Vulnerabilities

1. **Frontend API Key Leakage**: 
   - **Problem**: Previously, `vite.config.ts` was manually injecting the `GEMINI_API_KEY` into the frontend bundle using `define`. This exposed the raw key in the browser source code, leading to leaks.
   - **Fix**: The `define` injection has been removed. The frontend is now completely agnostic of API keys.
   
2. **Client-Side AI SDK Usage**:
   - **Problem**: The `@google/genai` SDK was imported and initialized directly in the browser (`src/geminiServices.ts`), making network requests directly to the AI provider.
   - **Fix**: All AI SDK logic has been moved to a secure backend. The frontend now communicates exclusively via a `fetch()` call to our own internal `/api/analyze` endpoint.

3. **Missing Rate Limiting & Validation**:
   - **Problem**: Direct client-to-provider calls lacked payload size limits.
   - **Fix**: The backend now validates payload types, enforces a minimum length, and limits request body size (`1mb` via Express JSON middleware).

## 🏛️ New Secure Architecture

```text
[ Browser / Frontend (Vite/React) ]
         |
         | (POST /api/analyze - NO API KEYS)
         v
[ Backend Server (Express / Vercel API) ] 
         |
         | (Uses process.env.GEMINI_API_KEY securely)
         v
[ External AI Provider (Google Gemini) ]
```

## ✅ Deployment Safety Checklist

Before deploying, ensure you follow these rules:

- [ ] **No Frontend Env Vars**: Ensure your environment variables **DO NOT** start with `VITE_`, `NEXT_PUBLIC_`, or `REACT_APP_`.
- [ ] **Server-Side Secrets**: Configure the `GEMINI_API_KEY` exclusively in your hosting provider's backend/serverless environment variables settings.
- [ ] **No Console Logs**: Ensure you haven't added `console.log(process.env)` anywhere in your frontend code.
- [ ] **Git Ignore**: Double-check that your `.env` file is listed in `.gitignore` (it is by default).

## 🚀 Deployment Instructions

### Vercel (Recommended)
This project is already configured for Vercel deployment natively. Vercel automatically detects the `api/` directory and deploys `api/analyze.ts` as a serverless function.

1. Push your code to GitHub.
2. Import the project in Vercel.
3. In the Vercel Dashboard, go to **Settings > Environment Variables**.
4. Add `GEMINI_API_KEY` and paste your key.
5. Deploy. The Vite frontend will build, and `/api/analyze` will be routed to the serverless function automatically.

### Netlify
If deploying to Netlify, you can use the same serverless function logic by moving the `api/` directory to `netlify/functions/` and adjusting your `netlify.toml` routing.

### Local Development
To run this secure architecture locally:
1. Ensure your `.env` file contains `GEMINI_API_KEY`.
2. Start the backend: `npm run dev:server` (runs on port 3001).
3. Start the frontend: `npm run dev` (runs on port 3000). The frontend will automatically proxy `/api` requests to the local backend.
