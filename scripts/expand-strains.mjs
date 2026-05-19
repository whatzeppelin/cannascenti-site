import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new Anthropic();
const STRAINS_PATH = path.join(__dirname, "../strains.json");

const existing = JSON.parse(fs.readFileSync(STRAINS_PATH, "utf8"));
const existingNames = new Set(existing.map(s => s.name.toLowerCase()));

// Master list of strains to add — covering classics, exotics, lineages, CBD, haze, kush, diesel, cookies, runtz, gelato, OG, cheese, and more
const WANT = [
  // Classic Landrace / Heritage
  "Thai","Afghani #1","Colombian Gold","Mexican Sativa","Malawi Gold","Congolese","Swazi Gold","Kerala","Altai","Lebanese","Nepalese","Kilimanjaro",
  // Haze Family
  "Original Haze","Lemon Haze","Blue Haze","Purple Haze","Strawberry Haze","Mango Haze","Neville's Haze","Shiva Haze","Amnesia","Silver Haze","Pineapple Haze","Citrus Haze",
  // Kush Family
  "Afghan Kush","OG Kush Breath","Confidential Cheese","Kandy Kush","Candy Kush","Cotton Candy Kush","Grape Kush","Strawberry Kush","Blueberry Kush","Hash Plant","Mega Wellness OG","Lemon Kush",
  // OG Family
  "Ghost OG","Diablo OG","Alien OG Kush","Lemon OG Kush","Obama Kush","Presidential OG","Cali OG","Rare Dankness","Alien Kush","White Fire OG","Lucid OG","Jupiter OG",
  // Diesel Family
  "East Coast Sour Diesel","Strawberry Diesel","Lemon Diesel","Blue Diesel","Banana Diesel","Purple Diesel","Citrus Diesel","Headband OG",
  // Cheese Family
  "Original Cheese","Big Buddha Cheese","Exodus Cheese","Blue Cheese OG","Cheese Quake","Cheesy Dick","Trainwreck Cheese",
  // Cookies / Dessert
  "Thin Mint GSC","Platinum GSC","Forum Cut GSC","Animal Mints","Mints","London Chello","Wookies","Grease Monkey OG","Jet Fuel Gelato","Dosidos #22","Pink Cookies","Sunset Cookies",
  // Gelato / Sherbet Family
  "Gelato 33","Gelato 41","Gelato 45","Bacio Gelato","Dolato","Gello Gelato","Gelato Cake","Sherbet OG","Raspberry Sherbet","Mango Sherbet","Orange Sherbet","Peach Sherbet",
  // Runtz / Zkittlez Family
  "Tropical Runtz","Watermelon Runtz","Rainbow Runtz","Banana Runtz","Purple Runtz","Grape Runtz","Peach Runtz","Runtz OG","Original Zkittlez","Melon Zkittlez","Grape Zkittlez",
  // Wedding Cake / Cake Family
  "Wedding Pie","Triangle Mints","Cake Pop","Birthday Cake Kush","Cherry Cake","Blueberry Cake","Strawberry Cake",
  // Modern Exotics
  "Oreoz","Rainbow Belts","Zoap","Gary Payton OG","Pancakes OG","Biscotti Mintz","Frozen Grapes","Grape Gasoline","Lemon Cherry Cookies","Purple Lemonade","Tropicana Cherry","Apples and Bananas","Runtz Muffin","Ice Cream Man","Gello","Jealousy OG","Permanent Marker OG","RS-11","Jokerz","Grapes and Cream",
  // CBD / Medical
  "Ringo's Gift","Harle-Tsu","Canna-Tsu","Stephen Hawking Kush","Sweet and Sour Widow","Sour Tsunami","Penelope","Valentine X","Omrita Rx3","Suzy Q","Remedy CBD","Dancehall","Pamelina",
  // Indica Classics
  "G13 Haze","Purple Afghani","Sensi Star","Shishkaberry","Sweet Tooth","Mendo Purps","Querkle","Qrazy Train","Space Queen","Snow White","Alien Dawg OG","Alien Bubba",
  // Sativa Classics
  "XJ-13","Voodoo","Red Congolese","Swazi","Durban Thai","Lemon Sativa","Sage","Acapulco Gold Haze","Santa Marta Colombian","Kilimanjaro Sativa","Island Sweet Skunk","Grapefruit Haze",
  // Skunk Family
  "Skunk #1","Super Skunk","Skunk Haze","Lemon Skunk OG","Island Skunk","Early Skunk","Skunk Berry","Skunk Punch",
  // Blueberry / Berry Family
  "Blueberry Headband","Blueberry AK","Blueberry OG","Mixed Berry","Berry Bomb","Berry Ryder","Blackberry OG","Raspberry OG","Cherry Berry","Boysenberry",
  // Fire / Exotic OGs
  "White Fire OG","Fire OG Kush","Alien Fire","Inferno Haze","White Dragon","Dragon Fruit","Dragon OG","Fire Alien Strawberry",
  // Papaya / Tropical
  "Papaya Punch","Papaya Cake","Mango Tango","Pineapple Kush","Passion Fruit","Starfruit","Guava Cake","Guava Sherbet","Lychee","Peach OG",
  // Newer Strains 2020s
  "Gushers OG","Grease Bucket","Biscotti Cake","Ice Cream Cake OG","Kush Mintz","London Pound Cake 75","Peanut Butter Gelato","Cereal Milk OG","Motorbreath 15","Jet Fuel","GMO Garlic Cookies","Garlic Breath","Garlic Cocktail","Super Boof","Gastro Pop","Grape Cream Cake",
  // Heirloom / Less Common
  "Romulan Grapefruit","Giesel","The White","The Black","The Cube","Flo","Blue Mystic","Blue Moonshine","Texada Timewarp","Williams Wonder","Warlock","Snow Lotus","Blue Satellite","C99","Cindy 99",
  // Autoflower Notable
  "Auto AK","Auto Blueberry","Auto Northern Lights","Auto White Widow","Fast Buds",
];

