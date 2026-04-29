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
const STRAINS_PATH = path.join(__dirname, "strains.json");
let STRAINS_DB = JSON.parse(fs.readFileSync(STRAINS_PATH, "utf8"));
console.log(`Loaded ${STRAINS_DB.length} strains from local database.`);

function reloadStrains() {
  STRAINS_DB = JSON.parse(fs.readFileSync(STRAINS_PATH, "utf8"));
}

function saveStrains() {
  fs.writeFileSync(STRAINS_PATH, JSON.stringify(STRAINS_DB, null, 2));
}

// Serve strain photos from /public/photos/
const PHOTOS_DIR = path.join(__dirname, "public", "photos");
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

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
    if (strain.description) {
      const descLower = strain.description.toLowerCase();
      for (const word of words) {
        if (word.length >= 4 && descLower.includes(word)) score += 1;
      }
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

async function generateStrainWithAI(query) {
  const prompt = `You are a cannabis expert. Give me a strain profile for "${query}".
Respond ONLY with a JSON array of 1–4 matching strains (or the closest real strains if the exact name isn't real). Each object must have exactly these fields:
{
  "name": string,
  "type": "Indica" | "Sativa" | "Hybrid",
  "thc": "XX–XX%",
  "cbd": "X.X%",
  "description": string (2 sentences max),
  "effects": [string, string, string, string, string]
}
No markdown, no explanation, just the JSON array.`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }]
  });

  const text = response.content[0].text.trim();
  const json = text.startsWith('[') ? text : text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  return JSON.parse(json);
}

async function generateProductsWithAI(query) {
  const prompt = `You are a cannabis retail expert. A user searched for: "${query}"

Is this a cannabis PRODUCT search? Products include: edibles (gummies, chocolates, beverages, baked goods), vapes/cartridges, concentrates (wax, shatter, rosin, live resin, distillate, hash, kief), pre-rolls/joints, flower/bud, topicals (creams, patches, balms), tinctures, capsules/pills, or specific cannabis brands (Stiiizy, Kiva, Wyld, Wana, Raw Garden, Cookies, Select, Heavy Hitters, etc.).

If this is a PURE strain name search (like "Blue Dream", "OG Kush", "Gorilla Glue") with no product type context — respond with exactly: []

If YES it's a product query, respond with a JSON array of 1–3 relevant product results:
[{
  "name": string (product name or category, e.g. "Cannabis Gummies" or "Stiiizy Pod"),
  "category": one of "Edibles" | "Vapes" | "Concentrates" | "Pre-Rolls" | "Flower" | "Topicals" | "Tinctures" | "Capsules",
  "brand": string or null,
  "description": string (2 sentences about this product type or brand),
  "onset": string (e.g. "30–90 min" for edibles, "Immediate" for vapes),
  "duration": string (e.g. "4–8 hours"),
  "best_for": [string, string, string],
  "dosing_tip": string (1 practical sentence),
  "beginner_friendly": boolean,
  "price_range": string (e.g. "$15–35 per unit")
}]

No markdown, no explanation — only the JSON array.`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }]
  });

  const text = response.content[0].text.trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']') + 1;
  if (start === -1) return [];
  return JSON.parse(text.slice(start, end));
}

