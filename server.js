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

  // ─── Encyclopedia dedicated pages ─────────────────────────────────────────

  // Shared nav for all encyclopedia pages
  const ENC_NAV = `<nav style="background:#060d0a;border-bottom:1px solid rgba(82,183,136,0.15);padding:0 32px;display:flex;align-items:center;justify-content:space-between;height:60px;position:sticky;top:0;z-index:100">
  <a href="/" style="font-family:'Great Vibes',cursive;font-size:1.4rem;color:#52B788;text-decoration:none">Cannascenti</a>
  <div style="display:flex;gap:4px;flex-wrap:wrap">
    <a href="/strains" style="color:rgba(242,234,216,0.7);text-decoration:none;font-family:Montserrat,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.08)">Strains</a>
    <a href="/terpenes" style="color:rgba(242,234,216,0.7);text-decoration:none;font-family:Montserrat,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.08)">Terpenes</a>
    <a href="/cannabinoids" style="color:rgba(242,234,216,0.7);text-decoration:none;font-family:Montserrat,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.08)">Cannabinoids</a>
    <a href="/consumption" style="color:rgba(242,234,216,0.7);text-decoration:none;font-family:Montserrat,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.08)">Consumption</a>
    <a href="/cultivation" style="color:rgba(242,234,216,0.7);text-decoration:none;font-family:Montserrat,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.08)">Cultivation</a>
    <a href="/history" style="color:rgba(242,234,216,0.7);text-decoration:none;font-family:Montserrat,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.08)">History</a>
    <a href="/extractions" style="color:rgba(242,234,216,0.7);text-decoration:none;font-family:Montserrat,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.08)">Extractions</a>
    <a href="/concentrates" style="color:rgba(242,234,216,0.7);text-decoration:none;font-family:Montserrat,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.08)">Concentrates</a>
    <a href="/cooking" style="color:rgba(242,234,216,0.7);text-decoration:none;font-family:Montserrat,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.08)">Cooking</a>
  </div>
</nav>`;

  const ENC_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Great+Vibes&family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">`;

  const ENC_BASE_CSS = `*{margin:0;padding:0;box-sizing:border-box}body{background:#060d0a;color:#F2EAD8;font-family:Montserrat,sans-serif}a{color:#52B788;text-decoration:none}.enc-page{max-width:1100px;margin:0 auto;padding:60px 32px 120px}.enc-page-header{margin-bottom:56px}.enc-label{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#52B788;margin-bottom:12px}.enc-title{font-family:'Cormorant Garamond',serif;font-size:clamp(2rem,5vw,3.5rem);font-weight:300;color:#F2EAD8;line-height:1.15;margin-bottom:20px}.enc-title em{font-style:italic;color:#52B788}.enc-desc{font-size:.95rem;line-height:1.8;color:rgba(242,234,216,0.65);max-width:680px}`;

  // ─── /terpenes ──────────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/terpenes") {
    const _WT = [
      { name:"Myrcene", tag:"Most Common in Cannabis", color:"#E07B39", aroma:"Earthy, musky, tropical, mango, hops", effect:"Heavy relaxation, couch-lock, sedating. High myrcene = indica-leaning experience regardless of strain type. Enhances CB1 receptor binding — helps cannabinoids cross the blood-brain barrier faster.", found:"mangoes, hops, lemongrass, parsley leaf, grapefruit, orange", boiling:"168°C / 334°F" },
      { name:"Limonene", tag:"The Mood Lifter", color:"#F5C842", aroma:"Citrus, lemon, orange, lime, grapefruit", effect:"Uplifting, euphoric, stress-relieving, refreshing. Drives that bright, social, happy high. Interacts with serotonin and dopamine receptors — the same pathways antidepressants target.", found:"lemon, bergamot, grapefruit, orange blossoms, lime", boiling:"176°C / 349°F" },
      { name:"Terpineol", tag:"The Relaxing Floral", color:"#D4A853", aroma:"Floral, citrus, sweet, lilac", effect:"Calming, sedating, stress-relieving. Often found alongside linalool in indica strains. Produces a relaxed, pleasant body feeling with mild euphoria.", found:"linden blossoms, lime, eucalyptus, pine", boiling:"218°C / 424°F" },
      { name:"Isopulegol", tag:"Minty & Cooling", color:"#C9B84C", aroma:"Minty, fresh, herbal, cooling", effect:"Stress-relieving, calming, anti-nausea. A precursor to menthol — gives that cool, refreshing sensation. Gastroprotective and anti-anxiety properties.", found:"geraniums, grapefruit, cananga, hops", boiling:"212°C / 414°F" },
      { name:"Caryophyllene", tag:"Binds CB2 Directly", color:"#D95F3B", aroma:"Peppery, woody, clove, cinnamon, earthy", effect:"Anti-inflammatory, pain-relieving, calming. The only terpene that directly binds CB2 receptors — technically both a cannabinoid and a terpene simultaneously.", found:"black pepper, cloves, cinnamon, basil, oregano", boiling:"160°C / 320°F" },
      { name:"Eucalyptol", tag:"The Refreshing Cleanser", color:"#E8603C", aroma:"Eucalyptus, camphor, minty, refreshing", effect:"Refreshing, alertness-boosting, stress-relieving. Clears mental fog. The sharp, clean note that opens your airways and sharpens your mind.", found:"eucalyptus, rosemary, sage, thyme, catnip", boiling:"176°C / 349°F" },
      { name:"Terpinolene", tag:"Multidimensional", color:"#C94F3A", aroma:"Pine, floral, herbs, citrus, sweet", effect:"Mildly sedating, calming, focus-enhancing. The most complex aroma profile of any terpene — simultaneously spicy, sweet, and floral.", found:"lilac, black currant, fir needles, sage, apple", boiling:"186°C / 367°F" },
      { name:"Delta-3-Carene", tag:"The Memory Terpene", color:"#B84036", aroma:"Sweet, cedar, earthy, pungent", effect:"Alertness, focus, memory retention. Known to promote bone health and reduce inflammation. The reason some strains make your mouth especially dry.", found:"cedar, cypress, rosemary, bell pepper, basil, pine", boiling:"168°C / 334°F" },
      { name:"Linalool", tag:"Nature's Anxiety Reducer", color:"#9B72CF", aroma:"Floral, lavender, citrus, spicy", effect:"Deeply calming, sedating, anxiolytic. Activates GABA receptors — the same system benzodiazepines target. The reason lavender has been used for sleep and calm for thousands of years.", found:"lavender, rose, bergamot, geranium, honeysuckle", boiling:"198°C / 388°F" },
      { name:"Geraniol", tag:"The Floral Protector", color:"#7B68C8", aroma:"Rose, geranium, citrus, warm floral", effect:"Calming, stress-relieving, neuroprotective. One of the most potent antioxidant terpenes. The warm floral note that gives rose its signature smell.", found:"rose, geranium, lemongrass, citronella, palmarosa", boiling:"230°C / 446°F" },
      { name:"Ocimene", tag:"The Uplifting Floral", color:"#5B8DD9", aroma:"Sweet, herbal, floral, woody, citrus", effect:"Uplifting, energizing, antiviral, anti-fungal. The sweet floral note in tropical strains. Often paired with limonene for extra euphoric effect.", found:"mint, parsley, basil, orchids, mangoes, bergamot", boiling:"50°C / 122°F" },
      { name:"Farnesol", tag:"The Calming Floral", color:"#4A7BC4", aroma:"Floral, fresh, citrus, rose", effect:"Calming, stress-relieving, antibacterial. Supports the immune system and has anti-tumor properties in early research.", found:"rose, linden, citronella, cyclamen, ambrette, sandalwood", boiling:"222°C / 432°F" },
      { name:"Pinene", tag:"The Alertness Terpene", color:"#52B788", aroma:"Pine, fresh, forest, herbs, rosemary", effect:"Promotes alertness and memory retention. One of the few terpenes that counteracts THC's short-term memory effects. Inhibits acetylcholinesterase — your brain's memory enzyme.", found:"pine needles, rosemary, dill, basil, parsley, cypress", boiling:"155°C / 311°F" },
      { name:"Humulene", tag:"The Appetite Suppressant", color:"#3D9970", aroma:"Earthy, woody, hoppy, herbal, spicy", effect:"Anti-inflammatory, antibacterial, appetite-suppressing. Unique — it can actually reduce hunger rather than increase it. Found heavily in hops.", found:"hops, sage, ginseng, coriander, cloves, balsam poplar", boiling:"198°C / 388°F" },
      { name:"Nerolidol", tag:"The Deep Sedative", color:"#2D8C5E", aroma:"Woody, fresh bark, citrus, floral", effect:"Sedating, stress-relieving, anti-parasitic. One of the most powerfully sedating terpenes. Enhances skin absorption — helps other cannabinoids penetrate more effectively.", found:"jasmine, lemongrass, tea tree, ginger, lavender", boiling:"122°C / 252°F" },
      { name:"Bisabolol", tag:"The Skin Healer", color:"#52A875", aroma:"Floral, sweet, chamomile, honey", effect:"Calming, anti-irritant, anti-inflammatory. The primary terpene in chamomile. Exceptional skin-healing properties — reduces redness, soothes irritation.", found:"chamomile, echinacea, verbena, sandalwood", boiling:"153°C / 307°F" }
    ];
    const _TD = [
      { name:"Myrcene", aroma:"Earthy · Musky · Cloves", tags:["Relaxing","Sedating","Body High"], bp:"167°C / 332°F", found:"Hops, Mangoes, Thyme, Lemongrass", effects:"The most abundant terpene in cannabis. Myrcene produces a sedating, couch-lock body effect and significantly amplifies THC by increasing cell membrane permeability, allowing cannabinoids to cross the blood-brain barrier more easily.", medical:["Pain relief","Anti-inflammatory","Muscle relaxant","Sleep aid","Anxiety reduction"], strains:["OG Kush","Blue Dream","Granddaddy Purple","Mango Kush","Grape Ape","White Widow"], note:"High-myrcene strains are associated with the classic indica sedation. The mango trick — eating a ripe mango before cannabis — works because mangoes are loaded with myrcene." },
      { name:"Limonene", aroma:"Citrus · Lemon · Orange", tags:["Uplifting","Energetic","Mood"], bp:"176°C / 349°F", found:"Citrus peel, Juniper, Rosemary", effects:"The second most common terpene in cannabis. Limonene produces an elevated, euphoric, anxiety-reducing effect and is strongly associated with daytime sativa profiles. Known for antifungal and antibacterial properties.", medical:["Anxiety & depression","Acid reflux","Antifungal","Immune support","Anti-tumor (research)"], strains:["Lemon Haze","Durban Poison","Super Lemon OG","Banana OG","Strawberry Banana","Wedding Cake"], note:"Limonene is the smell of cleaning products — that sharp citrus burst. In cannabis, it's the terpene most directly correlated with mood elevation and stress relief." },
      { name:"Caryophyllene", aroma:"Spicy · Pepper · Woody", tags:["Anti-inflammatory","Pain Relief","Calming"], bp:"130°C / 266°F", found:"Black pepper, Cloves, Cinnamon", effects:"The only terpene known to directly bind to cannabinoid receptors (CB2). Acts as a dietary cannabinoid with anti-inflammatory effects. Does not produce psychoactive effects on its own but significantly modifies the overall experience.", medical:["Anti-inflammatory","Chronic pain","Anxiety","Alcohol cravings","Ulcer protection"], strains:["Girl Scout Cookies","Sour Diesel","Bubba Kush","Chemdawg","Original Glue","Purple Punch"], note:"Because it binds to CB2 receptors, caryophyllene is legally classified as a dietary supplement. Black pepper is loaded with it — some people use it to reduce an overwhelming high." },
      { name:"Linalool", aroma:"Floral · Lavender · Sweet", tags:["Calming","Sedating","Anxiety"], bp:"198°C / 388°F", found:"Lavender, Basil, Mint, Cinnamon", effects:"Linalool is best known from lavender aromatherapy. In cannabis it produces calming, anti-anxiety, and mildly sedating effects. Strong anticonvulsant and neuroprotective properties are being actively researched.", medical:["Anxiety & stress","Insomnia","Epilepsy (research)","Depression","Pain"], strains:["Lavender","LA Confidential","Amnesia Haze","Do-Si-Dos","Scooby Snacks","Master Kush"], note:"Linalool is why lavender aromatherapy works. Strains dominant in linalool tend to be the true 'chill and sleep' indicas — less heavy, more peacefully sedating." },
      { name:"Pinene", aroma:"Pine · Fresh · Earthy", tags:["Alert","Memory","Respiratory"], bp:"155°C / 311°F", found:"Pine needles, Rosemary, Basil, Dill", effects:"The most widely encountered terpene in nature. Alpha-pinene promotes alertness and memory retention, and is a bronchodilator — it helps open airways. It also counteracts some of the short-term memory impairment from THC.", medical:["Memory retention","Asthma","Anti-inflammatory","Antiseptic","Anxiety"], strains:["Jack Herer","Trainwreck","Blue Dream","Island Sweet Skunk","Dutch Treat"], note:"Pinene is a natural bronchodilator — it opens airways. Strains high in pinene are often used by medical patients for respiratory conditions." },
      { name:"Terpinolene", aroma:"Fresh · Piney · Floral", tags:["Uplifting","Creative","Antioxidant"], bp:"186°C / 367°F", found:"Apples, Cumin, Lilac, Nutmeg", effects:"Terpinolene is relatively rare as a dominant terpene but highly valued for its complex, multidimensional aroma and uplifting effects. It appears across the scent spectrum from piney to floral to herbaceous.", medical:["Antioxidant","Antibacterial","Antifungal","Mild sedative","Anti-tumor (research)"], strains:["Jack Herer","Ghost Train Haze","Golden Goat","XJ-13","Dutch Treat","Orange Cookies"], note:"Terpinolene is paradoxical: it smells invigorating but has mild sedative properties. It's one of the markers of the classic Jack Herer lineage." },
      { name:"Humulene", aroma:"Woody · Earthy · Spicy", tags:["Appetite Suppressant","Anti-inflammatory","Antibacterial"], bp:"106°C / 223°F", found:"Hops, Basil, Cloves, Coriander", effects:"Humulene is notable for being one of the only cannabis terpenes associated with appetite suppression. It's a primary component of hops and contributes significantly to the herbaceous, earthy, spicy profiles of many classic strains.", medical:["Appetite suppression","Anti-inflammatory","Antibacterial","Anti-tumor (research)","Analgesic"], strains:["Girl Scout Cookies","Headband","White Widow","Skywalker OG","Death Star"], note:"Humulene is found in high concentrations in hops, which is why some hoppy IPAs and certain cannabis strains share an earthy, herbal quality." },
      { name:"Ocimene", aroma:"Sweet · Herbal · Woody", tags:["Uplifting","Antiviral","Antifungal"], bp:"65°C / 149°F", found:"Mint, Parsley, Basil, Orchids", effects:"Ocimene is a fragrant, sweet terpene with a complex aroma that varies from sweet and floral to herbaceous and woody. Research suggests antiviral, antifungal, and decongestant properties.", medical:["Antiviral","Antifungal","Decongestant","Anti-inflammatory","Antibacterial"], strains:["Clementine","Golden Goat","Space Queen","Dutch Treat","Strawberry Cough"], note:"Ocimene has one of the lowest boiling points of all cannabis terpenes, making it highly volatile — it's often what you smell when you first open a jar." }
    ];
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Terpenes — Cannascenti Encyclopedia</title>
<meta name="description" content="The complete cannabis terpene reference. Interactive terpene wheel, full profiles, medical uses, strain guides, and boiling points for every major terpene.">
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
#terpeneWheel{width:420px;max-width:100%;cursor:pointer}
.terpene-slice{cursor:pointer;transition:opacity .2s}
.terpene-slice:hover path{opacity:1!important}
.terpene-wheel-wrap{display:flex;gap:40px;align-items:flex-start;flex-wrap:wrap;margin-bottom:60px}
.terpene-wheel-info{flex:1;min-width:240px;padding:28px;background:rgba(255,255,255,0.03);border:1px solid rgba(82,183,136,0.15);border-radius:16px}
.twi-name{font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:300;margin-bottom:6px}
.twi-tag{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:rgba(242,234,216,0.5);margin-bottom:16px}
.twi-effect{font-size:.88rem;line-height:1.7;color:rgba(242,234,216,0.75);margin-bottom:12px}
.twi-aroma,.twi-found,.twi-boiling{font-size:.8rem;color:rgba(242,234,216,0.5);margin-bottom:6px}
.terpene-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px;margin-bottom:60px}
.terpene-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:24px}
.terpene-name{font-family:'Cormorant Garamond',serif;font-size:1.3rem;font-weight:400;margin-bottom:6px}
.terpene-tag{display:inline-block;font-size:10px;letter-spacing:.1em;text-transform:uppercase;background:rgba(82,183,136,0.12);color:#52B788;border-radius:20px;padding:3px 10px;margin-bottom:12px}
.terpene-found,.terpene-effect,.terpene-ecs{font-size:.83rem;line-height:1.7;color:rgba(242,234,216,0.6);margin-bottom:8px}
.terpene-effect{color:rgba(242,234,216,0.8)}
.enc-detail-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;margin-top:40px}
.enc-detail-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:28px}
.edc-name{font-family:'Cormorant Garamond',serif;font-size:1.4rem;margin-bottom:4px}
.edc-aroma{font-size:.8rem;color:rgba(242,234,216,0.5);margin-bottom:12px}
.edc-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.edc-tag{font-size:10px;letter-spacing:.08em;text-transform:uppercase;background:rgba(82,183,136,0.1);color:#52B788;border-radius:20px;padding:3px 10px}
.edc-bp{font-size:.8rem;color:rgba(242,234,216,0.4);margin-bottom:12px}
.edc-effects{font-size:.85rem;line-height:1.7;color:rgba(242,234,216,0.75);margin-bottom:14px}
.edc-section{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(242,234,216,0.4);margin-bottom:6px}
.edc-medical{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.edc-med{font-size:.75rem;background:rgba(255,255,255,0.05);border-radius:6px;padding:3px 8px;color:rgba(242,234,216,0.6)}
.edc-strains{font-size:.8rem;color:rgba(242,234,216,0.5);margin-bottom:12px}
.edc-note{font-size:.8rem;line-height:1.65;color:rgba(242,234,216,0.45);border-left:2px solid rgba(82,183,136,0.3);padding-left:12px;font-style:italic}
h2.sec{font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:300;margin:60px 0 24px;color:#F2EAD8}
h2.sec em{color:#52B788;font-style:italic}
@media(max-width:640px){.terpene-wheel-wrap{flex-direction:column}#terpeneWheel{width:100%;max-width:360px}}
</style>
</head>
<body>
${ENC_NAV}
<div class="enc-page">
  <div class="enc-page-header">
    <div class="enc-label">✦ Cannascenti Encyclopedia</div>
    <h1 class="enc-title">The complete <em>terpene</em> reference.</h1>
    <p class="enc-desc">Terpenes aren't just cannabis compounds — they exist all around us in nature. Every time you've smelled a lemon, walked through a pine forest, or felt calm holding lavender, your endocannabinoid system was already responding. Cannabis just delivers them in high concentration — and your body already knows exactly what to do with them.</p>
  </div>

  <div class="terpene-wheel-wrap">
    <svg id="terpeneWheel" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="terpene-wheel-info" id="terpeneInfo">
      <div class="twi-name" id="twiName">Click a terpene</div>
      <div class="twi-tag" id="twiTag">Explore the wheel</div>
      <div class="twi-aroma" id="twiAroma"></div>
      <div class="twi-effect" id="twiEffect"></div>
      <div class="twi-found" id="twiFound"></div>
      <div class="twi-boiling" id="twiBoiling"></div>
    </div>
  </div>

  <h2 class="sec">The eight <em>essential</em> terpenes</h2>
  <div class="terpene-grid" id="terpeneCards"></div>

  <h2 class="sec">Full <em>terpene profiles</em></h2>
  <div class="enc-detail-grid" id="terpeneDetail"></div>
</div>
<script>
var WT = ${JSON.stringify(_WT)};
var TD = ${JSON.stringify(_TD)};

function initWheel() {
  var svg = document.getElementById('terpeneWheel');
  if (!svg) return;
  var cx=250,cy=250,outerR=230,innerR=75,count=WT.length,slice=(2*Math.PI)/count;
  function polar(cx,cy,r,a){return[cx+r*Math.cos(a),cy+r*Math.sin(a)];}
  function makeSlice(i){
    var t=WT[i],sa=i*slice-Math.PI/2,ea=sa+slice,gap=0.03,s=sa+gap,e=ea-gap;
    var p1=polar(cx,cy,innerR,s),p2=polar(cx,cy,outerR,s),p3=polar(cx,cy,outerR,e),p4=polar(cx,cy,innerR,e);
    var d='M '+p1[0]+' '+p1[1]+' L '+p2[0]+' '+p2[1]+' A '+outerR+' '+outerR+' 0 0 1 '+p3[0]+' '+p3[1]+' L '+p4[0]+' '+p4[1]+' A '+innerR+' '+innerR+' 0 0 0 '+p1[0]+' '+p1[1]+' Z';
    var g=document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('class','terpene-slice');
    var path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',d);path.setAttribute('fill',t.color);path.setAttribute('opacity','0.75');
    g.appendChild(path);
    var mid=sa+slice/2,lr=(innerR+outerR)/2,lp=polar(cx,cy,lr,mid);
    var txt=document.createElementNS('http://www.w3.org/2000/svg','text');
    txt.setAttribute('x',lp[0]);txt.setAttribute('y',lp[1]);
    txt.setAttribute('text-anchor','middle');txt.setAttribute('dominant-baseline','middle');
    txt.setAttribute('fill','#081C15');txt.setAttribute('font-size','10');
    txt.setAttribute('font-family','Montserrat,sans-serif');txt.setAttribute('font-weight','600');
    txt.setAttribute('letter-spacing','0.05em');txt.setAttribute('pointer-events','none');
    txt.setAttribute('transform','rotate('+((mid*180/Math.PI)+90)+','+lp[0]+','+lp[1]+')');
    txt.textContent=t.name.toUpperCase();
    g.appendChild(txt);
    g.addEventListener('click',function(){selectT(i,g);});
    svg.appendChild(g);
  }
  var circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
  circle.setAttribute('cx',cx);circle.setAttribute('cy',cy);circle.setAttribute('r',innerR-4);circle.setAttribute('fill','#081C15');
  svg.appendChild(circle);
  var ct=document.createElementNS('http://www.w3.org/2000/svg','text');
  ct.setAttribute('x',cx);ct.setAttribute('y',cy);ct.setAttribute('text-anchor','middle');ct.setAttribute('dominant-baseline','middle');
  ct.setAttribute('fill','#52B788');ct.setAttribute('font-size','11');ct.setAttribute('font-family','Montserrat,sans-serif');
  ct.setAttribute('font-weight','300');ct.setAttribute('letter-spacing','0.15em');ct.textContent='TERPENES';
  svg.appendChild(ct);
  for(var i=0;i<count;i++) makeSlice(i);
  var active=null;
  function selectT(i,g){
    if(active){active.querySelector('path').setAttribute('opacity','0.75');active.setAttribute('class','terpene-slice');}
    g.querySelector('path').setAttribute('opacity','1');g.setAttribute('class','terpene-slice active');active=g;
    var t=WT[i];
    document.getElementById('twiName').textContent=t.name;
    document.getElementById('twiName').style.color=t.color;
    document.getElementById('twiTag').textContent=t.tag;
    document.getElementById('twiAroma').textContent='Aroma: '+t.aroma;
    document.getElementById('twiEffect').textContent=t.effect;
    document.getElementById('twiFound').textContent='Found in: '+t.found;
    document.getElementById('twiBoiling').textContent='Boiling point: '+t.boiling;
  }
  selectT(0,svg.querySelectorAll('.terpene-slice')[0]);
}

function renderCards(){
  var g=document.getElementById('terpeneCards');
  if(!g) return;
  var cards=[
    {name:'Myrcene',tag:'Most Common in Cannabis',found:'Found in: mangoes, hops, lemongrass, thyme, bay leaves.',effect:'The most abundant terpene in most cannabis strains. Produces that heavy, relaxed, couch-lock feeling.',ecs:'Enhances CB1 receptor binding — helps cannabinoids cross the blood-brain barrier faster. Eating a mango before smoking? The myrcene increases absorption.'},
    {name:'Limonene',tag:'The Mood Lifter',found:'Found in: lemon rinds, orange peel, limes, grapefruit, juniper berries.',effect:'Uplifting, euphoric, anxiety-reducing. The reason citrus makes you feel awake and positive. Drives that bright, social, happy high.',ecs:'Interacts with serotonin and dopamine receptors — the same pathways antidepressants target. Your body recognizes citrus as a mood signal.'},
    {name:'Caryophyllene',tag:'The Only Terpene That Binds CB2',found:'Found in: black pepper, cloves, cinnamon, basil, oregano.',effect:'Anti-inflammatory, pain-relieving, calming. Why cracking black pepper under your nose can take the edge off a too-intense high.',ecs:'The only terpene that directly binds to CB2 receptors. It is technically a cannabinoid and a terpene simultaneously.'},
    {name:'Linalool',tag:"Nature's Anxiety Reducer",found:'Found in: lavender, mint, cinnamon, birch trees, coriander.',effect:'Deeply calming, sedating, anxiolytic. The reason lavender has been used for sleep and calm for thousands of years.',ecs:'Activates GABA receptors — the same system benzodiazepines target. Your nervous system evolved to respond to linalool as a relaxation signal.'},
    {name:'Pinene',tag:'The Alertness Terpene',found:'Found in: pine needles, rosemary, dill, basil, parsley.',effect:'Promotes alertness, memory retention, and airway openness. One of the few terpenes that counteracts some of THC\'s short-term memory effects.',ecs:'Inhibits acetylcholinesterase — the enzyme that breaks down the neurotransmitter responsible for memory and focus.'}
  ];
  g.innerHTML=cards.map(function(c){return '<div class="terpene-card"><div class="terpene-name">'+c.name+'</div><span class="terpene-tag">'+c.tag+'</span><p class="terpene-found">'+c.found+'</p><p class="terpene-effect">'+c.effect+'</p><p class="terpene-ecs">'+c.ecs+'</p></div>';}).join('');
}

function renderDetail(){
  var g=document.getElementById('terpeneDetail');
  if(!g) return;
  g.innerHTML=TD.map(function(t){
    return '<div class="enc-detail-card">'+
      '<div class="edc-name">'+t.name+'</div>'+
      '<div class="edc-aroma">'+t.aroma+'</div>'+
      '<div class="edc-tags">'+t.tags.map(function(x){return '<span class="edc-tag">'+x+'</span>';}).join('')+'</div>'+
      '<div class="edc-bp">Boiling point: '+t.bp+' · Found in: '+t.found+'</div>'+
      '<p class="edc-effects">'+t.effects+'</p>'+
      '<div class="edc-section">Medical Uses</div>'+
      '<div class="edc-medical">'+t.medical.map(function(m){return '<span class="edc-med">'+m+'</span>';}).join('')+'</div>'+
      '<div class="edc-section">Key Strains</div>'+
      '<div class="edc-strains">'+t.strains.join(' · ')+'</div>'+
      '<p class="edc-note">'+t.note+'</p>'+
    '</div>';
  }).join('');
}

document.addEventListener('DOMContentLoaded',function(){initWheel();renderCards();renderDetail();});
</script>
</body></html>`;
    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /strains ──────────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/strains") {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Strain Library — Cannascenti Encyclopedia</title>
<meta name="description" content="Browse and search all cannabis strains. Full profiles with effects, terpenes, THC/CBD percentages, and growing info.">
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
.strain-filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:32px}
.sf-btn{background:none;border:1px solid rgba(255,255,255,0.12);border-radius:30px;padding:8px 20px;color:rgba(242,234,216,0.6);font-family:Montserrat,sans-serif;font-size:11px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .2s}
.sf-btn:hover,.sf-btn.active{border-color:#52B788;color:#52B788;background:rgba(82,183,136,0.08)}
.strain-search{width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:14px 20px;color:#F2EAD8;font-family:Montserrat,sans-serif;font-size:.9rem;margin-bottom:28px;outline:none}
.strain-search:focus{border-color:rgba(82,183,136,0.4)}
.strain-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:18px}
.sc{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:22px;cursor:pointer;transition:all .2s}
.sc:hover{border-color:rgba(82,183,136,0.3);transform:translateY(-2px)}
.sc-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
.sc-name{font-family:'Cormorant Garamond',serif;font-size:1.2rem;font-weight:400}
.sc-type{font-size:9px;letter-spacing:.1em;text-transform:uppercase;border-radius:20px;padding:3px 10px;font-weight:600}
.sc-type.indica{background:rgba(155,114,207,0.15);color:#9B72CF}
.sc-type.hybrid{background:rgba(82,183,136,0.15);color:#52B788}
.sc-type.sativa{background:rgba(232,168,76,0.15);color:#E8A84C}
.sc-thc{font-size:.78rem;color:rgba(242,234,216,0.45);margin-bottom:10px}
.sc-effects{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px}
.sc-effect{font-size:.72rem;background:rgba(255,255,255,0.05);border-radius:6px;padding:2px 8px;color:rgba(242,234,216,0.6)}
.sc-desc{font-size:.8rem;line-height:1.65;color:rgba(242,234,216,0.55)}
.sc-detail{display:none;margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.06)}
.sc-detail.open{display:block}
.sc-detail-row{font-size:.78rem;color:rgba(242,234,216,0.5);margin-bottom:6px}
.sc-detail-label{color:rgba(242,234,216,0.35);margin-right:6px}
.sc-terp{display:inline-block;background:rgba(82,183,136,0.1);color:#52B788;border-radius:12px;padding:2px 8px;font-size:.72rem;margin:2px}
.count-bar{font-size:.8rem;color:rgba(242,234,216,0.4);margin-bottom:20px}
</style>
</head>
<body>
${ENC_NAV}
<div class="enc-page">
  <div class="enc-page-header">
    <div class="enc-label">✦ Cannascenti Encyclopedia</div>
    <h1 class="enc-title">Every strain. <em>Everything about it.</em></h1>
    <p class="enc-desc">Full genetics, terpene profiles, effects, THC/CBD percentages, and growing info. Search by name or filter by type.</p>
  </div>
  <input class="strain-search" id="sSearch" placeholder="Search strains, effects, terpenes..." oninput="filterStrains()">
  <div class="strain-filters">
    <button class="sf-btn active" onclick="setType('all',this)">All</button>
    <button class="sf-btn" onclick="setType('indica',this)">Indica</button>
    <button class="sf-btn" onclick="setType('hybrid',this)">Hybrid</button>
    <button class="sf-btn" onclick="setType('sativa',this)">Sativa</button>
  </div>
  <div class="count-bar" id="countBar"></div>
  <div class="strain-grid" id="strainGrid"></div>
</div>
<script>
var STRAINS=[];var curType='all';
fetch('/api/strains/all').then(function(r){return r.json();}).then(function(data){
  STRAINS=data;renderStrains();
}).catch(function(){document.getElementById('strainGrid').innerHTML='<p style="color:rgba(242,234,216,0.4)">Loading strains...</p>';});

function setType(t,btn){
  curType=t;
  document.querySelectorAll('.sf-btn').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  renderStrains();
}
function filterStrains(){renderStrains();}

function renderStrains(){
  var q=(document.getElementById('sSearch').value||'').toLowerCase().trim();
  var list=STRAINS.filter(function(s){
    if(curType!=='all'&&s.type.toLowerCase()!==curType) return false;
    if(!q) return true;
    return (s.name+' '+(s.description||'')+' '+(s.effects||[]).join(' ')+' '+(s.terpenes||[]).join(' ')).toLowerCase().indexOf(q)>=0;
  });
  document.getElementById('countBar').textContent=list.length+' strain'+(list.length!==1?'s':'');
  var g=document.getElementById('strainGrid');
  g.innerHTML=list.map(function(s,i){
    var tc=s.type.toLowerCase();
    return '<div class="sc" onclick="toggleDetail(this)">'+
      '<div class="sc-header">'+
        '<div class="sc-name">'+s.name+'</div>'+
        '<span class="sc-type '+tc+'">'+s.type+'</span>'+
      '</div>'+
      '<div class="sc-thc">THC '+s.thc+' · CBD '+s.cbd+'</div>'+
      '<div class="sc-effects">'+(s.effects||[]).slice(0,4).map(function(e){return '<span class="sc-effect">'+e+'</span>';}).join('')+'</div>'+
      '<div class="sc-desc">'+(s.description||'').substring(0,120)+(s.description&&s.description.length>120?'...':'')+'</div>'+
      '<div class="sc-detail">'+
        (s.genetics?'<div class="sc-detail-row"><span class="sc-detail-label">Genetics:</span>'+s.genetics+'</div>':'')+
        (s.terpenes&&s.terpenes.length?'<div class="sc-detail-row"><span class="sc-detail-label">Terpenes:</span>'+(s.terpenes||[]).map(function(t){return '<span class="sc-terp">'+t+'</span>';}).join('')+'</div>':'')+
        (s.description&&s.description.length>120?'<div class="sc-detail-row" style="color:rgba(242,234,216,0.6)">'+s.description+'</div>':'')+
      '</div>'+
    '</div>';
  }).join('');
}

function toggleDetail(card){
  var d=card.querySelector('.sc-detail');
  if(d) d.classList.toggle('open');
}
</script>
</body></html>`;
    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /cooking ──────────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/cooking") {
    const _DECARB = [
      { temp:"220°F", tempC:"104°C", time:"60 min", name:"CBD Activation", desc:"Ideal for CBD-dominant flower. Lower heat preserves the most terpenes and converts CBDA to CBD with minimal THC degradation.", badge:"CBD Focus" },
      { temp:"240°F", tempC:"115°C", time:"40 min", name:"The Gold Standard", desc:"Perfect balance of THC conversion and terpene preservation. The most reliable method for edibles. Used by professional infusion kitchens.", badge:"Recommended" },
      { temp:"250°F", tempC:"121°C", time:"25–30 min", name:"Balanced Decarb", desc:"Slightly faster with minimal quality loss. Good for those short on time. Higher probability of some THC to CBN conversion starting.", badge:"Good" },
      { temp:"300°F", tempC:"149°C", time:"10–15 min", name:"Fast Decarb", desc:"Quick but risks degrading more THC into CBN. Significant terpene loss. Use only when time is critical.", badge:"Use Carefully" }
    ];
    const _INFUSION = [
      { id:"butter", icon:"🧈", name:"Cannabutter", sub:"The Foundation of Edibles", tags:["Versatile","Baking","Cooking"], desc:"Cannabutter is the backbone of cannabis cooking. Butter's fat content binds THC efficiently, and its flavor works with nearly everything — baked goods, sauces, toast, pasta, sautéed vegetables.", steps:["Decarboxylate your cannabis first — 240°F / 115°C for 40 minutes.","Melt 1 cup (2 sticks) unsalted butter with 1 cup water in a saucepan over low heat.","Add decarbed cannabis (3.5g for medium potency, 7g for strong).","Simmer on lowest heat for 2–3 hours, stirring occasionally. Never let it boil.","Strain through cheesecloth into a glass container, pressing to extract all butter.","Refrigerate — the water and butter will separate. Remove solidified butter from top.","Store refrigerated for up to 2 weeks, frozen for 6 months."], uses:["Baked goods","Pasta sauces","Toast & crackers","Sautéed vegetables","Frosting","Mashed potatoes"], tip:"Adding water during infusion prevents burning and helps remove chlorophyll — resulting in cleaner-tasting butter. The THC stays in the butter, not the water." },
      { id:"oil", icon:"🫒", name:"Cannabis Oil", sub:"Coconut, Olive & Beyond", tags:["Versatile","Vegan","Cooking"], desc:"Cannabis-infused oil is the most versatile infusion — it works in savory cooking, baking, salad dressings, smoothies, and capsules. Coconut oil has the highest saturated fat content of any plant oil, binding THC most efficiently.", steps:["Decarboxylate your cannabis — 240°F / 115°C for 40 minutes.","Combine 1 cup oil with decarbed cannabis in a double boiler or slow cooker.","Infuse on the lowest heat setting (160–200°F / 71–93°C) for 2–3 hours.","For slow cooker: set to low, infuse 4–6 hours for maximum extraction.","Stir occasionally and monitor temperature — never exceed 245°F / 118°C.","Strain through cheesecloth into a glass jar. Squeeze to extract maximum oil.","Store in a cool, dark place for up to 2 months."], uses:["Salad dressings","Stir fry","Capsules","Smoothies","Baking","Drizzled on finished dishes"], tip:"Coconut oil binds ~25% more THC due to higher saturated fat content. Olive oil has lower binding efficiency but superior flavor for savory dishes." },
      { id:"tincture", icon:"💧", name:"Cannabis Tincture", sub:"Alcohol-Based · Sublingual", tags:["Fast-Acting","Precise Dosing","Sublingual"], desc:"A tincture is a high-proof alcohol extraction of cannabis — the fastest and most dose-controllable way to consume cannabis besides inhalation. Taken sublingually, tinctures absorb directly into the bloodstream and begin working in 15–30 minutes.", steps:["Decarboxylate cannabis — 240°F / 115°C for 40 minutes.","Place decarbed cannabis in a clean glass jar.","Cover completely with high-proof food-grade alcohol (Everclear 190-proof is ideal). Use 1 oz alcohol per gram of cannabis.","Seal tightly and shake. Let sit at room temperature for 24 hours minimum.","For a quick version: keep in freezer for 3 hours, shaking every 30 minutes.","Strain through coffee filter into dropper bottles.","Store in a dark, cool location. Properly made tinctures last 1–5 years."], uses:["Sublingual drops","Cocktails & mocktails","Coffee & tea","Capsule filling","Microdosing"], tip:"A standard 1oz dropper bottle contains approximately 30 full droppers. Calculate your total mg per batch, then divide by 30 to know the mg per dropper." },
      { id:"cream", icon:"🥛", name:"Cannabis Cream / Milk", sub:"Dairy-Based Infusion", tags:["Dairy","Baking","Drinks"], desc:"Cannabis-infused cream or whole milk works beautifully for desserts, hot drinks, custards, and ice cream. Heavy cream (36–40% butterfat) binds THC readily, and the dairy flavor integrates seamlessly into sweet applications.", steps:["Decarboxylate cannabis — 240°F / 115°C for 40 minutes.","Heat heavy cream or whole milk in a saucepan to just below simmer (180°F / 82°C).","Add decarbed cannabis and stir to combine.","Keep at 180°F for 45–60 minutes, stirring frequently.","Never boil — high heat above 200°F will cause the fats to separate.","Strain through fine mesh or cheesecloth into a container.","Use immediately or refrigerate for up to 1 week."], uses:["Coffee & hot chocolate","Ice cream base","Custards & puddings","Whipped cream","Soups & bisques"], tip:"Cannabis cream in coffee is one of the most seamless infusion delivery methods. The fat carries the THC, the caffeine amplifies the onset. Add after brewing — never add raw cannabis." }
    ];
    const _DOSE_BARS = [
      { label:"Micro", mg:"1–2.5mg", pct:8, color:"#74C69D" },
      { label:"Low", mg:"2.5–5mg", pct:17, color:"#52B788" },
      { label:"Moderate", mg:"5–15mg", pct:42, color:"#2D9D6E" },
      { label:"High", mg:"15–30mg", pct:70, color:"#C9973A" },
      { label:"Very High", mg:"30–50mg", pct:88, color:"#E07030" },
      { label:"Extreme", mg:"50mg+", pct:100, color:"#C84040" }
    ];
    const _DOSE_RULES = [
      { num:"01", title:"Start at 5mg or below", body:"Even experienced smokers should start low with edibles. 11-hydroxy-THC is a different molecule. A joint-tolerant person can be floored by 20mg of edible THC on an empty stomach." },
      { num:"02", title:"Wait the full 2 hours", body:"The single most common mistake. Onset is 30 min to 2 hours. Re-dosing at 90 minutes because 'I don't feel anything' has ruined more evenings than any other error in cannabis." },
      { num:"03", title:"Eat before you dose", body:"Food in your stomach slows absorption and smooths onset. An empty stomach accelerates and intensifies effects — sometimes dramatically. First time? Always eat a full meal first." }
    ];
    const _RECIPES = [
      { icon:"🧈", name:"Classic Cannabutter", yield:"Yield: 1 cup · ~50–100mg THC per tbsp", ingredients:["1 cup (2 sticks) unsalted butter","1 cup water","3.5–7g decarbed cannabis","Cheesecloth for straining"], method:"Melt butter + water on low heat. Add cannabis. Simmer 2–3 hours. Strain through cheesecloth. Refrigerate to separate water. Use the solidified butter.", use:"Best for: brownies, cookies, rice crispy treats, pasta, toast" },
      { icon:"🫒", name:"Cannabis Coconut Oil", yield:"Yield: 1 cup · ~60–120mg THC per tbsp", ingredients:["1 cup coconut oil","3.5–7g decarbed cannabis","Cheesecloth or fine mesh strainer","Slow cooker or double boiler"], method:"Combine oil and cannabis in slow cooker on low for 4–6 hours (or double boiler 2–3 hours). Keep below 245°F. Strain and store in glass jar.", use:"Best for: capsules, baking, stir fry, salad dressing, smoothies" },
      { icon:"💧", name:"Green Dragon Tincture", yield:"Yield: 1oz · ~5–15mg THC per dropper", ingredients:["1 oz Everclear 190-proof","1g decarbed cannabis per oz alcohol","Glass dropper bottles","Coffee filter for straining"], method:"Combine in sealed glass jar. Shake and freeze 3 hours, shaking every 30 min. Strain through coffee filter. Fill dropper bottles. Label with potency.", use:"Best for: sublingual dosing, cocktails, coffee, precise microdosing" }
    ];
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cooking with Cannabis — Cannascenti Encyclopedia</title>
<meta name="description" content="The complete cannabis cooking guide. Decarboxylation, infusion methods, dosing, and recipes.">
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
.decarb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-bottom:60px}
.decarb-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:24px;text-align:center}
.decarb-temp{font-family:'Cormorant Garamond',serif;font-size:2.2rem;font-weight:300;color:#52B788}
.decarb-time{font-size:.8rem;color:rgba(242,234,216,0.45);margin:4px 0 10px}
.decarb-name{font-size:.9rem;font-weight:600;margin-bottom:8px}
.decarb-desc{font-size:.78rem;line-height:1.6;color:rgba(242,234,216,0.55)}
.decarb-badge{display:inline-block;margin-top:10px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;background:rgba(82,183,136,0.12);color:#52B788;border-radius:20px;padding:3px 12px}
.infusion-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px}
.inf-tab{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 18px;color:rgba(242,234,216,0.6);font-family:Montserrat,sans-serif;font-size:11px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;display:flex;align-items:center;gap:8px;transition:all .2s}
.inf-tab.active,.inf-tab:hover{border-color:#52B788;color:#F2EAD8;background:rgba(82,183,136,0.08)}
.inf-panel{display:none;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:32px;margin-bottom:40px}
.inf-panel.active{display:block}
.inf-tags{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.inf-tag{font-size:10px;letter-spacing:.08em;text-transform:uppercase;background:rgba(82,183,136,0.1);color:#52B788;border-radius:20px;padding:3px 10px}
.inf-desc{font-size:.88rem;line-height:1.75;color:rgba(242,234,216,0.7);margin-bottom:20px}
.inf-steps{list-style:none;margin-bottom:20px}
.inf-steps li{font-size:.85rem;line-height:1.7;color:rgba(242,234,216,0.65);padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);padding-left:20px;position:relative}
.inf-steps li::before{content:counter(step);counter-increment:step;position:absolute;left:0;color:#52B788;font-weight:600;font-size:.78rem}
.inf-steps{counter-reset:step}
.inf-uses{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px}
.inf-use{font-size:.78rem;background:rgba(255,255,255,0.05);border-radius:6px;padding:3px 10px;color:rgba(242,234,216,0.6)}
.inf-tip{font-size:.8rem;line-height:1.65;color:rgba(242,234,216,0.5);border-left:2px solid rgba(82,183,136,0.3);padding-left:14px;font-style:italic}
.dose-section{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:60px;align-items:start}
@media(max-width:640px){.dose-section{grid-template-columns:1fr}}
.dose-bars{display:flex;flex-direction:column;gap:10px}
.dose-bar-row{display:flex;align-items:center;gap:12px}
.dose-bar-label{font-size:.78rem;color:rgba(242,234,216,0.6);width:70px;flex-shrink:0}
.dose-bar-track{flex:1;height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden}
.dose-bar-fill{height:100%;border-radius:4px;transition:width .6s ease}
.dose-bar-mg{font-size:.75rem;color:rgba(242,234,216,0.45);width:80px;flex-shrink:0;text-align:right}
.dose-rules{display:flex;flex-direction:column;gap:16px}
.dose-rule{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px}
.dose-rule-num{font-family:'Cormorant Garamond',serif;font-size:1.4rem;color:#52B788;margin-bottom:4px}
.dose-rule-title{font-size:.9rem;font-weight:600;margin-bottom:6px}
.dose-rule-body{font-size:.82rem;line-height:1.65;color:rgba(242,234,216,0.6)}
.recipe-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}
.recipe-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:24px}
.recipe-icon{font-size:2rem;margin-bottom:10px}
.recipe-name{font-family:'Cormorant Garamond',serif;font-size:1.3rem;margin-bottom:4px}
.recipe-yield{font-size:.78rem;color:rgba(242,234,216,0.4);margin-bottom:14px}
.recipe-ing{list-style:none;margin-bottom:14px}
.recipe-ing li{font-size:.8rem;color:rgba(242,234,216,0.6);padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04)}
.recipe-method{font-size:.82rem;line-height:1.65;color:rgba(242,234,216,0.65);margin-bottom:10px}
.recipe-use{font-size:.78rem;color:#52B788}
h2.sec{font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:300;margin:60px 0 24px;color:#F2EAD8}
h2.sec em{color:#52B788;font-style:italic}
</style>
</head>
<body>
${ENC_NAV}
<div class="enc-page">
  <div class="enc-page-header">
    <div class="enc-label">✦ Cannascenti Encyclopedia</div>
    <h1 class="enc-title">Cooking with <em>Cannabis.</em></h1>
    <p class="enc-desc">Decarboxylation, infusion methods, dosing math, and recipes. Everything you need to cook with cannabis properly — from first-time edibles to professional infusion kitchen techniques.</p>
  </div>

  <h2 class="sec"><em>Decarboxylation</em> — activating THC</h2>
  <p class="enc-desc" style="margin-bottom:28px">Raw cannabis contains THCA, not THC. Heat converts THCA to active THC. Skip decarbing and your edibles won't work. Temperature and time determine potency and terpene preservation.</p>
  <div class="decarb-grid" id="debarbGrid"></div>

  <h2 class="sec">Infusion <em>methods</em></h2>
  <div class="infusion-tabs" id="infTabs"></div>
  <div id="infPanels"></div>

  <h2 class="sec">Edible <em>dosing</em> guide</h2>
  <div class="dose-section">
    <div>
      <p class="enc-desc" style="margin-bottom:24px">Edibles produce 11-hydroxy-THC in the liver — a more potent, longer-lasting compound than inhaled THC. Even experienced smokers should start lower than they think.</p>
      <div class="dose-bars" id="doseBars"></div>
    </div>
    <div class="dose-rules" id="doseRules"></div>
  </div>

  <h2 class="sec">Essential <em>recipes</em></h2>
  <div class="recipe-grid" id="recipeGrid"></div>
</div>
<script>
var DECARB = ${JSON.stringify(_DECARB)};
var INFUSION = ${JSON.stringify(_INFUSION)};
var DOSE_BARS = ${JSON.stringify(_DOSE_BARS)};
var DOSE_RULES = ${JSON.stringify(_DOSE_RULES)};
var RECIPES = ${JSON.stringify(_RECIPES)};

function render(){
  // decarb
  document.getElementById('debarbGrid').innerHTML=DECARB.map(function(d){
    return '<div class="decarb-card"><div class="decarb-temp">'+d.temp+'</div><div class="decarb-time">'+d.tempC+' · '+d.time+'</div><div class="decarb-name">'+d.name+'</div><div class="decarb-desc">'+d.desc+'</div><span class="decarb-badge">'+d.badge+'</span></div>';
  }).join('');
  // infusion tabs
  document.getElementById('infTabs').innerHTML=INFUSION.map(function(m,i){
    return '<button class="inf-tab'+(i===0?' active':'')+'" onclick="selectInf('+i+',this)">'+m.icon+' '+m.name+'</button>';
  }).join('');
  document.getElementById('infPanels').innerHTML=INFUSION.map(function(m,i){
    return '<div class="inf-panel'+(i===0?' active':'')+'" id="infPanel'+i+'">'+
      '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.5rem;font-weight:300;margin-bottom:4px">'+m.icon+' '+m.name+'</h3>'+
      '<div style="font-size:.8rem;color:rgba(242,234,216,0.4);margin-bottom:14px">'+m.sub+'</div>'+
      '<div class="inf-tags">'+m.tags.map(function(t){return '<span class="inf-tag">'+t+'</span>';}).join('')+'</div>'+
      '<p class="inf-desc">'+m.desc+'</p>'+
      '<ol class="inf-steps">'+m.steps.map(function(s){return '<li>'+s+'</li>';}).join('')+'</ol>'+
      '<div style="font-size:.8rem;color:rgba(242,234,216,0.4);margin-bottom:8px;letter-spacing:.08em;text-transform:uppercase">Best for</div>'+
      '<div class="inf-uses">'+m.uses.map(function(u){return '<span class="inf-use">'+u+'</span>';}).join('')+'</div>'+
      '<p class="inf-tip">'+m.tip+'</p>'+
    '</div>';
  }).join('');
  // dose bars
  document.getElementById('doseBars').innerHTML=DOSE_BARS.map(function(d){
    return '<div class="dose-bar-row"><span class="dose-bar-label">'+d.label+'</span><div class="dose-bar-track"><div class="dose-bar-fill" style="width:'+d.pct+'%;background:'+d.color+'"></div></div><span class="dose-bar-mg">'+d.mg+'</span></div>';
  }).join('');
  // dose rules
  document.getElementById('doseRules').innerHTML=DOSE_RULES.map(function(r){
    return '<div class="dose-rule"><div class="dose-rule-num">'+r.num+'</div><div class="dose-rule-title">'+r.title+'</div><div class="dose-rule-body">'+r.body+'</div></div>';
  }).join('');
  // recipes
  document.getElementById('recipeGrid').innerHTML=RECIPES.map(function(r){
    return '<div class="recipe-card"><div class="recipe-icon">'+r.icon+'</div><div class="recipe-name">'+r.name+'</div><div class="recipe-yield">'+r.yield+'</div><ul class="recipe-ing">'+r.ingredients.map(function(i){return '<li>'+i+'</li>';}).join('')+'</ul><div class="recipe-method">'+r.method+'</div><div class="recipe-use">'+r.use+'</div></div>';
  }).join('');
}

function selectInf(i,btn){
  document.querySelectorAll('.inf-tab').forEach(function(b){b.classList.remove('active');});
  document.querySelectorAll('.inf-panel').forEach(function(p){p.classList.remove('active');});
  btn.classList.add('active');
  document.getElementById('infPanel'+i).classList.add('active');
}

document.addEventListener('DOMContentLoaded',render);
</script>
</body></html>`;
    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /cannabinoids ─────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/cannabinoids") {
    const _CB = [
      { abbr:"THC", full:"Tetrahydrocannabinol", psycho:95, color:"#52B788", desc:"The primary psychoactive compound in cannabis. THC binds directly to CB1 receptors in the brain, producing the euphoria, altered perception, and heightened sensory awareness associated with cannabis intoxication. Also the most clinically studied cannabinoid for pain, nausea, and appetite.", uses:["Euphoria","Pain relief","Appetite stimulation","Anti-nausea","Glaucoma"], found:"10–35% in modern cultivars. Trace amounts in hemp." },
      { abbr:"CBD", full:"Cannabidiol", psycho:5, color:"#74C69D", desc:"The second most abundant cannabinoid — and the most therapeutically versatile. CBD is non-intoxicating, modulates the activity of THC through allosteric receptor action, and has demonstrated efficacy for epilepsy treatment (FDA-approved as Epidiolex). A powerful anti-inflammatory and anxiolytic.", uses:["Anxiety reduction","Epilepsy","Anti-inflammatory","Pain","Nausea"], found:"High in hemp. 0–25% in cannabis. Dominant in Charlotte's Web, ACDC, Harlequin." },
      { abbr:"CBG", full:"Cannabigerol", psycho:15, color:"#D4A853", desc:"Often called the 'mother cannabinoid' because CBGA is the biosynthetic precursor to THC, CBD, and CBC. Non-intoxicating. Shows strong antibacterial activity against MRSA, and early research suggests promise for inflammatory bowel disease, glaucoma, and Huntington's disease.", uses:["Antibacterial","Glaucoma","IBD","Neuroprotection","Appetite"], found:"Usually less than 1% in mature plants. Highest in early-harvest hemp." },
      { abbr:"CBN", full:"Cannabinol", psycho:20, color:"#C9973A", desc:"CBN is a degradation product of THC — as THC oxidizes over time, it converts to CBN. Mildly psychoactive. Heavily marketed as a sleep aid, though the scientific evidence for this is limited. More established are its antibacterial properties and potential as an appetite stimulant.", uses:["Sleep aid","Antibacterial","Appetite","Anticonvulsant","Mild pain"], found:"Highest in aged, oxidized cannabis. Forms when THC degrades." },
      { abbr:"THCV", full:"Tetrahydrocannabivarin", psycho:40, color:"#E07B39", desc:"A structural analog of THC with notably different effects. At low doses THCV actually blocks CB1 receptors and suppresses appetite. At higher doses it becomes mildly euphoric. Associated with clear-headed, energetic, short-duration highs.", uses:["Appetite suppression","Diabetes (research)","Panic attacks","Bone growth","Energy"], found:"Rare. Highest in African landrace sativas: Durban Poison, Pineapple Purps." },
      { abbr:"Δ8", full:"Delta-8 THC", psycho:60, color:"#9B72CF", desc:"Delta-8 THC is an isomer of Delta-9 THC with a double bond on the 8th carbon chain. Produces similar but notably milder psychoactive effects — often described as a lighter, clearer, less anxiety-prone version of the standard cannabis experience. Naturally occurring in trace amounts.", uses:["Mild euphoria","Antiemetic","Appetite","Anxiety reduction","Neuroprotection"], found:"Trace amounts naturally. Most commercial Delta-8 is synthesized from CBD." }
    ];
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cannabinoids — Cannascenti Encyclopedia</title>
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
.cb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px}
.cb-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:28px}
.cb-abbr{font-family:'Cormorant Garamond',serif;font-size:2.2rem;font-weight:300;margin-bottom:4px}
.cb-full{font-size:.8rem;color:rgba(242,234,216,0.4);margin-bottom:16px;letter-spacing:.05em}
.cb-psycho-track{height:6px;background:rgba(255,255,255,0.08);border-radius:3px;margin-bottom:6px;overflow:hidden}
.cb-psycho-fill{height:100%;border-radius:3px}
.cb-psycho-label{font-size:.72rem;color:rgba(242,234,216,0.35);margin-bottom:14px}
.cb-desc{font-size:.84rem;line-height:1.72;color:rgba(242,234,216,0.7);margin-bottom:16px}
.cb-uses{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.cb-use{font-size:.75rem;background:rgba(255,255,255,0.05);border-radius:6px;padding:3px 9px;color:rgba(242,234,216,0.6)}
.cb-found{font-size:.78rem;color:rgba(242,234,216,0.4);font-style:italic}
</style>
</head>
<body>
${ENC_NAV}
<div class="enc-page">
  <div class="enc-page-header">
    <div class="enc-label">✦ Cannascenti Encyclopedia</div>
    <h1 class="enc-title">The <em>cannabinoid</em> reference.</h1>
    <p class="enc-desc">THC is just the beginning. The cannabis plant produces over 100 cannabinoids, each with distinct receptor binding profiles and therapeutic effects. These are the ones that matter most.</p>
  </div>
  <div class="cb-grid" id="cbGrid"></div>
</div>
<script>
var CB = ${JSON.stringify(_CB)};
document.addEventListener('DOMContentLoaded',function(){
  document.getElementById('cbGrid').innerHTML=CB.map(function(c){
    return '<div class="cb-card">'+
      '<div class="cb-abbr" style="color:'+c.color+'">'+c.abbr+'</div>'+
      '<div class="cb-full">'+c.full+'</div>'+
      '<div class="cb-psycho-track"><div class="cb-psycho-fill" style="width:'+c.psycho+'%;background:'+c.color+'"></div></div>'+
      '<div class="cb-psycho-label">Psychoactivity: '+c.psycho+'%</div>'+
      '<p class="cb-desc">'+c.desc+'</p>'+
      '<div class="cb-uses">'+c.uses.map(function(u){return '<span class="cb-use">'+u+'</span>';}).join('')+'</div>'+
      '<div class="cb-found">'+c.found+'</div>'+
    '</div>';
  }).join('');
});
</script>
</body></html>`;
    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /consumption ──────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/consumption") {
    const _CM = [
      { icon:"🔥", name:"Smoking", onset:"2–10 min", duration:"1–3 hours", bio:"15–25%", best:"Flower, kief, hash", desc:"Combustion at 600–900°C releases cannabinoids and terpenes instantly. The fastest onset of any method. Bioavailability is moderate — much is lost to sidestream smoke and incomplete combustion.", pros:["Instant onset","Social ritual","Precise dose control","Full spectrum of flavors"], cons:["Combustion byproducts","Harshest on lungs","Burns plant material inefficiently","Smell"], tip:"Use a screen to prevent ash inhalation. Corner your bowl to preserve flavor. Clean glass weekly for best taste. Never hold smoke in — cannabinoids absorb in seconds." },
      { icon:"💨", name:"Vaporizing", onset:"2–10 min", duration:"1–3 hours", bio:"45–60%", best:"Flower (180–210°C), concentrates, oil", desc:"Vaporization heats cannabis below combustion temperature, releasing cannabinoids and terpenes as vapor rather than smoke. Significantly reduces harmful combustion byproducts. Bioavailability is roughly double that of smoking.", pros:["Reduced combustion toxins","Higher bioavailability","Superior terpene expression","Discreet"], cons:["Device cost","Requires charging","Different experience than smoking","Battery dependency"], tip:"For flower vaping, start at 170°C for terpene flavor and work up to 210°C for stronger effect. Desktop vaporizers outperform portables for quality." },
      { icon:"🍫", name:"Edibles", onset:"30–120 min", duration:"4–8 hours", bio:"4–12%", best:"Infused food, capsules, tinctures", desc:"When cannabis is consumed orally, THC is metabolized by the liver into 11-hydroxy-THC — a more potent, longer-lasting compound that crosses the blood-brain barrier more effectively. This is why edibles hit harder and last longer than smoking.", pros:["Longest duration","No respiratory impact","Discreet","Most potent experience"], cons:["Unpredictable onset","Easy to over-consume","2–4 hours to kick in","Hard to dose precisely"], tip:"Start with 2.5–5mg THC if you're new. Wait a full 2 hours before redosing. A high-fat meal significantly increases absorption. Tinctures under the tongue absorb in 15–45 min." },
      { icon:"💎", name:"Dabbing", onset:"Immediate", duration:"1–2 hours", bio:"50–80%", best:"Rosin, live resin, BHO, THCA diamonds", desc:"Dabbing vaporizes cannabis concentrates (typically 60–95% THC) on a heated surface, producing intensely potent vapor. The highest-bioavailability consumption method. At low temperatures, the terpene expression of high-quality concentrates is extraordinary.", pros:["Maximum potency","Best expression of concentrates","Fast onset","Full flavor at low temps"], cons:["Very high tolerance building","Equipment complexity","High cost of entry"], tip:"Low-temp dabs (400–450°F) preserve terpenes and are far more pleasant than hot dabs. Use a carb cap. Hash rosin at low temp is the pinnacle of the dab experience." },
      { icon:"💧", name:"Tinctures", onset:"15–45 min", duration:"2–4 hours", bio:"20–35%", best:"Alcohol or oil-based extracts", desc:"Tinctures are cannabis extracts administered sublingually (under the tongue). The mucous membranes absorb cannabinoids directly into the bloodstream, bypassing first-pass liver metabolism for faster onset than edibles. Highly controllable dosing with a dropper.", pros:["Precise dosing","No respiratory impact","Sublingual absorption is fast","Discreet"], cons:["Taste (alcohol-based)","Less potent than dabbing","Cost per dose"], tip:"Hold under tongue for 60–90 seconds before swallowing for best sublingual absorption. Oil-based tinctures are gentler. Start with 2.5mg THC and titrate up slowly." },
      { icon:"🧴", name:"Topicals", onset:"5–20 min", duration:"2–4 hours", bio:"<5% systemic", best:"Creams, balms, transdermal patches", desc:"Topicals deliver cannabinoids directly to localized tissue via skin absorption. Standard topicals do not enter the bloodstream and produce no psychoactive effect — they bind to CB2 receptors in skin, muscle, and nerve tissue.", pros:["No psychoactive effect","Targeted relief","No respiratory impact","Discreet"], cons:["Minimal systemic effect","Not effective for internal conditions","Variable quality"], tip:"For genuine pain relief, look for topicals with both THC and CBD — they work synergistically on CB2 receptors. Transdermal patches can be mildly psychoactive." }
    ];
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Consumption Methods — Cannascenti Encyclopedia</title>
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
.cm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px}
.cm-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:28px}
.cm-icon{font-size:2rem;margin-bottom:12px}
.cm-name{font-family:'Cormorant Garamond',serif;font-size:1.4rem;font-weight:400;margin-bottom:8px}
.cm-meta{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}
.cm-meta-item{font-size:.75rem;background:rgba(255,255,255,0.05);border-radius:6px;padding:4px 10px;color:rgba(242,234,216,0.6)}
.cm-meta-item span{color:rgba(242,234,216,0.35);margin-right:4px}
.cm-desc{font-size:.84rem;line-height:1.72;color:rgba(242,234,216,0.7);margin-bottom:16px}
.cm-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px}
.cm-col-label{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:rgba(242,234,216,0.35);margin-bottom:6px}
.cm-col ul{list-style:none}
.cm-col li{font-size:.78rem;color:rgba(242,234,216,0.6);padding:2px 0;padding-left:12px;position:relative}
.cm-col li::before{content:"•";position:absolute;left:0;color:#52B788}
.cm-tip{font-size:.79rem;line-height:1.6;color:rgba(242,234,216,0.45);border-left:2px solid rgba(82,183,136,0.3);padding-left:12px;font-style:italic}
</style>
</head>
<body>
${ENC_NAV}
<div class="enc-page">
  <div class="enc-page-header">
    <div class="enc-label">✦ Cannascenti Encyclopedia</div>
    <h1 class="enc-title">Every way to <em>consume</em> cannabis.</h1>
    <p class="enc-desc">Onset time, duration, bioavailability, pros and cons — every method fully explained. The right method depends on what you're looking for. Here's how to choose.</p>
  </div>
  <div class="cm-grid" id="cmGrid"></div>
</div>
<script>
var CM = ${JSON.stringify(_CM)};
document.addEventListener('DOMContentLoaded',function(){
  document.getElementById('cmGrid').innerHTML=CM.map(function(m){
    return '<div class="cm-card">'+
      '<div class="cm-icon">'+m.icon+'</div>'+
      '<div class="cm-name">'+m.name+'</div>'+
      '<div class="cm-meta">'+
        '<span class="cm-meta-item"><span>Onset:</span>'+m.onset+'</span>'+
        '<span class="cm-meta-item"><span>Duration:</span>'+m.duration+'</span>'+
        '<span class="cm-meta-item"><span>Bioavailability:</span>'+m.bio+'</span>'+
      '</div>'+
      '<p class="cm-desc">'+m.desc+'</p>'+
      '<div class="cm-cols">'+
        '<div class="cm-col"><div class="cm-col-label">Advantages</div><ul>'+m.pros.map(function(p){return '<li>'+p+'</li>';}).join('')+'</ul></div>'+
        '<div class="cm-col"><div class="cm-col-label">Disadvantages</div><ul>'+m.cons.map(function(c){return '<li>'+c+'</li>';}).join('')+'</ul></div>'+
      '</div>'+
      '<p class="cm-tip">'+m.tip+'</p>'+
    '</div>';
  }).join('');
});
</script>
</body></html>`;
    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /cultivation ──────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/cultivation") {
    const _CS = [
      { name:"Germination", dur:"1–7 days", icon:"🌱", desc:"The seed awakens. The taproot emerges, seeking water and darkness. This is the most delicate phase — temperature and moisture are everything.", environment:"Temp: 70–85°F · Humidity: 70–90% · Light: 18h (seedling)", nutrients:"None — seed contains all it needs", tips:["Keep medium moist, not soaking","Temperature consistency critical","Darkness or very low light during germination","Transplant when taproot reaches 1/2 inch"], watch:"Damping off (stem rot from overwatering). Use a humidity dome. Never let the medium dry out completely.", tip:"The paper towel method between two damp plates in a warm dark place is foolproof for germination." },
      { name:"Seedling", dur:"2–3 weeks", icon:"🌿", desc:"The first set of true leaves emerge. The plant is establishing its root system and vascular structure. Handle with extreme care.", environment:"Temp: 68–77°F · Humidity: 60–70% · Light: 18h fluorescent or LED", nutrients:"Very light — 1/4 strength veg nutrients at week 2", tips:["Avoid overwatering — let medium dry slightly between waterings","Use small pots to prevent overwatering","Gentle airflow strengthens stems"], watch:"Cotyledons yellowing (normal after week 2). Stretched seedlings mean insufficient light. Root-bound seedlings stunt.", tip:"Seedlings in solo cups with drainage holes is the classic method. Transplant when you can see roots coming out the bottom." },
      { name:"Vegetative", dur:"3–16 weeks", icon:"🌳", desc:"Explosive growth. The plant builds its structural framework — all the branches, nodes, and root mass that will support the eventual flower load.", environment:"Temp: 70–85°F · Humidity: 40–70% · Light: 18/6 or 20/4 hours", nutrients:"High nitrogen, moderate phosphorus and potassium. Heavy feeder.", tips:["Top or FIM at 5th node for bushier plants","LST (low-stress training) maximizes canopy evenness","SCROG nets maximize light penetration"], watch:"Nitrogen toxicity (clawed, dark green leaves). Spider mite infestations start here. Males begin showing pre-flowers — remove immediately.", tip:"Topping creates an exponential node count. Top once, you get 2 mains. Top those, you get 4. Manifolding creates 8 perfectly even colas." },
      { name:"Pre-Flower", dur:"1–2 weeks", icon:"🌸", desc:"The transition period. The plant shifts hormonal production toward reproduction. Sex becomes clearly visible. Vertical growth slows, lateral branching increases.", environment:"Temp: 65–80°F · Humidity: 40–50% · Light: 12/12 switch triggers flowering", nutrients:"Taper nitrogen, begin increasing phosphorus and potassium", tips:["Confirm sex immediately","Remove males before pollen sacs open","Apply any remaining training before stretch begins"], watch:"The 'stretch' — plants can double in height in 2 weeks during pre-flower. Stake tall plants. Hermaphrodites develop under stress.", tip:"Pre-flower is your last chance to train heavily. Once stretch begins, it's hands off. Get your trellis net in place now." },
      { name:"Flowering", dur:"6–12 weeks", icon:"🌺", desc:"The main event. The plant's entire energy is devoted to producing resinous flowers. Trichome development, terpene production, and cannabinoid synthesis all peak here.", environment:"Temp: 65–80°F · Humidity: 40–50% · Light: 12/12", nutrients:"High phosphorus and potassium, declining nitrogen. Specialized bloom nutrients.", tips:["Defoliate moderately at week 3 and week 6","Maintain strict 12/12 — any light leak causes hermaphroditism","Monitor trichomes with a loupe from week 6"], watch:"Bud rot (Botrytis) in dense colas. Reduce humidity, increase airflow. Powdery mildew. Spider mites explode in hot/dry conditions.", tip:"Color change under cooler temps is controlled by genetics (anthocyanins), not nutrients. To get purple, grow strains bred for it at cooler night temps (60°F)." },
      { name:"Harvest", dur:"1–3 days", icon:"✂️", desc:"The moment of truth. Trichome observation determines the perfect harvest window — the difference between a heady, clear high and a body-heavy sedative effect.", environment:"Temp: 60–70°F · Humidity: 45–55% · Complete darkness 24–48h before harvest", nutrients:"Flush with plain water 1–2 weeks before harvest", tips:["Trichomes: clear = early, cloudy = peak THC, amber = degraded THC/more CBD","Harvest in the morning for peak terpene content","Use sharp, clean scissors"], watch:"Mold at harvest. Harvest in cool, dry conditions. Wet trim vs dry trim — both valid; wet trim in humid climates, dry trim in dry climates.", tip:"A 40–60x loupe or jeweler's scope is mandatory for serious trichome observation. The naked eye cannot tell you when to harvest accurately." }
    ];
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cultivation Guide — Cannascenti Encyclopedia</title>
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
.stage-timeline{display:flex;flex-direction:column;gap:0}
.stage{display:grid;grid-template-columns:80px 1fr;gap:0;position:relative}
.stage-line{display:flex;flex-direction:column;align-items:center;padding-top:4px}
.stage-dot{width:40px;height:40px;border-radius:50%;background:rgba(82,183,136,0.15);border:2px solid rgba(82,183,136,0.4);display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;z-index:1}
.stage-connector{flex:1;width:2px;background:rgba(82,183,136,0.15);margin-top:6px}
.stage:last-child .stage-connector{display:none}
.stage-body{padding:0 0 40px 24px}
.stage-header{display:flex;align-items:baseline;gap:12px;margin-bottom:8px}
.stage-name{font-family:'Cormorant Garamond',serif;font-size:1.4rem;font-weight:400}
.stage-dur{font-size:.78rem;color:rgba(242,234,216,0.4)}
.stage-desc{font-size:.86rem;line-height:1.7;color:rgba(242,234,216,0.7);margin-bottom:14px}
.stage-env{font-size:.78rem;color:#52B788;background:rgba(82,183,136,0.08);border-radius:8px;padding:8px 14px;margin-bottom:12px}
.stage-tips{list-style:none;margin-bottom:12px}
.stage-tips li{font-size:.8rem;color:rgba(242,234,216,0.6);padding:3px 0;padding-left:14px;position:relative}
.stage-tips li::before{content:"→";position:absolute;left:0;color:#52B788;font-size:.7rem}
.stage-watch{font-size:.79rem;color:rgba(232,168,76,0.8);background:rgba(232,168,76,0.06);border-radius:8px;padding:8px 12px;margin-bottom:10px}
.stage-tip{font-size:.79rem;line-height:1.6;color:rgba(242,234,216,0.45);border-left:2px solid rgba(82,183,136,0.3);padding-left:12px;font-style:italic}
</style>
</head>
<body>
${ENC_NAV}
<div class="enc-page">
  <div class="enc-page-header">
    <div class="enc-label">✦ Cannascenti Encyclopedia</div>
    <h1 class="enc-title">Cannabis <em>cultivation</em> guide.</h1>
    <p class="enc-desc">From seed to harvest — every stage of the cannabis life cycle with environment requirements, nutrients, common problems, and pro tips. Whether you're growing your first plant or running a professional operation.</p>
  </div>
  <div class="stage-timeline" id="stageTimeline"></div>
</div>
<script>
var STAGES = ${JSON.stringify(_CS)};
document.addEventListener('DOMContentLoaded',function(){
  document.getElementById('stageTimeline').innerHTML=STAGES.map(function(s){
    return '<div class="stage">'+
      '<div class="stage-line"><div class="stage-dot">'+s.icon+'</div><div class="stage-connector"></div></div>'+
      '<div class="stage-body">'+
        '<div class="stage-header"><div class="stage-name">'+s.name+'</div><div class="stage-dur">'+s.dur+'</div></div>'+
        '<p class="stage-desc">'+s.desc+'</p>'+
        '<div class="stage-env">'+s.environment+'</div>'+
        '<ul class="stage-tips">'+s.tips.map(function(t){return '<li>'+t+'</li>';}).join('')+'</ul>'+
        '<div class="stage-watch">⚠ Watch for: '+s.watch+'</div>'+
        '<p class="stage-tip">'+s.tip+'</p>'+
      '</div>'+
    '</div>';
  }).join('');
});
</script>
</body></html>`;
    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /history ──────────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/history") {
    const _HE = [
      { era:"Ancient World", date:"~10,000 BCE", tag:"ancient", title:"First Cultivation", body:"Archaeological evidence from Taiwan indicates cannabis is among the first crops ever cultivated by humans — alongside wheat and rice. Used for fiber, seed oil, and ritual." },
      { era:"Ancient World", date:"2700 BCE", tag:"medicine", title:"Chinese Medical Canon", body:"Emperor Shen Nung's pharmacopeia documents cannabis (Ma) for gout, malaria, and absent-mindedness. The earliest written record of medical cannabis use." },
      { era:"Ancient World", date:"1000 BCE", tag:"culture", title:"Bhang in India", body:"Cannabis preparations called 'bhang' appear in the Atharva Veda as one of five sacred plants. Used in religious ceremonies, Ayurvedic medicine, and as an offering to Shiva. The tradition continues today." },
      { era:"Ancient World", date:"450 BCE", tag:"culture", title:"Scythian Ritual Steam Baths", body:"Greek historian Herodotus documents the Scythians throwing cannabis seeds onto hot stones in enclosed tents. One of the earliest recorded recreational cannabis uses." },
      { era:"Medieval & Colonial", date:"900 CE", tag:"culture", title:"Hashish Spreads Through the Middle East", body:"Hash culture flourishes in Persia, Arabia, and North Africa. The word 'assassin' is etymologically linked to 'hashishin' — the politically-motivated hash consumers in medieval legend." },
      { era:"Medieval & Colonial", date:"1545", tag:"ancient", title:"Cannabis Arrives in the Americas", body:"Spanish conquistadors bring cannabis hemp to Chile for rope and textile production. Hemp cultivation spreads rapidly through North and South America over the next century." },
      { era:"19th Century", date:"1839", tag:"medicine", title:"Western Medicine Discovers Cannabis", body:"Irish physician W.B. O'Shaughnessy publishes landmark research after studying cannabis use in India. Introduces cannabis tinctures to Western medicine for cholera, tetanus, and pain. Cannabis enters the British Pharmacopoeia." },
      { era:"19th Century", date:"1850", tag:"medicine", title:"US Pharmacopeia Listing", body:"Cannabis is added to the United States Pharmacopeia, legitimizing its medical use. Dozens of cannabis tincture products become available at American pharmacies." },
      { era:"Prohibition Era", date:"1910", tag:"culture", title:"Cannabis Enters the US via Mexico", body:"Mexican Revolution refugees bring recreational cannabis smoking to the United States. The practice spreads through border cities and into African American urban culture via jazz musicians." },
      { era:"Prohibition Era", date:"1936", tag:"prohibition", title:"Reefer Madness", body:"The anti-cannabis propaganda film Reefer Madness premieres, depicting cannabis causing murder, insanity, and moral depravity. Part of a broader campaign to criminalize cannabis nationally." },
      { era:"Prohibition Era", date:"1937", tag:"prohibition", title:"Marihuana Tax Act", body:"The US Marihuana Tax Act effectively criminalizes cannabis. Hemp Czar Harry Anslinger leads a campaign linking cannabis to violence and racial minorities. Cannabis is removed from the US Pharmacopeia in 1942." },
      { era:"Counterculture", date:"1960s", tag:"culture", title:"The Counterculture Embrace", body:"Cannabis becomes the symbol of the 1960s counterculture — inseparable from the Vietnam War protest movement, psychedelic music, and the sexual revolution." },
      { era:"Counterculture", date:"1970", tag:"prohibition", title:"Controlled Substances Act", body:"Nixon signs the Controlled Substances Act, placing cannabis in Schedule I alongside heroin. Sets the framework for the next 50 years of US drug policy." },
      { era:"Modern Era", date:"1988", tag:"science", title:"CB1 Receptor Discovered", body:"Allyn Howlett discovers the CB1 cannabinoid receptor in rat brains, proving cannabis works through a specific biological mechanism. The foundation for all subsequent endocannabinoid research." },
      { era:"Modern Era", date:"1992", tag:"science", title:"Endocannabinoid System Identified", body:"Raphael Mechoulam's team discovers anandamide — the brain's own 'bliss molecule' — revealing the endocannabinoid system. Cannabis works by mimicking molecules the body already produces." },
      { era:"Modern Era", date:"1996", tag:"legalization", title:"California Legalizes Medical Cannabis", body:"Proposition 215 makes California the first US state to legalize medical cannabis. The beginning of the state-by-state decriminalization movement." },
      { era:"Modern Era", date:"2012", tag:"legalization", title:"First Recreational Legalization", body:"Colorado and Washington become the first US states to legalize recreational cannabis, passing ballot measures despite federal Schedule I status." },
      { era:"Modern Era", date:"2018", tag:"legalization", title:"Canada Goes Fully Legal", body:"Canada becomes the first G7 nation to federally legalize recreational cannabis nationwide, creating a regulated commercial market from coast to coast." },
      { era:"Modern Era", date:"2024", tag:"legalization", title:"US Rescheduling Movement", body:"The DEA proposes moving cannabis from Schedule I to Schedule III — the most significant federal shift in US cannabis policy since the 1970 Controlled Substances Act." }
    ];
    const tagColors = { ancient:"#C9973A", medicine:"#52B788", culture:"#9B72CF", prohibition:"#C84040", science:"#5B8DD9", legalization:"#74C69D" };

    const _ORIGINS = [
      { name:"Taiwan", region:"East Asia", lat:23.5, lng:121, type:"ancient", strains:"First cultivation site", hunter:false, desc:"Archaeological evidence places cannabis cultivation in Taiwan around 10,000 BCE — making it one of the oldest crops in human history. Used for hemp fiber, seed oil, and ritual.", seeds:"The genetic origin of Cannabis sativa lineages that spread west across Asia." },
      { name:"Yunnan, China", region:"Southwest China", lat:25, lng:101, type:"ancient", strains:"Wild Cannabis Origin", hunter:false, desc:"Modern genetic studies point to Yunnan province as the evolutionary origin of all cannabis — both hemp and drug varieties. The ancestral homeland of every strain ever grown.", seeds:"All modern cannabis traces its DNA back to this region. The genetic Adam and Eve of the plant." },
      { name:"Hindu Kush Mountains", region:"Afghanistan / Pakistan", lat:35, lng:69, type:"landrace", strains:"Afghan Kush, Mazar-i-Sharif, Hash Plant", hunter:true, desc:"The Hindu Kush range produced some of the world's most resinous cannabis. The harsh environment — extreme cold, altitude, UV exposure — forced the plant to produce extraordinary amounts of resin as protection. Afghan genetics underpin nearly every modern indica.", seeds:"Strain Hunters Arjan & Franco made multiple expeditions into Afghanistan hunting pure Kush phenotypes. Afghan #1 by Sensi Seeds is the most famous stabilized variety." },
      { name:"Himachal Pradesh, India", region:"Northern India", lat:32.1, lng:77.2, type:"landrace", strains:"Malana Cream, Parvati Valley Hash", hunter:true, desc:"The Parvati Valley in Himachal Pradesh produces Malana Cream — made by rubbing living cannabis plants between bare palms. The isolation of Malana village and its specific landrace genetics create a product that cannot be replicated elsewhere.", seeds:"Strain Hunters filmed their India expedition in the Parvati Valley, documenting the charas-making tradition and collecting landrace seeds from plants growing wild at 3,000 meters." },
      { name:"Nepal", region:"South Asia", lat:28.2, lng:84.1, type:"landrace", strains:"Himalayan Gold, Temple Ball Hash", hunter:false, desc:"Nepalese Temple Balls are among the oldest and most revered hash preparations in the world — hand-rolled from dry-sifted charas and aged for years. The high-altitude Himalayan landraces produce distinctively spicy, incense-like terpene profiles.", seeds:"Nepalese genetics contributed significantly to the Haze varieties in the 1970s, blended by American breeders with Colombian and Mexican landraces." },
      { name:"Pakistan — Chitral", region:"Northwest Pakistan", lat:35.9, lng:71.8, type:"landrace", strains:"Pakistani Chitral Kush, PCK", hunter:false, desc:"Chitral, in Pakistan's northwestern tribal areas, produces a distinct landrace with deep purple coloration and extreme resin production. The PCK (Pakistani Chitral Kush) is prized for its dense hash production and unusual purple phenotypes.", seeds:"PCK was brought to Amsterdam breeders in the early 2000s and has since contributed purple phenotypes and early-finishing traits to dozens of modern strains." },
      { name:"Lebanon — Bekaa Valley", region:"Middle East", lat:33.8, lng:35.9, type:"landrace", strains:"Lebanese Red, Lebanese Blonde", hunter:false, desc:"The Bekaa Valley in Lebanon has produced hash for centuries. Lebanese Red and Lebanese Blonde were among the most prized hashishes of the 1970s — distinctively mild and aromatic compared to Moroccan or Afghan hash.", seeds:"Lebanese genetics contributed to early Skunk breeding and are present in many first-generation Dutch strains." },
      { name:"Morocco — Ketama", region:"North Africa", lat:34.9, lng:-4.6, type:"landrace", strains:"Moroccan Kif, Ketama Hash", hunter:true, desc:"The Ketama region in the Rif Mountains of Morocco is the world's largest traditional hash-producing area. The local Beldia landrace has been cultivated here for centuries. Moroccan hash was the most widely available hashish in Europe through the 20th century.", seeds:"Strain Hunters documented the Ketama region and its traditional dry-sift hash production. The Beldia landrace is under threat from hybridization with European varieties." },
      { name:"Colombia — Cauca", region:"South America", lat:2.4, lng:-76.6, type:"landrace", strains:"Colombian Gold, Punto Rojo, Santa Marta Gold", hunter:true, desc:"Colombia was the source of some of the most legendary sativas of the 1970s — Colombian Gold, Punto Rojo, and Santa Marta Gold. These pure sativas, grown at altitude in the Andes, had 3-month flowering times and profound, cerebral highs unlike anything from indica-dominant genetics.", seeds:"Strain Hunters Season 1 (2009) documented their Colombia expedition, collecting Punto Rojo and Colombian Gold seeds from indigenous farmers. These genetics directly influenced Haze and modern sativa hybrids." },
      { name:"Mexico — Oaxaca", region:"Mexico", lat:17.1, lng:-96.7, type:"landrace", strains:"Acapulco Gold, Oaxacan Highland", hunter:false, desc:"Mexico produced some of the most famous cannabis of the 1960s and 70s — Acapulco Gold, from the Pacific coast, was legendary for its golden coloration and euphoric high. Oaxacan Highland was a distinct landrace grown by indigenous Zapotec farmers at altitude.", seeds:"Mexican landraces were critical in the development of Skunk #1 and many early Californian hybrids. Mexican genetics traveled north with migrant workers in the early 20th century, introducing cannabis culture to the American Southwest." },
      { name:"Jamaica — Blue Mountains", region:"Caribbean", lat:18.1, lng:-77.3, type:"landrace", strains:"Lamb's Bread, Jamaican Lambsbread", hunter:true, desc:"Jamaica's Blue Mountains are home to Lamb's Bread — famously Bob Marley's preferred strain. A pure sativa landrace with an uplifting, creative, spiritually-focused effect. Rastafarian culture elevated cannabis (ganja) to a sacrament, and Jamaican genetics became deeply intertwined with reggae and the global cannabis counterculture.", seeds:"Strain Hunters documented Jamaica in Season 7 (2015), visiting Rastafarian farmers growing traditional Lamb's Bread in the mountains. Franco Loja described it as 'the most spiritually important cannabis genetics in the world.'" },
      { name:"Panama", region:"Central America", lat:8.5, lng:-80.8, type:"landrace", strains:"Panamanian Red", hunter:false, desc:"Panamanian Red was one of the most sought-after sativas of the 1970s — grown in Panama's rainforest highlands, it produced an intensely cerebral, almost psychedelic effect. A key genetic contributor to early American hybrids.", seeds:"Panamanian genetics were mixed with Colombian and Thai landraces by California breeders in the late 1970s, contributing to the diversity of early Haze varieties." },
      { name:"Thailand — Chiang Mai", region:"Southeast Asia", lat:18.8, lng:98.9, type:"landrace", strains:"Thai Stick, Thai Sativa", hunter:false, desc:"Thai stick — cannabis buds tied to a bamboo stick with cannabis fiber — was the most potent product available on the American black market in the 1970s. True Thai sativa is among the most extreme expressions of the species: 14-16 week flowering, enormous plants, intensely cerebral highs.", seeds:"Thai genetics are present in virtually all Haze varieties. Neville Schoenmakers of the Seed Bank brought Thai genetics to Europe in the 1980s, crossing them with Afghan indicas to create faster-flowering hybrids." },
      { name:"Cambodia", region:"Southeast Asia", lat:12.6, lng:104.9, type:"landrace", strains:"Cambodian, Khmer Gold", hunter:true, desc:"Cambodian landrace genetics were collected by Strain Hunters near the Thai border — pure sativas growing wild along river banks. Cambodian strains are notable for their extremely fast flowering time for a sativa — 9-10 weeks — making them invaluable for breeding.", seeds:"Strain Hunters collected Cambodian genetics in their Southeast Asia expedition. These seeds were used to develop FastBud and other fast-flowering sativa hybrids at Green House Seeds." },
      { name:"Ethiopia — Kaffa", region:"East Africa", lat:7.3, lng:36.4, type:"landrace", strains:"Ethiopian Landrace, Kaffa Kush", hunter:true, desc:"Ethiopia's Kaffa region — the birthplace of coffee — also harbors ancient cannabis landraces. Strain Hunters Season 4 (2012) documented their Ethiopia expedition, collecting genetics from cannabis growing wild at high altitude in near-inaccessible mountain terrain.", seeds:"Ethiopian genetics showed remarkable resistance to mold and pests, making them valuable for breeding outdoor-hardy varieties. Franco Loja considered Ethiopia one of the most important landrace gene pools." },
      { name:"Congo / DRC", region:"Central Africa", lat:-4.3, lng:15.3, type:"landrace", strains:"Congolese Sativa", hunter:true, desc:"Strain Hunters Season 5 (2013) was among their most dangerous expeditions — venturing deep into the Democratic Republic of Congo to collect landrace genetics. Congolese sativa is one of the tallest cannabis plants in the world, reaching 5-6 meters in the wild.", seeds:"Congolese genetics are the longest-flowering cannabis in existence — some phenotypes require 20+ weeks. They represent an extreme end of the sativa spectrum and are used to introduce equatorial traits to breeding programs." },
      { name:"Malawi — Lake Malawi Region", region:"Southern Africa", lat:-13.2, lng:34.3, type:"landrace", strains:"Malawi Gold", hunter:true, desc:"Malawi Gold is one of Africa's most legendary cannabis varieties — grown on the shores of Lake Malawi by the Chewa people for centuries. It's traditionally rolled into enormous 'cobs' — compressed cylinders of cannabis — and slowly smoked or used in ceremonies.", seeds:"Strain Hunters documented Malawi in their Africa expedition. Malawi Gold is a pure sativa with an unusual fruity sweetness. The genetics have been used by Dutch breeders to add tropical fruit notes to modern hybrids." },
      { name:"Eswatini — Swazi Highlands", region:"Southern Africa", lat:-26.5, lng:31.5, type:"landrace", strains:"Swazi Gold, Swazi Red", hunter:true, desc:"Swazi Gold from the Kingdom of Eswatini (formerly Swaziland) is a legendary African sativa — harvested at the peak of the dry season, naturally shade-dried, and rolled into premium braids by local farmers. Strain Hunters Season 3 (2011) documented the Swazi Gold harvest.", seeds:"Swazi Gold was among the most prized cannabis on the South African market for decades. The genetics are prized for their exceptional flavor — sweet, fruity, and spicy simultaneously." },
      { name:"Hawaii — Maui", region:"Pacific Islands", lat:20.8, lng:-156.3, type:"landrace", strains:"Maui Wowie, Hawaiian", hunter:false, desc:"Hawaii developed its own distinct cannabis culture from a mix of southeast Asian genetics brought by immigrant workers. Maui Wowie became one of the first American luxury cannabis brands of the 1970s — an uplifting, tropical sativa prized for its pineapple and citrus aroma.", seeds:"Hawaiian genetics contributed significantly to the development of tropical-fruity terpene profiles in modern strains. Maui Wowie was a prized mother plant in early Californian breeding programs." },
      { name:"Amsterdam — Seed Bank Hub", region:"Netherlands", lat:52.4, lng:4.9, type:"modern", strains:"Skunk #1, Northern Lights, White Widow, Haze", hunter:false, desc:"Amsterdam became the epicenter of modern cannabis breeding in the 1980s. The Seed Bank (later Sensi Seeds), Green House Seeds, and Dutch Passion developed the first stabilized, commercially available cannabis varieties by crossing landraces from Afghanistan, Colombia, Mexico, Thailand, and beyond.", seeds:"The Dutch Golden Age of cannabis breeding (1985-2000) created the genetic foundation of virtually every modern strain. Skunk #1, Northern Lights, Haze, White Widow — all developed in Amsterdam from landrace crosses." },
      { name:"Northern California — Emerald Triangle", region:"USA", lat:40.5, lng:-123.5, type:"modern", strains:"OG Kush, Girl Scout Cookies, Zkittlez", hunter:false, desc:"The Emerald Triangle (Humboldt, Mendocino, Trinity counties) became America's cannabis farming heartland during prohibition. California then became the epicenter of modern strain development — OG Kush, Girl Scout Cookies, Gelato, and Zkittlez were all developed here, creating the flavor-forward genetics that now dominate global markets.", seeds:"California moved cannabis breeding from yield-focused to terpene-focused. The state's medical dispensary system created a competitive market that rewarded unique flavors and effects, driving an explosion of new genetic diversity." }
    ];

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cannabis History & Origins — Cannascenti Encyclopedia</title>
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
.globe-section{background:rgba(0,0,0,0.3);border-bottom:1px solid rgba(82,183,136,0.12);padding:60px 0 0;margin-bottom:0}
.globe-section-inner{max-width:1100px;margin:0 auto;padding:0 32px}
.globe-wrap{display:grid;grid-template-columns:1fr 380px;gap:32px;align-items:start;padding-bottom:40px}
#globeCanvas{display:block;cursor:grab;border-radius:50%;background:transparent}
#globeCanvas:active{cursor:grabbing}
.globe-panel{padding:24px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:14px;min-height:340px}
.globe-panel-default{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;height:100%;min-height:300px;gap:12px;color:rgba(242,234,216,0.4);font-size:.85rem}
.globe-panel-default-icon{font-size:36px;margin-bottom:8px}
.gp-region{font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:#52B788;margin-bottom:6px}
.gp-name{font-family:'Cormorant Garamond',serif;font-size:1.6rem;font-weight:300;color:#F2EAD8;margin-bottom:4px;line-height:1.2}
.gp-type{display:inline-block;font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;border-radius:20px;padding:3px 10px;margin-bottom:14px;font-weight:600}
.gp-desc{font-size:.82rem;line-height:1.75;color:rgba(242,234,216,0.65);margin-bottom:14px}
.gp-seeds{font-size:.78rem;line-height:1.7;color:rgba(82,183,136,0.85);border-top:1px solid rgba(255,255,255,0.07);padding-top:12px;margin-top:4px}
.gp-strains{font-size:.75rem;color:rgba(242,234,216,0.45);margin-top:8px;font-style:italic}
.globe-legend{display:flex;gap:20px;flex-wrap:wrap;margin:0 32px 0;padding:14px 0;border-top:1px solid rgba(255,255,255,0.06);max-width:1100px;margin:0 auto}
.legend-item{display:flex;align-items:center;gap:7px;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:rgba(242,234,216,0.5)}
.legend-dot{width:10px;height:10px;border-radius:50%}
.hist-filter{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:36px}
.hf-btn{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:6px 16px;color:rgba(242,234,216,0.6);font-family:Montserrat,sans-serif;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .2s}
.hf-btn.active,.hf-btn:hover{border-color:#52B788;color:#52B788;background:rgba(82,183,136,0.08)}
.hist-timeline{display:flex;flex-direction:column;gap:0}
.hist-event{display:grid;grid-template-columns:100px 1fr;gap:0;opacity:1;transition:opacity .2s}
.hist-event.hidden{display:none}
.hist-left{text-align:right;padding-right:24px;padding-top:4px;position:relative}
.hist-left::after{content:'';position:absolute;right:-1px;top:8px;width:2px;height:100%;background:rgba(255,255,255,0.07)}
.hist-date{font-family:'Cormorant Garamond',serif;font-size:1rem;font-weight:300;color:rgba(242,234,216,0.6)}
.hist-era{font-size:.65rem;letter-spacing:.08em;text-transform:uppercase;color:rgba(242,234,216,0.3);margin-top:2px}
.hist-right{padding:0 0 36px 24px;position:relative}
.hist-right::before{content:'';position:absolute;left:-5px;top:8px;width:10px;height:10px;border-radius:50%;background:#52B788;border:2px solid #060d0a}
.hist-tag{display:inline-block;font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;border-radius:20px;padding:2px 9px;margin-bottom:8px;font-weight:600}
.hist-title{font-family:'Cormorant Garamond',serif;font-size:1.2rem;font-weight:400;margin-bottom:6px}
.hist-body{font-size:.83rem;line-height:1.7;color:rgba(242,234,216,0.65)}
@media(max-width:700px){.globe-wrap{grid-template-columns:1fr}.globe-panel{min-height:auto}}
@media(max-width:480px){.hist-event{grid-template-columns:70px 1fr}}
</style>
</head>
<body>
${ENC_NAV}

<div class="globe-section">
  <div class="globe-section-inner">
    <div class="enc-page-header" style="padding-top:0;margin-bottom:32px">
      <div class="enc-label">✦ Cannascenti Encyclopedia</div>
      <h1 class="enc-title">Cannabis <em>origins &amp; lineages.</em></h1>
      <p class="enc-desc">Every strain traces back to a specific place on earth. Drag the globe. Click any marker to explore the landrace genetics, Strain Hunters expeditions, and the journey from wild plant to modern variety.</p>
    </div>
    <div class="globe-wrap">
      <div>
        <canvas id="globeCanvas" width="480" height="480"></canvas>
      </div>
      <div class="globe-panel" id="globePanel">
        <div class="globe-panel-default">
          <div class="globe-panel-default-icon">🌍</div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:1.1rem;color:rgba(242,234,216,0.6)">Drag to rotate</div>
          <div>Click any glowing marker to explore the origin story, strain lineage, and Strain Hunters expeditions from that location.</div>
        </div>
      </div>
    </div>
    <div class="globe-legend" style="padding:14px 32px;border-top:1px solid rgba(255,255,255,0.06);display:flex;gap:20px;flex-wrap:wrap;max-width:1100px;margin:0 auto">
      <div class="legend-item"><div class="legend-dot" style="background:#C9973A"></div>Ancient Origin</div>
      <div class="legend-item"><div class="legend-dot" style="background:#52B788"></div>Landrace</div>
      <div class="legend-item"><div class="legend-dot" style="background:#E05C5C;box-shadow:0 0 6px #E05C5C"></div>Strain Hunters Expedition</div>
      <div class="legend-item"><div class="legend-dot" style="background:#5B8DD9"></div>Modern Hub</div>
    </div>
  </div>
</div>

<div class="enc-page">
  <div style="margin-bottom:48px">
    <div class="enc-label" style="margin-top:48px">✦ The Full Timeline</div>
    <h2 style="font-family:'Cormorant Garamond',serif;font-size:clamp(1.5rem,4vw,2.4rem);font-weight:300;color:#F2EAD8;line-height:1.2;margin-bottom:8px">10,000 years of <em style="color:#52B788">cannabis history.</em></h2>
    <p style="font-size:.9rem;color:rgba(242,234,216,0.55);line-height:1.7">From ancient Taiwan to modern federal rescheduling. Filter by category to explore specific threads.</p>
  </div>
  <div class="hist-filter">
    <button class="hf-btn active" onclick="filterHist('all',this)">All</button>
    <button class="hf-btn" onclick="filterHist('ancient',this)">Ancient</button>
    <button class="hf-btn" onclick="filterHist('medicine',this)">Medicine</button>
    <button class="hf-btn" onclick="filterHist('culture',this)">Culture</button>
    <button class="hf-btn" onclick="filterHist('prohibition',this)">Prohibition</button>
    <button class="hf-btn" onclick="filterHist('science',this)">Science</button>
    <button class="hf-btn" onclick="filterHist('legalization',this)">Legalization</button>
  </div>
  <div class="hist-timeline" id="histTimeline"></div>
</div>

<script>
var HE = ${JSON.stringify(_HE)};
var TAG_COLORS = ${JSON.stringify(tagColors)};
var ORIGINS = ${JSON.stringify(_ORIGINS)};

// ── Timeline ──────────────────────────────────────────────────────────────
function filterHist(tag,btn){
  document.querySelectorAll('.hf-btn').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  document.querySelectorAll('.hist-event').forEach(function(ev){
    ev.classList.toggle('hidden', tag!=='all' && ev.dataset.tag!==tag);
  });
}
document.addEventListener('DOMContentLoaded',function(){
  document.getElementById('histTimeline').innerHTML=HE.map(function(e){
    var col=TAG_COLORS[e.tag]||'#52B788';
    return '<div class="hist-event" data-tag="'+e.tag+'">'+
      '<div class="hist-left"><div class="hist-date">'+e.date+'</div><div class="hist-era">'+e.era+'</div></div>'+
      '<div class="hist-right">'+
        '<span class="hist-tag" style="background:'+col+'22;color:'+col+'">'+e.tag+'</span>'+
        '<div class="hist-title">'+e.title+'</div>'+
        '<p class="hist-body">'+e.body+'</p>'+
      '</div>'+
    '</div>';
  }).join('');
});

// ── Globe ─────────────────────────────────────────────────────────────────
(function(){
  var canvas = document.getElementById('globeCanvas');
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  var cx = W/2, cy = H/2, R = W*0.42;

  // Rotation state
  var rotY = -0.3, rotX = 0.25;
  var dragging = false, lastMX = 0, lastMY = 0;
  var autoSpin = true;
  var hoveredIdx = -1;
  var animFrame;

  // Type colors
  var TYPE_COLOR = { ancient:'#C9973A', landrace:'#52B788', modern:'#5B8DD9' };
  var HUNTER_COLOR = '#E05C5C';

  function getColor(o){ return o.hunter ? HUNTER_COLOR : (TYPE_COLOR[o.type]||'#52B788'); }

  // Simplified continent outlines as lat/lng polylines
  // [lat, lng] pairs, null = pen up
  var LAND = [
    // North America outline (simplified)
    [[83,-60],[75,-85],[72,-95],[65,-168],[60,-165],[55,-130],[45,-124],[32,-117],[22,-105],[15,-92],[8,-77],[12,-82],[18,-87],[22,-90],[25,-90],[30,-89],[29,-95],[26,-97],[25,-80],[28,-80],[35,-75],[42,-70],[47,-67],[50,-64],[55,-60],[60,-64],[68,-68],[72,-75],[75,-80],[78,-73],[83,-60]],
    // Greenland (simplified)
    [[83,-45],[77,-18],[72,-22],[65,-38],[63,-50],[68,-52],[75,-57],[83,-45]],
    // South America (simplified)
    [[12,-72],[10,-62],[8,-60],[5,-52],[0,-50],[-5,-35],[-10,-37],[-15,-39],[-20,-40],[-25,-48],[-34,-58],[-41,-63],[-52,-68],[-55,-65],[-52,-58],[-45,-65],[-40,-62],[-35,-58],[-28,-49],[-22,-42],[-15,-39],[-10,-36],[-5,-35],[0,-50],[4,-51],[8,-60],[10,-62],[12,-72]],
    // Europe (simplified)
    [[71,28],[65,14],[58,5],[50,2],[46,-1],[44,-8],[37,-8],[35,-5],[36,3],[38,13],[40,18],[42,13],[44,16],[47,10],[48,17],[54,18],[57,22],[60,25],[65,27],[68,28],[71,28]],
    // Scandinavia
    [[57,8],[59,5],[62,5],[65,14],[71,25],[70,30],[65,27],[60,25],[57,8]],
    // Africa (simplified)
    [[37,10],[32,12],[26,33],[12,43],[5,40],[0,41],[-5,40],[-12,37],[-18,35],[-25,33],[-34,26],[-34,18],[-28,16],[-22,14],[-15,12],[-5,10],[0,8],[5,1],[4,-9],[6,-11],[10,-15],[15,-17],[18,-16],[22,-17],[28,-13],[30,-9],[35,0],[37,10]],
    // Asia (simplified)
    [[71,28],[68,35],[65,40],[60,58],[55,73],[50,80],[45,75],[40,65],[35,59],[25,57],[22,59],[12,45],[5,40],[12,43],[26,33],[32,12],[37,10],[40,28],[42,36],[45,38],[42,48],[38,48],[36,52],[32,48],[28,49],[25,57],[30,68],[35,75],[40,76],[45,82],[50,80],[55,73],[60,58],[65,60],[68,65],[71,70],[74,80],[72,102],[65,110],[60,115],[55,132],[50,140],[43,131],[40,125],[35,119],[25,121],[20,110],[10,105],[5,103],[1,104],[5,100],[10,98],[16,98],[20,92],[22,92],[24,90],[26,89],[28,88],[32,78],[30,73],[25,68],[24,68],[22,70],[20,73],[15,74],[10,76],[8,77],[5,80],[8,80],[15,80],[20,73],[25,68],[30,73],[35,75],[40,76],[45,82],[50,80]],
    // Australia (simplified)
    [[-16,136],[-12,131],[-14,126],[-20,119],[-28,114],[-34,115],[-38,145],[-38,148],[-34,151],[-28,153],[-22,150],[-18,146],[-16,136]],
    // Japan
    [[45,141],[42,140],[36,136],[34,131],[34,135],[38,141],[40,141],[42,141],[45,141]],
    // UK (simplified)
    [[58,-5],[52,-5],[50,0],[52,2],[55,2],[58,-4],[58,-5]],
    // Indonesia (simplified)
    [[-5,105],[0,110],[0,120],[-2,130],[-5,105]],
    // New Zealand (simplified)
    [[-34,172],[-38,175],[-46,168],[-44,170],[-40,176],[-36,174],[-34,172]],
    // Madagascar
    [[-12,49],[-16,44],[-20,44],[-25,47],[-25,48],[-20,48],[-16,49],[-12,49]],
    // Philippines (simplified)
    [[18,122],[15,120],[10,124],[8,126],[10,126],[15,122],[18,122]],
    // Sri Lanka
    [[8,80],[6,80],[6,81],[8,81],[8,80]]
  ];

  function project(lat, lng) {
    var latR = lat * Math.PI / 180;
    var lngAdj = lng - rotY * 180 / Math.PI;
    var lngR = lngAdj * Math.PI / 180;
    var cosLat = Math.cos(latR), sinLat = Math.sin(latR);
    var cosLng = Math.cos(lngR), sinLng = Math.sin(lngR);
    var cosX = Math.cos(rotX), sinX = Math.sin(rotX);
    var x3 = cosLat * sinLng;
    var y3 = sinLat * cosX - cosLat * cosLng * sinX;
    var z3 = sinLat * sinX + cosLat * cosLng * cosX;
    return { x: cx + R * x3, y: cy - R * y3, z: z3 };
  }

  function drawFrame() {
    ctx.clearRect(0, 0, W, H);

    // Outer glow
    var outerGlow = ctx.createRadialGradient(cx, cy, R*0.9, cx, cy, R*1.15);
    outerGlow.addColorStop(0, 'rgba(82,183,136,0.06)');
    outerGlow.addColorStop(1, 'rgba(82,183,136,0)');
    ctx.beginPath(); ctx.arc(cx, cy, R*1.15, 0, Math.PI*2);
    ctx.fillStyle = outerGlow; ctx.fill();

    // Sphere base
    var grad = ctx.createRadialGradient(cx - R*0.25, cy - R*0.25, 0, cx, cy, R);
    grad.addColorStop(0, '#132b1d');
    grad.addColorStop(0.6, '#0a1a10');
    grad.addColorStop(1, '#040c07');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2);
    ctx.fillStyle = grad; ctx.fill();

    // Clip to sphere for land + grid
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2); ctx.clip();

    // Latitude grid lines
    for (var lat = -60; lat <= 60; lat += 30) {
      ctx.beginPath();
      var pen = false;
      for (var lg = -180; lg <= 180; lg += 3) {
        var p = project(lat, lg);
        if (p.z > 0) { if (!pen) { ctx.moveTo(p.x, p.y); pen = true; } else ctx.lineTo(p.x, p.y); }
        else { pen = false; }
      }
      ctx.strokeStyle = 'rgba(82,183,136,0.08)'; ctx.lineWidth = 0.5; ctx.stroke();
    }
    // Longitude grid lines
    for (var lng2 = -180; lng2 < 180; lng2 += 30) {
      ctx.beginPath();
      var pen2 = false;
      for (var la = -80; la <= 80; la += 3) {
        var p = project(la, lng2);
        if (p.z > 0) { if (!pen2) { ctx.moveTo(p.x, p.y); pen2 = true; } else ctx.lineTo(p.x, p.y); }
        else { pen2 = false; }
      }
      ctx.strokeStyle = 'rgba(82,183,136,0.08)'; ctx.lineWidth = 0.5; ctx.stroke();
    }

    // Draw land
    for (var li = 0; li < LAND.length; li++) {
      var poly = LAND[li];
      ctx.beginPath();
      var started = false;
      for (var pi = 0; pi < poly.length; pi++) {
        var pt = project(poly[pi][0], poly[pi][1]);
        if (pt.z > 0) {
          if (!started) { ctx.moveTo(pt.x, pt.y); started = true; }
          else ctx.lineTo(pt.x, pt.y);
        } else {
          started = false;
        }
      }
      ctx.fillStyle = 'rgba(82,183,136,0.18)';
      ctx.strokeStyle = 'rgba(82,183,136,0.35)';
      ctx.lineWidth = 0.7;
      ctx.fill(); ctx.stroke();
    }

    ctx.restore();

    // Sphere edge highlight
    var edgeGrad = ctx.createRadialGradient(cx - R*0.3, cy - R*0.3, R*0.5, cx, cy, R);
    edgeGrad.addColorStop(0, 'rgba(255,255,255,0)');
    edgeGrad.addColorStop(0.85, 'rgba(255,255,255,0)');
    edgeGrad.addColorStop(1, 'rgba(82,183,136,0.12)');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(82,183,136,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = edgeGrad; ctx.fill();

    // Specular highlight
    var spec = ctx.createRadialGradient(cx - R*0.35, cy - R*0.35, 0, cx - R*0.2, cy - R*0.2, R*0.4);
    spec.addColorStop(0, 'rgba(255,255,255,0.07)');
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2);
    ctx.fillStyle = spec; ctx.fill();

    // Draw markers (back first, then front)
    var visible = [];
    for (var oi = 0; oi < ORIGINS.length; oi++) {
      var o = ORIGINS[oi];
      var p = project(o.lat, o.lng);
      if (p.z > -0.1) visible.push({ o:o, p:p, i:oi });
    }
    visible.sort(function(a,b){ return a.p.z - b.p.z; });

    for (var vi = 0; vi < visible.length; vi++) {
      var v = visible[vi];
      var col = getColor(v.o);
      var isHovered = hoveredIdx === v.i;
      var r = isHovered ? 7 : 5;
      var alpha = 0.4 + v.p.z * 0.6;

      if (v.p.z > 0) {
        // Glow
        var glowR = isHovered ? 22 : 14;
        var glow = ctx.createRadialGradient(v.p.x, v.p.y, 0, v.p.x, v.p.y, glowR);
        glow.addColorStop(0, col.replace('#', 'rgba(').replace(/(..)(..)(..)/, function(m,r,g,b){ return parseInt(r,16)+','+parseInt(g,16)+','+parseInt(b,16); })+','+(isHovered?'0.7':'0.45')+')');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        // simpler: just use rgba approximation
        ctx.beginPath(); ctx.arc(v.p.x, v.p.y, glowR, 0, Math.PI*2);
        ctx.fillStyle = col+'44'; ctx.fill();

        // Dot
        ctx.beginPath(); ctx.arc(v.p.x, v.p.y, r, 0, Math.PI*2);
        ctx.fillStyle = col;
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Pulse ring for hovered
        if (isHovered) {
          ctx.beginPath(); ctx.arc(v.p.x, v.p.y, 12, 0, Math.PI*2);
          ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5; ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // Strain Hunters star marker
        if (v.o.hunter) {
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 8px sans-serif';
          ctx.fillText('SH', v.p.x - 6, v.p.y + 3);
        }
      }
    }
  }

  function tick() {
    if (autoSpin && !dragging) rotY += 0.003;
    drawFrame();
    animFrame = requestAnimationFrame(tick);
  }

  // Interaction
  function getPos(e) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = W / rect.width, scaleY = H / rect.height;
    var clientX = e.touches ? e.touches[0].clientX : e.clientX;
    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  canvas.addEventListener('mousedown', function(e){ dragging=true; autoSpin=false; var pos=getPos(e); lastMX=pos.x; lastMY=pos.y; });
  canvas.addEventListener('touchstart', function(e){ e.preventDefault(); dragging=true; autoSpin=false; var pos=getPos(e); lastMX=pos.x; lastMY=pos.y; }, {passive:false});
  window.addEventListener('mouseup', function(){ dragging=false; });
  window.addEventListener('touchend', function(){ dragging=false; });
  window.addEventListener('mousemove', function(e){
    if (!dragging) {
      var pos = getPos(e);
      var found = -1;
      for (var i=0; i<ORIGINS.length; i++) {
        var p = project(ORIGINS[i].lat, ORIGINS[i].lng);
        if (p.z > 0) {
          var dx = p.x - pos.x, dy = p.y - pos.y;
          if (Math.sqrt(dx*dx+dy*dy) < 14) { found = i; break; }
        }
      }
      if (hoveredIdx !== found) { hoveredIdx = found; canvas.style.cursor = found>=0 ? 'pointer' : 'grab'; }
      return;
    }
    var pos = getPos(e);
    rotY += (pos.x - lastMX) * 0.008;
    rotX += (pos.y - lastMY) * 0.005;
    rotX = Math.max(-1.2, Math.min(1.2, rotX));
    lastMX = pos.x; lastMY = pos.y;
  });
  window.addEventListener('touchmove', function(e){
    if (!dragging) return;
    e.preventDefault();
    var pos = getPos(e);
    rotY += (pos.x - lastMX) * 0.008;
    rotX += (pos.y - lastMY) * 0.005;
    rotX = Math.max(-1.2, Math.min(1.2, rotX));
    lastMX = pos.x; lastMY = pos.y;
  }, {passive:false});

  canvas.addEventListener('click', function(e){
    var pos = getPos(e);
    for (var i=0; i<ORIGINS.length; i++) {
      var p = project(ORIGINS[i].lat, ORIGINS[i].lng);
      if (p.z > 0) {
        var dx = p.x - pos.x, dy = p.y - pos.y;
        if (Math.sqrt(dx*dx+dy*dy) < 16) {
          showOrigin(i);
          autoSpin = false;
          // Spin globe to center on marker
          var targetLng = ORIGINS[i].lng;
          rotY = -targetLng * Math.PI / 180;
          rotX = ORIGINS[i].lat * Math.PI / 180 * 0.5;
          return;
        }
      }
    }
  });

  function showOrigin(idx) {
    var o = ORIGINS[idx];
    var col = getColor(o);
    var typeLabel = o.type === 'ancient' ? 'Ancient Origin' : o.type === 'modern' ? 'Modern Hub' : 'Landrace';
    var hunterBadge = o.hunter ? '<span style="display:inline-block;background:#E05C5C22;color:#E05C5C;border-radius:20px;padding:2px 9px;font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;font-weight:600;margin-left:6px">Strain Hunters</span>' : '';
    document.getElementById('globePanel').innerHTML =
      '<div class="gp-region">'+o.region+'</div>'+
      '<div class="gp-name">'+o.name+'</div>'+
      '<span class="gp-type" style="background:'+col+'22;color:'+col+'">'+typeLabel+'</span>'+hunterBadge+
      '<div class="gp-desc">'+o.desc+'</div>'+
      '<div class="gp-seeds">'+o.seeds+'</div>'+
      '<div class="gp-strains">Known strains: '+o.strains+'</div>';
  }

  // Resize canvas to fit container
  function resizeCanvas() {
    var maxW = Math.min(480, canvas.parentElement.offsetWidth - 32);
    canvas.style.width = maxW + 'px';
    canvas.style.height = maxW + 'px';
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  tick();
})();
</script>
</body></html>`;
    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /extractions ──────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/extractions") {
    const _EM = [
      { tier:"solventless", name:"Ice Water Hash", sub:"Bubble hash · Cold water agitation", quality:"★★★★★", solvent:"None", yield:"3–8%", safety:"Completely safe", desc:"One of the oldest concentrate forms. Cannabis is agitated in ice water, causing trichome heads to break off and sink. Collected through a series of mesh bags in increasingly fine micron sizes. Full-melt 6-star ice water hash is among the purest expressions of the plant.", notes:"The 73 and 90 micron bags produce the finest heads-only hash. Freeze-drying has revolutionized water hash quality, preserving terpenes that were lost in traditional air-drying." },
      { tier:"solventless", name:"Rosin", sub:"Heat + pressure extraction · Solventless concentrate", quality:"★★★★★", solvent:"None", yield:"10–25% (flower), 40–70% (hash)", safety:"Completely safe", desc:"Rosin is produced by applying heat and pressure to cannabis flower, kief, or ice water hash — squeezing out a sap-like concentrate. Zero solvents, instant results, full spectrum, and exceptional flavor.", notes:"Hash rosin from 6-star water hash is the most prized concentrate in the current market. Pressing at 160°F for 90 seconds yields the most terpene-rich, flavorful product. Dab at 450°F max." },
      { tier:"solventless", name:"Dry Sift", sub:"Mechanical trichome separation · Kief collection", quality:"★★★★☆", solvent:"None", yield:"5–15%", safety:"Completely safe", desc:"The most ancient form of concentration — mechanically separating trichome heads from plant material through screens. Quality ranges from full-plant kief to hyper-refined 'pure gold' dry sift that rivals the best hash in purity.", notes:"Traditional Moroccan dry sift is worked with bare hands, using body heat to cold-press the kief into the dark exterior, lighter interior slabs. The smell and flavor of properly made dry sift is irreplaceable." },
      { tier:"solvent", name:"BHO / PHO", sub:"Butane or Propane Hash Oil · Hydrocarbon extraction", quality:"★★★★★", solvent:"Butane / Propane", yield:"15–30%", safety:"Professional use only — explosion risk", desc:"Hydrocarbon extraction uses butane or propane to strip cannabinoids and terpenes from plant material. The most versatile extraction method — produces everything from shatter to live resin, budder, wax, and sauce.", notes:"Live resin BHO — made from fresh-frozen cannabis — preserves a terpene profile closer to the living plant than any other method. The gold standard for terpene-forward concentrates at scale." },
      { tier:"solvent", name:"CO2 Extraction", sub:"Supercritical carbon dioxide extraction", quality:"★★★★☆", solvent:"CO2 (no residue)", yield:"10–20%", safety:"Safe — no flammable solvents", desc:"CO2 becomes supercritical under specific temperature and pressure conditions, making it an effective solvent. Highly selective, tunable extraction that leaves no solvent residue. The dominant method for oil cartridges and commercial extract production.", notes:"CO2 oil has lower terpene content than hydrocarbon extracts but is more consumer-safe and infinitely scalable. Most vape cartridges use CO2 oil with added botanical terpenes." },
      { tier:"solvent", name:"Ethanol Extraction", sub:"High-proof alcohol wash · QWET / QWISO", quality:"★★★☆☆", solvent:"Food-grade ethanol", yield:"15–25%", safety:"Flammable — ventilation required", desc:"Ethanol is a food-safe solvent that efficiently extracts cannabinoids and terpenes. Quick-wash ethanol extraction (QWET) minimizes chlorophyll and lipid co-extraction. The preferred method for large-scale edibles production and RSO.", notes:"RSO (Rick Simpson Oil) is full-spectrum ethanol extract consumed orally for cancer treatment in alternative medicine contexts. The scientific evidence is limited but the cultural significance is substantial." },
      { tier:"solvent", name:"Distillate", sub:"Fractional distillation · THC isolate", quality:"★★★☆☆", solvent:"Process-dependent", yield:"Depends on source oil", safety:"Safe — final product is solvent-free", desc:"Distillate is the final step in refining cannabis oil — short-path fractional distillation purifies and concentrates specific cannabinoids to 90%+ purity. Nearly odorless and tasteless on its own. The backbone of the commercial vape cartridge industry.", notes:"Distillate is a blank canvas. High-quality live resin cartridges use the actual plant terpenes instead of added botanical terpenes." },
      { tier:"traditional", name:"Charas", sub:"Hand-rubbed live resin · Ancient Indian tradition", quality:"★★★★☆", solvent:"None", yield:"Very low — grams per hour", safety:"Completely safe", desc:"The oldest known concentrate. Made by rubbing fresh, living cannabis plants between the palms, collecting the resin that adheres to the hands. Because it's made from living plant material, charas preserves terpene compounds that are destroyed during the drying process.", notes:"Malana Cream from the Parvati Valley is considered among the finest charas in the world. The isolation of the village and the specific landrace genetics create a product that cannot be replicated elsewhere." }
    ];
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Extractions & Concentrates — Cannascenti Encyclopedia</title>
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
.ext-filter{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:28px}
.ext-btn{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:6px 18px;color:rgba(242,234,216,0.6);font-family:Montserrat,sans-serif;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .2s}
.ext-btn.active,.ext-btn:hover{border-color:#52B788;color:#52B788;background:rgba(82,183,136,0.08)}
.ext-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px}
.ext-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:28px;transition:all .2s}
.ext-card.hidden{display:none}
.ext-name{font-family:'Cormorant Garamond',serif;font-size:1.4rem;font-weight:400;margin-bottom:4px}
.ext-sub{font-size:.75rem;color:rgba(242,234,216,0.4);margin-bottom:12px}
.ext-meta{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.ext-meta-item{font-size:.72rem;background:rgba(255,255,255,0.05);border-radius:6px;padding:3px 9px;color:rgba(242,234,216,0.55)}
.ext-quality{color:#F5C842;letter-spacing:.1em}
.ext-tier{font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;border-radius:12px;padding:2px 8px;font-weight:600}
.ext-tier.solventless{background:rgba(82,183,136,0.15);color:#52B788}
.ext-tier.solvent{background:rgba(232,168,76,0.15);color:#E8A84C}
.ext-tier.traditional{background:rgba(155,114,207,0.15);color:#9B72CF}
.ext-desc{font-size:.84rem;line-height:1.7;color:rgba(242,234,216,0.7);margin-bottom:12px}
.ext-notes{font-size:.8rem;line-height:1.65;color:rgba(242,234,216,0.45);border-left:2px solid rgba(82,183,136,0.25);padding-left:12px;font-style:italic}
</style>
</head>
<body>
${ENC_NAV}
<div class="enc-page">
  <div class="enc-page-header">
    <div class="enc-label">✦ Cannascenti Encyclopedia</div>
    <h1 class="enc-title">Extractions & <em>concentrates.</em></h1>
    <p class="enc-desc">From ancient charas to modern live rosin — every extraction method explained. Solvent vs. solventless, traditional vs. modern craft, full melt vs. distillate. The definitive guide to cannabis concentrates.</p>
  </div>
  <div class="ext-filter">
    <button class="ext-btn active" onclick="filterExt('all',this)">All</button>
    <button class="ext-btn" onclick="filterExt('solventless',this)">Solventless</button>
    <button class="ext-btn" onclick="filterExt('solvent',this)">Solvent-Based</button>
    <button class="ext-btn" onclick="filterExt('traditional',this)">Traditional</button>
  </div>
  <div class="ext-grid" id="extGrid"></div>
</div>
<script>
var EM = ${JSON.stringify(_EM)};
function filterExt(tier,btn){
  document.querySelectorAll('.ext-btn').forEach(function(b){b.classList.remove('active');});
  btn.classList.add('active');
  document.querySelectorAll('.ext-card').forEach(function(c){
    c.classList.toggle('hidden', tier!=='all' && c.dataset.tier!==tier);
  });
}
document.addEventListener('DOMContentLoaded',function(){
  document.getElementById('extGrid').innerHTML=EM.map(function(m){
    return '<div class="ext-card" data-tier="'+m.tier+'">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">'+
        '<div class="ext-name">'+m.name+'</div>'+
        '<span class="ext-tier '+m.tier+'">'+m.tier+'</span>'+
      '</div>'+
      '<div class="ext-sub">'+m.sub+'</div>'+
      '<div class="ext-meta">'+
        '<span class="ext-meta-item">'+m.quality+'</span>'+
        '<span class="ext-meta-item">Yield: '+m.yield+'</span>'+
        '<span class="ext-meta-item">'+m.solvent+'</span>'+
      '</div>'+
      '<p class="ext-desc">'+m.desc+'</p>'+
      '<p class="ext-notes">'+m.notes+'</p>'+
    '</div>';
  }).join('');
});
</script>
</body></html>`;
    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /concentrates ─────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/concentrates") {
    const _CONC = [
      // ── TRADITIONAL ──
      { id:"charas", cat:"traditional", tier:1, name:"Charas", sub:"Hand-rubbed live resin", potency:"40–60%", purity:55, color:"#8B5E3C",
        badge:"Ancient", origin:"India · Nepal · Pakistan",
        desc:"The oldest concentrate on earth. Made by slowly rubbing fresh, living cannabis plants between bare palms. Resin adheres to the skin and is collected into dark, pliable balls. Because it's made from the living plant, charas preserves volatile terpene compounds destroyed during drying.",
        method:"Fresh plant material is rubbed between hands for hours. Body heat gently warms the trichomes, allowing them to adhere to skin. Collected resin is then rolled into balls or sticks.",
        consume:"Roll small pieces into a chillum or mix with tobacco in a spliff. Traditional consumption is in a clay chillum with a wet cloth filter. Dab at low temp (450–500°F) for the cleanest flavor.",
        note:"Malana Cream from Himachal Pradesh's Parvati Valley is the most prized charas in the world. The village of Malana has been cultivating the same landrace for over 500 years. True Malana Cream is nearly impossible to find outside of India.", flavor:"Earthy · Spicy · Incense · Sandalwood", rating:4 },

      { id:"temple-ball", cat:"traditional", tier:1, name:"Temple Ball Hash", sub:"Pressed hand-rolled charas · Himalayan tradition", potency:"40–65%", purity:58, color:"#6B4C2A",
        badge:"Ancient", origin:"Nepal · Tibet",
        desc:"Temple Balls are large, hand-rolled spheres of charas or dry sift hash, aged and cured for months or years. The exterior oxidizes to a dark, lacquered shell while the interior remains soft and fragrant. They are considered sacred in Himalayan Buddhist culture.",
        method:"High-quality hand-rubbed resin or dry sift is pressed and rolled into spheres, then aged. The aging process concentrates flavor, mellows harshness, and develops complex aromatic compounds not present in fresh hash.",
        consume:"Break off small pieces. Best in a pipe or bong at moderate temperature. The aged exterior has a distinct flavor from the fresh interior — many connoisseurs consume both separately.",
        note:"Traditional Nepalese temple balls were aged alongside butter lamps in monasteries — the warmth and darkness created ideal curing conditions. Modern connoisseurs are reviving the temple ball tradition with solventless hash.", flavor:"Deep Spice · Incense · Dark Fruit · Aged Wood", rating:4 },

      { id:"moroccan-hash", cat:"traditional", tier:1, name:"Moroccan Hash", sub:"Dry sift pressed · Ketama Rif Mountains", potency:"35–55%", purity:50, color:"#C9973A",
        badge:"Traditional", origin:"Morocco · Ketama",
        desc:"The world's most widely produced traditional hash. The Ketama region of Morocco's Rif Mountains has supplied Europe with hash for centuries. The local Beldia landrace is dry-sifted through fine screens, then hand-pressed into slabs with body heat. Ranges from blonde (fresh) to dark brown (aged).",
        method:"Dried cannabis is rubbed or beaten over fine silk or nylon screens. The collected kief falls through as a fine powder, then is pressed with hands or a press — sometimes gently warmed — into slabs or bricks.",
        consume:"Break and crumble into a joint or pipe. Classic European consumption is mixed with tobacco. Moroccan hash softens and becomes workable when warmed between fingers.",
        note:"Traditional Moroccan hash is under threat — European demand for higher-potency product has driven farmers to use hybrid genetics, abandoning the traditional Beldia landrace. Authentic old-school Moroccan hash is increasingly rare.", flavor:"Spicy · Herbal · Earthy · Mild Floral", rating:3 },

      { id:"lebanese", cat:"traditional", tier:1, name:"Lebanese Hash", sub:"Red & Blonde varieties · Bekaa Valley", potency:"30–45%", purity:45, color:"#C47A2A",
        badge:"Traditional", origin:"Lebanon · Bekaa Valley",
        desc:"Lebanese Red and Lebanese Blonde were the most sought-after hashishes in Europe during the 1970s. Produced in the Bekaa Valley from Lebanese landrace genetics — distinctively mild, smooth, and aromatic compared to Moroccan or Afghan varieties. Production declined dramatically during Lebanon's civil war.",
        method:"Similar dry sift process to Moroccan hash but using Lebanese landrace genetics harvested at different stages of ripeness. Red hash is made from more mature material; Blonde from less-ripe flower.",
        consume:"Crumble into a joint or pipe. Lebanese hash is among the mildest traditional hashes — excellent for beginners or daytime use. The smooth, mild smoke is unlike any modern concentrate.",
        note:"Lebanese hash genetics contributed to early Skunk and Dutch strain development. The Bekaa Valley landrace, now rarely grown, had a unique terpene profile — soft, almost floral, with none of the sharp spice of Afghan hash.", flavor:"Mild · Floral · Soft Spice · Honey", rating:3 },

      // ── SOLVENTLESS ──
      { id:"dry-sift", cat:"solventless", tier:2, name:"Dry Sift / Kief", sub:"Mechanical trichome separation", potency:"50–80%", purity:65, color:"#D4B84A",
        badge:"Solventless", origin:"Global",
        desc:"The most elemental form of modern concentration. Dried cannabis is agitated over progressively finer screens, mechanically separating trichome heads from plant material. Quality ranges from basic kief scraped from a grinder to hyper-refined '6-star' full-melt dry sift that rivals the finest water hash.",
        method:"Frozen cannabis is tumbled or hand-sifted over stacked screens of decreasing micron size (220→160→100→73→45μm). Lower micron = purer trichome heads with less plant contamination. Cold temperatures make trichomes more brittle and easier to separate.",
        consume:"Press into hash coins, vaporize in a bowl, or press into rosin. Full-melt dry sift can be dabbed directly. Add to joints for a significant potency increase.",
        note:"The difference between supermarket kief (your grinder's bottom chamber) and hyper-refined 6-star dry sift is enormous. True full-melt dry sift melts completely on a hot nail with no residue — a rare achievement requiring exceptional genetics and technique.", flavor:"Variable · True to Source Strain", rating:4 },

      { id:"ice-water-hash", cat:"solventless", tier:3, name:"Ice Water Hash", sub:"Bubble hash · Cold water agitation", potency:"50–80%", purity:70, color:"#74C6A0",
        badge:"Solventless", origin:"Modern — Global",
        desc:"Cannabis is agitated in ice-cold water, causing trichome heads to break off and sink. Collected through a series of mesh bags in increasingly fine micron sizes (220→160→120→90→73→45→25μm). The gold standard for solventless extraction — zero heat, zero solvents, just ice, water, and agitation.",
        method:"Fresh-frozen or cured cannabis is agitated in ice water (hand-stirring or using a washing machine). Trichomes break off and sink. The mixture is poured through bubble bags of decreasing micron size. Each bag collects different-sized trichome heads — 73μm and 90μm bags produce the finest, purest hash.",
        consume:"Air-dry or freeze-dry, then press into hash or dab. Full-melt grades (4–6 stars) can be dabbed directly. Lower grades are best pressed into rosin or added to bowls.",
        note:"Freeze-drying has revolutionized water hash — traditional air-drying destroys terpenes as the hash oxidizes. Freeze-dried hash retains the full terpene profile of the living plant. A 6-star full-melt freeze-dried hash is among the most complex and flavorful cannabis products in existence.", flavor:"Full-Spectrum · Strain-Specific · Complex", rating:5 },

      { id:"flower-rosin", cat:"solventless", tier:3, name:"Flower Rosin", sub:"Heat + pressure extraction from flower", potency:"60–75%", purity:68, color:"#E8D44D",
        badge:"Solventless", origin:"Modern — Global",
        desc:"Rosin produced by pressing cannabis flower between heated plates. The heat and pressure squeeze out a sap-like concentrate that retains the plant's full terpene profile. Zero solvents, no purging required, immediate results. The most accessible solventless concentrate — can be made at home with a hair straightener.",
        method:"Cannabis flower (ideally fresh-frozen or high-terpene) is placed in a mesh bag and pressed between heated plates (160–220°F) for 30–120 seconds. The squeezed oil collects on parchment paper. Lower temperatures preserve more terpenes; higher temperatures increase yield.",
        consume:"Dab at 450–520°F for full flavor. Cold-start dab recommended — place rosin on a cold nail, then heat slowly. Collect and refrigerate for extended flavor life.",
        note:"Flower rosin is the entry point to solventless — yields are lower (10–20%) than hash rosin but the process requires no equipment beyond a rosin press. Strain selection is critical: high-resin cultivars like Zkittlez, Papaya, and Biscotti produce exceptional flower rosin.", flavor:"Strain-Specific · Fresh · Terpy", rating:4 },

      { id:"hash-rosin", cat:"solventless", tier:4, name:"Hash Rosin", sub:"Pressed from ice water hash · Premium solventless", potency:"70–85%", purity:82, color:"#52B788",
        badge:"Solventless ★", origin:"Modern — USA",
        desc:"The pinnacle of solventless extraction. Ice water hash is pressed into rosin — producing a concentrate with exceptional potency, full-spectrum terpene expression, and zero solvent residue. Hash rosin from 6-star full-melt water hash is the most prized concentrate in the current market.",
        method:"6-star ice water hash is freeze-dried, then pressed in a rosin bag (25–45μm) between heated plates at 150–175°F for 60–90 seconds. The resulting oil is collected and immediately refrigerated or cold-cured. Every step of the process must be executed perfectly — the hash quality determines the rosin quality.",
        consume:"Dab at 440–490°F for maximum flavor. Hash rosin is exceptionally terpy — high temperatures destroy the terpenes. Cold-start or low-temp dab with a quartz banger and carb cap is ideal. Store refrigerated in a glass jar.",
        note:"Hash rosin has replaced BHO as the prestige concentrate in the American market. The best producers (Meraki Gardens, Farmer and the Felon, Sunday Goods) release limited drops that sell out immediately. Prices reflect the labor-intensive process — quality hash rosin regularly sells for $80–150/gram.", flavor:"Exceptional · Complex · Full-Spectrum · Living Plant", rating:5 },

      { id:"live-rosin", cat:"solventless", tier:4, name:"Live Rosin", sub:"Fresh-frozen ice water hash → rosin", potency:"70–85%", purity:83, color:"#3DBF7A",
        badge:"Live · Solventless ★", origin:"Modern — USA",
        desc:"Live rosin starts with fresh-frozen cannabis — plants harvested and immediately frozen before any drying or curing. The fresh-frozen material is washed into ice water hash, freeze-dried, then pressed into rosin. The result is a concentrate that captures the terpene profile of the living plant — something no other process achieves.",
        method:"Plants are harvested and immediately submerged in dry ice or liquid nitrogen, then stored frozen. Fresh-frozen material produces significantly higher terpene content in the resulting hash. The hash is washed, freeze-dried, and pressed at ultra-low temperatures (150–160°F) to preserve the volatile monoterpenes.",
        consume:"Dab at 440–480°F maximum. Live rosin is the most temperature-sensitive concentrate — heat is the enemy. A cold-start low-temp dab reveals a terpene complexity that is genuinely unlike anything else in cannabis. Expect flavors that taste like biting into fresh fruit.",
        note:"Live rosin represents the current apex of concentrate culture. The 'live' designation matters — fresh-frozen starting material contains 20–40% more terpenes than cured material. The flavor difference is immediately apparent to any experienced consumer.", flavor:"Living Plant · Hyper-Fresh · Strain-Identical", rating:5 },

      { id:"cold-cure-rosin", cat:"solventless", tier:4, name:"Cold Cure Rosin", sub:"Cured rosin badder · Controlled crystallization", potency:"70–83%", purity:80, color:"#2D9E6B",
        badge:"Solventless", origin:"Modern — USA",
        desc:"Freshly pressed rosin is placed in a sealed jar and left to cure at a low controlled temperature (32–65°F) for 24–72 hours. During curing, the THCA slowly crystallizes while the terpenes separate into a sauce layer — then both are mixed together, creating a badder/budder consistency. Cold cure dramatically improves texture and flavor compared to fresh-pressed rosin.",
        method:"Fresh-pressed rosin is jarred immediately after collection and placed in a 32–40°F environment. THCA nucleation begins as temperature drops. The process is stopped when desired consistency is reached — usually 24–72 hours. The result is whipped and homogenized into a uniform badder.",
        consume:"Dab at 440–490°F. Cold cure rosin is significantly easier to handle than fresh-press — the badder consistency allows easy collection with a dab tool. Flavor is smoother and more integrated than fresh-press.",
        note:"Cold cure has become the standard finishing technique for premium hash rosin. The curing process allows volatile terpenes to fully integrate with the THCA matrix, producing a more rounded, complex flavor profile.", flavor:"Smooth · Integrated · Creamy · Complex", rating:5 },

      // ── HYDROCARBON ──
      { id:"shatter", cat:"hydrocarbon", tier:2, name:"Shatter", sub:"BHO · Glass-like translucent slab", potency:"70–90%", purity:72, color:"#E8A23C",
        badge:"BHO", origin:"Modern — Canada / USA",
        desc:"Shatter is butane hash oil that has been purged at low temperature and allowed to cool into a glass-like, brittle slab. The translucent amber appearance indicates purity — impurities and fats cloud the final product. Once the dominant concentrate in dispensaries, shatter has been largely displaced by more terpene-rich forms.",
        method:"Cannabis is blasted with liquid butane in a closed-loop system. The butane solution is collected and purged under vacuum at low temperature (90–110°F) for 24–72 hours. The final product is spread thin and allowed to set without agitation — agitation causes the THCA to nucleate and turn waxy.",
        consume:"Break pieces off and dab at 500–550°F. Shatter is notoriously difficult to handle when cold — use a razor or dab tool to break pieces. Warms to room temperature to become pliable.",
        note:"Shatter's clarity is often mistaken for purity — but many clear shatters have been winterized (fats removed with ethanol) which strips terpenes. Terpy, unfilterd shatter often has a slightly cloudier appearance but superior flavor.", flavor:"Clean · Mild · THC-Forward", rating:3 },

      { id:"wax-budder", cat:"hydrocarbon", tier:2, name:"Wax / Budder / Crumble", sub:"Agitated BHO · Various textures", potency:"65–85%", purity:68, color:"#D4A843",
        badge:"BHO", origin:"Modern — USA",
        desc:"BHO that has been agitated or whipped during purging — causing THCA to nucleate and creating opaque, waxy textures. Wax is softer and stickier; budder is creamier; crumble is dry and honeycombed. These textures are easier to handle than shatter but retain more flavor.",
        method:"Similar BHO process to shatter, but the oil is agitated (whipped, stirred, or subjected to temperature fluctuations) during the purge cycle. This disrupts the molecular alignment and causes crystallization in a diffuse pattern rather than a glass sheet.",
        consume:"Dab at 480–520°F. Easy to collect with a dab tool — no breaking required. Wax and budder are among the most beginner-friendly concentrates in terms of handling.",
        note:"The texture of BHO is largely determined by the genetics used and the purging technique — not necessarily by quality. Some of the most flavorful BHO runs produce waxy consistency from high-terpene strains.", flavor:"Variable · Strain-Dependent", rating:3 },

      { id:"live-resin", cat:"hydrocarbon", tier:3, name:"Live Resin", sub:"Fresh-frozen BHO · Full terpene spectrum", potency:"65–85%", purity:75, color:"#E8C53A",
        badge:"Live BHO", origin:"Modern — Colorado, USA (2013)",
        desc:"Live resin changed the concentrate world when it debuted in Colorado in 2013. Made from fresh-frozen cannabis using hydrocarbon solvents, live resin preserves the complete terpene profile of the living plant — something impossible with cured starting material. The difference in flavor is immediately apparent: live resin smells and tastes like fresh cannabis, not dried flower.",
        method:"Plants are harvested and immediately flash-frozen in dry ice or liquid nitrogen. The frozen material is extracted with butane at very low temperatures (-20°F to -40°F) — cold extraction preserves the volatile monoterpenes that evaporate during drying. The result is purged at minimal temperature to protect the terpene payload.",
        consume:"Dab at 480–520°F. Live resin is available in many textures — sugar, badder, sauce, and more. The sauce form (HTFSE) with visible THCA crystals in a terpene soup is the most flavorful.",
        note:"The term 'live resin' was coined by William Fenger (Kind Bill) and Jason Emo in Colorado, 2013. Before live resin, concentrates were considered a potency delivery system — live resin proved they could be a flavor experience. It created the modern terpene-obsessed concentrate culture.", flavor:"Fresh · Alive · Strain-Exact · Complex", rating:5 },

      { id:"sauce-htfse", cat:"hydrocarbon", tier:3, name:"Sauce / HTFSE", sub:"High Terpene Full Spectrum Extract", potency:"60–80% (terpene-diluted)", purity:72, color:"#F5B33A",
        badge:"Live BHO", origin:"Modern — USA",
        desc:"HTFSE — High Terpene Full Spectrum Extract — is the terpene-forward end of the live resin spectrum. When live resin is allowed to sit and separate, THCA crystals nucleate and sink while the terpene-rich fraction rises as a viscous, amber sauce. The sauce layer can contain 30–50% terpenes by weight — creating an intensely aromatic concentrate unlike anything else.",
        method:"Live resin extract is placed in sealed containers and allowed to separate over 2–3 weeks. THCA nucleates and crystallizes at the bottom (diamonds); the high-terpene fraction rises to the top as sauce. Both fractions are kept together or separated based on desired product.",
        consume:"Low-temp dab at 440–480°F. Sauce is extremely terpy — high temperatures destroy the very thing that makes it special. A small dab at low temperature delivers a flavor experience that outperforms much larger dabs of lesser concentrates.",
        note:"Pure sauce (HTFSE) can be combined with isolated THCA diamonds — called 'diamonds in sauce' or 'terp sauce with diamonds.' This gives both maximum potency (from the THCA) and maximum flavor (from the sauce) simultaneously.", flavor:"Explosive Terpene · Strain-Identical · Liquid Aromatherapy", rating:5 },

      { id:"thca-diamonds", cat:"hydrocarbon", tier:3, name:"THCA Diamonds", sub:"Crystalline THCA · Near-pure cannabinoid", potency:"95–99%", purity:97, color:"#C8E6FF",
        badge:"Crystalline", origin:"Modern — USA",
        desc:"THCA diamonds are the purest form of cannabis concentrate — nearly identical to pharmaceutical-grade isolated cannabinoid. THCA (the acid precursor to THC) naturally crystallizes under the right conditions, forming large, clear to slightly yellow crystals. Upon dabbing, the heat decarboxylates THCA to THC instantly.",
        method:"Highly refined live resin or distillate is supersaturated and placed in sealed containers. Given time and specific temperature conditions, THCA nucleates and grows into crystals — a process called diamond mining. Larger crystals indicate longer, more controlled growth periods.",
        consume:"Dab at 500–550°F (higher temp needed for pure THCA). Diamonds have essentially no terpenes on their own — combine with HTFSE sauce or live resin sauce for the ideal potency-plus-flavor experience. Extremely powerful — start with a grain-of-rice sized piece.",
        note:"Pure THCA diamonds are essentially odorless and tasteless on their own. Their value is in potency, not flavor. The 'diamonds in sauce' format — crystals sitting in HTFSE — is considered the ideal form: maximum THC from the diamonds, maximum terpenes from the sauce.", flavor:"Neutral · Odorless · Pure Potency", rating:4 },

      { id:"liquid-diamonds", cat:"hydrocarbon", tier:4, name:"Liquid Diamonds", sub:"THCA dissolved in live terpene sauce · Ultra-premium", potency:"85–97%", purity:90, color:"#A8E6D0",
        badge:"Ultra-Premium", origin:"Modern — USA (2020s)",
        desc:"Liquid Diamonds is the hottest product in the current concentrate market — THCA diamonds are dissolved back into a live terpene sauce at precise temperatures, creating a unified, ultra-potent, ultra-terpy liquid concentrate. The result combines the near-100% potency of crystalline THCA with the full terpene expression of HTFSE sauce. Nothing else delivers both at this level simultaneously.",
        method:"THCA diamonds are slowly reintroduced into high-quality live resin sauce at controlled temperatures, allowing the crystals to dissolve while preserving the volatile terpenes. The result is a homogeneous, slightly viscous liquid that flows like honey and tests at 85–97% total cannabinoids.",
        consume:"Low-temp dab at 450–490°F. Liquid diamonds are extremely versatile — dab directly, fill vape cartridges, or use in a cold-start rig. The liquid format makes portioning easy. Store refrigerated or frozen to prevent re-crystallization.",
        note:"Liquid diamonds have become the prestige offering for top-tier California and Colorado brands. The combination of maximum potency and maximum terpene expression in a single product represents the convergence of the purity-chasing and flavor-chasing movements that have defined concentrate culture for the past decade.", flavor:"Full-Spectrum + Maximum Potency · The Best of Both Worlds", rating:5 },

      // ── CO2 / ETHANOL ──
      { id:"co2-oil", cat:"co2", tier:2, name:"CO2 Oil", sub:"Supercritical carbon dioxide extraction", potency:"50–75%", purity:65, color:"#8BBAD4",
        badge:"CO2", origin:"Modern — Global",
        desc:"CO2 becomes supercritical (simultaneously liquid and gas) at 31.1°C and 73 atmospheres — making it an effective, tunable solvent that leaves zero residue. CO2 extraction is the dominant method for commercial oil cartridges. At different pressures and temperatures, CO2 selectively extracts different compounds, allowing producers to target specific cannabinoid or terpene fractions.",
        method:"Cannabis is loaded into an extraction vessel. Supercritical CO2 is pumped through at precise pressure and temperature — the parameters determine what is extracted. The CO2 then passes through a separator where pressure drops, causing the oil to fall out while the CO2 reverts to gas and is recaptured.",
        consume:"Primarily consumed via vape cartridge. CO2 oil is the standard fill for most commercial cartridges. Can also be dabbed or used to make edibles. Generally less flavorful than hydrocarbon extracts from equivalent starting material.",
        note:"The vape cartridge market runs almost entirely on CO2 oil and distillate. CO2 oil itself has lower terpene content than hydrocarbon extracts — most commercial cartridges add botanical terpenes or cannabis-derived terpenes back in after extraction.", flavor:"Clean · Mild · Consumer-Friendly", rating:3 },

      { id:"rso", cat:"co2", tier:2, name:"RSO / FECO", sub:"Rick Simpson Oil · Full Extract Cannabis Oil", potency:"50–80%", purity:60, color:"#5A3E28",
        badge:"Ethanol", origin:"Canada (Rick Simpson, 2003)",
        desc:"RSO (Rick Simpson Oil) and FECO (Full Extract Cannabis Oil) are whole-plant ethanol extracts — dark, viscous, intensely potent oils that contain the full spectrum of cannabinoids, terpenes, flavonoids, and chlorophylls. Rick Simpson popularized the concentrate after claiming to have used it to treat his own skin cancer. RSO is primarily associated with high-dose therapeutic cannabis use.",
        method:"High-proof ethanol is used to wash cannabis plant material, stripping all compounds including chlorophylls and fats. The ethanol is then gently evaporated, leaving behind a thick, dark, full-spectrum oil. Winterization (cold ethanol filtration) can remove fats and waxes but also strips some terpenes.",
        consume:"Consumed orally — placed under the tongue or in a capsule. RSO is rarely smoked or dabbed due to its chlorophyll content. Oral consumption provides a longer-lasting, more body-focused effect. The taste is extremely strong — many users mix it with food or capsules.",
        note:"The scientific evidence for RSO as a cancer treatment is limited but the anecdotal reports are substantial. RSO is widely used in palliative care for cancer patients seeking high-dose cannabinoid therapy. The full-spectrum nature (including minor cannabinoids and flavonoids) may contribute to an entourage effect not present in distillate.", flavor:"Intense · Earthy · Full-Plant · Medicinal", rating:3 },

      // ── DISTILLATE & ISOLATE ──
      { id:"distillate", cat:"distillate", tier:2, name:"THC Distillate", sub:"Fractional distillation · 90%+ pure THC", potency:"85–95%", purity:90, color:"#E8D8A0",
        badge:"Distillate", origin:"Modern — Global",
        desc:"Distillate is the result of short-path fractional distillation — a process that separates specific compounds by their boiling points, producing a near-pure cannabinoid fraction. THC distillate is odorless, tasteless, and visually identical to honey. It is the backbone of the commercial cannabis industry — used in vape cartridges, edibles, tinctures, and topicals.",
        method:"Crude cannabis oil is refined through multiple passes of short-path distillation under vacuum. Each pass increases purity. The cannabinoids are separated from terpenes, fats, waxes, and other plant material. Terpenes are typically added back in afterward.",
        consume:"Versatile — fill cartridges, use in edibles, dab directly, or add to joints. Distillate has no flavor of its own — added terpenes (botanical or cannabis-derived) determine the experience. Most commercial edibles use distillate as the active ingredient.",
        note:"Distillate is a blank canvas. The terpenes added back in determine the experience completely. 'Live resin cartridges' add actual plant-derived terpenes to distillate, producing a significantly better flavor experience than cartridges with botanical (non-cannabis) terpenes.", flavor:"Neutral · Terpene-Dependent · Odorless Alone", rating:3 },

      { id:"thca-isolate", cat:"distillate", tier:3, name:"THCA / CBD Isolate", sub:"Single-molecule isolation · 99%+ pure", potency:"99%+", purity:99, color:"#FFFFFF",
        badge:"Isolate", origin:"Modern — Global",
        desc:"Cannabis isolate is a single purified cannabinoid at near 100% purity — most commonly THCA or CBD. THCA isolate appears as a white crystalline powder or large clear crystals (diamonds). CBD isolate is a white powder. These are the purest forms of cannabis compounds achievable with current technology.",
        method:"Crude extract is further refined through chromatography or repeated crystallization to isolate a single cannabinoid. THCA isolate is produced through the diamond mining process; CBD isolate requires additional chromatography steps after distillation.",
        consume:"THCA isolate is dabbed at high temperature (500–550°F). CBD isolate is dissolved in oil for tinctures, added to foods, or mixed into topicals. Both can be added to flower or other concentrates to boost potency.",
        note:"Isolate represents maximum purity but minimum entourage effect — research suggests that whole-plant extracts with multiple cannabinoids and terpenes may produce a more complex and potentially more therapeutic experience than isolated molecules. Still, for precise dosing, nothing beats isolate.", flavor:"Zero · Pure Molecule · No Terpenes", rating:3 }
    ];

    const catLabels = { traditional:"Traditional", solventless:"Solventless", hydrocarbon:"Hydrocarbon", co2:"CO2 & Ethanol", distillate:"Distillate & Isolate" };
    const catColors = { traditional:"#8B5E3C", solventless:"#52B788", hydrocarbon:"#E8A23C", co2:"#8BBAD4", distillate:"#C4B99A" };

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Concentrates — Cannascenti Encyclopedia</title>
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
/* Spectrum bar */
.spectrum-wrap{margin:0 0 56px;padding:32px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-radius:16px}
.spectrum-title{font-size:.75rem;letter-spacing:.12em;text-transform:uppercase;color:rgba(242,234,216,0.4);margin-bottom:16px}
.spectrum-bar{display:flex;height:10px;border-radius:10px;overflow:hidden;margin-bottom:10px}
.spectrum-seg{flex:1;transition:opacity .2s}
.spectrum-seg:hover{opacity:0.8;cursor:pointer}
.spectrum-labels{display:flex;justify-content:space-between;font-size:.65rem;letter-spacing:.06em;text-transform:uppercase;color:rgba(242,234,216,0.35)}
/* Filter */
.conc-filter{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:40px}
.cf-btn{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:7px 18px;color:rgba(242,234,216,0.55);font-family:Montserrat,sans-serif;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:7px}
.cf-btn:hover{border-color:rgba(255,255,255,0.25);color:rgba(242,234,216,0.85)}
.cf-btn.active{border-color:currentColor;background:rgba(255,255,255,0.05)}
.cf-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
/* Cards */
.conc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px}
.conc-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden;transition:border-color .25s,transform .2s;cursor:pointer}
.conc-card:hover{border-color:rgba(255,255,255,0.15);transform:translateY(-2px)}
.conc-card.expanded{border-color:rgba(82,183,136,0.3)}
.conc-card-top{display:flex;align-items:center;justify-content:space-between;padding:20px 22px 0}
.conc-badge{font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;border-radius:20px;padding:3px 10px;font-weight:600;white-space:nowrap}
.conc-stars{color:#C9973A;font-size:.85rem;letter-spacing:1px}
.conc-body{padding:14px 22px 20px}
.conc-name{font-family:'Cormorant Garamond',serif;font-size:1.4rem;font-weight:400;color:#F2EAD8;line-height:1.2;margin-bottom:3px}
.conc-sub{font-size:.72rem;color:rgba(242,234,216,0.4);letter-spacing:.04em;margin-bottom:12px}
.conc-meta{display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap}
.conc-meta-item{display:flex;flex-direction:column;gap:2px}
.conc-meta-label{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:rgba(242,234,216,0.3)}
.conc-meta-val{font-size:.82rem;color:#F2EAD8;font-weight:500}
.conc-purity-bar{height:4px;border-radius:4px;background:rgba(255,255,255,0.07);margin-bottom:16px;overflow:hidden}
.conc-purity-fill{height:100%;border-radius:4px;transition:width .6s}
.conc-desc{font-size:.82rem;line-height:1.75;color:rgba(242,234,216,0.62);margin-bottom:0}
.conc-expand{display:none;padding:0 22px 22px;border-top:1px solid rgba(255,255,255,0.06);margin-top:16px}
.conc-card.expanded .conc-expand{display:block}
.conc-section-label{font-size:.63rem;letter-spacing:.12em;text-transform:uppercase;color:rgba(242,234,216,0.3);margin:16px 0 6px}
.conc-section-text{font-size:.81rem;line-height:1.75;color:rgba(242,234,216,0.62)}
.conc-flavor{display:inline-block;font-size:.72rem;color:rgba(242,234,216,0.5);font-style:italic;margin-top:12px;padding:6px 14px;background:rgba(255,255,255,0.04);border-radius:8px}
.conc-origin{font-size:.72rem;color:rgba(242,234,216,0.35);margin-top:10px}
.conc-hidden{display:none}
/* Culture section */
.culture-section{margin-top:80px;padding:48px;background:rgba(82,183,136,0.04);border:1px solid rgba(82,183,136,0.12);border-radius:20px}
.culture-title{font-family:'Cormorant Garamond',serif;font-size:clamp(1.6rem,4vw,2.4rem);font-weight:300;color:#F2EAD8;line-height:1.2;margin-bottom:8px}
.culture-title em{color:#52B788;font-style:italic}
.culture-body{font-size:.88rem;line-height:1.9;color:rgba(242,234,216,0.65);max-width:780px}
.culture-body p{margin-bottom:16px}
.culture-body p:last-child{margin-bottom:0}
.culture-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-top:32px}
.culture-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px}
.culture-card-icon{font-size:22px;margin-bottom:10px}
.culture-card-title{font-family:Montserrat,sans-serif;font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:#52B788;margin-bottom:6px}
.culture-card-body{font-size:.78rem;line-height:1.65;color:rgba(242,234,216,0.55)}
@media(max-width:600px){.conc-grid{grid-template-columns:1fr}.culture-section{padding:28px}}
</style>
</head>
<body>
${ENC_NAV}
<div class="enc-page">
  <div class="enc-page-header">
    <div class="enc-label">✦ Cannascenti Encyclopedia</div>
    <h1 class="enc-title">The world of <em>concentrates.</em></h1>
    <p class="enc-desc">From 10,000-year-old charas rolled by hand in the Himalayas to liquid diamonds pressing the limits of modern extraction science — every form, process, and culture, documented. Click any card to go deep.</p>
  </div>

  <div class="spectrum-wrap">
    <div class="spectrum-title">The Concentrate Spectrum — Traditional to Ultra-Modern</div>
    <div class="spectrum-bar" id="spectrumBar"></div>
    <div class="spectrum-labels">
      <span>Traditional Hash</span>
      <span>Dry Sift &amp; Kief</span>
      <span>Ice Water Hash</span>
      <span>Rosin</span>
      <span>Live Resin BHO</span>
      <span>Diamonds</span>
      <span>Liquid Diamonds</span>
    </div>
  </div>

  <div class="conc-filter" id="concFilter">
    <button class="cf-btn active" style="color:#F2EAD8" data-cat="all" onclick="filterConc('all',this)"><div class="cf-dot" style="background:#F2EAD8"></div>All</button>
    <button class="cf-btn" style="color:#8B5E3C" data-cat="traditional" onclick="filterConc('traditional',this)"><div class="cf-dot" style="background:#8B5E3C"></div>Traditional</button>
    <button class="cf-btn" style="color:#52B788" data-cat="solventless" onclick="filterConc('solventless',this)"><div class="cf-dot" style="background:#52B788"></div>Solventless</button>
    <button class="cf-btn" style="color:#E8A23C" data-cat="hydrocarbon" onclick="filterConc('hydrocarbon',this)"><div class="cf-dot" style="background:#E8A23C"></div>Hydrocarbon</button>
    <button class="cf-btn" style="color:#8BBAD4" data-cat="co2" onclick="filterConc('co2',this)"><div class="cf-dot" style="background:#8BBAD4"></div>CO2 &amp; Ethanol</button>
    <button class="cf-btn" style="color:#C4B99A" data-cat="distillate" onclick="filterConc('distillate',this)"><div class="cf-dot" style="background:#C4B99A"></div>Distillate &amp; Isolate</button>
  </div>

  <div class="conc-grid" id="concGrid"></div>

  <!-- Live Rosin Culture Section -->
  <div class="culture-section">
    <div class="enc-label" style="margin-bottom:12px">✦ The Culture</div>
    <h2 class="culture-title">Live Rosin &amp; the <em>Solventless Revolution.</em></h2>
    <div class="culture-body">
      <p>For most of cannabis history, concentrates meant one thing: hash. The traditional methods — hand-rubbing charas, dry-sifting kief, pressing Moroccan slabs — were unchanged for centuries. Then in the late 1980s, hydrocarbon extraction arrived in North America, and for the next twenty years, BHO dominated the concentrate market. Shatter, wax, budder — the game was potency, and BHO delivered it.</p>
      <p>But something shifted around 2015. A community of extractors — largely operating out of Colorado and California — began questioning the solvent. They had seen what ice water hash could do at its best: full-melt 6-star hash that bubbled and disappeared on a hot nail, carrying the complete terpene signature of the living plant. They asked: what if you pressed that hash instead of using butane?</p>
      <p>The answer was hash rosin — and it changed everything. Suddenly there was a solventless concentrate that could rival BHO in potency while surpassing it in flavor and cleanliness. The live rosin movement followed: fresh-frozen starting material, washed into ice water hash, freeze-dried, pressed. The result was a concentrate that tasted like you were inhaling the actual living plant.</p>
      <p>Today, the premium end of the concentrate market is almost entirely solventless. The best producers — many of them small operations running single-strain limited drops — release grams that sell for $100+ and disappear in minutes. A new vocabulary has emerged: fresh press, cold cure, live rosin, 6-star full melt, temple ball revival. The culture has developed its own rituals: low-temp dabs, cold-start technique, quartz bangers, terp pearls, carb caps. The equipment is as specialized as any brewing or coffee setup.</p>
      <p>Liquid diamonds represent where both cultures converged — the purity obsession of the isolate world meeting the terpene obsession of the live rosin world. THCA crystals dissolved back into live terpene sauce, creating something simultaneously maximally potent and maximally flavorful. It is, for now, as close as cannabis science has come to having everything at once.</p>
    </div>
    <div class="culture-grid">
      <div class="culture-card">
        <div class="culture-card-icon">🌡️</div>
        <div class="culture-card-title">Low-Temp Dabbing</div>
        <div class="culture-card-body">The shift from 700°F+ torching to 440–500°F precision. Cold-start technique places concentrate in a cold banger, then slowly heats — maximum terpene expression at minimum combustion.</div>
      </div>
      <div class="culture-card">
        <div class="culture-card-icon">🧊</div>
        <div class="culture-card-title">Fresh-Frozen Philosophy</div>
        <div class="culture-card-body">Harvesting and immediately freezing cannabis in liquid nitrogen or dry ice. Prevents terpene degradation from drying and curing — captures the living plant's full chemical profile.</div>
      </div>
      <div class="culture-card">
        <div class="culture-card-icon">⭐</div>
        <div class="culture-card-title">The 6-Star Rating</div>
        <div class="culture-card-body">Ice water hash is rated 1–6 stars based on melt quality. 6-star full-melt hash leaves zero residue on a hot nail — the highest purity achievable without solvents. Most hash rates 3–4 stars.</div>
      </div>
      <div class="culture-card">
        <div class="culture-card-icon">🍯</div>
        <div class="culture-card-title">Cold Cure vs. Fresh Press</div>
        <div class="culture-card-body">Fresh press rosin is consumed immediately after extraction — brighter, more volatile terpenes. Cold cure (jarred at 32–40°F for 24–72h) creates a creamy badder with integrated, rounded flavor.</div>
      </div>
      <div class="culture-card">
        <div class="culture-card-icon">💎</div>
        <div class="culture-card-title">Diamond Mining</div>
        <div class="culture-card-body">Supersaturated live resin is sealed and left to crystallize. THCA diamonds nucleate over 2–3 weeks — some growing to gram-sized crystals. The terpene sauce separates above the diamond layer.</div>
      </div>
      <div class="culture-card">
        <div class="culture-card-icon">🌿</div>
        <div class="culture-card-title">Single-Strain Drops</div>
        <div class="culture-card-body">Premium solventless producers release single-strain, single-batch live rosin in limited quantities. Like wine vintages — the same cultivar pressed from different harvests produces distinctly different results.</div>
      </div>
    </div>
  </div>
</div>

<script>
var CONC = ${JSON.stringify(_CONC)};
var CAT_COLORS = ${JSON.stringify(catColors)};

// Build spectrum bar
var specSegs = [
  {label:'Charas',col:'#8B5E3C'},{label:'Temple Ball',col:'#7A5230'},{label:'Moroccan',col:'#C9973A'},
  {label:'Dry Sift',col:'#D4B84A'},{label:'Bubble Hash',col:'#74C6A0'},{label:'Flower Rosin',col:'#E8D44D'},
  {label:'Hash Rosin',col:'#52B788'},{label:'Live Rosin',col:'#3DBF7A'},{label:'Cold Cure',col:'#2D9E6B'},
  {label:'Shatter',col:'#E8A23C'},{label:'Live Resin',col:'#E8C53A'},{label:'HTFSE Sauce',col:'#F5B33A'},
  {label:'THCA Diamonds',col:'#C8E6FF'},{label:'Liquid Diamonds',col:'#A8E6D0'},
  {label:'CO2 Oil',col:'#8BBAD4'},{label:'RSO',col:'#5A3E28'},{label:'Distillate',col:'#E8D8A0'},{label:'Isolate',col:'#F5F5F0'}
];
document.getElementById('spectrumBar').innerHTML = specSegs.map(function(s){
  return '<div class="spectrum-seg" style="background:'+s.col+'" title="'+s.label+'"></div>';
}).join('');

// Render cards
function renderCards(cat) {
  var filtered = cat === 'all' ? CONC : CONC.filter(function(c){ return c.cat === cat; });
  document.getElementById('concGrid').innerHTML = filtered.map(function(c, i) {
    var col = CAT_COLORS[c.cat] || '#52B788';
    var stars = '';
    for (var s = 0; s < 5; s++) stars += s < c.rating ? '★' : '☆';
    var purityW = c.purity + '%';
    return '<div class="conc-card" id="card-'+c.id+'" onclick="toggleCard(\''+c.id+'\')">'+
      '<div class="conc-card-top">'+
        '<span class="conc-badge" style="background:'+col+'22;color:'+col+'">'+c.badge+'</span>'+
        '<span class="conc-stars">'+stars+'</span>'+
      '</div>'+
      '<div class="conc-body">'+
        '<div class="conc-name">'+c.name+'</div>'+
        '<div class="conc-sub">'+c.sub+'</div>'+
        '<div class="conc-meta">'+
          '<div class="conc-meta-item"><div class="conc-meta-label">Potency</div><div class="conc-meta-val">'+c.potency+'</div></div>'+
          '<div class="conc-meta-item"><div class="conc-meta-label">Purity</div><div class="conc-meta-val">'+c.purity+'%</div></div>'+
          '<div class="conc-meta-item"><div class="conc-meta-label">Origin</div><div class="conc-meta-val" style="font-size:.75rem">'+c.origin+'</div></div>'+
        '</div>'+
        '<div class="conc-purity-bar"><div class="conc-purity-fill" style="width:'+purityW+';background:'+col+'"></div></div>'+
        '<div class="conc-desc">'+c.desc+'</div>'+
      '</div>'+
      '<div class="conc-expand" id="expand-'+c.id+'">'+
        '<div class="conc-section-label">How it\'s made</div>'+
        '<div class="conc-section-text">'+c.method+'</div>'+
        '<div class="conc-section-label">How to consume</div>'+
        '<div class="conc-section-text">'+c.consume+'</div>'+
        '<div class="conc-section-label">Insider notes</div>'+
        '<div class="conc-section-text">'+c.note+'</div>'+
        '<div class="conc-flavor">'+c.flavor+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
}

function toggleCard(id) {
  var card = document.getElementById('card-'+id);
  card.classList.toggle('expanded');
}

function filterConc(cat, btn) {
  document.querySelectorAll('.cf-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  renderCards(cat);
}

document.addEventListener('DOMContentLoaded', function(){ renderCards('all'); });
</script>
</body></html>`;
    res.writeHead(200, {"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
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
