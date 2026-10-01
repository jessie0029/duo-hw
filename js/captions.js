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

// Pick the best available fast Gemini model for this key
export async function pickModel(key, preferred) {
  if (preferred) return preferred;
  if (modelCache && modelCache.key === key) return modelCache.model;
  const r = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  if (r.status === 400 || r.status === 401 || r.status === 403) throw new CaptionError('bad-key', 'The API key was not accepted.');
  if (!r.ok) throw new CaptionError('network', `Google returned ${r.status}.`);
  const list = ((await r.json()).models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''));
  const score = n => {
    if (n === 'gemini-flash-latest') return 1000;
    const m = n.match(/^gemini-(\d+(?:\.\d+)?)-flash$/);
    return m ? parseFloat(m[1]) * 10 : -1;
  };
  const best = list.filter(n => score(n) >= 0).sort((a, b) => score(b) - score(a))[0]
    || list.find(n => /flash/.test(n) && !/(image|tts|live|audio|lite)/.test(n))
    || 'gemini-2.5-flash';
  modelCache = { key, model: best };
  return best;
}

async function ask(key, model, prompt) {
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
  if (r.status === 429) throw new CaptionError('limit', 'The free daily limit is used up. Try again later or tomorrow.');
  if (r.status === 400 || r.status === 401 || r.status === 403) {
    const t = await r.text();
    if (/API key|API_KEY|permission/i.test(t)) throw new CaptionError('bad-key', 'The API key was not accepted.');
    throw new CaptionError('request', 'Google could not process this request.');
  }
  if (!r.ok) throw new CaptionError('network', `Google returned ${r.status}. Try again.`);
  const j = await r.json();
  const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!text) throw new CaptionError('empty', 'Gemini returned no text (it may have blocked the request). Try rephrasing.');
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const out = JSON.parse(m ? m[0] : text);
    if (typeof out.text !== 'string' || !out.text.trim()) throw 0;
    return { text: out.text.trim(), notes: Array.isArray(out.notes) ? out.notes.slice(0, 4).map(String) : [] };
  } catch { throw new CaptionError('format', 'The answer came back in the wrong format. Press the button again.'); }
}

const ctx = c => (c ? `\nPost context: ${c}\n` : '');

export async function polishEnglish(key, model, draft, context) {
  return ask(key, model, `You are editing an English social media caption written by ${WHO}.\n\n${EN_BRIEF}\n${ctx(context)}\nTask: improve the fluency and grammar of the draft and apply every rule above. Keep the duo's voice and the facts of the draft.\n\nReply with only JSON: {"text": "<polished caption>", "notes": ["<up to 4 very short notes on what you changed>"]}\n\nDraft:\n"""\n${draft}\n"""`);
}

export async function toGerman(key, model, english, context, onStep) {
  onStep && onStep('Translating…');
  const first = await ask(key, model, `Translate this English social media caption by ${WHO} into German.\n\n${DE_BRIEF}\n${ctx(context)}\nTask: this is the first step only: translate faithfully into German, keeping the emojis and hashtags. A second step will polish the German afterwards.\n\nReply with only JSON: {"text": "<German caption>"}\n\nEnglish caption:\n"""\n${english}\n"""`);
  onStep && onStep('Making it sound native…');
  return ask(key, model, `Here is a German social media caption by ${WHO}, translated from English.\n\n${DE_BRIEF}\n${ctx(context)}\nTask: review it and improve the flow and sentence structure so it reads as if a native German speaker (Austrian vocabulary preferred) had written it from scratch, applying every rule above. Do not add content or information.\n\nReply with only JSON: {"text": "<final German caption>", "notes": ["<up to 4 very short notes in English on what you changed>"]}\n\nGerman caption:\n"""\n${first.text}\n"""`);
}