async function getStrains(query) {
  const localResults = searchStrains(query);
  // If we got at least one real match (score > 0), use local data
  const hasRealMatch = localResults.length > 0 &&
    STRAINS_DB.some(s => {
      const n = s.name.toLowerCase();
      return query.toLowerCase().split(/\s+/).some(w => w.length >= 3 && n.includes(w));
    });

  if (hasRealMatch) return { strains: localResults };

  // Fall back to AI generation for unknown strains
  try {
    const aiStrains = await generateStrainWithAI(query);
    return { strains: aiStrains, generated: true };
  } catch (e) {
    console.error('AI strain generation failed:', e.message);
    return { strains: localResults };
  }
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

// Per-profile context injected into system prompt so Mary Jane knows who she's talking to
const PROFILE_CONTEXT = {
  relax:    "This user's quiz profile is 'The Relaxed Evening Unwinder'. They want to decompress and release tension. Their top matched strains were Wedding Cake, Granddaddy Purple, and Northern Lights. Key terpenes for them: myrcene, linalool, caryophyllene.",
  focus:    "This user's quiz profile is 'The Sharp Daytime Achiever'. They want focus, clarity, and productivity. Their top matched strains were Jack Herer, Durban Poison, and Green Crack. Key terpenes: terpinolene, pinene.",
  sleep:    "This user's quiz profile is 'The Deep Rest Seeker'. They struggle with sleep and want full sedation. Their top matched strains were Bubba Kush, 9 Pound Hammer, and Purple Punch. Key terpenes: myrcene, caryophyllene.",
  creative: "This user's quiz profile is 'The Creative Mind Explorer'. They want to make things and think differently. Their top matched strains were Blue Dream, Amnesia Haze, and Strawberry Cough. Key terpenes: limonene, ocimene.",
  uplift:   "This user's quiz profile is 'The Social Energy Seeker'. They want euphoria, social energy, and a bright mood. Their top matched strains were Sour Diesel, Trainwreck, and Super Lemon Haze. Key terpenes: limonene, caryophyllene.",
  balanced: "This user's quiz profile is 'The Balanced Everyday Smoker'. They want a smooth, versatile effect — not too sedating, not too wired. Their top matched strains were Girl Scout Cookies, Pineapple Express, and Cannatonic.",
};

async function streamChat(messages, res, context) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Build personalized system prompt if we have profile context
  let system = MJ_SYSTEM;
  if (context) {
    const parts = [];
    if (context.profile && PROFILE_CONTEXT[context.profile]) {
      parts.push(`\n\nUSER PROFILE CONTEXT:\n${PROFILE_CONTEXT[context.profile]}`);
      parts.push("Reference their profile naturally when relevant — don't announce it every message, but use it to give personalized recommendations.");
    }
    if (context.memory && context.memory.length > 0) {
      parts.push(`\nUSER STRAIN MEMORY (what they've told you about past experiences):\n${context.memory.join('\n')}`);
      parts.push("Use this memory to give smarter, more personalized recommendations.");
    }
    if (parts.length > 0) system += parts.join('\n');
  }

  const stream = client.messages.stream({
    model: "claude-opus-4-6",
    max_tokens: 600,
    system,
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
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
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
        const { messages, context } = JSON.parse(body);
        if (!Array.isArray(messages) || messages.length === 0) {
          res.writeHead(400); res.end("Bad request"); return;
        }
        const safe = messages.slice(-20).filter(m =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.length <= 2000
        );
        // Sanitize context — only allow known profile keys and short memory strings
        const safeContext = context && typeof context === "object" ? {
          profile: typeof context.profile === "string" && PROFILE_CONTEXT[context.profile] ? context.profile : null,
          memory: Array.isArray(context.memory) ? context.memory.slice(0, 10).filter(m => typeof m === "string" && m.length <= 200) : []
        } : null;
        await streamChat(safe, res, safeContext);
      } catch (err) {
        console.error("Chat error:", err.message);
        if (!res.headersSent) { res.writeHead(500); res.end("Error"); }
      }
    });
    return;
  }

  // ─── Return full strain database for Browse All tab ──────────────────────
  if (req.method === "GET" && req.url === "/api/strains/all") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",  // 5-min cache
    });
    res.end(JSON.stringify(STRAINS_DB));
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
        getStrains(query.trim()).then(data => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
        }).catch(err => {
          console.error("Strain error:", err.message);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to search strains" }));
        });
      } catch (err) {
        console.error("Strain error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to search strains" }));
      }
    });
    return;
  }

  // ─── Product search ────────────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/api/products") {
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
        generateProductsWithAI(query.trim()).then(data => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ products: data }));
        }).catch(err => {
          console.error("Product error:", err.message);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ products: [] }));
        });
      } catch (err) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ products: [] }));
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

  // ─── Dispensary pitch page ─────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/for-dispensaries") {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>For Dispensaries — Cannascenti</title>