const toAdd = WANT.filter(n => !existingNames.has(n.toLowerCase()));
console.log(`Existing: ${existing.length} | Want: ${WANT.length} | To generate: ${toAdd.length}`);

async function generateBatch(names) {
  const prompt = `You are a cannabis expert with encyclopedic knowledge of all strains worldwide.

Generate accurate strain profiles for these ${names.length} strains: ${names.map(n => `"${n}"`).join(", ")}

Respond ONLY with a JSON array. Each object must have exactly these fields:
{
  "name": string (exact name as given),
  "type": "indica" | "sativa" | "hybrid",
  "thc_min": number (realistic THC%, e.g. 18),
  "thc_max": number (realistic THC%, e.g. 24),
  "cbd": number (CBD% as decimal, e.g. 0.1),
  "description": string (2-3 sentences: aroma, effect, best use — vivid and specific),
  "effects": [string] (exactly 5, e.g. "Relaxed","Happy","Euphoric","Uplifted","Focused"),
  "terpenes": [string] (3-4 dominant terpenes, proper names like "Myrcene","Limonene"),
  "flavors": [string] (3-5 flavor descriptors),
  "tags": [string] (3-5 tags like "daytime","indica-dom","creative","nighttime","medical"),
  "rating": number (4.0–4.9, realistic crowd rating)
}
If a strain is primarily CBD, set thc_min/thc_max to realistic low values (5-15) and cbd to 10-20.
No markdown, no explanation. Only the JSON array.`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }]
  });

  const text = response.content[0].text.trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array in response");
  return JSON.parse(text.slice(start, end + 1));
}

async function main() {
  const BATCH = 15;
  const allNew = [];
  let failed = [];

  for (let i = 0; i < toAdd.length; i += BATCH) {
    const batch = toAdd.slice(i, i + BATCH);
    process.stdout.write(`Generating batch ${Math.floor(i/BATCH)+1}/${Math.ceil(toAdd.length/BATCH)}: ${batch[0]}…`);
    try {
      const results = await generateBatch(batch);
      allNew.push(...results);
      console.log(` ✓ got ${results.length}`);
    } catch (err) {
      console.log(` ✗ ${err.message}`);
      failed.push(...batch);
    }
    // Small delay to avoid rate limits
    if (i + BATCH < toAdd.length) await new Promise(r => setTimeout(r, 800));
  }

  // Retry failed ones individually
  for (const name of failed) {
    process.stdout.write(`Retrying "${name}"…`);
    try {
      const results = await generateBatch([name]);
      allNew.push(...results);
      console.log(" ✓");
    } catch {
      console.log(" ✗ skipped");
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const combined = [...existing, ...allNew];
  fs.writeFileSync(STRAINS_PATH, JSON.stringify(combined, null, 2));
  console.log(`\nDone! ${existing.length} → ${combined.length} strains saved to strains.json`);
}

main().catch(console.error);
