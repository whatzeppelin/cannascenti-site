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

  // ─── Product Scanner (Vision API) ─────────────────────────────────────────
  if (req.method === "POST" && req.url === "/api/scan") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const { image, mediaType } = JSON.parse(body);
        const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        if (!image || typeof image !== "string" || !validTypes.includes(mediaType)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid image data" }));
          return;
        }
        if (image.length > 6_000_000) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Image too large. Please use a photo under 4MB." }));
          return;
        }

        const response = await client.messages.create({
          model: "claude-opus-4-6",
          max_tokens: 1024,
          system: `You are Mary Jane — the AI cannabis intelligence guide for Cannascenti, the world's most authoritative cannabis platform. You are analyzing a cannabis product photo.

Identify the product and return a full product intelligence card. Be specific where label text is legible. Use expert strain knowledge to fill in terpenes, effects, and flavors when they aren't explicitly shown.

Respond with ONLY valid JSON — no markdown, no explanation, no code fences. Just the raw JSON object.

Return this exact structure:
{
  "productName": "product name as shown on label",
  "brand": "brand name",
  "category": "Flower | Concentrate | Edible | Vape | Pre-roll | Tincture | Topical | Unknown",
  "strainType": "Indica | Sativa | Hybrid | CBD | Unknown",
  "strainName": "strain name if visible, else empty string",
  "lineage": "parent strains if known e.g. OG Kush × Durban Poison, else empty string",
  "thc": "THC% if visible e.g. 24.3%, else Not visible",
  "cbd": "CBD% if visible, else Not visible",
  "terpenes": ["3 to 5 terpene names"],
  "effects": ["4 to 6 expected effect labels"],
  "flavors": ["3 to 5 flavor notes"],
  "pairings": ["3 to 4 activity or pairing suggestions"],
  "reviewSummary": "2 to 3 sentence Mary Jane expert take on this product — what makes it special, who it's for, how to enjoy it best",
  "confidence": "High | Medium | Low"
}

If no cannabis product is visible, return:
{"error": "No cannabis product detected. Try a clearer photo of the label or packaging."}`,
          messages: [{
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: image }
              },
              { type: "text", text: "Analyze this cannabis product and return the JSON intelligence card." }
            ]
          }]
        });

        const raw = response.content[0].text.trim();
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          const match = raw.match(/\{[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
          else throw new Error("No JSON in vision response");
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(parsed));
      } catch (err) {
        console.error("Scan error:", err.message);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Failed to analyze image. Please try again." }));
        }
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
<h2>Intellectual Property</h2><p>All content on this site — including but not limited to text, editorial copy, strain descriptions, product guides, design, graphics, layout, code, branding, the "Cannascenti" name, and the overall look and feel of the platform — is the exclusive intellectual property of Cannascenti and is protected by United States and international copyright law.</p><p>You may not reproduce, copy, republish, upload, post, transmit, scrape, or distribute any portion of this site's content in any form without prior written permission from Cannascenti. Unauthorized use constitutes copyright infringement and may result in legal action.</p><p>"Cannascenti" is a trademark. You may not use the Cannascenti name, logo, or brand in any manner that could cause confusion, imply endorsement, or misrepresent affiliation with Cannascenti without express written consent.</p>
<h2>No Scraping or Automated Access</h2><p>You may not use bots, scrapers, crawlers, or any automated tools to access, index, or extract content from this site. Any such activity is a violation of these Terms and may violate the Computer Fraud and Abuse Act.</p>
<h2>No Medical Advice</h2><p>Nothing on this site constitutes medical advice. Consult a healthcare professional before using cannabis for medical purposes.</p>
<h2>Limitation of Liability</h2><p>Cannascenti is not liable for any decisions made based on content found on this site. Use information responsibly.</p>
<h2>Changes to These Terms</h2><p>We reserve the right to update these Terms at any time. Continued use of the site after changes constitutes acceptance of the updated Terms.</p>
<h2>Contact</h2><p>Questions or legal inquiries? Email us at hello@cannascenti.com.</p>`}
</body></html>`;
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "public, max-age=86400" });
    res.end(html);
    return;
  }

  // ─── /quiz redirect ───────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/quiz") {
    res.writeHead(302, { "Location": "/#quiz" });
    res.end();
    return;
  }

  // ─── Joint Rolling Seminars page ──────────────────────────────────────────
  if (req.method === "GET" && req.url === "/seminars") {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Joint Rolling Seminars — Cannascenti</title>
<meta name="description" content="Learn to roll from scratch or master advanced techniques. Three levels: Beginner, Intermediate, and Masterclass. Taught by a 12-year cannabis veteran.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Great+Vibes&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--dark:#060f0a;--green:#52b788;--bright-green:#74c69d;--cream:#f2ead8;--gold:#c9973a;--border:rgba(255,255,255,0.07);--card:rgba(255,255,255,0.025)}
body{background:var(--dark);color:var(--cream);font-family:'Montserrat',sans-serif;font-weight:300;line-height:1.75;overflow-x:hidden}
a{color:var(--bright-green);text-decoration:none}
/* nav */
.s-nav{display:flex;align-items:center;justify-content:space-between;padding:24px 60px;border-bottom:1px solid var(--border);position:sticky;top:0;background:rgba(6,15,10,0.9);backdrop-filter:blur(12px);z-index:100}
.s-nav-logo{font-family:'Great Vibes',cursive;font-size:26px;color:var(--cream)}
.s-nav-back{font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:rgba(242,234,216,0.4);transition:color .2s}
.s-nav-back:hover{color:var(--bright-green)}
@media(max-width:600px){.s-nav{padding:20px 20px}}
/* hero */
.s-hero{padding:100px 60px 80px;max-width:900px;margin:0 auto;text-align:center}
.s-label{font-size:10px;letter-spacing:0.65em;text-transform:uppercase;color:var(--bright-green);margin-bottom:20px}
.s-title{font-family:'Cormorant Garamond',serif;font-size:clamp(42px,7vw,80px);font-weight:300;line-height:1.1;color:var(--cream);margin-bottom:24px}
.s-title em{font-style:italic;color:var(--bright-green)}
.s-desc{font-size:16px;color:rgba(242,234,216,0.55);max-width:580px;margin:0 auto 48px;line-height:1.85}
.s-cta{display:inline-block;background:var(--bright-green);color:#060f0a;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;padding:16px 40px;border-radius:2px;box-shadow:0 0 28px rgba(82,183,136,0.3);transition:box-shadow .2s,transform .2s}
.s-cta:hover{box-shadow:0 0 44px rgba(82,183,136,0.5);transform:translateY(-2px);color:#060f0a}
@media(max-width:600px){.s-hero{padding:72px 24px 60px}}
/* divider */
.s-divider{height:1px;background:rgba(82,183,136,0.1);max-width:1200px;margin:0 auto}
/* levels */
.s-levels{padding:80px 60px;max-width:1200px;margin:0 auto;display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.s-level{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:40px 32px;display:flex;flex-direction:column;transition:border-color .25s,transform .25s}
.s-level:hover{border-color:rgba(82,183,136,0.3);transform:translateY(-4px)}
.s-badge{display:inline-block;font-size:9px;letter-spacing:0.25em;text-transform:uppercase;padding:5px 14px;border-radius:20px;margin-bottom:24px;font-weight:500;align-self:flex-start}
.badge-beginner{background:rgba(82,183,136,0.12);color:var(--bright-green)}
.badge-intermediate{background:rgba(201,151,58,0.15);color:var(--gold)}
.badge-advanced{background:rgba(180,80,80,0.15);color:#e8a0a0}
.s-level-title{font-family:'Cormorant Garamond',serif;font-size:30px;font-weight:300;color:var(--cream);margin-bottom:14px}
.s-level-desc{font-size:13px;color:rgba(242,234,216,0.5);line-height:1.8;margin-bottom:24px;flex:1}
.s-techniques{list-style:none;margin-bottom:32px}
.s-techniques li{font-size:12px;color:rgba(82,183,136,0.7);padding:7px 0;border-bottom:1px solid rgba(82,183,136,0.07)}
.s-techniques li::before{content:'→ ';color:var(--bright-green);opacity:0.5}
.s-level-cta{display:block;text-align:center;border:1px solid rgba(82,183,136,0.3);color:var(--bright-green);font-size:10px;letter-spacing:0.2em;text-transform:uppercase;padding:12px;border-radius:4px;transition:background .2s,border-color .2s}
.s-level-cta:hover{background:rgba(82,183,136,0.08);border-color:var(--bright-green)}
@media(max-width:900px){.s-levels{grid-template-columns:1fr;padding:60px 24px}}
@media(max-width:480px){.s-levels{padding:48px 16px}.s-level{padding:28px 20px}}
/* formats */
.s-formats-wrap{background:rgba(255,255,255,0.015);border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:72px 60px}
.s-formats-inner{max-width:1200px;margin:0 auto}
.s-formats-title{font-family:'Cormorant Garamond',serif;font-size:clamp(28px,3.5vw,42px);font-weight:300;color:var(--cream);margin-bottom:48px;text-align:center}
.s-formats{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;border-top:1px solid var(--border);padding-top:40px}
.s-format{padding:32px 28px;border-right:1px solid var(--border)}
.s-format:last-child{border-right:none}
.s-format-icon{font-size:24px;margin-bottom:16px}
.s-format-title{font-family:'Cormorant Garamond',serif;font-size:22px;color:var(--cream);margin-bottom:10px}
.s-format-desc{font-size:12px;color:rgba(242,234,216,0.45);line-height:1.75}
@media(max-width:900px){.s-formats-wrap{padding:60px 24px}.s-formats{grid-template-columns:1fr}.s-format{border-right:none;border-bottom:1px solid var(--border)}.s-format:last-child{border-bottom:none}}
/* bottom cta */
.s-bottom{text-align:center;padding:100px 60px}
.s-bottom-title{font-family:'Cormorant Garamond',serif;font-size:clamp(32px,5vw,56px);font-weight:300;color:var(--cream);margin-bottom:16px}
.s-bottom-title em{font-style:italic;color:var(--bright-green)}
.s-bottom-sub{font-size:14px;color:rgba(242,234,216,0.45);margin-bottom:40px}
@media(max-width:600px){.s-bottom{padding:72px 24px}}
</style>
</head>
<body>
<nav class="s-nav">
  <a href="/" class="s-nav-logo">Cannascenti</a>
  <a href="/" class="s-nav-back">← Back to site</a>
</nav>

<div class="s-hero">
  <div class="s-label">✦ Joint Rolling Seminars</div>
  <h1 class="s-title">The art of<br><em>the roll</em></h1>
  <p class="s-desc">Most people have been smoking for years and still can't roll a proper joint. No judgment — nobody taught them. That changes here. From your first joint to a perfectly engineered cross — every level covered, every technique mastered.</p>
  <a href="https://calendly.com/cannascenti" target="_blank" class="s-cta">Book a Seminar</a>
</div>

<div class="s-divider"></div>

<div class="s-levels">
  <div class="s-level">
    <span class="s-badge badge-beginner">Beginner</span>
    <div class="s-level-title">Your First Roll</div>
    <p class="s-level-desc">Never rolled before? No problem. We start from zero — papers, filters, grinding, and the basics of a solid roll that burns clean.</p>
    <ul class="s-techniques">
      <li>Choosing the right papers</li>
      <li>Grinding consistency</li>
      <li>The classic straight joint</li>
      <li>Making a proper filter tip</li>
      <li>Lighting and smoking technique</li>
    </ul>
    <a href="https://calendly.com/cannascenti" target="_blank" class="s-level-cta">Book This Class</a>
  </div>
  <div class="s-level">
    <span class="s-badge badge-intermediate">Intermediate</span>
    <div class="s-level-title">Level Up Your Roll</div>
    <p class="s-level-desc">You can roll, but it's not consistent. This class tightens your technique and introduces blunts, backwoods, and the cone roll.</p>
    <ul class="s-techniques">
      <li>The perfect cone joint</li>
      <li>Blunt rolling (cigarillo & backwood)</li>
      <li>Dutch masters technique</li>
      <li>Pre-roll consistency tricks</li>
      <li>Infused rolls & kief crowning</li>
    </ul>
    <a href="https://calendly.com/cannascenti" target="_blank" class="s-level-cta">Book This Class</a>
  </div>
  <div class="s-level">
    <span class="s-badge badge-advanced">Advanced</span>
    <div class="s-level-title">The Masterclass</div>
    <p class="s-level-desc">For the enthusiast who wants to go all the way. Intricate rolls, showpieces, and techniques that will genuinely impress anyone in the room.</p>
    <ul class="s-techniques">
      <li>The cross joint</li>
      <li>Tulip &amp; cannons</li>
      <li>Multi-paper braided rolls</li>
      <li>Diamond &amp; star formations</li>
      <li>Scorpion &amp; windmill techniques</li>
    </ul>
    <a href="https://calendly.com/cannascenti" target="_blank" class="s-level-cta">Book This Class</a>
  </div>
</div>

<div class="s-formats-wrap">
  <div class="s-formats-inner">
    <div class="s-formats-title">How we teach</div>
    <div class="s-formats">
      <div class="s-format">
        <div class="s-format-icon">🖥</div>
        <div class="s-format-title">Live Online Sessions</div>
        <p class="s-format-desc">Zoom-based classes with real-time instruction. Learn from anywhere. Sessions are small-group, interactive, and recorded for replay.</p>
      </div>
      <div class="s-format">
        <div class="s-format-icon">📍</div>
        <div class="s-format-title">In-Person Workshops</div>
        <p class="s-format-desc">Hands-on sessions in select cities. Everything provided. The most effective way to learn — direct feedback, small groups, full experience.</p>
      </div>
      <div class="s-format">
        <div class="s-format-icon">🏢</div>
        <div class="s-format-title">Private Events &amp; Groups</div>
        <p class="s-format-desc">Dispensary staff training, private parties, corporate events, and group bookings. Fully customized to your occasion and audience.</p>
      </div>
    </div>
  </div>
</div>

<div class="s-bottom">
  <div class="s-bottom-title">Ready to <em>roll?</em></div>
  <p class="s-bottom-sub">Pick your level and book a session. First-timers always welcome.</p>
  <a href="https://calendly.com/cannascenti" target="_blank" class="s-cta">Book Now</a>
</div>

</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html" });
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
/* bpro callout */
.d-bpro{padding:80px 60px;border-bottom:1px solid var(--border)}
.d-bpro-inner{max-width:1100px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:48px;flex-wrap:wrap}
.d-bpro-title{font-family:'Cormorant Garamond',serif;font-size:clamp(28px,3.5vw,44px);color:var(--cream);font-style:italic;line-height:1.2;margin-bottom:16px;margin-top:10px}
.d-bpro-desc{font-size:13px;color:rgba(242,234,216,0.45);line-height:1.8;max-width:540px;margin-bottom:28px}
.d-bpro-tags{display:flex;flex-direction:column;gap:10px;flex-shrink:0}
.d-bpro-tag{font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(82,183,136,0.7);border:1px solid rgba(82,183,136,0.2);border-radius:2px;padding:6px 14px;white-space:nowrap}
@media(max-width:760px){.d-bpro{padding:60px 24px}.d-bpro-tags{flex-direction:row;flex-wrap:wrap}}
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
      <p class="d-feature-desc">Give your staff a tablet-ready cannabis intelligence tool. Customer intake, instant strain matching, glossary, talking points, and dosing reference. <a href="/budtender-pro" style="color:var(--bright-green)">Try it →</a></p>
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

<div class="d-bpro">
  <div class="d-bpro-inner">
    <div>
      <div class="d-section-label">✦ Budtender Pro</div>
      <h2 class="d-bpro-title">Staff-ready cannabis intelligence.<br>On any device.</h2>
      <p class="d-bpro-desc">Your team deserves better than guesswork. Budtender Pro gives dispensary staff a professional-grade tool for customer intake, instant strain matching, a 25-term glossary, ready-to-use talking point scripts, and a complete dosing reference — all in one tablet-ready interface.</p>
      <a href="/budtender-pro" class="d-hero-cta">Try Budtender Pro →</a>
    </div>
    <div class="d-bpro-tags">
      <span class="d-bpro-tag">Customer Intake</span>
      <span class="d-bpro-tag">Strain Matching</span>
      <span class="d-bpro-tag">25-Term Glossary</span>
      <span class="d-bpro-tag">8 Talking Point Scripts</span>
      <span class="d-bpro-tag">Dosing Reference</span>
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

  // ─── Budtender Pro page ───────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/budtender-pro") {
    const _SDB = [
      { name:'Granddaddy Purple', type:'indica', thc:'17–23%', effects:['Relaxed','Sleepy','Euphoric','Happy','Hungry'], medical:['Insomnia','Pain','Stress','Muscle Spasms','Appetite Loss'], bestFor:'Nighttime wind-down, deep sleep, chronic pain relief' },
      { name:'Northern Lights', type:'indica', thc:'16–21%', effects:['Relaxed','Sleepy','Happy','Euphoric','Hungry'], medical:['Insomnia','Pain','Stress','Anxiety','Depression'], bestFor:'Evening relaxation, deep sleep, stress relief' },
      { name:'Hindu Kush', type:'indica', thc:'15–20%', effects:['Relaxed','Sleepy','Happy','Calm','Body High'], medical:['Pain','Stress','Anxiety','Nausea','Insomnia'], bestFor:'Hash making, deep body relaxation, pain management' },
      { name:'Bubba Kush', type:'indica', thc:'15–22%', effects:['Relaxed','Sleepy','Happy','Euphoric','Hungry'], medical:['Insomnia','Pain','Stress','Anxiety','Muscle Spasms'], bestFor:'After-dinner relaxation, nighttime use, treating insomnia' },
      { name:'Blueberry', type:'indica', thc:'15–20%', effects:['Relaxed','Happy','Euphoric','Sleepy','Creative'], medical:['Stress','Depression','Pain','Insomnia','Anxiety'], bestFor:'Mood elevation, creative evenings, stress relief' },
      { name:'Afghani', type:'indica', thc:'15–21%', effects:['Relaxed','Sleepy','Euphoric','Happy','Body High'], medical:['Pain','Insomnia','Stress','Anxiety','Nausea'], bestFor:'Heavy relaxation, sleep, traditional hash production' },
      { name:'Purple Punch', type:'indica', thc:'18–25%', effects:['Relaxed','Sleepy','Happy','Euphoric','Hungry'], medical:['Insomnia','Stress','Pain','Anxiety','Depression'], bestFor:'Dessert-time smoke, nighttime relaxation, sleep' },
      { name:'Master Kush', type:'indica', thc:'16–20%', effects:['Relaxed','Happy','Sleepy','Euphoric','Focused'], medical:['Pain','Stress','Insomnia','Anxiety','Depression'], bestFor:'End of day relaxation, pain relief without heavy sedation' },
      { name:'Sour Diesel', type:'sativa', thc:'19–25%', effects:['Energetic','Euphoric','Creative','Focused','Happy'], medical:['Depression','Anxiety','Stress','Pain','Fatigue'], bestFor:'Daytime energy, creative work, social situations' },
      { name:'Jack Herer', type:'sativa', thc:'18–24%', effects:['Energetic','Creative','Happy','Focused','Euphoric'], medical:['Stress','Depression','Anxiety','Fatigue','ADHD'], bestFor:'Morning use, creative projects, daytime productivity' },
      { name:'Green Crack', type:'sativa', thc:'17–24%', effects:['Energetic','Focused','Happy','Euphoric','Creative'], medical:['Fatigue','Depression','Stress','Anxiety','ADHD'], bestFor:'Morning wake-up, energy boost, creative work sessions' },
      { name:'Durban Poison', type:'sativa', thc:'15–20%', effects:['Energetic','Euphoric','Creative','Focused','Happy'], medical:['Depression','Fatigue','Stress','Anxiety','ADHD'], bestFor:'Daytime productivity, outdoor activities, creative work' },
      { name:'Super Silver Haze', type:'sativa', thc:'18–23%', effects:['Energetic','Euphoric','Creative','Happy','Focused'], medical:['Stress','Depression','Anxiety','Fatigue','Nausea'], bestFor:'Daytime elevation, creative flow, socializing' },
      { name:'Strawberry Cough', type:'sativa', thc:'15–20%', effects:['Happy','Euphoric','Energetic','Uplifted','Creative'], medical:['Anxiety','Stress','Depression','ADHD','Fatigue'], bestFor:'Social settings, daytime mood lift, anxiety management' },
      { name:'Ghost Train Haze', type:'sativa', thc:'20–28%', effects:['Euphoric','Creative','Energetic','Focused','Uplifted'], medical:['Depression','Fatigue','ADHD','Stress','Pain'], bestFor:'Experienced users, creative deep dives, daytime stimulation' },
      { name:'Lemon Haze', type:'sativa', thc:'17–22%', effects:['Happy','Euphoric','Energetic','Uplifted','Creative'], medical:['Stress','Depression','Anxiety','Fatigue','Pain'], bestFor:'Morning use, mood elevation, outdoor activities' },
      { name:'OG Kush', type:'hybrid', thc:'20–26%', effects:['Euphoric','Relaxed','Happy','Creative','Sleepy'], medical:['Stress','Anxiety','Depression','Pain','Insomnia'], bestFor:'Versatile all-day use, stress relief, the OG experience' },
      { name:'Girl Scout Cookies', type:'hybrid', thc:'19–28%', effects:['Euphoric','Happy','Relaxed','Creative','Hungry'], medical:['Stress','Depression','Pain','Anxiety','Appetite Loss'], bestFor:'Creative evenings, mood elevation, appetite stimulation' },
      { name:'Gelato', type:'hybrid', thc:'20–26%', effects:['Euphoric','Happy','Relaxed','Creative','Energetic'], medical:['Stress','Anxiety','Depression','Pain','Fatigue'], bestFor:'Evening socializing, creative projects, stress relief' },
      { name:'Blue Dream', type:'hybrid', thc:'17–24%', effects:['Happy','Euphoric','Creative','Relaxed','Energetic'], medical:['Stress','Depression','Anxiety','Pain','Fatigue'], bestFor:'All-day use, beginners, social settings' },
      { name:'Wedding Cake', type:'hybrid', thc:'22–27%', effects:['Relaxed','Euphoric','Happy','Hungry','Sleepy'], medical:['Stress','Pain','Depression','Anxiety','Appetite Loss'], bestFor:'Evening relaxation, celebrations, appetite stimulation' },
      { name:'Runtz', type:'hybrid', thc:'19–29%', effects:['Euphoric','Happy','Relaxed','Uplifted','Hungry'], medical:['Stress','Anxiety','Depression','Pain','Appetite Loss'], bestFor:'Evening elevation, mood boost, dessert smoking' },
      { name:'Pineapple Express', type:'hybrid', thc:'19–25%', effects:['Happy','Euphoric','Energetic','Creative','Relaxed'], medical:['Stress','Depression','Anxiety','Fatigue','Pain'], bestFor:'Daytime activities, creative sessions, social use' },
      { name:'Zkittlez', type:'hybrid', thc:'15–23%', effects:['Happy','Relaxed','Euphoric','Uplifted','Focused'], medical:['Stress','Depression','Anxiety','Pain','Insomnia'], bestFor:'Evening relaxation, flavor chasers, mood elevation' }
    ];
    const _GLOSSARY = [
      { term:'Terpene', cat:'Science', def:'Aromatic compounds produced by cannabis (and other plants) that determine smell, flavor, and contribute to effect. Over 150 terpenes identified in cannabis. Not just fragrance — they interact with cannabinoids to modify the high.' },
      { term:'Cannabinoid', cat:'Science', def:'Chemical compounds that interact with the endocannabinoid system. THC and CBD are the most abundant, but over 100 cannabinoids exist in the plant — including CBG, CBN, CBC, and THCV.' },
      { term:'Endocannabinoid System', cat:'Science', def:"The body's built-in receptor system that cannabis interacts with. CB1 receptors (brain, nervous system) and CB2 receptors (immune system, peripheral tissues). Also responds to endogenous cannabinoids the body produces naturally." },
      { term:'Entourage Effect', cat:'Science', def:'The theory that cannabinoids and terpenes work synergistically — producing effects greater than any single compound alone. Why whole-flower products often feel different than isolated THC distillate.' },
      { term:'Full Spectrum', cat:'Products', def:'A product containing the complete range of cannabinoids, terpenes, and other plant compounds. Preserves the entourage effect. Contrasted with broad spectrum (THC removed) and isolate (single compound).' },
      { term:'Broad Spectrum', cat:'Products', def:'Contains multiple cannabinoids and terpenes but with THC removed or below 0.3%. Ideal for customers concerned about drug testing who still want the entourage effect.' },
      { term:'Isolate', cat:'Products', def:'A single cannabinoid extracted and purified to near-100% purity. No terpenes, no other cannabinoids. Predictable dosing, no entourage effect, typically odorless and flavorless.' },
      { term:'Decarboxylation', cat:'Science', def:'Heating cannabis to activate THCA → THC and CBDA → CBD. Raw cannabis is non-psychoactive. Required for edibles. Happens automatically when smoking or vaporizing.' },
      { term:'COA', cat:'Products', def:'Certificate of Analysis — a lab report detailing cannabinoid potency, terpene profile, and test results for pesticides, microbials, heavy metals, and residual solvents. Every compliant product should have one.' },
      { term:'Live Resin', cat:'Concentrates', def:'Concentrate made from fresh-frozen cannabis — material frozen immediately after harvest to preserve terpenes. Results in more flavorful, aromatic extracts than cured-plant concentrates.' },
      { term:'Live Rosin', cat:'Concentrates', def:'Solventless concentrate made by pressing fresh-frozen ice water hash (bubble hash) under heat and pressure. No chemicals — just cold, water, heat, and pressure. The apex of current solventless craft.' },
      { term:'Bubble Hash', cat:'Concentrates', def:'Solventless concentrate made by agitating cannabis in ice water and sieving through micron bags. Named for how it bubbles when heated. Quality rated 1–6 stars based on melt quality.' },
      { term:'Distillate', cat:'Concentrates', def:'Highly refined cannabis oil, typically 90%+ THC or CBD, with most other compounds removed. Tasteless and odorless until terpenes are added back. Most common ingredient in cartridges.' },
      { term:'Tincture', cat:'Products', def:'Cannabis extract in an alcohol or oil base, consumed sublingually (under the tongue) for faster absorption than edibles. Onset: 15–45 minutes. Allows precise dosing with a dropper.' },
      { term:'Sublingual', cat:'Consumption', def:'Administration under the tongue. Cannabis absorbs directly into the bloodstream through mucous membranes, bypassing the digestive system. Faster onset than edibles, slower than inhalation.' },
      { term:'11-Hydroxy-THC', cat:'Science', def:'The liver metabolite of THC formed during digestion of edibles. 2–3x more potent than inhaled THC and 4–6x longer-lasting. Why edibles feel different and stronger than smoking the same amount.' },
      { term:'Bioavailability', cat:'Science', def:'The percentage of a consumed substance that reaches systemic circulation. Smoking: 30–40%. Vaping: 40–56%. Edibles: 6–20%. Sublingual: 20–35%. Lower bioavailability does not mean weaker effect — edibles convert to stronger metabolites.' },
      { term:'Tolerance', cat:'Consumption', def:'Reduced response to cannabis with repeated use, primarily driven by CB1 receptor downregulation. Most users report significant tolerance reduction after a 2-week abstinence period.' },
      { term:'Microdose', cat:'Consumption', def:'Consuming a sub-perceptual or very low amount of cannabis (typically 1–2.5mg THC) to achieve therapeutic benefits without significant intoxication. Popular for daytime productivity and anxiety management.' },
      { term:'Hybrid', cat:'Strains', def:"A cannabis strain with genetics from both indica and sativa lineages. Most commercial cannabis today is hybrid. The indica/sativa/hybrid classification is increasingly understood as a simplification — terpene profile is more predictive of effect." },
      { term:'Phenotype', cat:'Strains', def:"The physical expression of a strain's genetics — influenced by environment, growing conditions, and cultivation techniques. Two plants from the same seeds can express different phenotypes." },
      { term:'Trichome', cat:'Science', def:'The crystalline resin glands covering cannabis flowers. The primary site of cannabinoid and terpene production. Trichome density and quality is a key indicator of flower quality and potency.' },
      { term:'Defoliation', cat:'Cultivation', def:'The selective removal of fan leaves during cultivation to improve light penetration and airflow to lower bud sites. A cultivation technique that can improve yield and quality.' },
      { term:'Landrace', cat:'Strains', def:'A cannabis strain indigenous to a specific geographic region, adapted to local climate and developed over centuries with minimal human selective breeding. Examples: Hindu Kush, Durban Poison, Thai.' },
      { term:'Phytocannabinoid', cat:'Science', def:'A cannabinoid produced by the cannabis plant, as distinct from endocannabinoids (produced by the body) and synthetic cannabinoids. THC, CBD, CBG, CBN, and CBC are all phytocannabinoids.' },
      { term:'Terp Profile', cat:'Products', def:'Short for terpene profile — the complete breakdown of which terpenes are present in a product and at what concentrations. Increasingly considered more predictive of effect than indica/sativa/hybrid classification.' }
    ];
    const _SCRIPTS = [
      { scenario:'New Customer', title:'First-time buyer intro', body:'"Welcome! Have you ever used cannabis before? No worries at all — let\'s figure out what you\'re looking for. Are you mostly looking to relax, help with sleep, manage some pain, or just see what all the fuss is about? Once I know what you\'re hoping for, I can point you to exactly the right thing and tell you exactly what to expect."', note:"Key: Ask about goals first, not products. Never lead with THC percentages for first-timers. Focus on what they want to feel, not what's potent." },
      { scenario:'Common Objection', title:'"I tried it once and got too high"', body:'"That\'s actually really common, and it\'s almost always a dosing issue — not the cannabis itself. What happened is that you probably got more THC than your system was ready for. The good news: that\'s completely avoidable. There are products specifically designed to give you a gentle, controlled experience — we can start much lower and you\'ll feel great without any of that overwhelm."', note:'Never dismiss their experience. Validate it, explain why it happened, and offer a controlled solution. CBD:THC ratios (1:1 or 2:1) are excellent here.' },
      { scenario:'Explaining Terpenes', title:'Why two strains with the same THC feel different', body:'"The THC percentage only tells you the volume of the main active compound — it\'s like knowing the alcohol content of wine but nothing about whether it\'s a pinot noir or a chardonnay. What actually shapes the experience is terpenes — the aromatic compounds that give each strain its personality. This one has high myrcene, which is relaxing and sedating. This other one has high limonene, which is uplifting and mood-boosting. Same THC, completely different experience."', note:"Use analogies — wine, beer, coffee — anything that connects to the customer's existing experience. Avoid jargon until after you've made the analogy." },
      { scenario:'Edibles Education', title:'Setting expectations for edibles', body:'"Edibles work differently than flower or vape — they go through your digestive system and liver, which converts THC into a more potent, longer-lasting form. Onset is 30 minutes to 2 hours — everyone is different. The golden rule is: start with 5mg, wait the full 2 hours before you consider taking more. Most bad experiences with edibles come from re-dosing too early because it didn\'t work. I promise you — it worked. It just needed more time."', note:'Always set the 2-hour expectation explicitly. This one piece of information prevents most bad edible experiences.' },
      { scenario:'Indica vs Sativa', title:'The modern understanding', body:'"The indica/sativa thing is a good starting point, but it\'s actually outdated science — most cannabis today is hybrid anyway. What actually predicts how you\'ll feel is the terpene profile. That said: if someone tells me they want energy and focus, I\'ll still lean sativa-dominant. If they want deep relaxation and sleep, I\'ll lean indica. It\'s a helpful shorthand even if it\'s not the whole picture."', note:"Don't overcorrect by dismissing indica/sativa entirely — it upsets customers who are used to it. Validate the framework, then add nuance." },
      { scenario:'Tolerance Talk', title:'"It doesn\'t work as well anymore"', body:'"What you\'re describing is tolerance — your CB1 receptors have adapted to regular cannabis exposure. The best fix is a tolerance break: even 2 weeks without cannabis can dramatically reset your response. When you come back, start lower than you\'re used to. If a T-break isn\'t an option right now, we can look at some options with a different cannabinoid profile — CBG and THCV both interact differently with your endocannabinoid system and some people find they cut through tolerance."', note:"Tolerance breaks are the #1 most effective solution. Always mention it. CBG or THCV products are a good secondary recommendation for customers who can't or won't take a break." },
      { scenario:'Medical Customer', title:'Navigating medical questions professionally', body:'"I want to be upfront: I\'m a cannabis specialist, not a medical professional, so I can\'t tell you what will treat or cure anything. What I can do is share what we\'ve heard from customers in similar situations and what the research shows. For sleep, a lot of customers do really well with high-CBN or indica-dominant products. For pain, people often report success with balanced CBD:THC ratios. Ultimately, working with a cannabis-friendly doctor is the best path if you\'re managing something serious."', note:"Never make medical claims. Always deflect to a physician for serious conditions. You can share anecdotal customer experience and general research without making treatment claims." },
      { scenario:'Drug Testing', title:'"Will this show up on a drug test?"', body:'"Standard drug tests look for THC metabolites — they can\'t distinguish between recreational and medical use, and they don\'t test for CBD. Any product with THC, even in a 1:1 ratio, can trigger a positive. The only products I can confidently say are unlikely to trigger a test are CBD isolate products with absolutely zero THC. Even broad-spectrum products with trace amounts can occasionally show up. If your job tests, I\'d really recommend only CBD isolate or asking your HR department for clarity on their threshold."', note:"Be honest here — don't sell a THC product to someone who will get fired over a positive test. CBD isolate products are the only safe recommendation for anyone with strict testing." }
    ];
    const _DOSE = [
      { title:'Edibles', sub:'Onset: 30 min – 2 hrs · Duration: 4–8 hrs', color:'linear-gradient(90deg,#C9973A,rgba(201,151,58,0.3))', rows:[{label:'Microdose',val:'1–2.5mg THC'},{label:'Low (beginner)',val:'2.5–5mg THC'},{label:'Moderate',val:'5–15mg THC'},{label:'High',val:'15–30mg THC'},{label:'Very high',val:'30mg+ THC'},{label:'Wait before re-dose',val:'2 full hours'},{label:'11-OH-THC potency',val:'2–3x inhaled THC'}] },
      { title:'Flower / Vape', sub:'Onset: 5–15 min · Duration: 1–3 hrs', color:'linear-gradient(90deg,#74c69d,rgba(82,183,136,0.3))', rows:[{label:'First time',val:'1 small hit, wait 15 min'},{label:'Occasional user',val:'1–2 hits'},{label:'Regular user',val:'2–4 hits'},{label:'Heavy user',val:'As needed'},{label:'Vape bioavailability',val:'40–56%'},{label:'Onset peak',val:'~30 min post-use'},{label:'CBD counteracts THC?',val:'Yes — 1:1 ratio reduces anxiety'}] },
      { title:'Tinctures / Sublingual', sub:'Onset: 15–45 min · Duration: 2–4 hrs', color:'linear-gradient(90deg,#7b8ff5,rgba(123,143,245,0.3))', rows:[{label:'Starting dose',val:'0.25ml (quarter dropper)'},{label:'Standard dose',val:'0.5–1ml (half–1 dropper)'},{label:'Hold under tongue',val:'60–90 seconds'},{label:'If swallowed',val:'Acts like edible — slower, stronger'},{label:'Onset',val:'15–45 min sublingual'},{label:'Shelf life',val:'1–5 years (alcohol-based)'},{label:'Best carrier',val:'MCT or coconut oil'}] },
      { title:'Concentrates / Dabs', sub:'Onset: Immediate · Duration: 2–4 hrs', color:'linear-gradient(90deg,#9b81e4,rgba(155,129,228,0.3))', rows:[{label:'Not for beginners',val:'High tolerance needed'},{label:'Typical potency',val:'60–90%+ THC'},{label:'Dab temp (low)',val:'450–550°F / 232–288°C'},{label:'Dab temp (high)',val:'600–750°F / 315–400°C'},{label:'Live rosin vs distillate',val:'Rosin: full spectrum / Dist: refined'},{label:'Best for tolerance?',val:'Use sparingly — builds fast'},{label:'Full melt hash temp',val:'~450°F ideal'}] }
    ];
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Budtender Pro — Cannascenti</title>
<meta name="description" content="Professional cannabis intelligence for dispensary staff. Customer intake, strain matching, glossary, talking points, and dosing reference — all in one tool.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Playfair+Display:ital,wght@1,400&family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --dark:#060f0a;--green:#52b788;--bright-green:#74c69d;--light-green:#74C69D;
  --cream:#f2ead8;--gold:#C9973A;--warm-black:#081C15;--card-bg:rgba(255,255,255,0.02);
  --border:rgba(255,255,255,0.07);
}
body{background:var(--dark);color:var(--cream);font-family:'Montserrat',sans-serif;line-height:1.7;overflow-x:hidden}
a{color:var(--bright-green);text-decoration:none}

/* nav */
.bp-nav{display:flex;align-items:center;justify-content:space-between;padding:24px 60px;border-bottom:1px solid var(--border);position:sticky;top:0;background:rgba(6,15,10,0.92);backdrop-filter:blur(12px);z-index:100}
.bp-nav-logo{font-family:'Cormorant Garamond',serif;font-size:20px;color:var(--cream);letter-spacing:0.08em}
.bp-nav-links{display:flex;gap:28px;align-items:center}
.bp-nav-back{font-size:11px;color:rgba(242,234,216,0.4);letter-spacing:0.1em;text-transform:uppercase;transition:color .2s}
.bp-nav-back:hover{color:var(--bright-green)}
@media(max-width:600px){.bp-nav{padding:20px 24px}.bp-nav-links{gap:16px}}

/* hero */
.bp-hero{padding:80px 60px 60px;max-width:1280px;margin:0 auto;display:flex;justify-content:space-between;align-items:flex-start;gap:40px;flex-wrap:wrap}
.section-label{font-size:10px;font-weight:500;letter-spacing:0.65em;text-transform:uppercase;color:var(--bright-green);margin-bottom:16px;display:flex;align-items:center;gap:14px}
.section-title{font-family:'Cormorant Garamond',serif;font-size:clamp(36px,5vw,60px);font-weight:300;color:var(--cream);line-height:1.15}
.section-title em{font-style:italic;color:var(--bright-green)}
.bp-hero-desc{color:rgba(245,240,225,0.6);font-size:16px;max-width:640px;line-height:1.8;margin-top:20px}
.bpro-badge{display:flex;flex-direction:column;align-items:center;gap:8px;background:rgba(82,183,136,0.08);border:1px solid rgba(82,183,136,0.2);border-radius:6px;padding:20px 28px;text-align:center;flex-shrink:0;margin-top:12px}
.bpro-badge-icon{font-size:32px}
.bpro-badge-text{font-family:'Montserrat',sans-serif;font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--bright-green)}
@media(max-width:600px){.bp-hero{padding:60px 24px 40px}}

/* tool wrapper */
.bp-tool{padding:0 60px 80px;max-width:1280px;margin:0 auto}
@media(max-width:600px){.bp-tool{padding:0 20px 60px}}

/* tabs */
.bpro-tabs{display:flex;gap:4px;border-bottom:2px solid rgba(255,255,255,0.08);overflow-x:auto;-webkit-overflow-scrolling:touch}
.bpro-tab{background:transparent;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;padding:14px 22px;font-family:'Montserrat',sans-serif;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(245,240,225,0.4);cursor:pointer;transition:all 0.2s;display:flex;align-items:center;gap:8px;flex-shrink:0}
.bpro-tab:hover{color:rgba(245,240,225,0.7)}
.bpro-tab.active{color:var(--bright-green);border-bottom-color:var(--bright-green)}
.bpro-tab-icon{font-size:15px}
.bpro-panel{padding:40px 0 0;animation:fadeSlideUp 0.25s ease}
.bpro-panel-hidden{display:none}
@keyframes fadeSlideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}

/* Intake */
.bpro-intake-grid{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:start}
.bpro-form-title{font-family:'Cormorant Garamond',serif;font-size:26px;color:var(--cream);margin-bottom:28px}
.bpro-field{margin-bottom:24px}
.bpro-field-label{font-family:'Montserrat',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:rgba(245,240,225,0.5);margin-bottom:10px;display:block}
.bpro-field-hint{font-weight:400;letter-spacing:0;text-transform:none;color:rgba(245,240,225,0.3);font-size:10px}
.bpro-chips{display:flex;flex-wrap:wrap;gap:7px}
.bpro-chip{background:transparent;border:1px solid rgba(255,255,255,0.12);color:rgba(245,240,225,0.55);padding:7px 16px;font-family:'Montserrat',sans-serif;font-size:11px;font-weight:600;letter-spacing:0.08em;cursor:pointer;border-radius:20px;transition:all 0.18s}
.bpro-chip:hover{border-color:rgba(82,183,136,0.5);color:var(--bright-green)}
.bpro-chip.selected{background:rgba(82,183,136,0.15);border-color:var(--bright-green);color:var(--bright-green)}
.bpro-recommend-btn{background:var(--bright-green);border:none;color:var(--warm-black);padding:14px 32px;font-family:'Montserrat',sans-serif;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;border-radius:2px;transition:all 0.2s;margin-top:8px;width:100%}
.bpro-recommend-btn:hover{background:#8fdbb8}
.bpro-rec-panel{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:32px;min-height:480px}
.bpro-rec-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;height:400px;text-align:center;gap:16px}
.bpro-rec-placeholder-icon{font-size:48px;opacity:0.3}
.bpro-rec-placeholder p{color:rgba(245,240,225,0.35);font-size:14px;line-height:1.7;max-width:280px}
.bpro-rec-placeholder strong{color:rgba(245,240,225,0.5)}
.bpro-rec-title{font-family:'Cormorant Garamond',serif;font-size:22px;color:var(--cream);margin-bottom:6px}
.bpro-rec-summary{font-size:13px;color:rgba(245,240,225,0.5);margin-bottom:24px;line-height:1.6}
.bpro-rec-strain{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:18px;margin-bottom:10px;position:relative;overflow:hidden}
.bpro-rec-strain::before{content:'';position:absolute;top:0;left:0;bottom:0;width:3px}
.bpro-rec-s-indica::before{background:#9b81e4}
.bpro-rec-s-sativa::before{background:#f0a85c}
.bpro-rec-s-hybrid::before{background:var(--bright-green)}
.bpro-rec-strain-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:10px}
.bpro-rec-strain-name{font-family:'Cormorant Garamond',serif;font-size:20px;color:var(--cream);font-weight:600}
.bpro-rec-strain-type{font-family:'Montserrat',sans-serif;font-size:10px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;padding:3px 10px;border-radius:20px}
.bpro-type-indica{color:#9b81e4;background:rgba(123,97,196,0.15);border:1px solid rgba(123,97,196,0.3)}
.bpro-type-sativa{color:#f0a85c;background:rgba(232,144,60,0.15);border:1px solid rgba(232,144,60,0.3)}
.bpro-type-hybrid{color:var(--bright-green);background:rgba(82,183,136,0.12);border:1px solid rgba(82,183,136,0.25)}
.bpro-rec-strain-why{font-size:12px;color:rgba(245,240,225,0.55);line-height:1.65;margin-bottom:8px}
.bpro-rec-strain-effects{display:flex;flex-wrap:wrap;gap:5px}
.bpro-rec-eff{font-size:10px;font-family:'Montserrat',sans-serif;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,0.06);color:rgba(245,240,225,0.55)}
.bpro-rec-script{margin-top:20px;background:rgba(82,183,136,0.06);border:1px solid rgba(82,183,136,0.15);border-left:3px solid var(--bright-green);border-radius:0 4px 4px 0;padding:14px 16px}
.bpro-rec-script-label{font-family:'Montserrat',sans-serif;font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--bright-green);margin-bottom:6px}
.bpro-rec-script p{font-size:12px;color:rgba(245,240,225,0.65);line-height:1.7;margin:0;font-style:italic}
.bpro-rec-warning{margin-top:16px;background:rgba(232,144,60,0.08);border:1px solid rgba(232,144,60,0.2);border-radius:4px;padding:12px 16px;font-size:12px;color:rgba(240,168,92,0.8);line-height:1.65}

/* Glossary */
.bpro-glossary-search-row{display:flex;flex-direction:column;gap:14px;margin-bottom:28px}
.bpro-glossary-input{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:3px;padding:12px 18px;color:var(--cream);font-family:'Montserrat',sans-serif;font-size:14px;outline:none;max-width:440px;transition:border-color 0.2s}
.bpro-glossary-input:focus{border-color:var(--bright-green)}
.bpro-gloss-cats{display:flex;flex-wrap:wrap;gap:7px}
.bpro-gloss-cat{background:transparent;border:1px solid rgba(255,255,255,0.1);color:rgba(245,240,225,0.45);padding:5px 14px;font-family:'Montserrat',sans-serif;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;border-radius:2px;transition:all 0.18s}
.bpro-gloss-cat:hover,.bpro-gloss-cat.active{border-color:var(--gold);color:var(--gold);background:rgba(201,151,58,0.08)}
.bpro-glossary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.bpro-gloss-card{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-radius:4px;padding:18px 16px;transition:background 0.2s}
.bpro-gloss-card:hover{background:rgba(201,151,58,0.04)}
.bpro-gloss-term{font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:600;color:var(--cream);margin-bottom:4px}
.bpro-gloss-cat-tag{font-family:'Montserrat',sans-serif;font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--gold);margin-bottom:8px}
.bpro-gloss-def{font-size:12px;color:rgba(245,240,225,0.55);line-height:1.7}

/* Scripts */
.bpro-scripts-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.bpro-script-card{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:26px 22px;transition:background 0.2s}
.bpro-script-card:hover{background:rgba(82,183,136,0.04)}
.bpro-script-scenario{font-family:'Montserrat',sans-serif;font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--bright-green);margin-bottom:8px}
.bpro-script-title{font-family:'Cormorant Garamond',serif;font-size:22px;color:var(--cream);margin-bottom:14px}
.bpro-script-body{font-size:13px;color:rgba(245,240,225,0.6);line-height:1.8;font-style:italic;border-left:2px solid rgba(82,183,136,0.3);padding-left:14px;margin-bottom:12px}
.bpro-script-note{font-size:11px;color:rgba(245,240,225,0.35);line-height:1.65}

/* Dosing */
.bpro-dosing-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.bpro-dose-card{background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.08);border-radius:4px;padding:24px 20px;position:relative;overflow:hidden}
.bpro-dose-card h3{font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--cream);margin-bottom:4px}
.bpro-dose-sub{font-family:'Montserrat',sans-serif;font-size:10px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:14px}
.bpro-dose-rows{display:flex;flex-direction:column;gap:8px}
.bpro-dose-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px}
.bpro-dose-row:last-child{border-bottom:none}
.bpro-dose-row-label{color:rgba(245,240,225,0.5);font-family:'Montserrat',sans-serif;font-size:11px}
.bpro-dose-row-val{color:var(--cream);font-weight:600;font-family:'Montserrat',sans-serif;font-size:11px;text-align:right}

