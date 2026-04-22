import Anthropic from "@anthropic-ai/sdk";
import http from "http";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new Anthropic();

// ─── Gzip cache (populated on first request, lives in memory) ─────────────────
const gzipCache = new Map();

// Cache durations by file type
const CACHE_TTL = {
  ".html":  "no-cache, no-store, must-revalidate",  // always fresh
  ".ttf":   "public, max-age=31536000, immutable",   // 1 year — font never changes
  ".woff":  "public, max-age=31536000, immutable",
  ".woff2": "public, max-age=31536000, immutable",
  ".json":  "public, max-age=3600",                  // 1 hour
  ".js":    "public, max-age=86400",                 // 1 day
  ".css":   "public, max-age=86400",
  ".png":   "public, max-age=604800",                // 7 days
  ".jpg":   "public, max-age=604800",
  ".svg":   "public, max-age=604800",
};

// ─── Load local strain database ───────────────────────────────────────────────
const STRAINS_DB = JSON.parse(fs.readFileSync(path.join(__dirname, "strains.json"), "utf8"));
console.log(`Loaded ${STRAINS_DB.length} strains from local database.`);

// ─── Semantic word map: query words → what to match in the DB ─────────────────
const SEMANTIC = {
  // moods & feelings
  happy: ["Happy", "Euphoric", "Uplifted"],
  cheery: ["Happy", "Euphoric", "Uplifted"],
  cheerful: ["Happy", "Euphoric"],
  euphoric: ["Euphoric", "Happy", "Uplifted"],
  relaxed: ["Relaxed", "Calming", "Peaceful"],
  relaxing: ["Relaxed", "Calming"],
  calm: ["Relaxed", "Calming"],
  chill: ["Relaxed", "Calming"],
  mellow: ["Relaxed", "Calming"],
  sleepy: ["Sleepy", "Sedating"],
  sleep: ["Sleepy", "Sedating", "Relaxed", "nighttime"],
  insomnia: ["Sleepy", "Sedating"],
  rest: ["Sleepy", "Relaxed"],
  bedtime: ["Sleepy", "Sedating", "nighttime"],
  nighttime: ["nighttime", "Sleepy"],
  night: ["nighttime", "Sleepy"],
  energetic: ["Energetic", "Active", "daytime"],
  energy: ["Energetic", "Active"],
  active: ["Energetic", "Active"],
  awake: ["Energetic", "Uplifted", "daytime"],
  alive: ["Energetic", "Uplifted"],
  lively: ["Energetic", "Uplifted", "Happy"],
  focused: ["Focused", "Alert", "Clear-headed"],
  focus: ["Focused", "Alert"],
  alert: ["Focused", "Alert"],
  productive: ["Focused", "Energetic", "Creative"],
  creative: ["Creative", "Focused", "Artistic"],
  artistic: ["Creative", "Artistic"],
  inspired: ["Creative", "Uplifted"],
  social: ["Happy", "Euphoric", "Talkative"],
  sociable: ["Happy", "Talkative"],
  talkative: ["Talkative", "Happy"],
  giggly: ["Giggly", "Happy", "Euphoric"],
  uplifted: ["Uplifted", "Happy", "Euphoric"],
  uplift: ["Uplifted", "Euphoric"],
  motivated: ["Energetic", "Focused"],
  cerebral: ["Cerebral", "Creative", "Focused"],
  heady: ["Cerebral", "Creative"],
  clear: ["Clear-headed", "Focused", "Alert"],
  mindful: ["Focused", "Clear-headed"],
  body: ["Relaxed", "Body High"],
  couch: ["Sedating", "Sleepy", "heavy"],
  heavy: ["Sedating", "heavy"],
  sedated: ["Sedating", "Sleepy"],
  // pain / symptoms
  pain: ["Relaxed", "Analgesic", "medical"],
  aches: ["Relaxed", "Analgesic"],
  anxiety: ["Calming", "Relaxed"],
  anxious: ["Calming", "Relaxed"],
  stress: ["Relaxed", "Calming", "Stress Relief"],
  depression: ["Uplifted", "Happy", "Euphoric"],
  nausea: ["Relaxed", "medical"],
  appetite: ["Hungry", "Appetite"],
  munchies: ["Hungry", "Appetite"],
  // flavors
  limey: ["Lime", "Citrus"],
  lime: ["Lime", "Citrus"],
  lemon: ["Lemon", "Citrus"],
  citrus: ["Citrus", "Lemon", "Orange", "Lime"],
  orange: ["Orange", "Citrus"],
  fruity: ["Fruity", "Berry", "Tropical"],
  fruit: ["Fruity", "Berry"],
  sweet: ["Sweet", "Candy", "Berry"],
  sugar: ["Sweet", "Candy"],
  candy: ["Sweet", "Candy"],
  earthy: ["Earthy", "Woody"],
  earth: ["Earthy"],
  woody: ["Woody", "Earthy"],
  wood: ["Woody"],
  pine: ["Pine", "Piney"],
  piney: ["Pine", "Piney"],
  pungent: ["Pungent", "Diesel", "Skunky"],
  diesel: ["Diesel", "Fuel"],
  fuel: ["Diesel", "Fuel"],
  gas: ["Diesel", "Fuel", "Pungent"],
  skunky: ["Skunky", "Pungent"],
  skunk: ["Skunky"],
  spicy: ["Spicy", "Pepper"],
  pepper: ["Pepper", "Spicy"],
  herbal: ["Herbal", "Earthy"],
  floral: ["Floral", "Lavender"],
  lavender: ["Lavender", "Floral"],
  berry: ["Berry", "Blueberry", "Fruity"],
  blueberry: ["Blueberry", "Berry"],
  grape: ["Grape", "Berry"],
  tropical: ["Tropical", "Mango", "Fruity"],
  mango: ["Mango", "Tropical"],
  vanilla: ["Vanilla", "Sweet"],
  chocolate: ["Chocolate", "Sweet"],
  cookies: ["Sweet", "Vanilla", "Cookies"],
  creamy: ["Creamy", "Sweet"],
  cheese: ["Cheese", "Pungent"],
  // terpenes
  limonene: ["Limonene"],
  myrcene: ["Myrcene"],
  caryophyllene: ["Caryophyllene"],
  linalool: ["Linalool"],
  pinene: ["Pinene"],
  terpinolene: ["Terpinolene"],
  humulene: ["Humulene"],
  ocimene: ["Ocimene"],
  // type
  sativa: ["Sativa"],
  indica: ["Indica"],
  hybrid: ["Hybrid"],
  // occasions & activities
  daytime: ["daytime", "Energetic"],
  morning: ["daytime", "wake-and-bake", "Energetic"],
  wake: ["daytime", "wake-and-bake"],
  afternoon: ["daytime", "Focused"],
  evening: ["nighttime", "Relaxed"],
  party: ["social", "Happy", "Euphoric"],
  workout: ["Energetic", "Active"],
  hiking: ["Energetic", "Active", "outdoor"],
  outdoor: ["outdoor", "Energetic"],
  meditation: ["Focused", "Calming"],
  music: ["Creative", "Euphoric"],
  art: ["Creative", "Artistic"],
  movie: ["Relaxed", "Couch-lock"],
  gaming: ["Focused", "Creative"],
  study: ["Focused", "Alert"],
  // special tags
  classic: ["classic"],
  kush: ["Kush", "OG"],
  og: ["OG", "Kush"],
  haze: ["Haze"],
  diesel: ["Diesel"],
};