<meta name="description" content="Cannascenti helps dispensaries connect customers to the right products — increasing basket size, reducing budtender load, and building loyalty.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400;1,600&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--dark:#060f0a;--card-bg:rgba(255,255,255,0.02);--green:#52b788;--bright-green:#74c69d;--cream:#f2ead8;--border:rgba(255,255,255,0.07)}
body{background:var(--dark);color:var(--cream);font-family:'Montserrat',sans-serif;line-height:1.7;overflow-x:hidden}
a{color:var(--bright-green);text-decoration:none}
/* nav */
.d-nav{display:flex;align-items:center;justify-content:space-between;padding:24px 60px;border-bottom:1px solid var(--border)}
.d-nav-logo{font-family:'Cormorant Garamond',serif;font-size:20px;color:var(--cream);letter-spacing:0.08em}
.d-nav-back{font-size:12px;color:rgba(242,234,216,0.4);letter-spacing:0.1em;text-transform:uppercase;transition:color .2s}
.d-nav-back:hover{color:var(--bright-green)}
@media(max-width:600px){.d-nav{padding:20px 24px}}
/* hero */
.d-hero{padding:120px 60px 100px;max-width:1100px;margin:0 auto;border-bottom:1px solid var(--border)}
.d-hero-label{font-size:11px;letter-spacing:.35em;text-transform:uppercase;color:var(--bright-green);margin-bottom:16px}
.d-hero-title{font-family:'Cormorant Garamond',serif;font-size:clamp(38px,6vw,72px);line-height:1.1;color:var(--cream);margin-bottom:28px}
.d-hero-title em{font-style:italic;color:var(--bright-green)}
.d-hero-desc{font-size:16px;color:rgba(242,234,216,0.55);max-width:560px;line-height:1.8;margin-bottom:44px}
.d-hero-cta{display:inline-block;background:var(--bright-green);color:#060f0a;font-size:11px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;padding:16px 36px;border-radius:2px;transition:opacity .2s}
.d-hero-cta:hover{opacity:.85;color:#060f0a}
.d-hero-sub{margin-top:16px;font-size:12px;color:rgba(242,234,216,0.3);letter-spacing:.04em}
@media(max-width:600px){.d-hero{padding:80px 24px 70px}}
/* stats bar */
.d-stats{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid var(--border)}
.d-stat{padding:44px 60px;border-right:1px solid var(--border)}
.d-stat:last-child{border-right:none}
.d-stat-num{font-family:'Cormorant Garamond',serif;font-size:clamp(36px,4vw,54px);color:var(--cream);margin-bottom:6px;line-height:1}
.d-stat-num em{color:var(--bright-green);font-style:normal}
.d-stat-label{font-size:12px;color:rgba(242,234,216,0.4);letter-spacing:.08em}
@media(max-width:760px){.d-stats{grid-template-columns:1fr;}.d-stat{padding:32px 24px;border-right:none;border-bottom:1px solid var(--border)}.d-stat:last-child{border-bottom:none}}
/* features */
.d-features{padding:90px 60px;max-width:1100px;margin:0 auto;border-bottom:1px solid var(--border)}
.d-section-label{font-size:11px;letter-spacing:.35em;text-transform:uppercase;color:var(--bright-green);margin-bottom:14px}
.d-section-title{font-family:'Cormorant Garamond',serif;font-size:clamp(28px,3.5vw,44px);color:var(--cream);font-style:italic;line-height:1.2;margin-bottom:56px}
.d-feature-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:28px}
.d-feature-card{background:var(--card-bg);border:1px solid var(--border);border-radius:4px;padding:36px;transition:border-color .25s}
.d-feature-card:hover{border-color:rgba(82,183,136,0.3)}
.d-feature-icon{font-size:22px;margin-bottom:18px}
.d-feature-heading{font-family:'Cormorant Garamond',serif;font-size:22px;color:var(--cream);margin-bottom:10px;line-height:1.3}
.d-feature-desc{font-size:13px;color:rgba(242,234,216,0.45);line-height:1.8}
@media(max-width:760px){.d-features{padding:60px 24px}.d-feature-grid{grid-template-columns:1fr}}
/* how */
.d-how{padding:90px 60px;border-bottom:1px solid var(--border);max-width:1100px;margin:0 auto}
.d-how-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;margin-top:56px}
.d-how-step-num{font-family:'Cormorant Garamond',serif;font-size:48px;color:rgba(82,183,136,0.15);line-height:1;margin-bottom:16px}
.d-how-step-heading{font-family:'Cormorant Garamond',serif;font-size:20px;color:var(--cream);margin-bottom:10px}
.d-how-step-desc{font-size:13px;color:rgba(242,234,216,0.45);line-height:1.8}
@media(max-width:760px){.d-how{padding:60px 24px}.d-how-steps{grid-template-columns:1fr;gap:32px}}
/* testimonial */
.d-testimonial{padding:90px 60px;border-bottom:1px solid var(--border);text-align:center}
.d-testimonial-quote{font-family:'Cormorant Garamond',serif;font-size:clamp(22px,3vw,34px);color:var(--cream);font-style:italic;max-width:780px;margin:0 auto 24px;line-height:1.5}
.d-testimonial-attr{font-size:12px;color:rgba(242,234,216,0.35);letter-spacing:.15em;text-transform:uppercase}
@media(max-width:600px){.d-testimonial{padding:60px 24px}}
/* cta */
.d-cta{padding:100px 60px;text-align:center;border-bottom:1px solid var(--border)}
.d-cta-title{font-family:'Cormorant Garamond',serif;font-size:clamp(32px,4.5vw,56px);color:var(--cream);font-style:italic;margin-bottom:20px;line-height:1.2}
.d-cta-desc{font-size:14px;color:rgba(242,234,216,0.45);margin-bottom:44px;max-width:480px;margin-left:auto;margin-right:auto;line-height:1.8}
.d-cta-btn{display:inline-block;background:var(--bright-green);color:#060f0a;font-size:11px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;padding:16px 40px;border-radius:2px;transition:opacity .2s}
.d-cta-btn:hover{opacity:.85;color:#060f0a}
.d-cta-note{margin-top:14px;font-size:12px;color:rgba(242,234,216,0.25)}
@media(max-width:600px){.d-cta{padding:70px 24px}}
/* footer */
.d-footer{padding:36px 60px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px}
.d-footer-copy{font-size:12px;color:rgba(242,234,216,0.25)}
.d-footer-links{display:flex;gap:24px}
.d-footer-links a{font-size:12px;color:rgba(242,234,216,0.3);transition:color .2s}
.d-footer-links a:hover{color:var(--bright-green)}
@media(max-width:600px){.d-footer{padding:28px 24px;flex-direction:column;align-items:flex-start}}
</style>
</head>
<body>

<nav class="d-nav">
  <span class="d-nav-logo">Cannascenti</span>
  <a href="/" class="d-nav-back">← Back to site</a>
</nav>

<div class="d-hero">
  <div class="d-hero-label">✦ For Dispensaries</div>
  <h1 class="d-hero-title">Your customers don't know<br>what they want.<br><em>We do.</em></h1>
  <p class="d-hero-desc">Cannascenti turns confused shoppers into confident buyers — with a quiz-based personalization engine that drives larger carts, repeat visits, and word-of-mouth.</p>
  <a href="mailto:hello@cannascenti.com?subject=Partnership%20Inquiry" class="d-hero-cta">Get in touch</a>
  <p class="d-hero-sub">No commitment. We'll walk you through the partnership in 20 minutes.</p>
</div>

<div class="d-stats">
  <div class="d-stat">
    <div class="d-stat-num"><em>4,200+</em></div>
    <div class="d-stat-label">profiles matched to date</div>
  </div>
  <div class="d-stat">
    <div class="d-stat-num">30<em>s</em></div>
    <div class="d-stat-label">average quiz completion time</div>
  </div>
  <div class="d-stat">
    <div class="d-stat-num"><em>6</em></div>
    <div class="d-stat-label">personalized cannabis profiles</div>
  </div>
</div>

<div class="d-features">
  <div class="d-section-label">✦ What You Get</div>
  <h2 class="d-section-title">Everything a modern dispensary needs<br>to sell smarter.</h2>
  <div class="d-feature-grid">
    <div class="d-feature-card">
      <div class="d-feature-icon">◈</div>
      <h3 class="d-feature-heading">Branded quiz for your store</h3>
      <p class="d-feature-desc">We white-label the Cannascenti match quiz with your branding, your product catalog, and your store's tone. Customers get personalized picks — from your menu.</p>
    </div>
    <div class="d-feature-card">
      <div class="d-feature-icon">✦</div>
      <h3 class="d-feature-heading">Budtender support tool</h3>
      <p class="d-feature-desc">Give your staff a tablet-ready version of Mary Jane — our AI budtender. She handles the common questions so your team can focus on high-value conversations.</p>
    </div>
    <div class="d-feature-card">
      <div class="d-feature-icon">◐</div>
      <h3 class="d-feature-heading">Customer insights dashboard</h3>
      <p class="d-feature-desc">See which profiles walk through your door, which strains convert best, and how your customers' preferences trend over time. Real data, not guesswork.</p>
    </div>
    <div class="d-feature-card">
      <div class="d-feature-icon">◇</div>
      <h3 class="d-feature-heading">Email capture & retention</h3>
      <p class="d-feature-desc">The quiz naturally captures emails from high-intent customers. We set up automated profile-matched follow-ups that drive repeat visits without spamming.</p>
    </div>
  </div>
</div>

<div class="d-how">
  <div class="d-section-label">✦ How It Works</div>
  <h2 class="d-section-title">Up and running in a week.</h2>
  <div class="d-how-steps">
    <div>
      <div class="d-how-step-num">01</div>
      <h3 class="d-how-step-heading">Send us your menu</h3>
      <p class="d-how-step-desc">Share your current product catalog — strains, SKUs, categories. We map it to our terpene and effect database.</p>
    </div>
    <div>
      <div class="d-how-step-num">02</div>
      <h3 class="d-how-step-heading">We configure your experience</h3>
      <p class="d-how-step-desc">Your branded quiz goes live with your products at the center. We test it against your top sellers and fine-tune recommendations.</p>
    </div>
    <div>
      <div class="d-how-step-num">03</div>
      <h3 class="d-how-step-heading">Embed, share, or link</h3>
      <p class="d-how-step-desc">Add it to your website, Leafly profile, email campaigns, or a QR code at the counter. Customers use it on their own or with staff guidance.</p>
    </div>
  </div>
</div>

<div class="d-testimonial">
  <p class="d-testimonial-quote">"The quiz cut our 'I don't know what I want' conversations in half. Customers come in knowing their profile — the upsell practically happens by itself."</p>
  <p class="d-testimonial-attr">— Early partner dispensary, Los Angeles</p>
</div>

<div class="d-cta">
  <h2 class="d-cta-title">Ready to personalize<br>your customer experience?</h2>
  <p class="d-cta-desc">We're onboarding a small number of dispensary partners this quarter. Spots are limited — reach out to get started.</p>
  <a href="mailto:hello@cannascenti.com?subject=Dispensary%20Partnership" class="d-cta-btn">Email us to get started</a>
  <p class="d-cta-note">Or email hello@cannascenti.com directly</p>
</div>

<footer class="d-footer">
  <span class="d-footer-copy">© 2026 Cannascenti. Must be 21+ where applicable.</span>
  <div class="d-footer-links">
    <a href="/">Home</a>
    <a href="/privacy">Privacy</a>
    <a href="/terms">Terms</a>
  </div>
</footer>

</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "public, max-age=3600" });
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

  // ─── Serve strain photos ──────────────────────────────────────────────────
  if (req.method === "GET" && req.url.startsWith("/public/photos/")) {
    const filename = path.basename(req.url);
    const filePath = path.join(PHOTOS_DIR, filename);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filename).toLowerCase();
      const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
                 : ext === ".png" ? "image/png"
                 : ext === ".webp" ? "image/webp" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=604800" });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404); res.end("Not found");
    }
    return;
  }

  // ─── Add-strain API (POST) ─────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/api/admin/add-strain") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { key, strain } = JSON.parse(body);
        const adminKey = process.env.ADMIN_KEY || "cannascenti2025";
        if (key !== adminKey) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" })); return;
        }
        if (!strain?.name || !strain?.type) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Name and type are required" })); return;
        }

        // Generate slug
        const slug = strain.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

        // Handle base64 photo → save to disk
        let photoUrl = strain.photoUrl || null;
        if (strain.photoData && strain.photoData.startsWith("data:image")) {
          const matches = strain.photoData.match(/^data:(image\/\w+);base64,(.+)$/);
          if (matches) {
            const ext = matches[1].split("/")[1] || "jpg";
            const buf = Buffer.from(matches[2], "base64");
            const filename = `${slug}-${Date.now()}.${ext}`;
            fs.writeFileSync(path.join(PHOTOS_DIR, filename), buf);
            photoUrl = `/public/photos/${filename}`;
          }
        }

        // Build the strain object
        const newStrain = {
          name:        strain.name.trim(),
          slug,
          type:        strain.type,
          thc_min:     strain.thc_min ? parseInt(strain.thc_min) : null,
          thc_max:     strain.thc_max ? parseInt(strain.thc_max) : null,
          thc:         strain.thc_min && strain.thc_max ? `${strain.thc_min}–${strain.thc_max}%` : null,
          cbd:         strain.cbd ? parseFloat(strain.cbd) : null,
          terpenes:    Array.isArray(strain.terpenes) ? strain.terpenes : (strain.terpenes || "").split(",").map(t => t.trim()).filter(Boolean),
          effects:     Array.isArray(strain.effects)  ? strain.effects  : (strain.effects  || "").split(",").map(e => e.trim()).filter(Boolean),
          flavors:     Array.isArray(strain.flavors)  ? strain.flavors  : (strain.flavors  || "").split(",").map(f => f.trim()).filter(Boolean),
          genetics:    strain.genetics || null,
          parents:     strain.parents  ? strain.parents.split(",").map(p => p.trim()).filter(Boolean) : [],
          description: strain.description || null,   // Mikey's personal review
          medical:     strain.medical   ? strain.medical.split(",").map(m => m.trim()).filter(Boolean) : [],
          bestFor:     strain.bestFor   || null,
          funFact:     strain.funFact   || null,
          tags:        strain.tags      ? strain.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
          rating:      strain.rating    ? parseFloat(strain.rating) : null,
          photoUrl,
          leaflyUrl:   strain.leaflyUrl   || `https://www.leafly.com/strains/${slug}`,
          weedmapsUrl: strain.weedmapsUrl || `https://weedmaps.com/strains/${slug}`,
          erbaUrl:     strain.erbaUrl    || null,  // "Buy at Erba Sawtelle" link
          inStockErba: !!strain.inStockErba,
          addedBy:     "Mikey @ Erba Sawtelle",
          addedAt:     new Date().toISOString(),
          isStaffPick: !!strain.isStaffPick,
        };

        // Replace if already exists, else prepend (new strains first)
        const idx = STRAINS_DB.findIndex(s => s.slug === slug || s.name.toLowerCase() === strain.name.toLowerCase().trim());
        if (idx >= 0) {
          STRAINS_DB[idx] = { ...STRAINS_DB[idx], ...newStrain };
        } else {
          STRAINS_DB.unshift(newStrain);
        }

        saveStrains();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, slug, total: STRAINS_DB.length }));
      } catch (err) {
        console.error("add-strain error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to save strain" }));
      }
    });
    return;
  }

  // ─── AI auto-fill strain info ──────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/api/admin/strain-autofill") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const { key, name } = JSON.parse(body);
        const adminKey = process.env.ADMIN_KEY || "cannascenti2025";
        if (key !== adminKey) { res.writeHead(401); res.end("Unauthorized"); return; }
        if (!name) { res.writeHead(400); res.end("Missing name"); return; }

        const msg = await client.messages.create({
          model: "claude-opus-4-6",
          max_tokens: 800,
          messages: [{
            role: "user",
            content: `You are a cannabis encyclopedia expert. Return ONLY a JSON object (no markdown, no commentary) for the cannabis strain "${name}" with exactly these fields:
{
  "type": "indica|sativa|hybrid",
  "thc_min": number,
  "thc_max": number,
  "cbd": number,
  "genetics": "Parent1 × Parent2",
  "parents": ["Parent1","Parent2"],
  "terpenes": ["Terpene1","Terpene2","Terpene3"],
  "effects": ["Effect1","Effect2","Effect3","Effect4","Effect5"],
  "flavors": ["Flavor1","Flavor2","Flavor3"],
  "medical": ["Condition1","Condition2","Condition3"],
  "bestFor": "one sentence",
  "funFact": "one interesting fact about genetics, origin, or cultural significance"
}
Only return factual, well-established information. If unsure about a field, use null.`
          }]
        });

        const text = msg.content.find(b => b.type === "text")?.text || "{}";
        // Extract JSON even if Claude adds any wrapper text
        const match = text.match(/\{[\s\S]*\}/);
        const data = match ? JSON.parse(match[0]) : {};
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      } catch (err) {
        console.error("autofill error:", err.message);
        res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ─── Add-strain CMS page ───────────────────────────────────────────────────
  if (req.method === "GET" && req.url.startsWith("/add-strain")) {
    const adminKey = process.env.ADMIN_KEY || "cannascenti2025";
    const url = new URL(req.url, "http://localhost");
    if (url.searchParams.get("key") !== adminKey) {
      res.writeHead(401, { "Content-Type": "text/plain" });
      res.end("Unauthorized — add ?key=YOUR_KEY to the URL"); return;
    }
    const key = url.searchParams.get("key");
    const COMMON_EFFECTS = ["Relaxed","Happy","Euphoric","Uplifted","Creative","Energetic","Focused","Sleepy","Hungry","Talkative","Giggly","Body High","Calm","Sedated","Aroused"];
    const COMMON_TERPS   = ["Myrcene","Caryophyllene","Limonene","Linalool","Pinene","Terpinolene","Ocimene","Humulene","Bisabolol","Nerolidol","Valencene","Geraniol"];
    const cmsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Add Strain — Cannascenti CMS</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#060e08;color:#e8e0ce;font-family:system-ui,sans-serif;padding:24px 20px;max-width:680px;margin:0 auto;padding-bottom:80px}
  h1{font-size:22px;font-weight:700;color:#52b788;margin-bottom:4px}
  .sub{font-size:12px;color:rgba(232,224,206,0.4);margin-bottom:32px}
  .section{background:rgba(82,183,136,0.04);border:1px solid rgba(82,183,136,0.15);border-radius:10px;padding:20px;margin-bottom:20px}
  .section-title{font-size:11px;letter-spacing:0.25em;text-transform:uppercase;color:#52b788;margin-bottom:16px;font-weight:700}
  label{display:block;font-size:12px;color:rgba(232,224,206,0.55);margin-bottom:5px;margin-top:14px;letter-spacing:0.05em}
  label:first-of-type{margin-top:0}
  input,textarea,select{width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:11px 13px;color:#e8e0ce;font-size:15px;font-family:inherit;outline:none;transition:border-color 0.2s;-webkit-appearance:none}
  input:focus,textarea:focus,select:focus{border-color:rgba(82,183,136,0.5)}
  textarea{resize:vertical;min-height:90px;line-height:1.55}
  select option{background:#0a120a}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
  .chip{padding:6px 13px;border-radius:20px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:rgba(232,224,206,0.6);font-size:12px;cursor:pointer;transition:all 0.15s;-webkit-tap-highlight-color:transparent;user-select:none}
  .chip.active{background:rgba(82,183,136,0.2);border-color:rgba(82,183,136,0.5);color:#52b788}
  .chip.terp.active{background:rgba(244,162,97,0.15);border-color:rgba(244,162,97,0.4);color:#f4a261}
  .photo-preview{width:100%;max-height:220px;object-fit:cover;border-radius:8px;margin-top:12px;display:none}
  .toggle-row{display:flex;align-items:center;gap:12px;padding:10px 0}
  .toggle-label{font-size:14px;color:rgba(232,224,206,0.75)}
  .toggle{position:relative;width:44px;height:26px;flex-shrink:0}
  .toggle input{opacity:0;width:0;height:0}
  .slider{position:absolute;cursor:pointer;inset:0;background:rgba(255,255,255,0.1);border-radius:26px;transition:.3s}
  .slider:before{position:absolute;content:"";height:20px;width:20px;left:3px;bottom:3px;background:#555;border-radius:50%;transition:.3s}
  input:checked + .slider{background:#52b788}
  input:checked + .slider:before{transform:translateX(18px);background:#fff}
  .btn{width:100%;padding:16px;background:#52b788;color:#060e08;border:none;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.05em;cursor:pointer;transition:opacity 0.2s;margin-top:8px}
  .btn:active{opacity:0.8}
  .btn-ai{background:rgba(82,183,136,0.12);color:#52b788;border:1px solid rgba(82,183,136,0.3);font-size:13px;padding:10px;border-radius:6px;margin-top:6px;width:100%;cursor:pointer;transition:all 0.2s}
  .btn-ai:active{background:rgba(82,183,136,0.25)}
  .btn-ai.loading{opacity:0.5;cursor:wait}
  .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#52b788;color:#060e08;font-weight:700;font-size:14px;padding:12px 28px;border-radius:30px;box-shadow:0 4px 24px rgba(0,0,0,0.4);opacity:0;transition:opacity 0.3s;pointer-events:none;white-space:nowrap;z-index:999}
  .toast.show{opacity:1}
  .err{color:#f4a261;font-size:12px;margin-top:6px}
</style>
</head>
<body>
<h1>🌿 Add New Strain</h1>
<div class="sub">Cannascenti CMS · Erba Sawtelle · Real-time updates</div>

<div class="section">
  <div class="section-title">Identity</div>
  <label>Strain Name *</label>
  <input id="name" type="text" placeholder="e.g. Runtz, Gelato 41, Mimosa..." autocomplete="off">
  <button class="btn-ai" id="autofillBtn" onclick="autofill()">✦ AI Auto-Fill terpenes, genetics & effects</button>
  <div id="autofillStatus" style="font-size:12px;color:rgba(232,224,206,0.4);margin-top:6px;min-height:16px"></div>

  <label>Type *</label>
  <select id="type">
    <option value="">Select type...</option>
    <option value="Indica">Indica</option>
    <option value="Sativa">Sativa</option>
    <option value="Hybrid">Hybrid</option>
  </select>

  <div class="row2">
    <div>
      <label>THC Min %</label>
      <input id="thc_min" type="number" min="0" max="40" placeholder="20">
    </div>
    <div>
      <label>THC Max %</label>
      <input id="thc_max" type="number" min="0" max="40" placeholder="26">
    </div>
  </div>

  <label>CBD %</label>
  <input id="cbd" type="number" min="0" max="25" step="0.1" placeholder="0.1">

  <label>Genetics / Lineage</label>
  <input id="genetics" type="text" placeholder="e.g. Gelato 33 × Zkittlez">
</div>

<div class="section">
  <div class="section-title">Terpenes</div>
  <div class="chips" id="terpChips">
    ${COMMON_TERPS.map(t => `<span class="chip terp" data-val="${t}" onclick="toggleChip(this,'terps')">${t}</span>`).join("")}
  </div>
  <label style="margin-top:14px">Other Terpenes (comma-separated)</label>
  <input id="terpsCustom" type="text" placeholder="e.g. Farnesene, Guaiol">
</div>

<div class="section">
  <div class="section-title">Effects</div>
  <div class="chips" id="effectChips">
    ${COMMON_EFFECTS.map(e => `<span class="chip" data-val="${e}" onclick="toggleChip(this,'effects')">${e}</span>`).join("")}
  </div>
  <label style="margin-top:14px">Other Effects</label>
  <input id="effectsCustom" type="text" placeholder="e.g. Introspective, Chatty">
</div>

<div class="section">
  <div class="section-title">Your Review</div>
  <label>Description / Personal Review</label>
  <textarea id="description" placeholder="Your honest take — what does it actually feel like? Who's it for? What makes it special?"></textarea>
  <label>Best For</label>
  <input id="bestFor" type="text" placeholder="e.g. Afternoon creativity, social events, winding down">
  <label>Flavors (comma-separated)</label>
  <input id="flavors" type="text" placeholder="e.g. Sweet, Citrus, Earthy, Pine">
  <label>Cannascenti Take / Fun Fact</label>
  <textarea id="funFact" placeholder="Cultural significance, genetics history, what makes it iconic..."></textarea>
</div>

<div class="section">
  <div class="section-title">Availability</div>
  <div class="toggle-row">
    <label class="toggle">
      <input type="checkbox" id="inStockErba">
      <span class="slider"></span>
    </label>
    <span class="toggle-label">In Stock at Erba Sawtelle right now</span>
  </div>
  <label>Erba Sawtelle Menu Link</label>
  <input id="erbaUrl" type="url" placeholder="https://www.erbamarkets.com/...">
  <label>Weedmaps Link (auto-filled if blank)</label>
  <input id="weedmapsUrl" type="url" placeholder="https://weedmaps.com/strains/...">
  <label>Leafly Link (auto-filled if blank)</label>
  <input id="leaflyUrl" type="url" placeholder="https://www.leafly.com/strains/...">
  <div class="toggle-row" style="margin-top:12px">
    <label class="toggle">
      <input type="checkbox" id="isStaffPick">
      <span class="slider"></span>
    </label>
    <span class="toggle-label">Mark as Staff Pick</span>
  </div>
</div>

<div class="section">
  <div class="section-title">Photo</div>
  <label>Take / Upload Photo</label>
  <input type="file" id="photoFile" accept="image/*" capture="environment" onchange="previewPhoto(this)">
  <img id="photoPreview" class="photo-preview" alt="Preview">
</div>

<button class="btn" onclick="submitStrain()">✦ Publish Strain to Cannascenti</button>
<div id="errMsg" class="err"></div>
<div class="toast" id="toast"></div>

<script>
const KEY = "${key}";
const selectedEffects = new Set();
const selectedTerps   = new Set();
let photoData = null;

function toggleChip(el, group) {
  const val = el.dataset.val;
  const set = group === 'effects' ? selectedEffects : selectedTerps;
  if (set.has(val)) { set.delete(val); el.classList.remove('active'); }
  else              { set.add(val);    el.classList.add('active'); }
}

function previewPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    photoData = e.target.result;
    const img = document.getElementById('photoPreview');
    img.src = photoData;
    img.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

async function autofill() {
  const name = document.getElementById('name').value.trim();
  if (!name) { showToast('Enter a strain name first'); return; }
  const btn = document.getElementById('autofillBtn');
  const status = document.getElementById('autofillStatus');
  btn.classList.add('loading');
  btn.textContent = '⏳ Asking Claude...';
  status.textContent = 'Pulling genetics, terpenes & effects from the encyclopedia...';
  try {
    const r = await fetch('/api/admin/strain-autofill', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ key: KEY, name })
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);

    // Fill type
    if (data.type) {
      const t = data.type.charAt(0).toUpperCase() + data.type.slice(1);
      document.getElementById('type').value = t;
    }
    if (data.thc_min) document.getElementById('thc_min').value = data.thc_min;
    if (data.thc_max) document.getElementById('thc_max').value = data.thc_max;
    if (data.cbd)     document.getElementById('cbd').value = data.cbd;
    if (data.genetics) document.getElementById('genetics').value = data.genetics;
    if (data.bestFor)  document.getElementById('bestFor').value = data.bestFor;
    if (data.funFact)  document.getElementById('funFact').value = data.funFact;

    // Terpenes
    (data.terpenes || []).forEach(t => {
      const chip = [...document.querySelectorAll('#terpChips .chip')].find(c => c.dataset.val === t);
      if (chip) { selectedTerps.add(t); chip.classList.add('active'); }
      else document.getElementById('terpsCustom').value = [document.getElementById('terpsCustom').value, t].filter(Boolean).join(', ');
    });

    // Effects
    (data.effects || []).forEach(e => {
      const chip = [...document.querySelectorAll('#effectChips .chip')].find(c => c.dataset.val === e);
      if (chip) { selectedEffects.add(e); chip.classList.add('active'); }
      else document.getElementById('effectsCustom').value = [document.getElementById('effectsCustom').value, e].filter(Boolean).join(', ');
    });

    // Flavors
    if (data.flavors?.length) document.getElementById('flavors').value = data.flavors.join(', ');

    status.textContent = '✓ Auto-filled! Review and add your personal review below.';
    status.style.color = '#52b788';
  } catch(err) {
    status.textContent = 'Could not auto-fill: ' + err.message;
    status.style.color = '#f4a261';
  } finally {
    btn.classList.remove('loading');
    btn.textContent = '✦ AI Auto-Fill terpenes, genetics & effects';
  }
}

async function submitStrain() {
  const name = document.getElementById('name').value.trim();
  const type = document.getElementById('type').value;
  document.getElementById('errMsg').textContent = '';
  if (!name) { document.getElementById('errMsg').textContent = 'Strain name is required.'; return; }
  if (!type) { document.getElementById('errMsg').textContent = 'Select a type.'; return; }

  const custom_terps   = document.getElementById('terpsCustom').value.split(',').map(t=>t.trim()).filter(Boolean);
  const custom_effects = document.getElementById('effectsCustom').value.split(',').map(e=>e.trim()).filter(Boolean);

  const strain = {
    name, type,
    thc_min:     document.getElementById('thc_min').value || null,
    thc_max:     document.getElementById('thc_max').value || null,
    cbd:         document.getElementById('cbd').value     || null,
    genetics:    document.getElementById('genetics').value.trim()     || null,
    terpenes:    [...selectedTerps, ...custom_terps],
    effects:     [...selectedEffects, ...custom_effects],
    flavors:     document.getElementById('flavors').value,
    description: document.getElementById('description').value.trim() || null,
    bestFor:     document.getElementById('bestFor').value.trim()     || null,
    funFact:     document.getElementById('funFact').value.trim()     || null,
    inStockErba: document.getElementById('inStockErba').checked,
    erbaUrl:     document.getElementById('erbaUrl').value.trim()     || null,
    weedmapsUrl: document.getElementById('weedmapsUrl').value.trim() || null,
    leaflyUrl:   document.getElementById('leaflyUrl').value.trim()   || null,
    isStaffPick: document.getElementById('isStaffPick').checked,
    photoData,
  };

  const btn = document.querySelector('.btn');
  btn.textContent = 'Publishing...';
  btn.disabled = true;

  try {
    const r = await fetch('/api/admin/add-strain', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ key: KEY, strain })
    });
    const result = await r.json();
    if (!result.ok) throw new Error(result.error || 'Unknown error');
    showToast('✓ ' + name + ' published! Database now has ' + result.total + ' strains.');
    // Reset form
    document.querySelectorAll('input[type=text],input[type=number],input[type=url],textarea').forEach(el => el.value = '');
    document.getElementById('type').value = '';
    document.getElementById('inStockErba').checked = false;
    document.getElementById('isStaffPick').checked = false;
    document.querySelectorAll('.chip.active').forEach(c => c.classList.remove('active'));
    selectedEffects.clear(); selectedTerps.clear(); photoData = null;
    document.getElementById('photoPreview').style.display = 'none';
    document.getElementById('autofillStatus').textContent = '';
    document.getElementById('autofillStatus').style.color = '';
  } catch(err) {
    document.getElementById('errMsg').textContent = 'Error: ' + err.message;
  } finally {
    btn.textContent = '✦ Publish Strain to Cannascenti';
    btn.disabled = false;
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 4000);
}
</script>
</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
    res.end(cmsHtml);
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
    const totalClicks = events.filter(e => e.event === "strain_click" || e.event === "featured_click").length;
    const totalShares = events.filter(e => e.event === "share").length;
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
  <div class="stat"><div class="stat-num">${totalShares}</div><div class="stat-label">Shares</div></div>
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