/* Consulting / CannaQuant */
.bp-consulting{padding:80px 60px;border-top:1px solid rgba(82,183,136,0.1)}
.bp-consulting-inner{max-width:1280px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:start}
.consulting-title{font-family:'Cormorant Garamond',serif;font-size:clamp(32px,4vw,50px);font-weight:300;line-height:1.15;color:var(--cream);margin-bottom:24px;margin-top:20px}
.consulting-title em{font-family:'Playfair Display',serif;font-style:italic;font-weight:400;color:var(--light-green)}
.consulting-desc{font-size:14px;line-height:1.9;color:rgba(245,240,225,0.55);margin-bottom:40px}
.consulting-stats{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:40px}
.consulting-stat-num{font-family:'Cormorant Garamond',serif;font-size:42px;font-weight:300;color:var(--bright-green);line-height:1;margin-bottom:6px}
.consulting-stat-label{font-size:11px;letter-spacing:0.12em;color:rgba(245,240,225,0.45);text-transform:uppercase}
.btn-primary{font-size:12px;font-weight:500;letter-spacing:0.25em;text-transform:uppercase;color:var(--warm-black);background:var(--bright-green);padding:16px 36px;border-radius:2px;text-decoration:none;display:inline-block;transition:background 0.2s}
.btn-primary:hover{background:var(--light-green);color:var(--warm-black)}
.consulting-services{display:flex;flex-direction:column;gap:16px}
.consulting-service{background:rgba(255,255,255,0.02);border:1px solid rgba(82,183,136,0.1);border-radius:6px;padding:28px 32px;display:flex;align-items:flex-start;gap:20px;transition:border-color 0.3s}
.consulting-service:hover{border-color:rgba(82,183,136,0.3)}
.consulting-service-icon{font-size:20px;flex-shrink:0;margin-top:2px}
.consulting-service-title{font-family:'Cormorant Garamond',serif;font-size:20px;color:var(--cream);margin-bottom:6px}
.consulting-service-desc{font-size:12px;line-height:1.7;color:rgba(245,240,225,0.5)}
.consulting-service-price{font-size:11px;letter-spacing:0.1em;color:var(--gold);margin-top:10px;opacity:0.8}

