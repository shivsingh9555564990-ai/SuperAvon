export interface RepoFile {
  name: string;
  path: string;
  category: 'core' | 'extension' | 'cloudflare' | 'docker' | 'docs' | 'config';
  description: string;
  language: string;
  previewSnippet: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  mode: number;
  think: number;
  description: string;
  badge?: string;
}

export const REPO_MODELS: ModelInfo[] = [
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    mode: 1,
    think: 4,
    description: 'Latest all-around model with fast inference and strong general reasoning.',
    badge: 'Latest',
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    mode: 1,
    think: 4,
    description: 'Default stable all-around model (Gemini 3.6 Flash).',
    badge: 'Default',
  },
  {
    id: 'gemini-3.5-flash-thinking',
    name: 'Gemini 3.5 Flash Thinking',
    mode: 2,
    think: 0,
    description: 'Deep thinking mode with up to 20,000+ characters reasoning output.',
    badge: 'Deep Reasoning',
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    mode: 1,
    think: 4,
    description: 'Alias for gemini-3.6-flash (automatically backend upgraded).',
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    mode: 3,
    think: 4,
    description: 'Pro grade model for complex analysis (requires cookies for web routing).',
    badge: 'Pro',
  },
  {
    id: 'gemini-3.1-pro-enhanced',
    name: 'Gemini 3.1 Pro Enhanced',
    mode: 3,
    think: 4,
    description: 'Experimental enhanced output parameters for Pro.',
  },
  {
    id: 'gemini-auto',
    name: 'Gemini Auto',
    mode: 4,
    think: 4,
    description: 'Autonomous model selection based on prompt complexity.',
  },
  {
    id: 'gemini-3.5-flash-thinking-lite',
    name: 'Gemini 3.5 Flash Thinking Lite',
    mode: 5,
    think: 0,
    description: 'Dynamic thinking mode with adaptive step depth.',
  },
  {
    id: 'gemini-flash-lite',
    name: 'Gemini Flash Lite',
    mode: 6,
    think: 4,
    description: 'Lightweight ultra-low latency model for simple queries.',
  },
];

