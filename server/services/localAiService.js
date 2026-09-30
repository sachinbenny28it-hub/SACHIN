const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const CHAT_MODEL = process.env.OLLAMA_MODEL || 'qwen3:0.6b';
const ASR_MODEL = process.env.OLLAMA_ASR_MODEL || 'frozenlab/qwen3-asr:0.6b';
const CONTEXT_LENGTH = Math.max(1024, Math.min(Number(process.env.OLLAMA_CONTEXT_LENGTH) || 2048, 4096));
const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '30s';
let ollamaLaunchAttempted = false;

const memorySuggestionTool = {
  type: 'function',
  function: {
    name: 'suggest_memory',
    description: 'Suggest one durable fact the user may want in their Memory Vault. This only creates a suggestion for the user to approve; it does not save anything. Use for explicit requests to remember something, or a clear long-term preference, goal, project, deadline, or recurring behaviour. Never suggest when asked not to remember. Do not use for small talk.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['goal', 'learning', 'project', 'preference', 'plan', 'instruction', 'context', 'behaviour'] },
        content: { type: 'string', description: 'A short, specific, faithful note, maximum 500 characters.' },
        pinned: { type: 'boolean', description: 'Whether this is important enough to pin.' }
      },
      required: ['category', 'content', 'pinned']
    }
  }
};

async function getJson(endpoint, { body, timeoutMs = 3000 } = {}) {
  let response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (cause) {
    const error = new Error('The local Ollama service is not reachable.');
    error.code = 'OLLAMA_UNAVAILABLE';
    error.cause = cause;
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : `Ollama returned HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.code = /model .* not found|pull model/i.test(message) ? 'OLLAMA_MODEL_MISSING' : 'OLLAMA_REQUEST_FAILED';
    throw error;
  }
  return data;
}

async function getLocalAiStatus() {
  try {
    const data = await getJson('/api/tags', { timeoutMs: 2500 });
    const names = (data.models || []).map((item) => item.name || item.model).filter(Boolean);
    return {
      running: true,
      chatReady: names.includes(CHAT_MODEL),
      voiceReady: names.includes(ASR_MODEL),
      provider: 'Ollama local',
      model: CHAT_MODEL
    };
  } catch {
    return { running: false, chatReady: false, voiceReady: false, provider: 'Ollama local', model: CHAT_MODEL };
  }
}

function findOllamaExecutable() {
  const candidates = [
    process.env.OLLAMA_EXE,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Ollama', 'ollama.exe'),
    'ollama'
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === 'ollama' || fs.existsSync(candidate));
}

async function ensureOllamaRunning() {
  let status = await getLocalAiStatus();
  if (status.running || ollamaLaunchAttempted) return status;
  ollamaLaunchAttempted = true;

  const executable = findOllamaExecutable();
  if (!executable) return status;
  const env = {
    ...process.env,
    // Keep model weights in Ollama's local user cache by default. The project
    // may live in a synced folder (for example OneDrive), where model files can
    // be represented as cloud placeholders and fail to load.
    OLLAMA_MODELS: process.env.OLLAMA_MODELS || path.join(os.homedir(), '.ollama', 'models'),
    OLLAMA_CONTEXT_LENGTH: String(CONTEXT_LENGTH),
    OLLAMA_MAX_LOADED_MODELS: '1'
  };
  try {
    const child = spawn(executable, ['serve'], { detached: true, windowsHide: true, stdio: 'ignore', env });
    child.on('error', (error) => console.error('Ollama start failed:', { code: error.code || null }));
    child.unref();
  } catch (error) {
    console.error('Ollama start failed:', { code: error.code || null });
    return status;
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    status = await getLocalAiStatus();
    if (status.running) break;
  }
  return status;
}

function keepRecentContext(messages) {
  const systemPrompt = messages.filter((message) => message.role === 'system').map((message) => String(message.content || '').trim()).filter(Boolean).join('\n\n');
  const history = messages.filter((message) => message.role !== 'system').map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message.content || '')
  }));
  let availableChars = Math.max(1200, 5200 - systemPrompt.length);
  const kept = [];
  for (let index = history.length - 1; index >= 0 && availableChars > 0; index -= 1) {
    const item = history[index];
    const content = item.content.length > availableChars ? item.content.slice(-availableChars) : item.content;
    if (content) {
      kept.push({ ...item, content });
      availableChars -= content.length;
    }
  }
  kept.reverse();
  return [...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []), ...kept];
}

async function chatCompletion(messages, { model = CHAT_MODEL, tools = [], maxTokens = 384, temperature = 0.6 } = {}) {
  const payload = {
    model,
    messages,
    stream: false,
    think: false,
    keep_alive: KEEP_ALIVE,
    options: { num_ctx: CONTEXT_LENGTH, num_predict: maxTokens, temperature },
    ...(tools.length ? { tools } : {})
  };
  return getJson('/api/chat', { body: payload, timeoutMs: 180000 });
}

function readToolArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

async function getSachinReply(input, { allowMemorySuggestions = true } = {}) {
  const messages = keepRecentContext(input);
  const first = await chatCompletion(messages, { tools: allowMemorySuggestions ? [memorySuggestionTool] : [] });
  const assistantMessage = first.message || {};
  const calls = (assistantMessage.tool_calls || []).filter((call) => call.function?.name === 'suggest_memory');
  const validCategories = memorySuggestionTool.function.parameters.properties.category.enum;
  const suggestions = calls.map((call) => {
    const args = readToolArgs(call.function?.arguments);
    return {
      callId: call.id || null,
      category: args.category,
      content: typeof args.content === 'string' ? args.content.trim() : '',
      pinned: args.pinned === true
    };
  }).filter((item) => item.content && item.content.length <= 500 && validCategories.includes(item.category));

  let text = typeof assistantMessage.content === 'string' ? assistantMessage.content.trim() : '';
  if (calls.length) {
    const followupMessages = [
      ...messages,
      assistantMessage,
      ...calls.map((call) => ({
        role: 'tool',
        tool_name: call.function.name,
        content: JSON.stringify({ suggestion_created: true, saved: false })
      }))
    ];
    const final = await chatCompletion(followupMessages, { maxTokens: 300, temperature: 0.6 });
    text = typeof final.message?.content === 'string' ? final.message.content.trim() : text;
  }

  return { text, suggestions };
}

async function transcribeAudio(buffer) {
  const wavHeader = buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE';
  if (!wavHeader) {
    const error = new Error('Local voice transcription needs a WAV recording from the browser.');
    error.code = 'LOCAL_WAV_REQUIRED';
    error.status = 415;
    throw error;
  }
  const response = await chatCompletion([
    { role: 'user', content: '', images: [buffer.toString('base64')] }
  ], { model: ASR_MODEL, maxTokens: 512, temperature: 0 });
  const rawText = typeof response.message?.content === 'string' ? response.message.content : '';
  return rawText.includes('<asr_text>') ? rawText.split(/<asr_text>/i).pop().trim() : rawText.trim();
}

module.exports = { getSachinReply, transcribeAudio, getLocalAiStatus, ensureOllamaRunning, CHAT_MODEL, ASR_MODEL };