/* footer */
.bp-footer{padding:36px 60px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;border-top:1px solid var(--border)}
.bp-footer-copy{font-size:12px;color:rgba(242,234,216,0.25)}
.bp-footer-links{display:flex;gap:24px}
.bp-footer-links a{font-size:12px;color:rgba(242,234,216,0.3);transition:color .2s}
.bp-footer-links a:hover{color:var(--bright-green)}

/* responsive */
@media(max-width:1100px){.bpro-intake-grid{grid-template-columns:1fr}.bpro-glossary-grid{grid-template-columns:repeat(2,1fr)}.bpro-dosing-grid{grid-template-columns:1fr}.bp-consulting-inner{grid-template-columns:1fr;gap:48px}}
@media(max-width:768px){.bpro-scripts-grid{grid-template-columns:1fr}.bpro-glossary-grid{grid-template-columns:1fr 1fr}.bpro-rec-panel{padding:20px;min-height:auto}.bp-consulting{padding:60px 24px}}
@media(max-width:480px){.bpro-glossary-grid{grid-template-columns:1fr}.bpro-dosing-grid{grid-template-columns:1fr}.bpro-tab{font-size:9px;padding:10px}.bp-footer{padding:28px 24px;flex-direction:column;align-items:flex-start}}
</style>
</head>
<body>

