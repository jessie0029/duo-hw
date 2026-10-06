// Built-in caption assistant using the Google Gemini API (free tier).
// The API key is stored in the user's (encrypted) settings, never in the code.
import { EN_RULES, DE_RULES, EN_SAMPLES, DE_SAMPLES, THREADS_RULES, THREADS_MAX } from './caption-rules.js';
export const charCount = t => [...(t || '')].length;

const API = 'https://generativelanguage.googleapis.com/v1beta';
const samples = arr => arr.map((s, i) => `--- Sample ${i + 1} ---\n${s}`).join('\n\n');
const EN_BRIEF = 'Rules for English captions:\n- ' + EN_RULES.join('\n- ') + '\n\nSample captions (tone reference only, do not copy their content):\n' + samples(EN_SAMPLES);
const DE_BRIEF = 'Rules for German captions:\n- ' + DE_RULES.join('\n- ') + '\n\nSample captions (tone reference only, do not copy their content):\n' + samples(DE_SAMPLES);
const WHO = 'the classical piano duo PIANO DUO HUA & WEI (pianists Hua and Wei, a married couple)';

let modelCache = null;

export class CaptionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Ordered list of fast Gemini models available to this key (best first).
// Google's free tier sometimes answers "503 overloaded" for one model, so we fall back to the next.
export async function pickModels(key, preferred) {
  if (modelCache && modelCache.key === key) return preferred ? [preferred, ...modelCache.models.filter(m => m !== preferred)] : modelCache.models;
  let r;
  try { r = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } }); }
  catch { throw new CaptionError('network', 'No connection to Google. Check your internet.'); }
  if (r.status === 400 || r.status === 401 || r.status === 403) throw new CaptionError('bad-key', 'The API key was not accepted.');
  if (!r.ok) throw new CaptionError('network', `Google returned ${r.status}. Try again in a minute.`);
  const names = ((await r.json()).models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /flash/.test(n) && !/(image|tts|live|audio|embedding|thinking-exp)/.test(n));
  const score = n => {
    let v = 0;
    const ver = n.match(/gemini-(\d+(?:\.\d+)?)/);
    if (ver) v += parseFloat(ver[1]) * 10;
    if (n === 'gemini-flash-latest') v = 1000;
    if (n === 'gemini-flash-lite-latest') v = 500;
    if (/preview|exp/.test(n)) v -= 15;      // stable models first
    if (/lite/.test(n) && !/latest/.test(n)) v -= 8; // lite as fallback
    if (/-\d{3}$|-\d{2}-\d{4}$/.test(n)) v -= 1;     // dated snapshots after aliases
    return v;
  };
  const models = [...new Set(names)].sort((x, y) => score(y) - score(x)).slice(0, 6);
  if (!models.includes('gemini-2.5-flash')) models.push('gemini-2.5-flash');
  modelCache = { key, models };
  return preferred ? [preferred, ...models.filter(m => m !== preferred)] : models;
}
export async function pickModel(key, preferred) { return (await pickModels(key, preferred))[0]; }

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastModel = '';
export const usedModel = () => lastModel;

async function askOnce(key, model, prompt) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, responseMimeType: 'application/json' },
  };
  let r;
  try {
    r = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body),
    });
  } catch { throw new CaptionError('network', 'No connection to Google. Check your internet.'); }
  if (r.status === 429) throw new CaptionError('limit', 'The free limit for now is used up. Try again in a minute, or tomorrow.');
  if (r.status === 503 || r.status === 500 || r.status === 502 || r.status === 504) throw new CaptionError('busy', 'Google’s free Gemini servers are busy right now. Try again in a minute.');
  if (r.status === 404) throw new CaptionError('model', 'Model not available.');
  if (r.status === 400 || r.status === 401 || r.status === 403) {
    const t = await r.text();
    if (/API key|API_KEY|permission/i.test(t)) throw new CaptionError('bad-key', 'The API key was not accepted.');
    throw new CaptionError('request', 'Google could not process this request.');
  }
  if (!r.ok) throw new CaptionError('busy', `Google returned ${r.status}. Try again in a minute.`);
  const j = await r.json();
  const text = (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
  if (!text) throw new CaptionError('empty', 'Gemini returned no text (it may have blocked the request). Try rephrasing.');
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const out = JSON.parse(m ? m[0] : text);
    if (typeof out.text !== 'string' || !out.text.trim()) throw 0;
    return { text: out.text.trim(), notes: Array.isArray(out.notes) ? out.notes.slice(0, 4).map(String) : [] };
  } catch { throw new CaptionError('format', 'The answer came back in the wrong format. Press the button again.'); }
}