export const REPO_FILES: RepoFile[] = [
  {
    name: 'gemini_web2api.py',
    path: 'gemini_web2api.py',
    category: 'core',
    description: 'Complete standalone Python server converting Gemini Web interface into OpenAI API.',
    language: 'python',
    previewSnippet: `#!/usr/bin/env python3
"""Convert Google Gemini web interface to OpenAI-compatible API."""
import os
import sys
import json
import base64
import asyncio
from http.server import HTTPServer, BaseHTTPRequestHandler

# Supports:
# - /v1/chat/completions (OpenAI compatible)
# - /v1/models (OpenAI model list)
# - /v1/responses (Codex CLI)
# - /v1beta/models (Google native format)
# - HTTP & HTTPS proxy support (NEW)
# - Thinking depth adjustment via @think=N
`,
  },
  {
    name: 'worker.js',
    path: 'cloudflare/worker.js',
    category: 'cloudflare',
    description: 'Serverless Cloudflare Worker version supporting edge deployment with zero servers.',
    language: 'javascript',
    previewSnippet: `/**
 * Cloudflare Worker for gemini-web2api
 * Provides OpenAI-compatible endpoint directly on Cloudflare Edge network.
 * Supports /v1/chat/completions, /v1/models, /v1beta/models, /health.
 */
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }
    // Handles rate limiting, Bearer token auth, and Gemini web payload translation...
  }
};`,
  },
  {
    name: 'config.example.json',
    path: 'config.example.json',
    category: 'config',
    description: 'Configuration template for port, proxy, cookies, API keys, and models.',
    language: 'json',
    previewSnippet: `{
  "port": 8081,
  "host": "0.0.0.0",
  "retry_attempts": 3,
  "retry_delay_sec": 2,
  "request_timeout_sec": 180,
  "gemini_bl": "boq_assistant-bard-web-server_20260716.08_p0",
  "auth_user": null,
  "xsrf_token": null,
  "default_model": "gemini-3.6-flash",
  "api_keys": [
    "sk-gemini"
  ],
  "cookie_file": null,
  "proxy": null,
  "log_requests": true,
  "temporary_chats": false
}`,
  },
  {
    name: 'popup.js',
    path: 'gemini-cookie-sync-extension/popup.js',
    category: 'extension',
    description: 'Chrome extension script to export Google Gemini web authentication safely to gemini-auth.json.',
    language: 'javascript',
    previewSnippet: `// Exports cookies, XSRF token, and build metadata from current Gemini session
// No data is ever sent to external servers; file is saved strictly locally.
document.getElementById('export').addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ url: '*://gemini.google.com/*' });
  // Extracts __Secure-1PSID, __Secure-1PSIDTS, etc. and formats into JSON...
});`,
  },
  {
    name: 'manifest.json',
    path: 'gemini-cookie-sync-extension/manifest.json',
    category: 'extension',
    description: 'Manifest V3 configuration for Gemini Cookie Sync Chrome Extension.',
    language: 'json',
    previewSnippet: `{
  "manifest_version": 3,
  "name": "Gemini Cookie Sync",
  "version": "1.0",
  "description": "Exports Gemini cookies plus XSRF/build metadata for gemini-web2api.",
  "permissions": [
    "cookies",
    "downloads",
    "tabs",
    "scripting"
  ],
  "host_permissions": [
    "https://google.com/*",
    "https://*.google.com/*"
  ],
  "action": {
    "default_title": "Gemini Cookie Sync",
    "default_popup": "popup.html"
  }
}`,
  },
  {
    name: 'Dockerfile',
    path: 'Dockerfile',
    category: 'docker',
    description: 'Production Docker container setup with Python 3.11-slim.',
    language: 'dockerfile',
    previewSnippet: `FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8081
CMD ["python", "gemini_web2api.py"]`,
  },
  {
    name: 'docker-compose.local.yml',
    path: 'docker-compose.local.yml',
    category: 'docker',
    description: 'One-click local docker compose configuration mounting config.json.',
    language: 'yaml',
    previewSnippet: `version: '3.8'
services:
  gemini-web2api:
    build: .
    ports:
      - "8081:8081"
    volumes:
      - ./config.json:/app/config.json:ro
      - ./cookie.json:/app/cookie.json:ro
    restart: unless-stopped`,
  },
  {
    name: 'README.md',
    path: 'README.md',
    category: 'docs',
    description: 'Main project documentation with full setup, client configuration, and API specs.',
    language: 'markdown',
    previewSnippet: `# gemini-web2api

Convert Google Gemini's web interface into an OpenAI-compatible API. Zero cost, cross-platform, single file.

## Features
- Optional API Keys: no auth when api_keys is empty, OpenAI-style Bearer auth
- OpenAI Compatible: Drop-in replacement for /v1/chat/completions and /v1/models
- Tool Calling: Full function calling support (OpenAI format)
- Multiple Models: Flash (3.7 / 3.6), Extended Thinking (20k+ char output), Pro, Auto, Lite
- Thinking Depth: Adjustable via @think=N suffix (0=deepest, 4=shallowest)
- Web Search: Built-in internet access (Gemini's native search)
- Proxy Support: HTTP & HTTPS proxy environment and config options
`,
  },
  {
    name: 'README_CN.md',
    path: 'README_CN.md',
    category: 'docs',
    description: 'Full Chinese language documentation with configuration and client setup.',
    language: 'markdown',
    previewSnippet: `# gemini-web2api (中文文档)

将 Google Gemini 网页版转为 OpenAI 兼容的 API。零成本、跨平台、单文件运行。

## 特色功能
- 兼容 OpenAI 格式：支持 /v1/chat/completions 和 /v1/models
- 深度思考模型：gemini-3.5-flash-thinking 输出超过 2 万字符
- 工具调用：完整支持 OpenAI function calling 格式
- 联网搜索：原生调用 Gemini 网络搜索
- 代理支持：支持配置 HTTP/HTTPS 代理
`,
  },
];