<nav class="bp-nav">
  <span class="bp-nav-logo">Cannascenti</span>
  <div class="bp-nav-links">
    <a href="/for-dispensaries" class="bp-nav-back">← For Dispensaries</a>
    <a href="/" class="bp-nav-back">Home</a>
  </div>
</nav>

<div class="bp-hero">
  <div>
    <div class="section-label">✦ Budtender Pro</div>
    <div class="section-title">The tool built for <em>the floor.</em></div>
    <p class="bp-hero-desc">Fast, practical cannabis intelligence for dispensary professionals. Customer intake, instant strain matching, terminology reference, and ready-to-use customer scripts — everything you need to give exceptional service on every transaction.</p>
  </div>
  <div class="bpro-badge">
    <span class="bpro-badge-icon">🎓</span>
    <span class="bpro-badge-text">Professional Reference</span>
  </div>
</div>

<div class="bp-tool">
  <div class="bpro-tabs">
    <button class="bpro-tab active" onclick="bproTab('intake')">
      <span class="bpro-tab-icon">🧑‍💼</span>Customer Intake
    </button>
    <button class="bpro-tab" onclick="bproTab('glossary')">
      <span class="bpro-tab-icon">📖</span>Glossary
    </button>
    <button class="bpro-tab" onclick="bproTab('scripts')">
      <span class="bpro-tab-icon">💬</span>Talking Points
    </button>
    <button class="bpro-tab" onclick="bproTab('dosing')">
      <span class="bpro-tab-icon">⚖️</span>Dosing Quick Ref
    </button>
  </div>

  <!-- INTAKE PANEL -->
  <div class="bpro-panel" id="bproIntake">
    <div class="bpro-intake-grid">
      <div class="bpro-intake-form">
        <div class="bpro-form-title">Customer Profile</div>
        <div class="bpro-field">
          <div class="bpro-field-label">Experience Level</div>
          <div class="bpro-chips" id="bproExpChips">
            <button class="bpro-chip" onclick="bproSelect('exp','first')">First Time</button>
            <button class="bpro-chip" onclick="bproSelect('exp','occasional')">Occasional</button>
            <button class="bpro-chip" onclick="bproSelect('exp','regular')">Regular</button>
            <button class="bpro-chip" onclick="bproSelect('exp','heavy')">Heavy User</button>
          </div>
        </div>
        <div class="bpro-field">
          <div class="bpro-field-label">Primary Goal <span class="bpro-field-hint">(select up to 2)</span></div>
          <div class="bpro-chips" id="bproGoalChips">
            <button class="bpro-chip" onclick="bproMulti('goal','sleep')">😴 Sleep</button>
            <button class="bpro-chip" onclick="bproMulti('goal','pain')">💊 Pain Relief</button>
            <button class="bpro-chip" onclick="bproMulti('goal','anxiety')">🧘 Anxiety</button>
            <button class="bpro-chip" onclick="bproMulti('goal','energy')">⚡ Energy</button>
            <button class="bpro-chip" onclick="bproMulti('goal','creativity')">🎨 Creativity</button>
            <button class="bpro-chip" onclick="bproMulti('goal','mood')">😊 Mood Lift</button>
            <button class="bpro-chip" onclick="bproMulti('goal','appetite')">🍽️ Appetite</button>
            <button class="bpro-chip" onclick="bproMulti('goal','focus')">🎯 Focus</button>
            <button class="bpro-chip" onclick="bproMulti('goal','social')">🎉 Social</button>
            <button class="bpro-chip" onclick="bproMulti('goal','relax')">🛋️ Relax</button>
          </div>
        </div>
        <div class="bpro-field">
          <div class="bpro-field-label">Time of Use</div>
          <div class="bpro-chips" id="bproTimeChips">
            <button class="bpro-chip" onclick="bproSelect('time','morning')">Morning</button>
            <button class="bpro-chip" onclick="bproSelect('time','afternoon')">Afternoon</button>
            <button class="bpro-chip" onclick="bproSelect('time','evening')">Evening</button>
            <button class="bpro-chip" onclick="bproSelect('time','nighttime')">Nighttime</button>
          </div>
        </div>
        <div class="bpro-field">
          <div class="bpro-field-label">Consumption Preference</div>
          <div class="bpro-chips" id="bproConsChips">
            <button class="bpro-chip" onclick="bproSelect('cons','flower')">🌿 Flower</button>
            <button class="bpro-chip" onclick="bproSelect('cons','vape')">💨 Vape</button>
            <button class="bpro-chip" onclick="bproSelect('cons','edible')">🍪 Edible</button>
            <button class="bpro-chip" onclick="bproSelect('cons','capsule')">💊 Capsule</button>
            <button class="bpro-chip" onclick="bproSelect('cons','concentrate')">💎 Concentrate</button>
            <button class="bpro-chip" onclick="bproSelect('cons','any')">No Preference</button>
          </div>
        </div>
        <div class="bpro-field">
          <div class="bpro-field-label">Any Concerns?</div>
          <div class="bpro-chips" id="bproConcernChips">
            <button class="bpro-chip" onclick="bproMulti('concern','anxious')">Anxiety-prone</button>
            <button class="bpro-chip" onclick="bproMulti('concern','sensitive')">THC sensitive</button>
            <button class="bpro-chip" onclick="bproMulti('concern','medication')">On medication</button>
            <button class="bpro-chip" onclick="bproMulti('concern','driving')">Driving later</button>
            <button class="bpro-chip" onclick="bproMulti('concern','none')">None</button>
          </div>
        </div>
        <button class="bpro-recommend-btn" onclick="bproGenRec()">Generate Recommendation →</button>
      </div>
      <div class="bpro-rec-panel" id="bproRecPanel">
        <div class="bpro-rec-placeholder">
          <div class="bpro-rec-placeholder-icon">🌿</div>
          <p>Fill in the customer profile and hit <strong>Generate Recommendation</strong> to see matched strains and talking points.</p>
        </div>
      </div>
    </div>
  </div>

  <!-- GLOSSARY PANEL -->
  <div class="bpro-panel bpro-panel-hidden" id="bproGlossary">
    <div class="bpro-glossary-search-row">
      <input class="bpro-glossary-input" id="bproGlossSearch" type="text" placeholder="Search terms..." oninput="bproFilterGloss()" />
      <div class="bpro-gloss-cats" id="bproGlossCats"></div>
    </div>
    <div class="bpro-glossary-grid" id="bproGlossGrid"></div>
  </div>

  <!-- SCRIPTS PANEL -->
  <div class="bpro-panel bpro-panel-hidden" id="bproScripts">
    <div class="bpro-scripts-grid" id="bproScriptsGrid"></div>
  </div>

  <!-- DOSING PANEL -->
  <div class="bpro-panel bpro-panel-hidden" id="bproDosing">
    <div class="bpro-dosing-grid" id="bproDosingGrid"></div>
  </div>
