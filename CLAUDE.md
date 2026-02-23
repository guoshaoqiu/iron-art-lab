# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Iron Art Lab (铁板爻画)** is a Chinese web application providing AI-powered divination/fortune-telling analysis via DeepSeek LLM. It has zero npm dependencies — pure Node.js backend serving a vanilla JS/HTML/CSS frontend.

## Commands

```bash
npm start       # Start production server (port 3000)
npm run dev     # Start dev server with auto-reload (--watch flag)
```

No build step. No test suite. No linter configured. The server reads `.env` at startup.

## Environment Setup

Copy `.env.example` to `.env` and fill in at minimum:
```
DEEPSEEK_API_KEY=<required>
```

Optional env vars (with defaults): `MODEL_NAME` (deepseek-chat), `MAX_OUTPUT_TOKENS` (1200), `DEEPSEEK_BASE_URL` (https://api.deepseek.com), `PORT` (3000), `SYSTEM_PROMPT`.

## Architecture

### Backend (`server.js`)

Pure Node.js `http` module — no framework. All routing is manual. Key routes:
- `GET /` → serves `public/index.html`
- `GET /public/*` → serves static files (path-traversal validated)
- `POST /api/analyze` → non-streaming DeepSeek call
- `POST /api/analyze-stream` → SSE streaming DeepSeek call

The server loads `.env` via a custom `loadEnv()` parser (no dotenv package).

**Key data flow for `/api/analyze-stream`:**
1. Parse and validate JSON body (`parseJsonBody`, `validatePayload`)
2. Normalize conversation history (`normalizeHistory` — caps at 16 messages)
3. Build prompt and messages (`buildInitialPrompt`, `buildMessages`)
4. Stream DeepSeek API response (`callDeepSeekStream`)
5. Parse SSE chunks, extract JSON template via `parseTemplateContent`
6. Emit SSE events to client (`sendSse`)

`parseTemplateContent()` handles LLM output that may contain `<think>` tags and attempts to extract embedded JSON objects from the response text. The template schema (`TEMPLATE` constant) defines the structured divination data shape including bazi, day master, great luck cycles, and prediction summaries.

### Frontend (`public/`)

- `index.html` — Two-panel layout: left = input form, right = streaming results + follow-up chat
- `app.js` — Vanilla JS handling SSE streaming, conversation state, markdown rendering, and form management
- `styles.css` — Custom CSS design system with CSS variables; fonts loaded from Google Fonts (Manrope + Noto Sans SC); markdown/XSS libraries from CDN

**Frontend state:** `conversation[]` array holds the multi-turn chat history. `isRequesting` guards against concurrent submissions.

**Streaming flow:** `runModelRequest()` calls `requestAnalyzeStream()` with SSE parsing; falls back to `requestAnalyzeOnce()` (non-streaming) on failure. Markdown output is rendered via `marked.js` and sanitized by `DOMPurify`.

## Key Conventions

- **Commit format:** `type(scope): summary` (e.g., `feat(api): add streaming endpoint`)
- Chinese language UI — all user-facing strings in the HTML/CSS are in Simplified Chinese
- The `TEMPLATE` object in `server.js` is the canonical schema for structured LLM output — any new fields in the divination analysis should be added there and handled in `coerceTemplate()`/`mergeByTemplate()`
