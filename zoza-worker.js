/* ===== zoza-worker.js — خدمة وسيطة آمنة للوضع الذكي في «حوار مع صديقتي Zoza» (الإنجليزية) =====
   تعمل على Cloudflare Workers (مجاني للاستخدام الخفيف). تحفظ مفتاح Anthropic سرًّا بعيدًا عن كود الموقع.
   الإعداد (مرة واحدة):
   1) أنشئ Worker جديدًا في Cloudflare والصق هذا الملف.
   2) في Settings ← Variables أضف:  ANTHROPIC_API_KEY (Secret) = مفتاحك
                                      ALLOWED_ORIGIN = https://اسم-المستخدم.github.io   (يمكن وضع عدة نطاقات مفصولة بفاصلة)
                                      MODEL (اختياري) = claude-haiku-5-5
   3) انسخ رابط الـ Worker وضعه في أول index.html:  var AI_URL = 'https://....workers.dev';
      (أو من زر «⚙️ العقل الذكي» داخل الصفحة لتجربته على جهازك فقط).
   تنبيه: كل رسالة طالب تستهلك رصيدك في Anthropic. أضف قاعدة Rate Limiting في Cloudflare لمنع الإسراف. */
const LEVELS = { b: 'A1 (beginner: very short and simple sentences, basic vocabulary)', m: 'A2-B1 (intermediate: medium sentences, everyday vocabulary)', a: 'B2 (advanced: rich sentences, nuance, argued opinions)' };
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = { 'Access-Control-Allow-Origin': okOrigin ? origin : 'null', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
    const out = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST' || !okOrigin) return out({ error: 'forbidden' }, 403);
    if (!env.ANTHROPIC_API_KEY) return out({ error: 'missing key' }, 500);
    let body; try { body = await request.json(); } catch { return out({ error: 'bad json' }, 400); }
    const msg = String(body.message || '').slice(0, 500).trim(); if (!msg) return out({ error: 'empty' }, 400);
    // سجل المحادثة: آخر 20 رسالة، يبدأ بـ user ويتبادل الأدوار
    let msgs = []; (Array.isArray(body.history) ? body.history : []).slice(-20).forEach(h => { const role = h.role === 'assistant' ? 'assistant' : 'user', content = String(h.content || '').slice(0, 500).trim(); if (!content) return; if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += '\n' + content; else msgs.push({ role, content }); });
    while (msgs.length && msgs[0].role !== 'user') msgs.shift();
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user') msgs.push({ role: 'user', content: msg });
    const name = String(body.name || '').slice(0, 20), topic = String(body.topic || '').slice(0, 60);
    const system = `You are Zoza, a cheerful, patient and encouraging robot English teacher (you speak as a woman). You are chatting with ${name || 'a student'}, a teenage Arabic speaker (Egypt) who is learning English.
Student level: ${LEVELS[body.level] || LEVELS.b}. ${topic ? 'Current topic: ' + topic + '.' : 'The topic is free: follow the student’s interests.'}
Rules: ALWAYS reply in English adapted to the level (A1: 1 to 2 short sentences; B2: up to 4 sentences). You LEAD the conversation: almost always end with ONE single question to keep the dialogue going. If the student asks a question, ANSWER it first, clearly and simply, then follow up with a related question. Call the student by their first name from time to time. Gently correct mistakes (spelling, grammar, verb forms, word choice) in the student’s LAST message only, without discouraging them. Keep content suitable for teenagers: politely refuse any inappropriate or dangerous subject and suggest another one. Never ask for sensitive personal information. Be very attentive: connect your reply to what the student said earlier (name, tastes, feelings), show empathy, vary the topics (movies, science, history, cooking, games, travel, fun philosophy), and sometimes offer a riddle, a “would you rather?” question or a mini-challenge. Write the way people speak aloud: natural sentences, no emojis, no symbols, never repeat the same phrase twice.
Reply ONLY with a valid JSON object (no text around it, no code fences) of the form:
{"reply_en":"...","reply_ar":"simple Arabic translation of reply_en","corrections":[{"wrong":"student's mistake","right":"correct form","why_ar":"short explanation in simple Arabic"}],"suggestions_en":["2 or 3 short possible replies for the student (especially at A1)"],"new_words":[{"en":"useful word","ar":"meaning in Arabic"}],"tip_ar":"short tip in Arabic (or empty string)"}`;
    let r; try {
      r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: env.MODEL || 'claude-haiku-5-5', max_tokens: 800, system, messages: msgs }) });
    } catch { return out({ error: 'upstream' }, 502); }
    if (!r.ok) return out({ error: 'upstream ' + r.status }, 502);
    const data = await r.json(); const txt = (data.content && data.content[0] && data.content[0].text) || '';
    let obj; try { const m = txt.match(/\{[\s\S]*\}/); obj = JSON.parse(m ? m[0] : txt); } catch { obj = { reply_en: txt.slice(0, 400), reply_ar: '', corrections: [], suggestions_en: [], new_words: [], tip_ar: '' }; }
    return out({ reply_en: String(obj.reply_en || ''), reply_ar: String(obj.reply_ar || ''), corrections: Array.isArray(obj.corrections) ? obj.corrections.slice(0, 5) : [], suggestions_en: Array.isArray(obj.suggestions_en) ? obj.suggestions_en.slice(0, 3) : [], new_words: Array.isArray(obj.new_words) ? obj.new_words.slice(0, 4) : [], tip_ar: String(obj.tip_ar || '') });
  }
};