</div>

<!-- CannaQuant -->
<div class="bp-consulting">
  <div class="bp-consulting-inner">
    <div>
      <div class="section-label">✦ CannaQuant</div>
      <div class="consulting-title">Your personal <em>CannaQuant.</em> Your budtender for life.</div>
      <p class="consulting-desc">Think of me as your cannabis financial advisor — except instead of money, we're talking about your experience, your body, your goals, and your plant. Whether you're brand new or a seasoned connoisseur, I meet you exactly where you are. Real conversations. Real answers. No guesswork.</p>
      <div class="consulting-stats">
        <div><div class="consulting-stat-num">10+</div><div class="consulting-stat-label">Years on the floor</div></div>
        <div><div class="consulting-stat-num">1000s</div><div class="consulting-stat-label">Customers helped</div></div>
        <div><div class="consulting-stat-num">500+</div><div class="consulting-stat-label">Strains studied</div></div>
        <div><div class="consulting-stat-num">100%</div><div class="consulting-stat-label">Real experience</div></div>
      </div>
      <a href="https://calendly.com/cannascenti" target="_blank" class="btn-primary">Book Your CannaQuant Session</a>
    </div>
    <div class="consulting-services">
      <div class="consulting-service">
        <div class="consulting-service-icon">🌿</div>
        <div>
          <div class="consulting-service-title">Personal Consumer Session</div>
          <p class="consulting-service-desc">New to cannabis or just not getting the results you want? Tell me your goals, your lifestyle, your experience — I'll build you a personalized cannabis plan covering strains, products, dosing, and consumption methods.</p>
          <div class="consulting-service-price">1-on-1 · 60 minutes · Zoom or phone</div>
        </div>
      </div>
      <div class="consulting-service">
        <div class="consulting-service-icon">🏪</div>
        <div>
          <div class="consulting-service-title">Dispensary & Staff Training</div>
          <p class="consulting-service-desc">Floor strategy, product curation, and comprehensive staff training on strains, terpenes, and customer conversations — built by someone who has actually managed a dispensary.</p>
          <div class="consulting-service-price">Custom packages · In-person or virtual</div>
        </div>
      </div>
      <div class="consulting-service">
        <div class="consulting-service-icon">💼</div>
        <div>
          <div class="consulting-service-title">Cannabis Business Strategy</div>
          <p class="consulting-service-desc">Launching a brand, entering the market, refining your positioning? Deep industry knowledge meets real commercial thinking. From startup to scale.</p>
          <div class="consulting-service-price">Project-based · Initial call complimentary</div>
        </div>
      </div>
    </div>
  </div>
</div>

<footer class="bp-footer">
  <span class="bp-footer-copy">© 2026 Cannascenti. Must be 21+ where applicable.</span>
  <div class="bp-footer-links">
    <a href="/">Home</a>
    <a href="/for-dispensaries">For Dispensaries</a>
    <a href="/privacy">Privacy</a>
  </div>
</footer>

<script>
var SDB_DATA = ${JSON.stringify(_SDB)};
var BPRO_GLOSSARY = ${JSON.stringify(_GLOSSARY)};
var BPRO_SCRIPTS = ${JSON.stringify(_SCRIPTS)};
var BPRO_DOSE_CARDS = ${JSON.stringify(_DOSE)};

var bproState = { exp: null, goal: [], time: null, cons: null, concern: [] };

function bproTab(tab) {
  var tabs = ['intake','glossary','scripts','dosing'];
  document.querySelectorAll('.bpro-tab').forEach(function(t){t.classList.remove('active');});
  tabs.forEach(function(t, i) {
    var id = 'bpro' + t.charAt(0).toUpperCase() + t.slice(1);
    document.getElementById(id).classList.toggle('bpro-panel-hidden', t !== tab);
    document.querySelectorAll('.bpro-tab')[i].classList.toggle('active', t === tab);
  });
}

function bproSelect(field, val) {
  bproState[field] = val;
  var chips = document.querySelectorAll('#bpro' + field.charAt(0).toUpperCase() + field.slice(1) + 'Chips .bpro-chip');
  chips.forEach(function(c){c.classList.remove('selected');});
  event.currentTarget.classList.add('selected');
}

function bproMulti(field, val) {
  var arr = bproState[field];
  var btn = event.currentTarget;
  if (arr.indexOf(val) > -1) {
    bproState[field] = arr.filter(function(v){return v !== val;});
    btn.classList.remove('selected');
  } else {
    var max = field === 'goal' ? 2 : 5;
    if (arr.length < max) { bproState[field].push(val); btn.classList.add('selected'); }
  }
}

function bproGenRec() {
  var exp = bproState.exp, goal = bproState.goal, time = bproState.time, concern = bproState.concern;
  var panel = document.getElementById('bproRecPanel');
  var scored = SDB_DATA.map(function(s) {
    var score = 0;
    var eff = s.effects.map(function(e){return e.toLowerCase();});
    if (goal.indexOf('sleep') > -1 && (eff.indexOf('sleepy') > -1 || s.type==='indica')) score += 10;
    if (goal.indexOf('pain') > -1 && s.medical.some(function(m){return m.toLowerCase().indexOf('pain') > -1;})) score += 8;
    if (goal.indexOf('anxiety') > -1 && s.medical.some(function(m){return m.toLowerCase().indexOf('anxiety') > -1;})) score += 8;
    if (goal.indexOf('energy') > -1 && (s.type==='sativa' || eff.indexOf('energetic') > -1)) score += 8;
    if (goal.indexOf('creativity') > -1 && eff.indexOf('creative') > -1) score += 8;
    if (goal.indexOf('mood') > -1 && (eff.indexOf('happy') > -1 || eff.indexOf('euphoric') > -1)) score += 6;
    if (goal.indexOf('appetite') > -1 && eff.indexOf('hungry') > -1) score += 10;
    if (goal.indexOf('focus') > -1 && eff.indexOf('focused') > -1) score += 8;
    if (goal.indexOf('social') > -1 && (eff.indexOf('happy') > -1 || eff.indexOf('talkative') > -1 || eff.indexOf('euphoric') > -1)) score += 6;
    if (goal.indexOf('relax') > -1 && (eff.indexOf('relaxed') > -1 || s.type==='indica')) score += 8;
    if (time==='morning' && s.type==='sativa') score += 5;
    if (time==='afternoon' && s.type==='sativa') score += 3;
    if (time==='afternoon' && s.type==='hybrid') score += 4;
    if (time==='evening' && s.type==='hybrid') score += 5;
    if (time==='nighttime' && (s.type==='indica' || eff.indexOf('sleepy') > -1)) score += 6;
    if (exp==='first') {
      if (s.type==='hybrid') score += 4;
      if (s.name==='Blue Dream' || s.name==='Strawberry Cough') score += 6;
      if (s.thc.indexOf('17') > -1 || s.thc.indexOf('15') > -1 || s.thc.indexOf('16') > -1) score += 3;
    }
    if (exp==='heavy') {
      if (s.thc.indexOf('25') > -1 || s.thc.indexOf('26') > -1 || s.thc.indexOf('27') > -1 || s.thc.indexOf('28') > -1 || s.thc.indexOf('29') > -1) score += 5;
      if (s.name==='Ghost Train Haze' || s.name==='Wedding Cake' || s.name==='Runtz') score += 4;
    }
    if (concern.indexOf('anxious') > -1 || concern.indexOf('sensitive') > -1) {
      if (s.type==='sativa' && parseFloat(s.thc) > 22) score -= 5;
      if (s.name==='Ghost Train Haze') score -= 8;
      if (s.type==='hybrid' || s.medical.some(function(m){return m.toLowerCase().indexOf('anxiety') > -1;})) score += 3;
    }
    return { s: s, score: score };
  });
  scored.sort(function(a,b){return b.score - a.score;});
  var top = scored.slice(0,3);
  var goalLabels = { sleep:'sleep', pain:'pain relief', anxiety:'anxiety management', energy:'energy and focus', creativity:'creativity', mood:'mood elevation', appetite:'appetite stimulation', focus:'focus', social:'socializing', relax:'relaxation' };
  var goalsText = goal.length ? goal.map(function(g){return goalLabels[g]||g;}).join(' and ') : 'general use';
  var timeText = { morning:'morning', afternoon:'afternoon', evening:'evening', nighttime:'nighttime' }[time] || 'anytime';
  var expText = { first:'first-time', occasional:'occasional', regular:'regular', heavy:'experienced' }[exp] || '';
  var warnings = [];
  if (concern.indexOf('driving') > -1) warnings.push('⚠️ Customer is driving later — recommend low dose or CBD-forward options only. Do not recommend concentrates or high-THC products for same-day driving.');
  if (concern.indexOf('medication') > -1) warnings.push('⚠️ Customer is on medication — recommend they consult their physician before use. Cannabis can interact with SSRIs, blood thinners, and other medications.');
  if (concern.indexOf('anxious') > -1 || concern.indexOf('sensitive') > -1) warnings.push('⚠️ Anxiety-prone or THC-sensitive — start with 2.5mg or less for edibles, recommend CBD:THC ratios, avoid pure sativas with high THC.');
  if (exp === 'first') warnings.push('⚠️ First-time user — 5mg or below for edibles, one small hit for flower. Set expectations: 15–30 minute onset for flower, 30 min–2 hours for edibles.');
  var s0 = top[0].s;
  var scriptLine = '"Based on what you\'ve told me, I\'d recommend starting with ' + s0.name + ' — it\'s a ' + s0.type + ' that\'s great for ' + goalsText + '. ' + (time ? 'Perfect for ' + timeText + ' use. ' : '') + (exp==='first' ? 'Since you\'re new, I\'d suggest starting with a small amount and waiting 20–30 minutes before taking more.' : '') + '"';
  panel.innerHTML =
    '<div class="bpro-rec-title">Recommendation Ready</div>' +
    '<div class="bpro-rec-summary">' + (expText ? expText.charAt(0).toUpperCase()+expText.slice(1)+' consumer · ' : '') + goalsText + ' · ' + timeText + '</div>' +
    top.map(function(item, i) {
      return '<div class="bpro-rec-strain bpro-rec-s-' + item.s.type + '">' +
        '<div class="bpro-rec-strain-top">' +
          '<span class="bpro-rec-strain-name">' + (i===0?'⭐ ':'') + item.s.name + '</span>' +
          '<span class="bpro-rec-strain-type bpro-type-' + item.s.type + '">' + item.s.type + ' · THC ' + item.s.thc + '</span>' +
        '</div>' +
        '<div class="bpro-rec-strain-why">' + item.s.bestFor + '</div>' +
        '<div class="bpro-rec-strain-effects">' + item.s.effects.slice(0,4).map(function(e){return '<span class="bpro-rec-eff">'+e+'</span>';}).join('') + '</div>' +
      '</div>';
    }).join('') +
    '<div class="bpro-rec-script"><div class="bpro-rec-script-label">✦ Suggested Script</div><p>' + scriptLine + '</p></div>' +
    (warnings.length ? '<div class="bpro-rec-warning">' + warnings.join('<br>') + '</div>' : '');
}

// Glossary
var bproActiveCat = 'All';
var bproGlossSearch = '';
var GLOSS_CATS = ['All'].concat(BPRO_GLOSSARY.reduce(function(acc,g){if(acc.indexOf(g.cat)<0)acc.push(g.cat);return acc;},[]));

function bproRenderGloss() {
  var grid = document.getElementById('bproGlossGrid');
  var search = bproGlossSearch.toLowerCase();
  var filtered = BPRO_GLOSSARY.filter(function(g) {
    var catMatch = bproActiveCat === 'All' || g.cat === bproActiveCat;
    var textMatch = !search || g.term.toLowerCase().indexOf(search) > -1 || g.def.toLowerCase().indexOf(search) > -1;
    return catMatch && textMatch;
  });
  grid.innerHTML = filtered.map(function(g) {
    return '<div class="bpro-gloss-card"><div class="bpro-gloss-term">'+g.term+'</div><div class="bpro-gloss-cat-tag">'+g.cat+'</div><div class="bpro-gloss-def">'+g.def+'</div></div>';
  }).join('') || '<div style="color:rgba(245,240,225,0.3);padding:40px;text-align:center">No terms match your search.</div>';
}
function bproFilterGloss() {
  bproGlossSearch = document.getElementById('bproGlossSearch').value;
  bproRenderGloss();
}
function bproSetCat(cat) {
  bproActiveCat = cat;
  document.querySelectorAll('.bpro-gloss-cat').forEach(function(c){c.classList.toggle('active', c.textContent === cat);});
  bproRenderGloss();
}
document.getElementById('bproGlossCats').innerHTML = GLOSS_CATS.map(function(c) {
  return '<button class="bpro-gloss-cat' + (c==='All'?' active':'') + '" onclick="bproSetCat(\'' + c + '\')">' + c + '</button>';
}).join('');
bproRenderGloss();