// ─── Semantic strain search ────────────────────────────────────────────────────
function searchStrains(query) {
  const words = query.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  // Build an expanded set of target terms from the query
  const targets = new Set();
  const nameFragments = [];

  for (const word of words) {
    // Add the raw word itself
    targets.add(word);
    nameFragments.push(word);

    // Expand through semantic map
    const mapped = SEMANTIC[word];
    if (mapped) {
      for (const t of mapped) targets.add(t.toLowerCase());
    }
  }

  const scores = STRAINS_DB.map(strain => {
    let score = 0;

    // ① Direct name match (highest priority)
    const nameLower = strain.name.toLowerCase();
    for (const frag of nameFragments) {
      if (nameLower === frag) { score += 20; break; }
      if (nameLower.includes(frag) && frag.length >= 3) { score += 10; break; }
    }

    // ② Type match
    if (targets.has(strain.type.toLowerCase())) score += 6;

    // ③ Effects match
    for (const effect of strain.effects) {
      if (targets.has(effect.toLowerCase())) score += 5;
    }

    // ④ Flavors match
    for (const flavor of strain.flavors) {
      if (targets.has(flavor.toLowerCase())) score += 4;
    }

    // ⑤ Tags match
    for (const tag of strain.tags) {
      if (targets.has(tag.toLowerCase())) score += 3;
    }

    // ⑥ Terpenes match
    for (const terpene of strain.terpenes) {
      if (targets.has(terpene.toLowerCase())) score += 3;
    }

    // ⑦ Description keyword match (light bonus)
    const descLower = strain.description.toLowerCase();
    for (const word of words) {
      if (word.length >= 4 && descLower.includes(word)) score += 1;
    }

    return { strain, score };
  });

  // Sort by score desc, then by rating as tiebreaker
  scores.sort((a, b) => b.score - a.score || b.strain.rating - a.strain.rating);

  // Return top 4 with score > 0, or top 4 overall if no matches
  const top = scores.filter(s => s.score > 0).slice(0, 4);
  const results = top.length >= 2 ? top : scores.slice(0, 4);

  return results.map(({ strain }) => ({
    name: strain.name,
    type: strain.type,
    thc: `${strain.thc_min}–${strain.thc_max}%`,
    cbd: strain.cbd < 0.5 ? "<1%" : `${strain.cbd}%`,
    description: strain.description,
    effects: strain.effects.slice(0, 5),
  }));
}

