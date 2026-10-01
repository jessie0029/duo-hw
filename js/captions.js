// Built-in caption assistant using the Google Gemini API (free tier).
// The API key is stored in the user's (encrypted) settings, never in the code.
import { EN_RULES, DE_RULES, EN_SAMPLES, DE_SAMPLES } from './caption-rules.js';

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

// Try each model; retry a busy model once after a short pause before moving on.
async function ask(key, models, prompt) {
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await askOnce(key, model, prompt); lastModel = model;
        // stick with the model that worked for the rest of this session
        if (modelCache && modelCache.models[0] !== model) modelCache.models = [model, ...modelCache.models.filter(m => m !== model)];
        models.splice(0, models.length, model, ...models.filter(m => m !== model));
        return r;
      }
      catch (e) {
        lastErr = e;
        if (e.code === 'bad-key' || e.code === 'request' || e.code === 'empty' || e.code === 'network') throw e;
        if (e.code === 'busy' && attempt === 0) { await sleep(1500); continue; }
        break; // limit / model / format: next model
      }
    }
  }
  throw lastErr || new CaptionError('busy', 'Gemini is busy right now. Try again in a minute.');
}

const ctx = c => (c ? `\nPost context: ${c}\n` : '');

export async function polishEnglish(key, models, draft, context) {
  return ask(key, models, `You are editing an English social media caption written by ${WHO}.\n\n${EN_BRIEF}\n${ctx(context)}\nTask: improve the fluency and grammar of the draft and apply every rule above. Keep the duo's voice and the facts of the draft.\n\nReply with only JSON: {"text": "<polished caption>", "notes": ["<up to 4 very short notes on what you changed>"]}\n\nDraft:\n"""\n${draft}\n"""`);
}

export async function toGerman(key, models, english, context, onStep) {
  onStep && onStep('Translating…');
  const first = await ask(key, models, `Translate this English social media caption by ${WHO} into German.\n\n${DE_BRIEF}\n${ctx(context)}\nTask: this is the first step only: translate faithfully into German, keeping the emojis and hashtags. A second step will polish the German afterwards.\n\nReply with only JSON: {"text": "<German caption>"}\n\nEnglish caption:\n"""\n${english}\n"""`);
  onStep && onStep('Making it sound native…');
  return ask(key, models, `Here is a German social media caption by ${WHO}, translated from English.\n\n${DE_BRIEF}\n${ctx(context)}\nTask: review it and improve the flow and sentence structure so it reads as if a native German speaker (Austrian vocabulary preferred) had written it from scratch, applying every rule above. Do not add content or information.\n\nReply with only JSON: {"text": "<final German caption>", "notes": ["<up to 4 very short notes in English on what you changed>"]}\n\nGerman caption:\n"""\n${first.text}\n"""`);
}