// Scripts
document.getElementById('bproScriptsGrid').innerHTML = BPRO_SCRIPTS.map(function(s) {
  return '<div class="bpro-script-card">' +
    '<div class="bpro-script-scenario">'+s.scenario+'</div>' +
    '<div class="bpro-script-title">'+s.title+'</div>' +
    '<div class="bpro-script-body">'+s.body+'</div>' +
    '<div class="bpro-script-note">💡 '+s.note+'</div>' +
  '</div>';
}).join('');

// Dosing
document.getElementById('bproDosingGrid').innerHTML = BPRO_DOSE_CARDS.map(function(c) {
  return '<div class="bpro-dose-card">' +
    '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:'+c.color+'"></div>' +
    '<h3>'+c.title+'</h3>' +
    '<div class="bpro-dose-sub" style="color:rgba(245,240,225,0.4)">'+c.sub+'</div>' +
    '<div class="bpro-dose-rows">' +
      c.rows.map(function(r){return '<div class="bpro-dose-row"><span class="bpro-dose-row-label">'+r.label+'</span><span class="bpro-dose-row-val">'+r.val+'</span></div>';}).join('') +
    '</div>' +
  '</div>';
}).join('');
</script>
</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "public, max-age=3600" });
    res.end(html);
    return;
  }

  // ─── Learn page ───────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/learn") {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cannabis Education — Cannascenti</title>
<meta name="description" content="The most comprehensive cannabis education resource. Numbers, lab reports, conditions, and legal status — all in one place.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Great+Vibes&family=Montserrat:wght@300;400;500;600&family=Playfair+Display:ital,wght@1,400&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--dark:#060f0a;--green:#52b788;--bright-green:#74c69d;--light-green:#b7e4c7;--cream:#f2ead8;--gold:#c9973a;--amber:#e8a84c;--warm-black:#060f0a;--card-bg:rgba(255,255,255,0.025);--border:rgba(255,255,255,0.07)}
body{background:var(--dark);color:var(--cream);font-family:'Montserrat',sans-serif;font-weight:300;line-height:1.75;overflow-x:hidden}
a{color:var(--bright-green);text-decoration:none}

.s-nav{display:flex;align-items:center;justify-content:space-between;padding:24px 60px;border-bottom:1px solid var(--border);position:sticky;top:0;background:rgba(6,15,10,0.9);backdrop-filter:blur(12px);z-index:100}
.s-nav-logo{font-family:'Great Vibes',cursive;font-size:26px;color:var(--cream)}
.s-nav-back{font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:rgba(242,234,216,0.4);transition:color .2s}
.s-nav-back:hover{color:var(--bright-green)}
@media(max-width:600px){.s-nav{padding:20px 20px}}

.s-hero{padding:80px 60px 60px;max-width:900px;margin:0 auto;text-align:center}
.s-label{font-size:10px;letter-spacing:0.65em;text-transform:uppercase;color:var(--bright-green);margin-bottom:20px}
.s-title{font-family:'Cormorant Garamond',serif;font-size:clamp(38px,6vw,72px);font-weight:300;line-height:1.1;color:var(--cream);margin-bottom:20px}
.s-title em{font-family:'Playfair Display',serif;font-style:italic;color:var(--bright-green)}
.s-desc{font-size:15px;color:rgba(242,234,216,0.55);max-width:560px;margin:0 auto;line-height:1.85}
@media(max-width:600px){.s-hero{padding:60px 24px 40px}}

.learn-inner{max-width:1280px;margin:0 auto;padding:0 60px 120px}
@media(max-width:768px){.learn-inner{padding:0 24px 80px}}

.learn-section{margin-top:80px;padding-top:60px;border-top:1px solid rgba(82,183,136,0.08)}
.learn-section:first-child{border-top:none;margin-top:0;padding-top:20px}

.section-label{font-size:10px;letter-spacing:0.5em;text-transform:uppercase;color:var(--bright-green);margin-bottom:16px;display:block}
.terpene-intro{max-width:700px;margin-bottom:48px}
.terpene-intro-title{font-family:'Cormorant Garamond',serif;font-size:clamp(28px,3.5vw,44px);font-weight:300;line-height:1.2;color:var(--cream);margin-bottom:12px}
.terpene-intro-title em{font-family:'Playfair Display',serif;font-style:italic;color:var(--light-green)}
.terpene-intro-desc{font-size:14px;line-height:1.9;color:var(--cream);opacity:.6}

/* numbers */
.numbers-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-top:40px}
.numbers-card{background:var(--card-bg);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:28px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:4px;transition:transform .25s,border-color .25s}
.numbers-card:hover{transform:translateY(-3px);border-color:rgba(122,184,80,0.3)}
.num-big{font-family:'Cormorant Garamond',serif;font-size:3.2rem;font-weight:700;color:var(--bright-green);line-height:1}
.num-plus{font-size:1.1rem;font-weight:700;color:var(--gold);margin-top:-4px;min-height:20px}
.num-label{font-size:.75rem;line-height:1.4;opacity:.6;margin-top:8px;letter-spacing:.03em}

/* consume btns & detail */
.consume-btn{display:flex;flex-direction:column;align-items:center;gap:8px;padding:20px 12px;border-radius:12px;border:2px solid rgba(255,255,255,0.08);background:var(--card-bg);cursor:pointer;transition:all .25s;color:var(--cream);font-family:'Montserrat',sans-serif;opacity:.65}
.consume-btn:hover{opacity:.85;transform:translateY(-2px)}
.consume-btn.active{opacity:1;border-color:var(--bright-green);box-shadow:0 4px 20px rgba(122,184,80,0.25);transform:translateY(-3px)}
.consume-btn-icon{font-size:1.8rem}
.consume-btn-name{font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;text-align:center}
.consume-detail{border-radius:16px;border:1px solid rgba(255,255,255,0.08);background:var(--card-bg);overflow:hidden;min-height:60px;transition:all .3s}
.consume-detail-inner{padding:28px 32px}
.consume-detail-header{display:flex;align-items:center;gap:16px;margin-bottom:24px}
.consume-detail-icon{font-size:2.5rem}
.consume-detail-title{font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:600;color:var(--cream)}
.consume-desc-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.consume-desc-item{background:rgba(255,255,255,0.04);border-radius:10px;padding:16px}
.consume-desc-item strong{display:block;font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--bright-green);margin-bottom:6px}
.consume-desc-item p{font-size:.85rem;line-height:1.5;opacity:.8;margin:0}
@media(max-width:600px){.consume-desc-grid{grid-template-columns:1fr}}

/* coa grid */
.coa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:14px;margin:36px 0 28px}

/* conditions */
.conditions-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin:36px 0 28px}
.condition-btn{display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px 10px;border-radius:12px;border:2px solid rgba(255,255,255,0.08);background:var(--card-bg);cursor:pointer;transition:all .25s;color:var(--cream);font-family:'Montserrat',sans-serif;opacity:.65}
.condition-btn:hover{opacity:.85;transform:translateY(-2px)}
.condition-btn.active{opacity:1;border-color:var(--bright-green);box-shadow:0 4px 20px rgba(122,184,80,0.25);transform:translateY(-3px)}
.condition-btn-icon{font-size:1.6rem}
.condition-btn-name{font-size:.68rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;text-align:center}