function getStrains(query) {
  const results = searchStrains(query);
  return { strains: results };
}

// ─── Mary Jane chat ────────────────────────────────────────────────────────────
const MJ_SYSTEM = `You are Mary Jane — the AI assistant and cannabis intelligence guide for Cannascenti, the world's most authoritative cannabis magazine and education platform.

Your personality:
- Warm, confident, and genuinely knowledgeable — like a best friend who happens to be the greatest cannabis expert alive
- Conversational and real — never robotic, never overly formal
- Passionate about cannabis culture, education, and elevating the conversation around the plant
- You have lived experience on the dispensary floor — not just book knowledge
- Playful and a little witty, but always professional and helpful

What you know deeply:
- Every strain, terpene, cannabinoid, and effect — you can speak to all of it
- Hash culture: bubble hash, dry sift, rosin, live hash, kief — the history, the techniques, the tasting notes
- Cannascenti's offerings: The Magazine, Cannalogy education hub, Joint Rolling Seminars (Beginner/Intermediate/Advanced), Hash events (Taste the Courage tasting events, Solventless Sessions, Hash Nights), CannaQuant — your personal cannabis consultant and budtender for life (personal consumer sessions, dispensary consulting, business strategy, staff training), AI Strain Finder, Budtender Pro tool
- Joint rolling techniques from basics to advanced (cross joints, tulips, backwoods, Dutch masters, etc.)
- How to evaluate cannabis quality — label reading, terpene profiles, the entourage effect
- Dosing, consumption methods, harm reduction

How you help:
- Recommend strains based on what someone describes (you can tell them to also use the Strain Finder on the page)
- Guide people to the right Cannascenti service (seminar, consultation, hash event, etc.)
- Educate on any cannabis topic simply and clearly
- Help people book or learn more about consulting or seminars (direct them to contact or the relevant section)
- Answer any cannabis question with depth and confidence

Keep responses concise and conversational — 2–4 sentences usually. Go longer only when explaining something complex. Never use bullet lists in chat — write naturally. Never say you're an AI language model — you are Mary Jane, Cannascenti's guide.`;