// Remember the model that last worked (across sessions) and try it first.
function rememberModel(m) { try { localStorage.setItem('pdhw:gemModel', JSON.stringify({ m, t: Date.now() })); } catch {} }
function rememberedModel() { try { const x = JSON.parse(localStorage.getItem('pdhw:gemModel') || 'null'); return x && Date.now() - x.t < 3 * 864e5 ? x.m : null; } catch { return null; } }

// Try every available model; if all are busy, wait and go round again (up to 3 rounds).
async function ask(key, models, prompt, onStatus) {
  const pref = rememberedModel();
  if (pref && models.includes(pref) && models[0] !== pref) models.splice(0, models.length, pref, ...models.filter(m => m !== pref));
  const waits = [0, 4000, 10000];
  let lastErr;
  for (let round = 0; round < waits.length; round++) {
    if (waits[round]) {
      for (let s = waits[round] / 1000; s > 0; s--) { onStatus && onStatus(`Gemini is busy. Trying again in ${s} s…`); await sleep(1000); }
      onStatus && onStatus('Trying again…');
    }
    let allBusy = true;
    for (const model of models) {
      try {
        const r = await askOnce(key, model, prompt);
        lastModel = model; rememberModel(model);
        if (modelCache && modelCache.models[0] !== model) modelCache.models = [model, ...modelCache.models.filter(m => m !== model)];
        models.splice(0, models.length, model, ...models.filter(m => m !== model));
        return r;
      } catch (e) {
        lastErr = e;
        if (['bad-key', 'request', 'empty', 'network'].includes(e.code)) throw e;
        if (e.code !== 'busy' && e.code !== 'limit') allBusy = false;
      }
    }
    if (!allBusy && lastErr && lastErr.code === 'format') throw lastErr;
  }
  throw lastErr || new CaptionError('busy', 'Gemini is busy right now. Try again in a minute.');
}

const ctx = c => (c ? `\nPost context: ${c}\n` : '');

export async function polishEnglish(key, models, draft, context, onStatus) {
  onStatus && onStatus('Polishing…');
  return ask(key, models, `You are editing an English social media caption written by ${WHO}.\n\n${EN_BRIEF}\n${ctx(context)}\nTask: improve the fluency and grammar of the draft and apply every rule above. Keep the duo's voice and the facts of the draft.\n\nReply with only JSON: {"text": "<polished caption>", "notes": ["<up to 4 very short notes on what you changed>"]}\n\nDraft:\n"""\n${draft}\n"""`, onStatus);
}

// One request instead of two: translate, then revise into native German, returning only the final version.
export async function toGerman(key, models, english, context, onStatus) {
  onStatus && onStatus('Translating and polishing…');
  return ask(key, models, `Create the German version of this English social media caption by ${WHO}.\n\n${DE_BRIEF}\n${ctx(context)}\nWork in two steps internally: (1) translate the caption faithfully into German; (2) review your translation and improve the flow and sentence structure so it reads as if a native German speaker (Austrian vocabulary preferred) had written it from scratch, applying every rule above. Do not add content or information. Return only the final result of step 2.\n\nReply with only JSON: {"text": "<final German caption>", "notes": ["<up to 4 very short notes in English on choices you made>"]}\n\nEnglish caption:\n"""\n${english}\n"""`, onStatus);
}

// Shorten the German caption into a Threads version (max 500 characters); retries once if too long.
export async function toThreads(key, models, german, context, onStatus) {
  const base = `Here is the full German social media caption by ${WHO}.\n\n${DE_BRIEF}\n\nRules for the Threads version:\n- ${THREADS_RULES.join('\n- ')}\n${ctx(context)}\nTask: write the Threads version of this caption following every rule above.\n\nReply with only JSON: {"text": "<Threads caption in German>"}\n\nFull German caption:\n"""\n${german}\n"""`;
  onStatus && onStatus('Shortening for Threads…');
  let r = await ask(key, models, base, onStatus);
  if (charCount(r.text) > THREADS_MAX) {
    onStatus && onStatus(`Too long (${charCount(r.text)} characters). Shortening again…`);
    r = await ask(key, models, base + `\n\nYour previous version had ${charCount(r.text)} characters, which is over the limit. Make it clearly shorter, under 460 characters:\n"""\n${r.text}\n"""`, onStatus);
  }
  return r;
}