/* legal map */
.legal-legend{display:flex;gap:24px;align-items:center;flex-wrap:wrap;margin:24px 0 32px}
.legal-dot{width:12px;height:12px;border-radius:50%;display:inline-block;margin-right:6px}
.legal-rec{background:#7dd87d}
.legal-med{background:#5ca0e8}
.legal-dec{background:#e8c05c}
.legal-ill{background:rgba(255,255,255,0.2)}
.legal-legend-label{font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;opacity:.8;margin-right:12px}
.legal-states-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.legal-state{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:10px;background:var(--card-bg);border:1px solid rgba(255,255,255,0.06);transition:transform .2s}
.legal-state:hover{transform:translateY(-2px)}
.legal-state-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.legal-state-name{font-size:.78rem;font-weight:600;color:var(--cream)}
.legal-state-status{font-size:.62rem;opacity:.5;text-transform:uppercase;letter-spacing:.06em}
</style>
</head>
<body>

<nav class="s-nav">
  <a href="/" class="s-nav-logo">Cannascenti</a>
  <a href="/" class="s-nav-back">← Back to Home</a>
</nav>

<div class="s-hero">
  <div class="s-label">✦ The Cannalogy</div>
  <h1 class="s-title">Cannabis education for <em>everyone</em></h1>
  <p class="s-desc">Numbers, lab reports, conditions, and legal status. Everything you need to actually understand what you're buying and putting in your body.</p>
</div>

<div class="learn-inner">

  <!-- NUMBERS -->
  <div class="learn-section">
    <div class="terpene-intro">
      <span class="section-label">✦ Cannabis by the Numbers</span>
      <div class="terpene-intro-title">The plant in <em>plain numbers</em></div>
      <p class="terpene-intro-desc">The cannabis industry and the plant itself tell a story best understood through data. These are the numbers worth knowing.</p>
    </div>
    <div class="numbers-grid">
      <div class="numbers-card"><div class="num-big">100</div><div class="num-plus">+</div><div class="num-label">Cannabinoids identified in cannabis</div></div>
      <div class="numbers-card"><div class="num-big">200</div><div class="num-plus">+</div><div class="num-label">Terpenes found in the plant</div></div>
      <div class="numbers-card"><div class="num-big">30</div><div class="num-plus">%</div><div class="num-label">Max THC potency in top-shelf flower</div></div>
      <div class="numbers-card"><div class="num-big">70</div><div class="num-plus">%</div><div class="num-label">Of the endocannabinoid system still being actively studied</div></div>
      <div class="numbers-card"><div class="num-big">50</div><div class="num-plus">K+</div><div class="num-label">Years cannabis has been used by humans</div></div>
      <div class="numbers-card"><div class="num-big">38</div><div class="num-plus"></div><div class="num-label">US states with legal cannabis (medical or recreational)</div></div>
      <div class="numbers-card"><div class="num-big">57</div><div class="num-plus">B</div><div class="num-label">Dollar US cannabis market projected by 2030</div></div>
      <div class="numbers-card"><div class="num-big">4</div><div class="num-plus">hrs</div><div class="num-label">Average duration of an edible experience</div></div>
    </div>
  </div>

  <!-- COA -->
  <div class="learn-section">
    <div class="terpene-intro">
      <span class="section-label">✦ Lab Reports &amp; COAs</span>
      <div class="terpene-intro-title">What the label <em>actually means</em></div>
      <p class="terpene-intro-desc">A Certificate of Analysis (COA) is the most important document in cannabis — and almost nobody knows how to read one. Click each panel to decode what you're actually buying.</p>
    </div>
    <div class="coa-grid" id="coaGrid"></div>
    <div class="consume-detail" id="coaDetail"></div>
  </div>

  <!-- CONDITIONS -->
  <div class="learn-section">
    <div class="terpene-intro">
      <span class="section-label">✦ Cannabis &amp; Conditions</span>
      <div class="terpene-intro-title">What actually <em>helps what</em></div>
      <p class="terpene-intro-desc">Cannabis isn't one-size-fits-all medicine. Different conditions respond to different cannabinoid and terpene combinations. Click any condition to see what the research and experience point to.</p>
    </div>
    <div class="conditions-grid" id="conditionsGrid"></div>
    <div class="consume-detail" id="conditionsDetail"></div>
  </div>

  <!-- LEGAL MAP -->
  <div class="learn-section">
    <div class="terpene-intro">
      <span class="section-label">✦ Legal Status by State</span>
      <div class="terpene-intro-title">Where cannabis stands <em>right now</em></div>
      <p class="terpene-intro-desc">The legal landscape has shifted dramatically in the last decade. Here's exactly where every US state stands — recreational, medical-only, decriminalized, or still fully illegal.</p>
    </div>
    <div class="legal-legend">
      <span class="legal-dot legal-rec"></span><span class="legal-legend-label">Recreational</span>
      <span class="legal-dot legal-med"></span><span class="legal-legend-label">Medical Only</span>
      <span class="legal-dot legal-dec"></span><span class="legal-legend-label">Decriminalized</span>
      <span class="legal-dot legal-ill"></span><span class="legal-legend-label">Illegal</span>
    </div>
    <div class="legal-states-grid" id="legalGrid"></div>
  </div>

</div>

<script>
// COA
const COA_DATA = [
  {id:'potency',icon:'💪',name:'Potency Panel',bestFor:'The most important panel. Shows THC, THCA, CBD, CBDA, and minor cannabinoids as percentages.',howTo:'THCA converts to THC when heated (decarboxylation). Total THC = THC + (THCA × 0.877). The number on the package is often THCA — not active THC.',pros:'Look for: Total Active THC, CBD content, minor cannabinoids (CBG, CBN, CBC).',cons:'THC % alone tells you almost nothing about quality. A 30% distillate hits differently than a 22% terpene-rich flower.'},
  {id:'terpenes',icon:'🌸',name:'Terpene Panel',bestFor:'The panel that predicts your experience more accurately than THC %. Total terpene content and individual profile.',howTo:'Good flower has 1–3% total terpenes. Premium craft cannabis can hit 3–5%+. Below 0.5% usually means degraded product.',pros:'Look for: which terpenes dominate and at what percentage. Myrcene + linalool = sedating. Limonene + pinene = energetic.',cons:'Terpenes are volatile — they degrade with heat, light, and time.'},
  {id:'pesticides',icon:'🚫',name:'Pesticide Screening',bestFor:'Safety panel. Tests for residual pesticides from cultivation. Critical for medical patients and anyone who cares what they\'re inhaling.',howTo:'"Pass" means all tested compounds are below action limits. Look for "ND" (not detected) across the board.',pros:'Always buy tested cannabis from accredited labs.',cons:'Different states test for different pesticides. Third-party tested products from reputable labs are the gold standard.'},
  {id:'microbials',icon:'🦠',name:'Microbial Testing',bestFor:'Tests for mold, yeast, bacteria (E. coli, Salmonella). Essential for immunocompromised patients.',howTo:'Total Yeast and Mold (TYMC) and Total Aerobic Microbial Count (TAMC) must fall below action levels.',pros:'Any product with a failed microbial test is dangerous and should not be consumed.',cons:'Visual red flags: white powdery coating, dark spots, or musty smell — regardless of a lab pass.'},
  {id:'metals',icon:'⚗️',name:'Heavy Metals',bestFor:'Cannabis bioaccumulates heavy metals from soil — lead, cadmium, arsenic, mercury. Especially relevant for concentrates.',howTo:'Concentrates concentrate everything — including any metals in the plant. Always verify concentrates have passed heavy metals testing.',pros:'Look for "Pass" on lead, cadmium, arsenic, and mercury specifically.',cons:'Hemp (CBD) products have had the most heavy metals issues historically.'},
  {id:'labinfo',icon:'🏛️',name:'Lab & Batch Info',bestFor:'Who tested it, when, and which batch. The authenticity of the COA itself.',howTo:'A legitimate COA includes: accredited lab name and license number, sample ID, batch number, harvest/test date, and QR code to verify online.',pros:'Look for: ISO/IEC 17025 accreditation — the gold standard for testing labs.',cons:'COA fraud exists. Always scan the QR code or visit the lab\'s website to verify the actual report.'},
];
function renderCoaGrid() {
  document.getElementById('coaGrid').innerHTML = COA_DATA.map(m =>
    '<button class="consume-btn" id="coabtn-'+m.id+'" onclick="coaSelect(\''+m.id+'\')"><span class="consume-btn-icon">'+m.icon+'</span><span class="consume-btn-name">'+m.name+'</span></button>'
  ).join('');
}
function coaSelect(id) {
  document.querySelectorAll('#coaGrid .consume-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('coabtn-'+id).classList.add('active');
  const m = COA_DATA.find(x => x.id===id);
  document.getElementById('coaDetail').innerHTML = '<div class="consume-detail-inner"><div class="consume-detail-header"><div class="consume-detail-icon">'+m.icon+'</div><div><div class="consume-detail-title">'+m.name+'</div></div></div><div class="consume-desc-grid"><div class="consume-desc-item"><strong>What It Is</strong><p>'+m.bestFor+'</p></div><div class="consume-desc-item"><strong>How to Read It</strong><p>'+m.howTo+'</p></div><div class="consume-desc-item"><strong>What to Look For</strong><p>'+m.pros+'</p></div><div class="consume-desc-item"><strong>Red Flags</strong><p>'+m.cons+'</p></div></div></div>';
}
renderCoaGrid();
coaSelect('potency');

// Conditions
const CONDITIONS_DATA = [
  {id:'anxiety',icon:'😰',name:'Anxiety',bestFor:'CBD-dominant or balanced 1:1 products. High-THC can worsen anxiety in some people.',howTo:'Best cannabinoids: CBD (primary), low-dose THC, CBG. Best terpenes: Linalool, Myrcene, Caryophyllene.',pros:'Start with CBD tincture (25–50mg). If adding THC, never exceed 5mg until you know your response.',cons:'High-THC cannabis is a common anxiety trigger. If you\'ve had panic attacks from cannabis, stay below 5mg THC.'},
  {id:'sleep',icon:'😴',name:'Insomnia / Sleep',bestFor:'Indica-dominant, high-myrcene, high-CBN products taken 30–60 minutes before bed.',howTo:'Best cannabinoids: CBN (most sedating), THC (shortens sleep onset), CBD (improves sleep quality). Best terpenes: Myrcene, Linalool, Terpinolene.',pros:'CBN 5–10mg + low-dose THC (5–10mg) + myrcene-rich strain = most effective sleep stack.',cons:'High-THC use before sleep can suppress REM sleep over time. Use intentionally, not habitually.'},
  {id:'pain',icon:'🤕',name:'Chronic Pain',bestFor:'Full-spectrum cannabis addressing both the pain signal and inflammation simultaneously.',howTo:'Best cannabinoids: THC (pain relief), CBD (anti-inflammatory), CBG (bone/joint), CBC. Best terpenes: Caryophyllene, Myrcene.',pros:'For localized pain: CBD topicals. For systemic pain: full-spectrum tincture or edible.',cons:'Cannabis addresses pain symptomatically — it doesn\'t heal underlying tissue damage.'},
  {id:'depression',icon:'🌧️',name:'Depression',bestFor:'Uplifting sativas and hybrids with limonene, pinene, and moderate THC for daytime mood lift.',howTo:'Best cannabinoids: THC (mood elevation), CBD, CBC. Best terpenes: Limonene (serotonin/dopamine), Pinene (alertness), Linalool.',pros:'Microdosing THC (2–5mg) with a limonene-forward strain is the most widely reported daytime protocol.',cons:'Heavy daily use can blunt motivation and deepen depression over time.'},
  {id:'ptsd',icon:'🛡️',name:'PTSD',bestFor:'Cannabis is one of the most studied plant medicines for PTSD. Nightmares, hypervigilance, and anxiety respond well.',howTo:'Best cannabinoids: THC (reduces nightmare frequency), CBD, CBN. Best terpenes: Myrcene, Linalool, Caryophyllene.',pros:'THC has been shown to reduce REM sleep disturbances and nightmare frequency.',cons:'High-THC can cause hypervigilance and paranoia in some PTSD patients. Start extremely low.'},
  {id:'nausea',icon:'🤢',name:'Nausea',bestFor:'One of the oldest documented medical uses. Fast-acting inhalation is most effective.',howTo:'Best cannabinoids: THC (directly reduces nausea via CB1), CBD (anti-emetic). Best terpenes: Limonene.',pros:'Even a single puff can stop nausea within minutes for most users.',cons:'Cannabinoid Hyperemesis Syndrome (CHS) is rare but real — heavy long-term use can paradoxically cause severe nausea.'},
  {id:'adhd',icon:'⚡',name:'ADHD / Focus',bestFor:'Low-dose THCV, sativa-dominant strains, and microdosed THC can improve focus — heavy use worsens it.',howTo:'Best cannabinoids: THCV, low-dose THC, CBD. Best terpenes: Pinene (acetylcholinesterase inhibitor), Limonene.',pros:'Microdosing 2–5mg THC with a pinene/limonene-dominant strain before focused work is widely reported.',cons:'High-THC reliably impairs working memory and attention. The therapeutic window is narrow.'},
  {id:'inflammation',icon:'🔥',name:'Inflammation',bestFor:'CBD and caryophyllene are the most evidence-backed anti-inflammatory cannabis compounds.',howTo:'Best cannabinoids: CBD, CBG, CBC, Caryophyllene (direct CB2 activation). Topicals for localized, edibles for systemic.',pros:'CBD + caryophyllene is the most studied anti-inflammatory stack.',cons:'Cannabis reduces inflammation but doesn\'t address root causes.'},
];
function renderConditionsGrid() {
  document.getElementById('conditionsGrid').innerHTML = CONDITIONS_DATA.map(c =>
    '<button class="condition-btn" id="condbtn-'+c.id+'" onclick="conditionSelect(\''+c.id+'\')"><span class="condition-btn-icon">'+c.icon+'</span><span class="condition-btn-name">'+c.name+'</span></button>'
  ).join('');
}
function conditionSelect(id) {
  document.querySelectorAll('.condition-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('condbtn-'+id).classList.add('active');
  const c = CONDITIONS_DATA.find(x => x.id===id);
  document.getElementById('conditionsDetail').innerHTML = '<div class="consume-detail-inner"><div class="consume-detail-header"><div class="consume-detail-icon">'+c.icon+'</div><div><div class="consume-detail-title">'+c.name+'</div></div></div><div class="consume-desc-grid"><div class="consume-desc-item"><strong>Best Approach</strong><p>'+c.bestFor+'</p></div><div class="consume-desc-item"><strong>Cannabinoids &amp; Terpenes</strong><p>'+c.howTo+'</p></div><div class="consume-desc-item"><strong>Protocol</strong><p>'+c.pros+'</p></div><div class="consume-desc-item"><strong>Important Notes</strong><p>'+c.cons+'</p></div></div></div>';
}
renderConditionsGrid();
conditionSelect('anxiety');

// Legal Map
const LEGAL_STATES = [
  {name:'Alabama',status:'med',label:'Medical'},{name:'Alaska',status:'rec',label:'Recreational'},{name:'Arizona',status:'rec',label:'Recreational'},{name:'Arkansas',status:'med',label:'Medical'},{name:'California',status:'rec',label:'Recreational'},{name:'Colorado',status:'rec',label:'Recreational'},{name:'Connecticut',status:'rec',label:'Recreational'},{name:'Delaware',status:'rec',label:'Recreational'},{name:'Florida',status:'med',label:'Medical'},{name:'Georgia',status:'dec',label:'Decriminalized'},{name:'Hawaii',status:'med',label:'Medical'},{name:'Idaho',status:'ill',label:'Illegal'},{name:'Illinois',status:'rec',label:'Recreational'},{name:'Indiana',status:'ill',label:'Illegal'},{name:'Iowa',status:'med',label:'Medical'},{name:'Kansas',status:'ill',label:'Illegal'},{name:'Kentucky',status:'med',label:'Medical'},{name:'Louisiana',status:'med',label:'Medical'},{name:'Maine',status:'rec',label:'Recreational'},{name:'Maryland',status:'rec',label:'Recreational'},{name:'Massachusetts',status:'rec',label:'Recreational'},{name:'Michigan',status:'rec',label:'Recreational'},{name:'Minnesota',status:'rec',label:'Recreational'},{name:'Mississippi',status:'med',label:'Medical'},{name:'Missouri',status:'rec',label:'Recreational'},{name:'Montana',status:'rec',label:'Recreational'},{name:'Nebraska',status:'dec',label:'Decriminalized'},{name:'Nevada',status:'rec',label:'Recreational'},{name:'New Hampshire',status:'dec',label:'Decriminalized'},{name:'New Jersey',status:'rec',label:'Recreational'},{name:'New Mexico',status:'rec',label:'Recreational'},{name:'New York',status:'rec',label:'Recreational'},{name:'North Carolina',status:'dec',label:'Decriminalized'},{name:'North Dakota',status:'med',label:'Medical'},{name:'Ohio',status:'rec',label:'Recreational'},{name:'Oklahoma',status:'med',label:'Medical'},{name:'Oregon',status:'rec',label:'Recreational'},{name:'Pennsylvania',status:'med',label:'Medical'},{name:'Rhode Island',status:'rec',label:'Recreational'},{name:'South Carolina',status:'ill',label:'Illegal'},{name:'South Dakota',status:'med',label:'Medical'},{name:'Tennessee',status:'ill',label:'Illegal'},{name:'Texas',status:'med',label:'Medical'},{name:'Utah',status:'med',label:'Medical'},{name:'Vermont',status:'rec',label:'Recreational'},{name:'Virginia',status:'rec',label:'Recreational'},{name:'Washington',status:'rec',label:'Recreational'},{name:'West Virginia',status:'med',label:'Medical'},{name:'Wisconsin',status:'dec',label:'Decriminalized'},{name:'Wyoming',status:'ill',label:'Illegal'},{name:'Washington DC',status:'rec',label:'Recreational'},
];
document.getElementById('legalGrid').innerHTML = LEGAL_STATES.map(s =>
  '<div class="legal-state"><div class="legal-state-dot legal-'+s.status+'"></div><div><div class="legal-state-name">'+s.name+'</div><div class="legal-state-status">'+s.label+'</div></div></div>'
).join('');
</script>
</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  // ─── Mary Jane Vision — Product Scanner page ──────────────────────────────
  if (req.method === "GET" && req.url === "/scan") {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mary Jane Vision — Product Scanner | Cannascenti</title>
<meta name="description" content="Scan any cannabis product and get a full intelligence briefing instantly. Powered by Mary Jane.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Great+Vibes&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--dark:#060f0a;--green:#52b788;--bright-green:#74c69d;--cream:#f2ead8;--gold:#c9973a;--border:rgba(255,255,255,0.07);--card:rgba(255,255,255,0.025);--amber:#e8a84c}
body{background:var(--dark);color:var(--cream);font-family:'Montserrat',sans-serif;font-weight:300;line-height:1.75;overflow-x:hidden}
a{color:var(--bright-green);text-decoration:none}

/* nav */
.s-nav{display:flex;align-items:center;justify-content:space-between;padding:24px 60px;border-bottom:1px solid var(--border);position:sticky;top:0;background:rgba(6,15,10,0.9);backdrop-filter:blur(12px);z-index:100}
.s-nav-logo{font-family:'Great Vibes',cursive;font-size:26px;color:var(--cream)}
.s-nav-back{font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:rgba(242,234,216,0.4);transition:color .2s}
.s-nav-back:hover{color:var(--bright-green)}
@media(max-width:600px){.s-nav{padding:20px 20px}}

/* hero */
.s-hero{padding:80px 60px 60px;max-width:760px;margin:0 auto;text-align:center}
.s-label{font-size:10px;letter-spacing:0.65em;text-transform:uppercase;color:var(--bright-green);margin-bottom:20px}
.s-title{font-family:'Cormorant Garamond',serif;font-size:clamp(38px,6vw,68px);font-weight:300;line-height:1.1;color:var(--cream);margin-bottom:20px}
.s-title em{font-style:italic;color:var(--bright-green)}
.s-desc{font-size:15px;color:rgba(242,234,216,0.55);max-width:520px;margin:0 auto;line-height:1.85}
@media(max-width:600px){.s-hero{padding:60px 24px 40px}}

/* scanner */
.scan-wrap{max-width:760px;margin:0 auto;padding:0 60px 100px}
@media(max-width:600px){.scan-wrap{padding:0 20px 80px}}

.scanner-drop{border:1px dashed rgba(82,183,136,0.3);border-radius:6px;background:rgba(82,183,136,0.03);min-height:240px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:40px 24px;cursor:pointer;transition:border-color .2s,background .2s}
.scanner-drop:hover,.scanner-drop.drag-over{border-color:rgba(82,183,136,0.6);background:rgba(82,183,136,0.06)}
.scanner-drop-icon{width:52px;height:52px;color:rgba(82,183,136,0.5)}
.scanner-drop-title{font-size:16px;font-weight:500;color:var(--cream);text-align:center}
.scanner-drop-sub{font-size:12px;color:rgba(242,234,216,0.35);letter-spacing:0.06em;text-align:center;margin-top:-12px}
.scanner-drop-btns{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}
.scanner-btn{font-family:'Montserrat',sans-serif;font-size:11px;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;padding:13px 24px;border-radius:3px;border:1px solid rgba(82,183,136,0.4);background:transparent;color:var(--bright-green);cursor:pointer;transition:background .2s,border-color .2s;min-height:44px}
.scanner-btn:hover{background:rgba(82,183,136,0.1);border-color:rgba(82,183,136,0.7)}
.scanner-btn-primary{background:var(--bright-green);color:#060f0a;border-color:var(--bright-green)}
.scanner-btn-primary:hover{background:#74c69d;border-color:#74c69d}
.scanner-preview-wrap{position:relative;border-radius:6px;overflow:hidden;border:1px solid rgba(82,183,136,0.25)}
.scanner-preview-img{width:100%;max-height:320px;object-fit:contain;background:#030806;display:block}
.scanner-preview-clear{position:absolute;top:10px;right:10px;width:32px;height:32px;border-radius:50%;background:rgba(6,12,6,0.8);border:1px solid rgba(242,234,216,0.2);color:rgba(242,234,216,0.7);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.scanner-preview-clear:hover{background:rgba(6,12,6,0.95);color:var(--cream)}
.scanner-action{display:flex;justify-content:center;margin-top:20px}
.scanner-loading{display:flex;flex-direction:column;align-items:center;gap:14px;padding:40px;text-align:center}
.scanner-loading-ring{width:44px;height:44px;border:2px solid rgba(82,183,136,0.15);border-top-color:var(--bright-green);border-radius:50%;animation:spin .9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.scanner-loading-text{font-size:13px;color:rgba(242,234,216,0.5);letter-spacing:0.06em}

/* result card */
.scan-card{border:1px solid rgba(82,183,136,0.18);border-radius:6px;background:rgba(255,255,255,0.025);overflow:hidden;margin-top:32px}
.scan-card-header{padding:24px 28px 20px;border-bottom:1px solid rgba(255,255,255,0.06)}
.scan-card-meta{display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap}
.scan-card-brand{font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(242,234,216,0.4)}
.scan-card-dot{color:rgba(242,234,216,0.2);font-size:10px}
.scan-card-cat{font-size:10px;letter-spacing:0.12em;text-transform:uppercase;padding:3px 9px;border-radius:20px;background:rgba(82,183,136,0.12);color:rgba(82,183,136,0.8);border:1px solid rgba(82,183,136,0.15)}
.scan-card-confidence-high{color:#52b788}
.scan-card-confidence-medium{color:var(--amber)}
.scan-card-confidence-low{color:rgba(242,234,216,0.4)}
.scan-card-name{font-family:'Cormorant Garamond',serif;font-size:1.7rem;font-weight:400;color:var(--cream);line-height:1.2;margin-bottom:4px}
.scan-card-strain{font-size:12px;color:rgba(242,234,216,0.45);letter-spacing:0.05em}
.scan-card-type-badge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:3px 10px;border-radius:3px;margin-left:8px}
.scan-type-indica{background:rgba(155,127,212,0.15);color:#b89ef8;border:1px solid rgba(155,127,212,0.2)}
.scan-type-sativa{background:rgba(232,168,76,0.12);color:#e8a84c;border:1px solid rgba(232,168,76,0.2)}
.scan-type-hybrid{background:rgba(82,183,136,0.12);color:#52b788;border:1px solid rgba(82,183,136,0.2)}
.scan-type-cbd{background:rgba(92,160,232,0.12);color:#5ca0e8;border:1px solid rgba(92,160,232,0.2)}
.scan-type-unknown{background:rgba(242,234,216,0.06);color:rgba(242,234,216,0.4);border:1px solid rgba(242,234,216,0.1)}
.scan-card-body{padding:24px 28px;display:grid;grid-template-columns:1fr 1fr;gap:24px}
@media(max-width:600px){.scan-card-body{grid-template-columns:1fr}}
.scan-section-label{font-size:9px;font-weight:700;letter-spacing:0.25em;text-transform:uppercase;color:var(--bright-green);margin-bottom:8px;opacity:.8}
.scan-card-section-full{grid-column:1/-1}
.scan-potency-row{display:flex;gap:16px}
.scan-potency-val{font-family:'Cormorant Garamond',serif;font-size:1.5rem;font-weight:400;color:var(--cream);line-height:1}
.scan-potency-key{font-size:10px;color:rgba(242,234,216,0.4);letter-spacing:0.1em;text-transform:uppercase;margin-top:2px}
.scan-tags{display:flex;flex-wrap:wrap;gap:6px}
.scan-tag{font-size:11px;padding:4px 10px;border-radius:20px;background:rgba(82,183,136,0.08);color:rgba(82,183,136,0.85);border:1px solid rgba(82,183,136,0.15)}
.scan-tag-neutral{background:rgba(242,234,216,0.05);color:rgba(242,234,216,0.55);border:1px solid rgba(242,234,216,0.1)}
.scan-lineage{font-size:13px;color:rgba(242,234,216,0.55);line-height:1.5;font-style:italic}
.scan-review{font-size:14px;color:rgba(242,234,216,0.7);line-height:1.75;border-top:1px solid rgba(255,255,255,0.06);padding-top:20px}
.scan-review-attr{font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:rgba(82,183,136,0.6);margin-top:10px}
.scan-error{padding:32px;text-align:center;color:rgba(242,234,216,0.5);font-size:14px;line-height:1.6}
</style>
</head>
<body>

<nav class="s-nav">
  <a href="/" class="s-nav-logo">Cannascenti</a>
  <a href="/" class="s-nav-back">← Back to Home</a>
</nav>

<div class="s-hero">
  <div class="s-label">✦ Mary Jane Vision</div>
  <h1 class="s-title">Scan Any Product.<br><em>Know Everything.</em></h1>
  <p class="s-desc">Point your camera at any cannabis product — flower, concentrate, vape, edible. Mary Jane identifies it instantly and delivers a full intelligence briefing.</p>
</div>

<div class="scan-wrap">

  <input type="file" id="scanFileInput" accept="image/*" style="display:none" onchange="onScanFile(this)">

  <div class="scanner-drop" id="scannerDrop"
    onclick="document.getElementById('scanFileInput').click()"
    ondragover="scanDragOver(event)" ondragleave="scanDragLeave(event)" ondrop="scanDrop(event)">
    <svg class="scanner-drop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="3" width="20" height="15" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <path d="M21 15l-5-5L5 21"/>
      <path d="M16 3h5v5"/>
      <path d="M21 3l-5 5"/>
    </svg>
    <div class="scanner-drop-title">Drop a photo here — or tap to browse</div>
    <div class="scanner-drop-sub">JPG · PNG · WEBP &nbsp;·&nbsp; Up to 4MB</div>
    <div class="scanner-drop-btns" onclick="event.stopPropagation()">
      <button class="scanner-btn" onclick="triggerCam()">📷 &nbsp;Take Photo</button>
      <label class="scanner-btn scanner-btn-primary" for="scanFileInput" style="display:inline-flex;align-items:center;cursor:pointer;">↑ &nbsp;Upload Image</label>
    </div>
  </div>

  <div id="scannerPreviewWrap" style="display:none">
    <div class="scanner-preview-wrap">
      <img id="scannerPreviewImg" class="scanner-preview-img" alt="Product photo">
      <button class="scanner-preview-clear" onclick="clearScan()" title="Remove">×</button>
    </div>
    <div class="scanner-action">
      <button class="scanner-btn scanner-btn-primary" id="scanBtn" onclick="runScan()">Ask Mary Jane →</button>
    </div>
  </div>

  <div class="scanner-loading" id="scannerLoading" style="display:none">
    <div class="scanner-loading-ring"></div>
    <div class="scanner-loading-text">Mary Jane is reading the product…</div>
  </div>

  <div id="scannerResult"></div>

</div>

<script>
let scanFileData = null;

function triggerCam() {
  const inp = document.getElementById('scanFileInput');
  inp.setAttribute('capture', 'environment');
  inp.click();
}

function onScanFile(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    alert('Image is too large. Please use a photo under 5MB.');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const [header, base64] = dataUrl.split(',');
    const mediaType = header.match(/data:([^;]+)/)[1];
    scanFileData = { base64, mediaType };
    document.getElementById('scannerDrop').style.display = 'none';
    document.getElementById('scannerPreviewWrap').style.display = 'block';
    document.getElementById('scannerPreviewImg').src = dataUrl;
    document.getElementById('scannerResult').innerHTML = '';
  };
  reader.readAsDataURL(file);
}

function clearScan() {
  scanFileData = null;
  document.getElementById('scanFileInput').value = '';
  document.getElementById('scannerDrop').style.display = 'flex';
  document.getElementById('scannerPreviewWrap').style.display = 'none';
  document.getElementById('scannerLoading').style.display = 'none';
  document.getElementById('scannerResult').innerHTML = '';
}

function scanDragOver(e) {
  e.preventDefault();
  document.getElementById('scannerDrop').classList.add('drag-over');
}
function scanDragLeave(e) {
  document.getElementById('scannerDrop').classList.remove('drag-over');
}
function scanDrop(e) {
  e.preventDefault();
  document.getElementById('scannerDrop').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  onScanFile({ files: [file] });
}

async function runScan() {
  if (!scanFileData) return;
  const btn = document.getElementById('scanBtn');
  btn.disabled = true;
  btn.textContent = 'Analyzing…';
  document.getElementById('scannerLoading').style.display = 'flex';
  document.getElementById('scannerResult').innerHTML = '';
  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: scanFileData.base64, mediaType: scanFileData.mediaType })
    });
    const data = await res.json();
    document.getElementById('scannerLoading').style.display = 'none';
    document.getElementById('scannerResult').innerHTML = renderScanCard(data);
  } catch {
    document.getElementById('scannerLoading').style.display = 'none';
    document.getElementById('scannerResult').innerHTML = '<div class="scan-error">Something went wrong. Please try again.</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ask Mary Jane →';
  }
}

function renderScanCard(d) {
  if (d.error) return '<div class="scan-error">' + d.error + '</div>';
  const typeClass = {'Indica':'scan-type-indica','Sativa':'scan-type-sativa','Hybrid':'scan-type-hybrid','CBD':'scan-type-cbd'}[d.strainType] || 'scan-type-unknown';
  const confColor = {'High':'scan-card-confidence-high','Medium':'scan-card-confidence-medium','Low':'scan-card-confidence-low'}[d.confidence] || '';
  const tags = (arr) => (arr||[]).map(t => '<span class="scan-tag">'+t+'</span>').join('');
  const neutralTags = (arr) => (arr||[]).map(t => '<span class="scan-tag scan-tag-neutral">'+t+'</span>').join('');
  return '<div class="scan-card">' +
    '<div class="scan-card-header">' +
      '<div class="scan-card-meta">' +
        (d.brand ? '<span class="scan-card-brand">'+d.brand+'</span><span class="scan-card-dot">·</span>' : '') +
        '<span class="scan-card-cat">'+(d.category||'Cannabis')+'</span>' +
        (d.confidence ? '<span class="scan-card-dot">·</span><span class="scan-section-label '+confColor+'" style="margin-bottom:0">'+d.confidence+' confidence</span>' : '') +
      '</div>' +
      '<div class="scan-card-name">' +
        (d.productName||d.strainName||'Unknown Product') +
        (d.strainType && d.strainType !== 'Unknown' ? '<span class="scan-card-type-badge '+typeClass+'">'+d.strainType+'</span>' : '') +
      '</div>' +
      (d.strainName && d.productName && d.strainName !== d.productName ? '<div class="scan-card-strain">'+d.strainName+'</div>' : '') +
    '</div>' +
    '<div class="scan-card-body">' +
      '<div class="scan-card-section"><div class="scan-section-label">Potency</div><div class="scan-potency-row"><div class="scan-potency-item"><div class="scan-potency-val">'+(d.thc||'—')+'</div><div class="scan-potency-key">THC</div></div><div class="scan-potency-item"><div class="scan-potency-val">'+(d.cbd||'—')+'</div><div class="scan-potency-key">CBD</div></div></div></div>' +
      (d.lineage ? '<div class="scan-card-section"><div class="scan-section-label">Lineage</div><div class="scan-lineage">'+d.lineage+'</div></div>' : '') +
      '<div class="scan-card-section"><div class="scan-section-label">Terpenes</div><div class="scan-tags">'+tags(d.terpenes)+'</div></div>' +
      '<div class="scan-card-section"><div class="scan-section-label">Effects</div><div class="scan-tags">'+tags(d.effects)+'</div></div>' +
      '<div class="scan-card-section"><div class="scan-section-label">Flavor Profile</div><div class="scan-tags">'+neutralTags(d.flavors)+'</div></div>' +
      '<div class="scan-card-section"><div class="scan-section-label">Best With</div><div class="scan-tags">'+neutralTags(d.pairings)+'</div></div>' +
      (d.reviewSummary ? '<div class="scan-card-section scan-card-section-full"><div class="scan-review">'+d.reviewSummary+'<div class="scan-review-attr">— Mary Jane, Cannascenti</div></div></div>' : '') +
    '</div></div>';
}
</script>
</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html" });
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
