import Anthropic from "@anthropic-ai/sdk";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new Anthropic();

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
- Cannascenti's offerings: The Magazine, Cannalogy education hub, Joint Rolling Seminars (Beginner/Intermediate/Advanced), Hash events (Taste the Courage tasting events, Solventless Sessions, Hash Nights), Cannabis Consulting (personal, dispensary, business strategy, staff training), AI Strain Finder, Budtender Pro tool
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

  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.join(__dirname, filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Cannascenti running at http://localhost:${PORT}`));