async function streamChat(messages, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const stream = client.messages.stream({
    model: "claude-opus-4-6",
    max_tokens: 600,
    system: MJ_SYSTEM,
    messages,
  });

  stream.on("text", (delta) => {
    res.write(`data: ${JSON.stringify({ delta })}\n\n`);
  });

  stream.on("finalMessage", () => {
    res.write("data: [DONE]\n\n");
    res.end();
  });

  stream.on("error", (err) => {
    console.error("Stream error:", err.message);
    res.write("data: [DONE]\n\n");
    res.end();
  });
}

// ─── HTTP server ───────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const { messages } = JSON.parse(body);
        if (!Array.isArray(messages) || messages.length === 0) {
          res.writeHead(400); res.end("Bad request"); return;
        }
        const safe = messages.slice(-20).filter(m =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.length <= 2000
        );
        await streamChat(safe, res);
      } catch (err) {
        console.error("Chat error:", err.message);
        if (!res.headersSent) { res.writeHead(500); res.end("Error"); }
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/strains") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { query } = JSON.parse(body);
        if (!query || typeof query !== "string" || query.length > 200) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid query" }));
          return;
        }
        const data = getStrains(query.trim());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      } catch (err) {
        console.error("Strain error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to search strains" }));
      }
    });
    return;
  }

  // ─── Legal pages ──────────────────────────────────────────────────────────
  if (req.method === "GET" && (req.url === "/privacy" || req.url === "/terms")) {
    const isPrivacy = req.url === "/privacy";
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${isPrivacy ? "Privacy Policy" : "Terms of Use"} — Cannascenti</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#081c15;color:#e8e0ce;font-family:system-ui,sans-serif;padding:60px 32px;max-width:760px;margin:0 auto;line-height:1.7}h1{font-size:28px;margin-bottom:8px;color:#fff}h2{font-size:17px;margin:32px 0 10px;color:#fff}p,li{font-size:15px;color:rgba(232,224,206,0.7);margin-bottom:12px}ul{padding-left:20px}a{color:#52b788}nav{margin-bottom:40px;font-size:13px}<style>
</head><body>
<nav><a href="/" style="color:#52b788;text-decoration:none;">← Back to Cannascenti</a></nav>
${isPrivacy ? `<h1>Privacy Policy</h1><p>Last updated: April 2026</p>
<h2>What We Collect</h2><p>When you subscribe to our newsletter, we collect your email address and your quiz result profile (e.g., "Relax", "Focus"). We do not collect names, payment information, or precise location data.</p>
<h2>How We Use It</h2><p>Your email is used only to send cannabis recommendations and educational content from Cannascenti. We do not sell, rent, or share your email with third parties.</p>
<h2>Analytics</h2><p>We collect anonymous event data (e.g., which quiz profiles are popular, which strain cards are clicked). This data contains no personally identifiable information.</p>
<h2>Cookies & Local Storage</h2><p>We use your browser's localStorage to save your quiz profile for a better return experience. No third-party tracking cookies are used.</p>
<h2>Your Rights</h2><p>You can unsubscribe from emails at any time. To request deletion of your data, contact us at hello@cannascenti.com.</p>
<h2>Contact</h2><p>Questions? Email us at hello@cannascenti.com.</p>` : `<h1>Terms of Use</h1><p>Last updated: April 2026</p>
<h2>Educational Content Only</h2><p>Cannascenti provides cannabis education, strain information, and recommendations for informational purposes only. We do not sell cannabis or cannabis products.</p>
<h2>Age Requirement</h2><p>By using this site you confirm you are 21 years of age or older (or the legal age in your jurisdiction). Cannabis laws vary by location — it is your responsibility to know and follow local laws.</p>
<h2>No Medical Advice</h2><p>Nothing on this site constitutes medical advice. Consult a healthcare professional before using cannabis for medical purposes.</p>
<h2>Affiliate Links</h2><p>Some strain links on this site may be affiliate links. We may earn a small commission if you purchase through them, at no cost to you.</p>
<h2>Limitation of Liability</h2><p>Cannascenti is not liable for any decisions made based on content found on this site. Use information responsibly.</p>
<h2>Contact</h2><p>Questions? Email us at hello@cannascenti.com.</p>`}
</body></html>`;
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "public, max-age=86400" });
    res.end(html);
    return;
  }

  // ─── Analytics tracking ────────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/api/track") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { event, data } = JSON.parse(body);
        if (!event || typeof event !== "string" || event.length > 100) {
          res.writeHead(400); res.end(); return;
        }
        const entry = JSON.stringify({ event, data: data || {}, ts: new Date().toISOString() }) + "\n";
        fs.appendFile(path.join(__dirname, "analytics.jsonl"), entry, () => {});
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400); res.end();
      }
    });
    return;
  }

  // ─── Admin dashboard ───────────────────────────────────────────────────────
  if (req.method === "GET" && req.url.startsWith("/admin")) {
    const adminKey = process.env.ADMIN_KEY || "cannascenti2025";
    const url = new URL(req.url, "http://localhost");
    if (url.searchParams.get("key") !== adminKey) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Unauthorized"); return;
    }
    const analyticsPath = path.join(__dirname, "analytics.jsonl");
    const subsPath = path.join(__dirname, "subscribers.jsonl");
    const readLines = (filePath) => {
      try {
        return fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
      } catch { return []; }
    };
    const events = readLines(analyticsPath);
    const subs = readLines(subsPath);
    const profiles = {relax:0, focus:0, sleep:0, creative:0, uplift:0, balanced:0};
    const strains = {};
    const refines = {light:0, energy:0, relax_dir:0};
    events.forEach(e => {
      if (e.event === "quiz_result" && e.data.profile) {
        profiles[e.data.profile] = (profiles[e.data.profile]||0) + 1;
      }
      if (e.event === "strain_click" && e.data.strain) {
        strains[e.data.strain] = (strains[e.data.strain]||0) + 1;
      }
      if (e.event === "refine_click") {
        const d = e.data.direction;
        if (d === "light") refines.light++;
        else if (d === "energy") refines.energy++;
        else if (d === "relax") refines.relax_dir++;
      }
    });
    const totalQuiz = events.filter(e => e.event === "quiz_result").length;
    const totalClicks = events.filter(e => e.event === "strain_click").length;
    const topStrains = Object.entries(strains).sort((a,b) => b[1]-a[1]).slice(0, 10);
    const profileColors = {relax:"#52b788",focus:"#f4a261",sleep:"#7b9ccc",creative:"#c084fc",uplift:"#fbbf24",balanced:"#9ca3af"};
    const maxProfile = Math.max(...Object.values(profiles), 1);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cannascenti Analytics</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0a120a;color:#e8e0ce;font-family:system-ui,sans-serif;padding:40px 32px;max-width:960px;margin:0 auto}
  h1{font-size:24px;font-weight:700;margin-bottom:4px;color:#fff}
  .sub{font-size:13px;color:rgba(232,224,206,0.4);margin-bottom:40px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:40px}
  .stat{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:20px}
  .stat-num{font-size:36px;font-weight:700;color:#52b788;margin-bottom:4px}
  .stat-label{font-size:12px;color:rgba(232,224,206,0.45);letter-spacing:0.1em;text-transform:uppercase}
  h2{font-size:16px;font-weight:600;color:#fff;margin-bottom:20px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.07)}
  .section{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:24px;margin-bottom:24px}
  .bar-row{display:flex;align-items:center;gap:12px;margin-bottom:12px}
  .bar-label{width:100px;font-size:13px;color:rgba(232,224,206,0.7);text-transform:capitalize}
  .bar-track{flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden}
  .bar-fill{height:100%;border-radius:4px;transition:width 0.6s}
  .bar-count{font-size:13px;color:rgba(232,224,206,0.5);width:30px;text-align:right}
  .strain-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:14px}
  .strain-row:last-child{border-bottom:none}
  .strain-count{color:#52b788;font-weight:600}
  .refine-row{display:flex;gap:16px;flex-wrap:wrap}
  .refine-chip{background:rgba(255,255,255,0.05);border-radius:20px;padding:8px 18px;font-size:13px;color:rgba(232,224,206,0.7)}
  .refine-chip span{color:#52b788;font-weight:700;margin-left:6px}
  .ts{font-size:11px;color:rgba(232,224,206,0.3);margin-top:16px}
  @media(max-width:600px){.grid{grid-template-columns:1fr 1fr}}
</style></head><body>
<h1>Cannascenti Analytics</h1>
<div class="sub">Live data — refreshes on reload</div>
<div class="grid">
  <div class="stat"><div class="stat-num">${totalQuiz}</div><div class="stat-label">Quiz Completions</div></div>
  <div class="stat"><div class="stat-num">${totalClicks}</div><div class="stat-label">Strain Clicks</div></div>
  <div class="stat"><div class="stat-num">${subs.length}</div><div class="stat-label">Subscribers</div></div>
  <div class="stat"><div class="stat-num">${events.length}</div><div class="stat-label">Total Events</div></div>
</div>
<div class="section">
  <h2>Profile Distribution</h2>
  ${Object.entries(profiles).map(([k,v]) => `
    <div class="bar-row">
      <div class="bar-label">${k}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round(v/maxProfile*100)}%;background:${profileColors[k]||'#52b788'}"></div></div>
      <div class="bar-count">${v}</div>
    </div>`).join("")}
</div>
<div class="section">
  <h2>Top Strain Clicks</h2>
  ${topStrains.length ? topStrains.map(([name,count]) => `
    <div class="strain-row"><span>${name}</span><span class="strain-count">${count}</span></div>`).join("") : '<div style="color:rgba(232,224,206,0.35);font-size:14px">No clicks yet</div>'}
</div>
<div class="section">
  <h2>Refine Button Usage</h2>
  <div class="refine-row">
    <div class="refine-chip">Less intense<span>${refines.light}</span></div>
    <div class="refine-chip">More energy<span>${refines.energy}</span></div>
    <div class="refine-chip">More relaxing<span>${refines.relax_dir}</span></div>
  </div>
</div>
<div class="ts">Last updated: ${new Date().toLocaleString()}</div>
</body></html>`;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  if (req.method === "POST" && req.url === "/api/email") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { email, profile } = JSON.parse(body);
        if (!email || typeof email !== "string" || !email.includes("@") || email.length > 200) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid email" }));
          return;
        }
        const entry = JSON.stringify({ email: email.trim(), profile: profile || null, ts: new Date().toISOString() }) + "\n";
        fs.appendFile(path.join(__dirname, "subscribers.jsonl"), entry, err => {
          if (err) console.error("Email save error:", err.message);
        });
        console.log(`New subscriber: ${email.trim()} (${profile || "unknown"})`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error("Email error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed" }));
      }
    });
    return;
  }

  // Strip query strings for file path resolution
  const urlPath = req.url.split("?")[0];
  let filePath = urlPath === "/" ? "/index.html" : urlPath;
  filePath = path.join(__dirname, filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(filePath);
    const mime = MIME[ext] || "application/octet-stream";
    const cacheControl = CACHE_TTL[ext] || "public, max-age=3600";
    const acceptsGzip = (req.headers["accept-encoding"] || "").includes("gzip");

    const sendResponse = (body, compressed) => {
      const headers = { "Content-Type": mime, "Cache-Control": cacheControl };
      if (compressed) { headers["Content-Encoding"] = "gzip"; headers["Vary"] = "Accept-Encoding"; }
      res.writeHead(200, headers);
      res.end(body);
    };

    if (!acceptsGzip) { sendResponse(data, false); return; }

    // Serve from gzip cache if available (don't cache HTML — it deploys frequently)
    if (ext !== ".html" && gzipCache.has(filePath)) {
      sendResponse(gzipCache.get(filePath), true); return;
    }

    zlib.gzip(data, { level: 6 }, (gzipErr, compressed) => {
      if (gzipErr) { sendResponse(data, false); return; }
      if (ext !== ".html") gzipCache.set(filePath, compressed);
      sendResponse(compressed, true);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Cannascenti running at http://localhost:${PORT}`));
