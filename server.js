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

// ─── Terpene metadata for /terpenes/:slug profile pages ───────────────────────
const TERP_META = [
  { name:"Myrcene", slug:"myrcene", color:"#E07B39", tag:"The Most Abundant", family:"Earthy", bp:168, bpF:334,
    aroma:"Earthy · Musky · Tropical · Cloves",
    effect:"Heavy relaxation and couch-lock. The most abundant terpene in cannabis — increases cell membrane permeability so THC crosses the blood-brain barrier faster and in greater quantity. High myrcene means heavier, more sedating effect regardless of strain type. The single biggest predictor of whether a strain will sedate or activate.",
    receptorNote:"Myrcene potentiates CB1 receptors by increasing cell membrane permeability, allowing THC to cross the blood-brain barrier faster and in greater quantity. More myrcene = faster onset, stronger effect. This is why indica strains hit harder even at the same THC percentage.",
    medical:["Pain relief","Anti-inflammatory","Muscle relaxant","Sleep aid","Anti-anxiety"],
    nature:[{e:"🥭",n:"Mango",note:"Ripe mangoes are loaded with myrcene — eating one 45 min before cannabis boosts THC absorption"},{e:"🍺",n:"Hops",note:"Cannabis and hops are botanical cousins — the earthy backbone of IPAs comes from shared myrcene genetics"},{e:"🌿",n:"Thyme",note:"Dried thyme is one of the highest myrcene herbs in your kitchen"},{e:"🍋",n:"Lemongrass",note:"Primary aromatic compound in lemongrass essential oil"},{e:"🫐",n:"Bay Leaves",note:"The earthy depth of bay laurel leaves comes largely from myrcene"},{e:"🍊",n:"Grapefruit",note:"Myrcene alongside limonene creates the citrus-earth complexity of grapefruit"}],
    hack:"The Mango Trick: Eating a ripe mango 45 minutes before cannabis can noticeably increase the strength and duration of effects. The myrcene in mango primes your CB1 receptors, lowering the threshold for THC binding.",
    exStrains:["OG Kush","Blue Dream","Granddaddy Purple","Mango Kush","White Widow","Grape Ape"] },
  { name:"Limonene", slug:"limonene", color:"#F5C842", tag:"The Mood Lifter", family:"Citrus", bp:176, bpF:349,
    aroma:"Citrus · Lemon · Orange · Lime",
    effect:"Uplifting, euphoric, stress-relieving. Drives that bright, social, happy high. Interacts with serotonin (5-HT1A) and dopamine receptors — the same pathways targeted by antidepressants and anxiolytics. The most mood-elevating terpene in cannabis.",
    receptorNote:"Limonene doesn't bind cannabinoid receptors directly but interacts powerfully with serotonin (5-HT1A) and dopamine receptors — the same pathways targeted by antidepressants and anxiolytics. It literally talks to your mood system.",
    medical:["Anxiety & depression","Stress relief","Acid reflux","Antifungal","Immune support"],
    nature:[{e:"🍋",n:"Lemon peel",note:"The most concentrated natural source — lemon essential oil is nearly pure limonene"},{e:"🍊",n:"Orange rind",note:"The characteristic smell of orange peel is almost entirely limonene"},{e:"🍈",n:"Grapefruit",note:"Grapefruit's bright, slightly bitter top note is limonene-driven"},{e:"🌲",n:"Juniper",note:"Gin's distinctive piney-citrus quality comes from juniper limonene"},{e:"🌿",n:"Rosemary",note:"Alongside camphor, limonene gives rosemary its bright, uplifting scent"},{e:"🧹",n:"Citrus cleaners",note:"Nearly every citrus cleaner uses limonene — it's literally the smell of clean"}],
    hack:"The Citrus Squeeze: Smelling fresh lemon or orange peel can immediately produce a mild limonene effect — the same terpene activating your serotonin receptors is now in your nostrils.",
    exStrains:["Lemon Haze","Durban Poison","Super Lemon Haze","Wedding Cake","Banana OG","Strawberry Banana"] },
  { name:"Caryophyllene", slug:"caryophyllene", color:"#D95F3B", tag:"Binds CB2 Directly", family:"Spice", bp:160, bpF:320,
    aroma:"Peppery · Woody · Clove · Cinnamon · Spice",
    effect:"Anti-inflammatory, pain-relieving, calming. The only terpene that directly binds to cannabinoid receptors (CB2) — technically both a terpene AND a dietary cannabinoid. Significantly reduces systemic inflammation without psychoactive effects. Why black pepper helps bring you down from too much THC.",
    receptorNote:"Caryophyllene is the ONLY terpene that directly binds to cannabinoid receptors — specifically CB2 receptors in the immune system and peripheral nervous system. This makes it technically both a terpene AND a dietary cannabinoid. The FDA classifies it as GRAS (Generally Recognized As Safe).",
    medical:["Chronic pain","Anti-inflammatory","Anxiety","Alcohol craving reduction","Ulcer protection"],
    nature:[{e:"🫙",n:"Black Pepper",note:"The dominant terpene in black pepper — cracking pepper under your nose activates CB2 receptors immediately"},{e:"🌶️",n:"Cloves",note:"Cloves are so rich in caryophyllene they've been used as pain relief for toothaches for centuries"},{e:"🍂",n:"Cinnamon",note:"That warm, spicy cinnamon note comes largely from caryophyllene alongside eugenol"},{e:"🌿",n:"Basil",note:"Fresh basil contains significant caryophyllene alongside other terpenes"},{e:"🌿",n:"Oregano",note:"Mediterranean cooking's signature herb is rich in caryophyllene"},{e:"🍺",n:"Hops",note:"Alongside myrcene, caryophyllene gives hoppy beers their spicy, resinous character"}],
    hack:"The Black Pepper Trick: Chewing or smelling black peppercorns can take the edge off an overwhelming high. Caryophyllene binds CB2 receptors and has a grounding, calming effect on the endocannabinoid system.",
    exStrains:["Girl Scout Cookies","Sour Diesel","Bubba Kush","Chemdawg","Gorilla Glue #4","Purple Punch"] },
  { name:"Linalool", slug:"linalool", color:"#9B72CF", tag:"Nature's Anxiety Reducer", family:"Floral", bp:198, bpF:388,
    aroma:"Floral · Lavender · Sweet · Spice",
    effect:"Deeply calming, sedating, anxiolytic. Activates GABA receptors — the brain's primary inhibitory system. The reason lavender aromatherapy demonstrably reduces anxiety in clinical settings. The most peaceful, gentle sedation in cannabis — less heavy than myrcene, more softly flowing.",
    receptorNote:"Linalool activates GABA receptors — the brain's primary inhibitory system that reduces neural excitation. This is the same system activated by benzodiazepines (Valium, Xanax) and alcohol. Linalool is nature's built-in nervous system calmer.",
    medical:["Anxiety & stress","Insomnia","Anticonvulsant (research)","Depression","Pain & inflammation"],
    nature:[{e:"💜",n:"Lavender",note:"Lavender essential oil is the richest natural linalool source — over 50% of its oil is linalool"},{e:"🌸",n:"Jasmine",note:"Jasmine's intoxicating floral sweetness comes from linalool alongside benzyl acetate"},{e:"🌿",n:"Basil",note:"Sweet basil contains linalool alongside ocimene, creating its complex floral-herb profile"},{e:"🌲",n:"Birch",note:"Birch bark and leaves contain linalool — the forest-calm of birch forests is partly linalool"},{e:"🫚",n:"Coriander",note:"Coriander seeds are a significant linalool source used in many calming herbal traditions"},{e:"🌹",n:"Rose",note:"Rose's calming, romantic aroma is largely linalool working its GABA magic"}],
    hack:"The Lavender Test: If lavender aromatherapy genuinely calms you down, linalool-dominant cannabis strains will too. Your brain's response to linalool is consistent across delivery methods.",
    exStrains:["Lavender Kush","LA Confidential","Amnesia Haze","Do-Si-Dos","Master Kush","Zkittlez"] },
  { name:"Pinene", slug:"pinene", color:"#52B788", tag:"The Alertness Terpene", family:"Fresh", bp:155, bpF:311,
    aroma:"Pine · Forest · Fresh · Rosemary · Herbs",
    effect:"Promotes alertness and memory retention. Opens airways as a bronchodilator. One of the few compounds that counteracts THC's short-term memory impairment. High pinene strains are remarkably clear-headed despite being potent.",
    receptorNote:"Pinene inhibits acetylcholinesterase — the enzyme that breaks down acetylcholine, the neurotransmitter responsible for memory, learning, and focus. This is why pinene-dominant strains can actually counteract THC's short-term memory effects.",
    medical:["Memory retention","Asthma & bronchodilation","Anti-inflammatory","Antiseptic","Anxiety"],
    nature:[{e:"🌲",n:"Pine needles",note:"Alpha-pinene is literally what pine trees smell like — the most abundant terpene in nature"},{e:"🌿",n:"Rosemary",note:"Rosemary has been associated with memory since ancient Greece — now we know why (pinene)"},{e:"🌿",n:"Dill",note:"Fresh dill's clean, bright scent comes from pinene and other fresh terpenes"},{e:"🌿",n:"Basil",note:"Fresh basil contains both pinene and linalool — the herb of focus AND calm"},{e:"🌿",n:"Parsley",note:"Fresh parsley's clean green aroma is pinene-forward"},{e:"🌲",n:"Cypress",note:"Mediterranean cypress trees release pinene — the fresh air of coastal forests"}],
    hack:"Walk Through Pines: Spending time in a pine forest (shinrin-yoku, or forest bathing) is literally inhaling pinene. The documented cognitive and respiratory benefits of forest bathing partially come from this terpene.",
    exStrains:["Jack Herer","Trainwreck","Blue Dream","Island Sweet Skunk","Dutch Treat","Strawberry Cough"] },
  { name:"Terpinolene", slug:"terpinolene", color:"#74C69D", tag:"The Multidimensional", family:"Fresh", bp:186, bpF:367,
    aroma:"Pine · Floral · Herbs · Citrus · Sweet",
    effect:"Mildly sedating despite its fresh, invigorating aroma. The most complex smell profile of any terpene — simultaneously piney, floral, citrusy, and sweet. Rare as a dominant terpene, highly prized when present. The signature of Jack Herer lineage strains.",
    receptorNote:"Terpinolene's receptor activity is the least studied of the major terpenes, but research suggests it acts on multiple systems simultaneously — creating its paradoxical profile of smelling invigorating while producing mild sedation.",
    medical:["Antioxidant","Antibacterial","Antifungal","Mild sedation","Anti-tumor (early research)"],
    nature:[{e:"🍎",n:"Apples",note:"The fresh, slightly floral scent of apple skin contains terpinolene"},{e:"🌸",n:"Lilac",note:"Lilac's sweet-fresh floral burst is largely terpinolene — one of the most distinctive natural sources"},{e:"🌿",n:"Cumin",note:"Earthy cumin contains terpinolene alongside other spice terpenes"},{e:"🌰",n:"Nutmeg",note:"Nutmeg's warm-sweet-herbal complexity includes terpinolene"},{e:"🌲",n:"Fir trees",note:"Fir needle essential oil is a major terpinolene source — that sharp, clean mountain forest smell"},{e:"🌿",n:"Sage",note:"Sage contains terpinolene alongside thujone — contributing to its complex, medicinal aroma"}],
    hack:"The Jack Herer Fingerprint: If a strain smells simultaneously fresh, herbal, and subtly sweet — almost like walking through an herb garden in spring — you're likely smelling terpinolene. It's the signature of Jack Herer and its descendants.",
    exStrains:["Jack Herer","Ghost Train Haze","Golden Goat","XJ-13","Dutch Treat","Durban Poison"] },
  { name:"Humulene", slug:"humulene", color:"#3D9970", tag:"The Appetite Suppressant", family:"Earthy", bp:198, bpF:388,
    aroma:"Earthy · Woody · Hoppy · Herbal · Spicy",
    effect:"Anti-inflammatory, antibacterial, appetite-suppressing. The only common cannabis terpene associated with appetite reduction — unusual for a plant known for the munchies. Used in traditional Chinese medicine for centuries. Hoppy IPA drinkers know this terpene well.",
    receptorNote:"Humulene interacts with both CB1 and CB2 receptors as a modulator — not a direct agonist. Research suggests it suppresses appetite by modulating the endocannabinoid pathways that regulate hunger, making it the rare cannabis terpene that reduces rather than increases appetite.",
    medical:["Appetite suppression","Anti-inflammatory","Antibacterial","Anti-tumor (research)","Analgesic"],
    nature:[{e:"🍺",n:"Hops",note:"Humulene is named after Humulus lupulus — the hop plant. The backbone of IPA bitterness and herbaceous character"},{e:"🌿",n:"Basil",note:"Fresh basil contains humulene alongside linalool — contributing to its complex profile"},{e:"🌿",n:"Cloves",note:"Cloves contain both caryophyllene and humulene — the dual-spice combination in many classic strains"},{e:"🫚",n:"Coriander",note:"Coriander seeds contain humulene — used across traditional medicine for digestion"},{e:"🌿",n:"Ginseng",note:"Korean red ginseng is rich in humulene — possibly contributing to its adaptogenic properties"},{e:"🌲",n:"Balsam Poplar",note:"Northern balsam poplar trees release humulene — the deep earthy smell of northern forests"}],
    hack:"The IPA Connection: If you love hoppy IPAs for their earthy, herbal bite but not for feeling hungry afterward — that's humulene working. Strains dominant in humulene actually suppress appetite rather than stimulating it.",
    exStrains:["Girl Scout Cookies","Headband","White Widow","Skywalker OG","Death Star","Original Glue"] },
  { name:"Ocimene", slug:"ocimene", color:"#5B8DD9", tag:"The Tropical Uplifter", family:"Floral", bp:65, bpF:149,
    aroma:"Sweet · Herbal · Floral · Woody · Tropical",
    effect:"Uplifting, energizing, antiviral, antifungal, decongestant. The tropical sweetness in sativa strains. Creates a bright, clean, sweet-herbal profile. Often present alongside limonene in energetic euphoric hybrids.",
    receptorNote:"Ocimene doesn't directly bind cannabinoid receptors but demonstrates significant antiviral and antifungal activity through separate pathways. Its extremely low boiling point (65C) means it's the first terpene you smell when a jar is opened.",
    medical:["Antiviral","Antifungal","Decongestant","Anti-inflammatory","Antibacterial"],
    nature:[{e:"🌿",n:"Mint",note:"Mint contains ocimene alongside menthol — contributing to its fresh, sweet complexity"},{e:"🌿",n:"Parsley",note:"Fresh parsley's green-sweet aroma includes significant ocimene"},{e:"🌿",n:"Thai Basil",note:"Thai basil especially is high in ocimene — that distinctive sweet-anise quality"},{e:"🌸",n:"Orchids",note:"Many orchid species use ocimene to attract pollinators with their sweet tropical scent"},{e:"🥭",n:"Mangoes",note:"Alongside myrcene, ocimene contributes to mango's complex tropical sweetness"},{e:"🌸",n:"Bergamot",note:"Bergamot orange peel (the flavor in Earl Grey tea) contains significant ocimene"}],
    hack:"The First Smell: Ocimene has the lowest boiling point of common cannabis terpenes — it's the very first thing you smell when you open a jar of fresh cannabis. That immediate sweet, tropical, herbal blast? That's ocimene.",
    exStrains:["Clementine","Golden Goat","Space Queen","Dutch Treat","Strawberry Cough","Green Crack"] },
  { name:"Bisabolol", slug:"bisabolol", color:"#52A875", tag:"The Skin Healer", family:"Floral", bp:153, bpF:307,
    aroma:"Floral · Sweet · Chamomile · Honey · Vanilla",
    effect:"Calming, anti-irritant, skin-healing, anti-inflammatory. The primary terpene in chamomile. Exceptional skin-healing properties — reduces redness, soothes irritation. Found in many luxury skincare products.",
    receptorNote:"Bisabolol inhibits multiple inflammatory pathways and has demonstrated direct anti-inflammatory activity in skin tissue. It also enhances the absorption of other compounds through skin — making it valuable in topical cannabis formulations.",
    medical:["Skin healing","Anti-inflammatory","Anti-irritant","Wound healing","Anti-microbial"],
    nature:[{e:"🌼",n:"Chamomile",note:"German chamomile is the richest natural source of bisabolol — the key reason chamomile tea is calming"},{e:"🌿",n:"Echinacea",note:"The immune-supporting herb echinacea contains bisabolol as a key active compound"},{e:"🌿",n:"Verbena",note:"Lemon verbena essential oil contains bisabolol alongside citral"},{e:"🌲",n:"Sandalwood",note:"Sandalwood's smooth, warm complexity includes bisabolol"},{e:"🫚",n:"Candeia tree",note:"Brazilian candeia bark is one of the highest natural bisabolol concentrations — used in premium cosmetics"},{e:"🌸",n:"Vanilla",note:"Alongside vanillin, bisabolol contributes to vanilla's soothing, warm sweetness"}],
    hack:"The Chamomile Connection: If chamomile tea reliably calms you, bisabolol-rich cannabis strains (often CBD-dominant) will have a similar soothing effect. It's the same terpene activating the same pathways.",
    exStrains:["ACDC","Harle-Tsu","OG Shark","Headband","Oracle","Pink Kush"] },
  { name:"Nerolidol", slug:"nerolidol", color:"#2D8C5E", tag:"The Deep Sedative", family:"Earthy", bp:122, bpF:252,
    aroma:"Woody · Fresh Bark · Citrus · Floral · Green",
    effect:"Powerfully sedating, stress-relieving, anti-parasitic. One of the most sedating terpenes in cannabis. Enhances skin absorption — helps other cannabinoids penetrate more effectively. Best for night use.",
    receptorNote:"Nerolidol enhances the absorption of compounds through biological membranes — studied as a penetration enhancer for transdermal drug delivery. In cannabis, it helps other cannabinoids penetrate more effectively, amplifying overall effect.",
    medical:["Insomnia","Anti-parasitic","Anti-fungal","Anxiety","Sedation"],
    nature:[{e:"🌸",n:"Jasmine",note:"Jasmine absolute contains significant nerolidol — contributing to its rich, deep floral sedative quality"},{e:"🌿",n:"Lemongrass",note:"Lemongrass essential oil contains nerolidol alongside citral and myrcene"},{e:"🌿",n:"Tea Tree",note:"Australian tea tree oil contains nerolidol — contributing to its penetrating, antiseptic quality"},{e:"🫚",n:"Ginger",note:"Fresh ginger root contains nerolidol — part of why ginger has warming, penetrating properties"},{e:"💜",n:"Lavender",note:"Lavender contains trace nerolidol alongside its primary linalool"},{e:"🌸",n:"Orange Blossoms",note:"Neroli oil (orange blossom) is a primary nerolidol source — hence the name"}],
    hack:"Nerolidol is the terpene that makes topical cannabis products work better. It opens biological channels that allow cannabinoids to penetrate skin tissue — which is why high-nerolidol strains are often used in topical formulations.",
    exStrains:["Jack Herer","Skywalker OG","Chemdawg","Island Sweet Skunk","Sweet Skunk"] },
  { name:"Geraniol", slug:"geraniol", color:"#7B68C8", tag:"The Floral Protector", family:"Floral", bp:230, bpF:446,
    aroma:"Rose · Geranium · Citrus · Warm Floral · Peach",
    effect:"Calming, stress-relieving, neuroprotective. One of the most potent antioxidant terpenes. The warm floral note that gives rose its signature smell. Repels insects naturally — probably why cannabis produces it.",
    receptorNote:"Geraniol has demonstrated neuroprotective properties — protecting neurons from oxidative stress and showing promise in Alzheimer's and Parkinson's research. It also has direct antioxidant activity, scavenging free radicals that damage cell membranes.",
    medical:["Neuroprotection","Antioxidant","Anti-tumor (research)","Anti-fungal","Antibacterial"],
    nature:[{e:"🌹",n:"Rose",note:"Geraniol is one of the primary compounds in rose essential oil — the warm floral depth of rose"},{e:"🌸",n:"Geranium",note:"The flower is named for its geraniol content — geranium oil is extremely high in this terpene"},{e:"🌿",n:"Lemongrass",note:"Lemongrass contains geraniol alongside myrcene — contributing to its complex tropical character"},{e:"🌸",n:"Citronella",note:"Mosquito-repelling citronella candles work largely through geraniol — cannabis produces it for the same reason"},{e:"🍑",n:"Peach",note:"Ripe peach skin contains geraniol — the warm floral note that makes peaches smell more than just sweet"},{e:"🌸",n:"Palmarosa",note:"Palmarosa (tropical grass) is a commercial geraniol source used in perfumery and cosmetics"}],
    hack:"Natural Bug Repellent: Geraniol is why cannabis plants are naturally pest-resistant. The terpene repels insects. High-geraniol strains grown outdoors tend to have fewer pest problems — the plant is protecting itself.",
    exStrains:["Headband","Master Kush","Afghani","OG Shark","Amnesia","Great White Shark"] },
  { name:"Terpineol", slug:"terpineol", color:"#D4A853", tag:"The Relaxing Floral", family:"Floral", bp:218, bpF:424,
    aroma:"Floral · Citrus · Sweet · Lilac · Pine",
    effect:"Calming, sedating, stress-relieving. Often found alongside linalool in indica strains, amplifying sedation. Produces a relaxed, pleasant body feeling with mild euphoria. The lilac-pine floral note of many classic indicas.",
    receptorNote:"Terpineol has demonstrated sedative properties in animal studies — reducing movement activity and inducing sleep at sufficient doses. It appears to interact with GABA pathways similarly to linalool, producing calming effects.",
    medical:["Insomnia","Anti-anxiety","Anti-inflammatory","Antioxidant","Antibacterial"],
    nature:[{e:"🌸",n:"Linden Blossoms",note:"Linden flowers are high in terpineol — used in traditional sleep teas across Europe"},{e:"🍋",n:"Lime",note:"Lime peel contains terpineol alongside limonene — part of lime's complex citrus-floral profile"},{e:"🌿",n:"Eucalyptus",note:"Eucalyptus oil contains terpineol — amplifying its respiratory-opening properties"},{e:"🌲",n:"Pine",note:"Some pine varieties contain terpineol alongside pinene — contributing to their layered complexity"},{e:"🌸",n:"Petitgrain",note:"Petitgrain oil (from orange tree leaves) is a major terpineol source in natural perfumery"},{e:"🌸",n:"Lilac",note:"Lilac's sweet, nostalgic spring scent comes largely from terpineol"}],
    hack:"The Lilac Effect: If you've ever felt inexplicably calm walking past blooming lilacs in spring, terpineol was working on you. Strains with combined linalool and terpineol amplify each other's sedative effects.",
    exStrains:["OG Kush","White Widow","Jack Herer","Girl Scout Cookies","Fire OG"] },
  { name:"Valencene", slug:"valencene", color:"#F5A623", tag:"The Citrus Peel", family:"Citrus", bp:254, bpF:489,
    aroma:"Sweet Orange · Citrus · Fresh · Woody · Grapefruit",
    effect:"Uplifting, energizing, mood-brightening. Similar to limonene but with a softer, sweeter citrus quality. Found in citrus fruit peel and some exotic cannabis strains. The orange-soda terpene.",
    receptorNote:"Valencene demonstrates anti-inflammatory and insect-repelling properties. Named for Valencia oranges, it acts on inflammatory pathways similar to caryophyllene but with less direct receptor binding activity.",
    medical:["Anti-inflammatory","Antifungal","Insect repellent","Mood elevation","Nausea relief"],
    nature:[{e:"🍊",n:"Valencia Oranges",note:"Named for the variety — Valencia orange peel is extremely high in valencene"},{e:"🍊",n:"Tangerines",note:"The bright, sweet citrus pop of tangerines comes largely from valencene"},{e:"🍊",n:"Grapefruit",note:"Alongside limonene, valencene creates grapefruit's distinctive sweet-tart profile"},{e:"🫐",n:"Nectarines",note:"Ripe nectarine skin contains valencene — part of their summer-fruit sweetness"},{e:"🍹",n:"Mango",note:"Mango's tropical sweetness includes valencene alongside myrcene and ocimene"},{e:"🌿",n:"Herbs",note:"Some Mediterranean herbs contain trace valencene as part of complex volatile profiles"}],
    hack:"The Tangie Test: Tangie and its family (Clementine, Agent Orange, Mimosa) are the highest-valencene strains. If you love the orange-soda sweetness of Tangie, you're a valencene person — seek it in other strains.",
    exStrains:["Tangie","Clementine","Agent Orange","Mimosa","Sour Tangie"] },
  { name:"Farnesene", slug:"farnesene", color:"#4A7BC4", tag:"The Green Apple", family:"Fresh", bp:222, bpF:432,
    aroma:"Floral · Fresh · Green Apple · Citrus · Woody",
    effect:"Calming, stress-relieving, anti-inflammatory, antibacterial. Contributes a fresh, green-apple quality to strains. Found in apples, hops, and flowers. Often overlooked but important to overall terpene profiles.",
    receptorNote:"Farnesene demonstrates anti-inflammatory activity through multiple pathways and has shown promise in research for its effects on stress response systems. It's also a natural alarm pheromone in plants — cannabis produces it as a stress signal.",
    medical:["Anti-inflammatory","Antibacterial","Skin health","Anti-tumor (early research)","Relaxation"],
    nature:[{e:"🍏",n:"Green Apples",note:"Farnesene is the primary reason green apples smell fresher and more tart than red apples"},{e:"🍺",n:"Hops",note:"German noble hops used in lagers are high in farnesene — the fresh beer quality"},{e:"🌸",n:"Ginger Lily",note:"Ginger lily flowers release farnesene as a floral attractant for pollinators"},{e:"🥬",n:"Chamomile",note:"German chamomile contains farnesene alongside bisabolol — doubling its calming profile"},{e:"🌿",n:"Turmeric",note:"Turmeric rhizomes contain farnesene as part of their complex anti-inflammatory terpene blend"},{e:"🌸",n:"Gardenias",note:"Gardenia's rich, sweet-green floral scent includes farnesene"}],
    hack:"The Green Apple Smell: If a cannabis strain has a distinct green apple, fresh-cut grass, or just-opened-can-of-beer quality, farnesene is likely a significant component of the terpene profile.",
    exStrains:["Skunk #1","Sour Diesel","MAC","Zkittlez","Green Crack"] },
  { name:"Guaiol", slug:"guaiol", color:"#6AAF8E", tag:"The Pine & Rose", family:"Earthy", bp:288, bpF:550,
    aroma:"Pine · Rose · Woody · Floral · Green",
    effect:"Calming, stress-relieving, antimicrobial, anti-inflammatory. The woody-floral terpene with the highest boiling point — it survives temperatures that destroy most others. A finishing terpene that comes through at the end of a vaporizer session.",
    receptorNote:"Guaiol has demonstrated anti-inflammatory, antimicrobial, and insect-repelling properties in research. It has the highest boiling point of common cannabis terpenes — it's active even in high-temperature consumption.",
    medical:["Anti-inflammatory","Antimicrobial","Cough suppressant","Insect repellent","Anti-tumor (early)"],
    nature:[{e:"🌲",n:"Guaiacum",note:"Named for the guaiacum wood tree — South American timber historically used for anti-inflammatory medicine"},{e:"🌹",n:"Rose",note:"Rose absolute contains guaiol — part of rose's deep, complex woody-floral base note"},{e:"🌲",n:"Cypress Pine",note:"Cypress pine wood contains guaiol — that distinctive clean-woody smell of Mediterranean architecture"},{e:"🌿",n:"Nutmeg",note:"Nutmeg contains guaiol alongside other high-boiling sesquiterpenes"},{e:"🌸",n:"Tea Rose",note:"Tea rose varieties are particularly high in guaiol alongside geraniol"},{e:"🌿",n:"Naematoloma",note:"Some edible mushroom species contain guaiol — an unusual cross-kingdom terpene presence"}],
    hack:"The Vaporizer Finish: Guaiol has the highest boiling point (288C) of common cannabis terpenes — it's one of the terpenes vapers taste at the very end of a session when everything else has already vaporized.",
    exStrains:["Plushberry","Pennywise","Blue Kush","Agent Orange","AK-47"] }
];

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

const MJ_SYSTEM_V2 = `You are Mary Jane — cannabis intelligence guide for Cannascenti. You have 12+ years of dispensary floor experience, have guided thousands of patients and customers, and have trained dispensary staff across the country. You know this plant the way a sommelier knows wine — not just the facts, but the stories, the nuance, and the human side.

YOUR VOICE:
Warm, direct, and genuinely opinionated. You speak like a trusted friend who happens to be the best budtender alive. You're not a neutral information dispenser — you have real opinions ("I never recommend Green Crack for anxiety-prone people, and here's exactly why"). You ask follow-up questions when you need more context before recommending. You're honest when something is genuinely complex or debated.

YOUR DEEP KNOWLEDGE (be specific, not generic):
Strains — you know them by name, lineage, and effect profile. When recommending a strain, tell users to check its full profile on Cannascenti at /strains/[name-as-slug]. Examples: /strains/og-kush, /strains/blue-dream, /strains/jack-herer, /strains/granddaddy-purple.

Terpenes you can speak to from experience: Myrcene (most abundant; potentiates THC via CB1; the reason indicas hit harder at the same %; the mango trick is real — eat a ripe mango 45 min before and THC absorption goes up), Limonene (mood elevation, hits serotonin; the bright feeling in anything citrus-forward), Caryophyllene (the only terpene that binds CB2 directly; anti-inflammatory without psychoactivity; why black pepper helps bring you down from too much THC), Linalool (lavender compound; GABA modulator; anxiety and deep sleep), Pinene (alpha-pinene counteracts THC memory fog; opens airways; clearest-headed terpene — if someone hates getting forgetful, look for pinene), Terpinolene (rare as dominant; cerebral and energetic; Jack Herer and Durban Poison are the classics), Ocimene (sweet, tropical, uplifting).

Cannabinoids: THC, CBD (works best with THC; on its own helps anxiety and inflammation), CBN (the sleepy one; what THC breaks down into; great for insomnia), CBG (the "mother cannabinoid"; early research for focus, IBS, glaucoma), THCV (Durban Poison is the famous source; appetite suppression; stimulating and fast-clearing), Delta-8 (about half the anxiety load of Delta-9; smoother high; synthesized from CBD in most cases — transparency matters).

THC and anxiety — you've talked dozens of people through bad experiences on the floor: The dose-response curve is real — low THC doses are anxiolytic, high doses trigger anxiety in genetically susceptible people (FAAH enzyme variation). CBD at 1:1 or higher dramatically cuts THC-induced anxiety. Indica vs sativa matters less than terpene profile — a high-myrcene hybrid will sedate harder than any pure indica label. Set, setting, and mindset are as important as the plant.

Consumption method timing from memory: Flower (2–5 min onset, peak at 20–30 min, 2–3 hrs total), Vape (2–5 min, 1–2 hrs), Edibles (45–90 min onset, 4–8 hrs — the liver converts delta-9 to 11-hydroxy-THC which is 2–3x more potent and psychedelic; "I ate more because I didn't feel it" is the number one edibles mistake), Tinctures sublingual (15–30 min), Dabs/concentrates (near-instant, intense — not for beginners).

Solventless and hash: You've pressed your own rosin. You talk about 73u–90u screens for full melt bubble hash, ice water extraction at cold temperatures, pressing at 160–180°F for rosin (low temp = terp preservation, high temp = yield), live rosin vs cured rosin, dry sift, the difference between 3-star and 6-star hash. You love this topic.

Quality evaluation: jar appeal, bud structure, trichome density under a loupe, the nose (terpene expression), moisture and cure quality, stem snap test, lab panel reading (look at total terpene %, not just THC%).

CANNASCENTI PLATFORM (mention naturally when it helps, never pushy):
- Strain Finder: free AI matching on the homepage — great starting point
- Encyclopedia: /strains (392+ profiles), /terpenes, /cannabinoids, /history, /concentrates, /edibles
- CannaQuant: personal cannabis consulting — for people who want seriously personalized guidance
- Joint Rolling Seminars: Beginner/Intermediate/Advanced
- Solventless Sessions & Hash Nights: premium tasting events
- Budtender Pro: tool for dispensary staff at /budtender-pro

RESPONSE RULES:
- Conversational length: 2–5 sentences for simple questions, more for genuinely complex topics
- Short paragraphs separated by line breaks, not bullet lists
- Use **bold** sparingly for strain names or key terms when it adds clarity
- When recommending a strain: mention the profile link naturally ("check out the full **Blue Dream** profile — /strains/blue-dream")
- End with one follow-up question when you need more to give a real recommendation (experience level? daily or occasional? anxiety history? flower or edibles?)
- Never say "As an AI" — you are Mary Jane, you have floor experience, you have a perspective
- On comparisons ("Blue Dream vs Gelato"): give a real opinion, not just neutral facts
- On anything still debated in cannabis science: be honest — "the research on this is still early"`;


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
  let system = MJ_SYSTEM_V2;
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
    max_tokens: 900,
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

  // ─── Strain lookup: local DB first, AI fallback for unknown strains ──────
  if (req.method === "POST" && req.url === "/api/strain/lookup") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", async () => {
      try {
        const { name } = JSON.parse(body);
        if (!name || typeof name !== "string" || name.length > 200) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid name" }));
          return;
        }
        const q = name.trim().toLowerCase();

        // 1. Try exact match in local DB
        let found = STRAINS_DB.find(s => s.name.toLowerCase() === q);
        // 2. Try partial match
        if (!found) found = STRAINS_DB.find(s => s.name.toLowerCase().includes(q) || q.includes(s.name.toLowerCase()));

        if (found) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ strain: found, source: "local" }));
          return;
        }

        // 3. AI fallback for unknown strains
        const prompt = `You are a cannabis expert with encyclopedic knowledge of all cannabis strains, including rare, regional, and newer varieties.

Generate a detailed strain profile for: "${name.trim()}"

If this is a real strain, provide accurate data. If it's very obscure, provide your best knowledge.
Respond ONLY with a single JSON object (not an array):
{
  "name": string (the proper strain name),
  "type": "Indica" | "Sativa" | "Hybrid",
  "thc_min": number,
  "thc_max": number,
  "cbd": number,
  "description": string (2-3 sentences, evocative and informative),
  "effects": [string] (5 effects, e.g. "Relaxed", "Happy", "Euphoric"),
  "terpenes": [string] (3-4 dominant terpenes),
  "flavors": [string] (3-5 flavors),
  "genetics": string (parent strains, e.g. "OG Kush × Durban Poison" or "Unknown"),
  "tags": [string] (3-5 tags like "daytime", "indica-dom", "creative")
}
No markdown, no explanation, just the JSON object.`;

        const response = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 700,
          messages: [{ role: "user", content: prompt }]
        });

        const text = response.content[0].text.trim();
        const jsonStr = text.startsWith("{") ? text : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
        const strain = JSON.parse(jsonStr);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ strain, source: "ai" }));
      } catch (err) {
        console.error("Strain lookup error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Lookup failed" }));
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
    <a href="/concentrates" style="color:rgba(242,234,216,0.7);text-decoration:none;font-family:Montserrat,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.08)">Concentrates</a>
    <a href="/edibles" style="color:rgba(242,234,216,0.7);text-decoration:none;font-family:Montserrat,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.08)">Edibles</a>

    <a href="/glossary" style="color:rgba(242,234,216,0.7);text-decoration:none;font-family:Montserrat,sans-serif;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:6px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.08)">Glossary</a>
  </div>
</nav>`;

  const ENC_FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Great+Vibes&family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">`;

  const ENC_BASE_CSS = `*{margin:0;padding:0;box-sizing:border-box}body{background:#060d0a;color:#F2EAD8;font-family:Montserrat,sans-serif}a{color:#52B788;text-decoration:none}.enc-page{max-width:1100px;margin:0 auto;padding:60px 32px 120px}.enc-page-header{margin-bottom:56px}.enc-label{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:#52B788;margin-bottom:12px}.enc-title{font-family:'Cormorant Garamond',serif;font-size:clamp(2rem,5vw,3.5rem);font-weight:300;color:#F2EAD8;line-height:1.15;margin-bottom:20px}.enc-title em{font-style:italic;color:#52B788}.enc-desc{font-size:.95rem;line-height:1.8;color:rgba(242,234,216,0.65);max-width:680px}`;

  // ─── /terpenes ──────────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/terpenes") {
    const _TERP = [
      { name:"Myrcene", tag:"The Most Abundant", color:"#E07B39", aroma:"Earthy · Musky · Tropical · Cloves", family:"Earthy", bp:168, bpF:334,
        receptor:"CB1 Potentiator", receptorSide:"cb1",
        receptorNote:"Myrcene increases cell membrane permeability, allowing THC to cross the blood-brain barrier faster and in greater quantity. More myrcene = faster onset, stronger effect. This is why indica strains hit harder even at the same THC percentage.",
        effect:"Heavy relaxation, couch-lock, sedating. The classic indica terpene. High myrcene = indica-leaning experience regardless of strain type. The single biggest predictor of whether a strain will be sedating or activating.",
        medical:["Pain relief","Anti-inflammatory","Muscle relaxant","Sleep aid","Anti-anxiety"],
        strains:["OG Kush","Blue Dream","Granddaddy Purple","Mango Kush","White Widow","Grape Ape"],
        nature:[
          {e:"🥭",n:"Mango",note:"Ripe mangoes are loaded with myrcene — eating one 45 min before cannabis significantly boosts THC absorption"},
          {e:"🍺",n:"Hops",note:"Cannabis and hops are botanical cousins. The earthy backbone of IPAs comes from shared myrcene genetics"},
          {e:"🌿",n:"Thyme",note:"Dried thyme is one of the highest myrcene herbs in your kitchen"},
          {e:"🍋",n:"Lemongrass",note:"Primary aromatic compound in lemongrass essential oil"},
          {e:"🫐",n:"Bay Leaves",note:"The earthy depth of bay laurel leaves comes largely from myrcene"},
          {e:"🍊",n:"Grapefruit",note:"Myrcene alongside limonene creates the citrus-earth complexity of grapefruit"}
        ],
        hack:"The Mango Trick: Eating a ripe mango 45 minutes before cannabis can noticeably increase the strength and duration of effects. The myrcene in mango primes your CB1 receptors, lowering the threshold for THC binding."
      },
      { name:"Limonene", tag:"The Mood Lifter", color:"#F5C842", aroma:"Citrus · Lemon · Orange · Lime", family:"Citrus", bp:176, bpF:349,
        receptor:"Serotonin & Dopamine", receptorSide:"serotonin",
        receptorNote:"Limonene doesn't bind cannabinoid receptors directly but interacts powerfully with serotonin (5-HT1A) and dopamine receptors — the same pathways targeted by antidepressants and anxiolytics. It literally talks to your mood system.",
        effect:"Uplifting, euphoric, stress-relieving, refreshing. Drives that bright, social, happy high. The most mood-elevating terpene in cannabis. High limonene strains are reliably energetic and anxiety-reducing.",
        medical:["Anxiety & depression","Stress relief","Acid reflux","Antifungal","Immune support"],
        strains:["Lemon Haze","Durban Poison","Super Lemon OG","Wedding Cake","Banana OG","Strawberry Banana"],
        nature:[
          {e:"🍋",n:"Lemon peel",note:"The most concentrated natural source — lemon essential oil is nearly pure limonene"},
          {e:"🍊",n:"Orange rind",note:"The characteristic smell of orange peel is almost entirely limonene"},
          {e:"🍈",n:"Grapefruit",note:"Grapefruit's bright, slightly bitter top note is limonene-driven"},
          {e:"🌲",n:"Juniper berries",note:"Gin's distinctive piney-citrus quality comes from juniper limonene"},
          {e:"🌿",n:"Rosemary",note:"Alongside camphor, limonene gives rosemary its bright, uplifting scent"},
          {e:"🧹",n:"Cleaning products",note:"Nearly every citrus cleaner uses limonene — it's literally the smell of 'clean'"}
        ],
        hack:"The Citrus Squeeze: Smelling fresh lemon or orange peel can immediately produce a mild limonene effect — the same terpene activating your serotonin receptors is now in your nostrils."
      },
      { name:"Caryophyllene", tag:"Binds CB2 Directly", color:"#D95F3B", aroma:"Peppery · Woody · Clove · Cinnamon · Spice", family:"Spice", bp:160, bpF:320,
        receptor:"CB2 Direct Binder", receptorSide:"cb2",
        receptorNote:"Caryophyllene is the ONLY terpene that directly binds to cannabinoid receptors — specifically CB2 receptors in the immune system and peripheral nervous system. This makes it technically both a terpene AND a dietary cannabinoid. The FDA classifies it as GRAS (Generally Recognized As Safe).",
        effect:"Anti-inflammatory, pain-relieving, calming. Significantly reduces systemic inflammation without psychoactive effects. The immune system terpene. Why some people crush black pepper to ease an overwhelming high.",
        medical:["Chronic pain","Anti-inflammatory","Anxiety","Alcohol craving reduction","Ulcer protection"],
        strains:["Girl Scout Cookies","Sour Diesel","Bubba Kush","Chemdawg","Gorilla Glue","Purple Punch"],
        nature:[
          {e:"🫙",n:"Black Pepper",note:"The dominant terpene in black pepper — cracking pepper under your nose activates CB2 receptors immediately"},
          {e:"🌶️",n:"Cloves",note:"Cloves are so rich in caryophyllene they've been used as pain relief for toothaches for centuries"},
          {e:"🍂",n:"Cinnamon",note:"That warm, spicy cinnamon note? Largely caryophyllene alongside eugenol"},
          {e:"🌿",n:"Basil",note:"Fresh basil contains significant caryophyllene alongside other terpenes"},
          {e:"🌿",n:"Oregano",note:"Mediterranean cooking's signature herb is rich in caryophyllene"},
          {e:"🍺",n:"Hops",note:"Alongside myrcene, caryophyllene gives hoppy beers their spicy, resinous character"}
        ],
        hack:"The Black Pepper Trick: Chewing or smelling black peppercorns can take the edge off an overwhelming high. Caryophyllene binds CB2 receptors and has a grounding, calming effect on the endocannabinoid system."
      },
      { name:"Linalool", tag:"Nature's Anxiety Reducer", color:"#9B72CF", aroma:"Floral · Lavender · Sweet · Spice", family:"Floral", bp:198, bpF:388,
        receptor:"GABA System", receptorSide:"gaba",
        receptorNote:"Linalool activates GABA receptors — the brain's primary inhibitory system that reduces neural excitation. This is the same system activated by benzodiazepines (Valium, Xanax) and alcohol. Linalool is nature's built-in nervous system calmer.",
        effect:"Deeply calming, sedating, anxiolytic. The reason lavender aromatherapy demonstrably reduces anxiety in clinical settings. The most peaceful, easiest sedation in cannabis — less heavy than myrcene, more gently flowing.",
        medical:["Anxiety & stress","Insomnia","Anticonvulsant (research)","Depression","Pain & inflammation"],
        strains:["Lavender Kush","LA Confidential","Amnesia Haze","Dosido","Master Kush","Zkittlez"],
        nature:[
          {e:"💜",n:"Lavender",note:"Lavender essential oil is the richest natural linalool source — over 50% of its oil is linalool"},
          {e:"🌸",n:"Jasmine",note:"Jasmine's intoxicating floral sweetness comes from linalool alongside benzyl acetate"},
          {e:"🌿",n:"Basil",note:"Sweet basil contains linalool alongside ocimene, creating its complex floral-herb profile"},
          {e:"🌲",n:"Birch trees",note:"Birch bark and leaves contain linalool — the forest-calm of birch forests is partly linalool"},
          {e:"🫚",n:"Coriander",note:"Coriander seeds are a significant linalool source — used in many calming herbal traditions"},
          {e:"🌹",n:"Rose",note:"Rose's calming, romantic aroma is largely linalool working its GABA magic"}
        ],
        hack:"The Lavender Test: If lavender aromatherapy genuinely calms you down, linalool-dominant cannabis strains will too. Your brain's response to linalool is consistent across delivery methods."
      },
      { name:"Pinene", tag:"The Alertness Terpene", color:"#52B788", aroma:"Pine · Forest · Fresh · Rosemary · Herbs", family:"Fresh", bp:155, bpF:311,
        receptor:"Acetylcholinesterase Inhibitor", receptorSide:"memory",
        receptorNote:"Pinene inhibits acetylcholinesterase — the enzyme that breaks down acetylcholine, the neurotransmitter responsible for memory, learning, and focus. This is why pinene-dominant strains can actually counteract THC's short-term memory effects.",
        effect:"Promotes alertness and memory retention. Opens airways (bronchodilator). One of the few compounds that counteracts THC's memory impairment. The 'focus' terpene. High pinene strains are clear-headed despite being potent.",
        medical:["Memory retention","Asthma & bronchodilation","Anti-inflammatory","Antiseptic","Anxiety"],
        strains:["Jack Herer","Trainwreck","Blue Dream","Island Sweet Skunk","Dutch Treat","Strawberry Cough"],
        nature:[
          {e:"🌲",n:"Pine needles",note:"Alpha-pinene is literally what pine trees smell like — the most abundant terpene in nature"},
          {e:"🌿",n:"Rosemary",note:"Rosemary has been associated with memory since ancient Greece — now we know why (pinene)"},
          {e:"🌿",n:"Dill",note:"Fresh dill's clean, bright scent comes from pinene and other fresh terpenes"},
          {e:"🌿",n:"Basil",note:"Fresh basil contains both pinene and linalool — the herb of focus AND calm"},
          {e:"🫚",n:"Parsley",note:"Fresh parsley's clean green aroma is pinene-forward"},
          {e:"🌲",n:"Cypress",note:"Mediterranean cypress trees release pinene — the 'fresh air' of coastal forests"}
        ],
        hack:"Walk Through Pines: Spending time in a pine forest (shinrin-yoku, or forest bathing) is literally inhaling pinene. The documented cognitive and respiratory benefits of forest bathing partially come from this terpene."
      },
      { name:"Terpinolene", tag:"The Multidimensional", color:"#74C69D", aroma:"Pine · Floral · Herbs · Citrus · Sweet", family:"Fresh", bp:186, bpF:367,
        receptor:"Mild Sedative Pathways", receptorSide:"sedative",
        receptorNote:"Terpinolene's receptor activity is the least studied of the major terpenes, but research suggests it acts on multiple systems simultaneously — creating its paradoxical profile of smelling invigorating while producing mild sedation.",
        effect:"Mildly sedating despite its fresh, invigorating aroma. The most complex smell profile of any terpene — simultaneously piney, floral, citrusy, and sweet. Rare as a dominant terpene, highly prized when present. The signature of Jack Herer lineage strains.",
        medical:["Antioxidant","Antibacterial","Antifungal","Mild sedation","Anti-tumor (early research)"],
        strains:["Jack Herer","Ghost Train Haze","Golden Goat","XJ-13","Dutch Treat","Super Lemon Haze"],
        nature:[
          {e:"🍎",n:"Apples",note:"The fresh, slightly floral scent of apple skin contains terpinolene"},
          {e:"🌸",n:"Lilac",note:"Lilac's sweet-fresh floral burst is largely terpinolene — one of the most distinctive natural sources"},
          {e:"🌿",n:"Cumin",note:"Earthy cumin contains terpinolene alongside other spice terpenes"},
          {e:"🌰",n:"Nutmeg",note:"Nutmeg's warm-sweet-herbal complexity includes terpinolene"},
          {e:"🌲",n:"Fir trees",note:"Fir needle essential oil is a major terpinolene source — that sharp, clean mountain forest smell"},
          {e:"🌿",n:"Sage",note:"Sage contains terpinolene alongside thujone — contributing to its complex, medicinal aroma"}
        ],
        hack:"The Jack Herer Fingerprint: If a strain smells simultaneously fresh, herbal, and subtly sweet — almost like walking through an herb garden in spring — you're likely smelling terpinolene. It's the signature of Jack Herer and its descendants."
      },
      { name:"Humulene", tag:"The Appetite Suppressant", color:"#3D9970", aroma:"Earthy · Woody · Hoppy · Herbal · Spicy", family:"Earthy", bp:198, bpF:388,
        receptor:"CB1 & CB2 Modulator", receptorSide:"cb2",
        receptorNote:"Humulene interacts with both CB1 and CB2 receptors as a modulator — not a direct agonist. Research suggests it suppresses appetite by modulating the endocannabinoid pathways that regulate hunger, making it the rare cannabis terpene that reduces rather than increases appetite.",
        effect:"Anti-inflammatory, antibacterial, appetite-suppressing. The only common cannabis terpene associated with appetite reduction (vs. the infamous munchies). Used in traditional Chinese medicine for centuries. Hoppy IPA drinkers know this terpene well.",
        medical:["Appetite suppression","Anti-inflammatory","Antibacterial","Anti-tumor (research)","Analgesic"],
        strains:["Girl Scout Cookies","Headband","White Widow","Skywalker OG","Death Star","Original Glue"],
        nature:[
          {e:"🍺",n:"Hops",note:"Humulene is named after Humulus lupulus — the hop plant. The backbone of IPA bitterness and herbaceous character"},
          {e:"🌿",n:"Basil",note:"Fresh basil contains humulene alongside linalool — contributing to its complex profile"},
          {e:"🌿",n:"Cloves",note:"Cloves contain both caryophyllene and humulene — the dual-spice combination in many classic strains"},
          {e:"🫚",n:"Coriander",note:"Coriander seeds contain humulene — used across traditional medicine for digestion"},
          {e:"🌿",n:"Ginseng",note:"Korean red ginseng is rich in humulene — possibly contributing to its adaptogenic properties"},
          {e:"🌲",n:"Balsam Poplar",note:"Northern balsam poplar trees release humulene — the deep earthy smell of northern forests"}
        ],
        hack:"The IPA Connection: If you love hoppy IPAs for their earthy, herbal bite but not for feeling hungry afterward — that's humulene working. Strains dominant in humulene (alongside myrcene) actually suppress appetite rather than stimulating it."
      },
      { name:"Ocimene", tag:"The Tropical Uplifter", color:"#5B8DD9", aroma:"Sweet · Herbal · Floral · Woody · Tropical", family:"Floral", bp:65, bpF:149,
        receptor:"Antiviral Pathways", receptorSide:"immune",
        receptorNote:"Ocimene doesn't directly bind cannabinoid receptors but demonstrates significant antiviral and antifungal activity through separate pathways. Research suggests it may activate immune response channels. Its extremely low boiling point means it's the first terpene you smell when a jar is opened.",
        effect:"Uplifting, energizing, antiviral, antifungal, decongestant. The tropical sweetness in sativa strains. Often present alongside limonene in energetic euphoric hybrids. Creates a bright, clean, sweet-herbal profile.",
        medical:["Antiviral","Antifungal","Decongestant","Anti-inflammatory","Antibacterial"],
        strains:["Clementine","Golden Goat","Space Queen","Dutch Treat","Strawberry Cough","Green Crack"],
        nature:[
          {e:"🌿",n:"Mint",note:"Mint contains ocimene alongside menthol — contributing to its fresh, sweet complexity"},
          {e:"🌿",n:"Parsley",note:"Fresh parsley's green-sweet aroma includes significant ocimene"},
          {e:"🌿",n:"Basil",note:"Thai basil especially is high in ocimene — that distinctive sweet-anise quality"},
          {e:"🌸",n:"Orchids",note:"Many orchid species use ocimene to attract pollinators with their sweet tropical scent"},
          {e:"🥭",n:"Mangoes",note:"Alongside myrcene, ocimene contributes to mango's complex tropical sweetness"},
          {e:"🌸",n:"Bergamot",note:"Bergamot orange peel (the flavor in Earl Grey tea) contains significant ocimene"}
        ],
        hack:"The First Smell: Ocimene has the lowest boiling point of common cannabis terpenes — it's the very first thing you smell when you open a jar of fresh cannabis. If you get an immediate sweet, tropical, herbal blast, that's ocimene hitting your nose first."
      },
      { name:"Linalool", tag:"Nature's Anxiety Reducer", color:"#9B72CF", aroma:"Floral · Lavender · Sweet · Spice", family:"Floral", bp:198, bpF:388,
        receptor:"GABA System", receptorSide:"gaba",
        receptorNote:"Linalool activates GABA receptors — the brain's primary inhibitory system that reduces neural excitation. This is the same system activated by benzodiazepines (Valium, Xanax) and alcohol. Linalool is nature's built-in nervous system calmer.",
        effect:"Deeply calming, sedating, anxiolytic. The reason lavender aromatherapy demonstrably reduces anxiety in clinical settings. The most peaceful, easiest sedation in cannabis — less heavy than myrcene, more gently flowing.",
        medical:["Anxiety & stress","Insomnia","Anticonvulsant (research)","Depression","Pain & inflammation"],
        strains:["Lavender Kush","LA Confidential","Amnesia Haze","Dosido","Master Kush","Zkittlez"],
        nature:[
          {e:"💜",n:"Lavender",note:"Lavender essential oil is the richest natural linalool source — over 50% of its oil is linalool"},
          {e:"🌸",n:"Jasmine",note:"Jasmine's intoxicating floral sweetness comes from linalool alongside benzyl acetate"},
          {e:"🌿",n:"Basil",note:"Sweet basil contains linalool alongside ocimene, creating its complex floral-herb profile"},
          {e:"🌲",n:"Birch trees",note:"Birch bark and leaves contain linalool — the forest-calm of birch forests is partly linalool"},
          {e:"🫚",n:"Coriander",note:"Coriander seeds are a significant linalool source — used in many calming herbal traditions"},
          {e:"🌹",n:"Rose",note:"Rose's calming, romantic aroma is largely linalool working its GABA magic"}
        ],
        hack:"The Lavender Test: If lavender aromatherapy genuinely calms you down, linalool-dominant cannabis strains will too. Your brain's response to linalool is consistent across delivery methods."
      },
      { name:"Bisabolol", tag:"The Skin Healer", color:"#52A875", aroma:"Floral · Sweet · Chamomile · Honey · Vanilla", family:"Floral", bp:153, bpF:307,
        receptor:"Anti-inflammatory Pathways", receptorSide:"immune",
        receptorNote:"Bisabolol inhibits multiple inflammatory pathways and has demonstrated direct anti-inflammatory activity in skin tissue. It also enhances the absorption of other compounds through skin — making it valuable in topical cannabis formulations.",
        effect:"Calming, anti-irritant, skin-healing, anti-inflammatory. The primary terpene in chamomile. Exceptional skin-healing properties — reduces redness, soothes irritation. Found in many luxury skincare products.",
        medical:["Skin healing","Anti-inflammatory","Anti-irritant","Wound healing","Anti-microbial"],
        strains:["ACDC","Harle-Tsu","OG Shark","Headband","Oracle","Pink Kush"],
        nature:[
          {e:"🌼",n:"Chamomile",note:"German chamomile is the richest natural source of bisabolol — the key reason chamomile tea is calming"},
          {e:"🌿",n:"Echinacea",note:"The immune-supporting herb echinacea contains bisabolol as a key active compound"},
          {e:"🌿",n:"Verbena",note:"Lemon verbena essential oil contains bisabolol alongside citral"},
          {e:"🌲",n:"Sandalwood",note:"Sandalwood's smooth, warm complexity includes bisabolol"},
          {e:"🫚",n:"Candeia tree",note:"Brazilian candeia tree bark is one of the highest natural bisabolol concentrations — used in premium cosmetics"},
          {e:"🌸",n:"Vanilla",note:"Alongside vanillin, bisabolol contributes to vanilla's soothing, warm sweetness"}
        ],
        hack:"The Chamomile Connection: If chamomile tea reliably calms you, bisabolol-rich cannabis strains (often CBD-dominant) will have a similar soothing effect. It's the same terpene activating the same pathways."
      },
      { name:"Nerolidol", tag:"The Deep Sedative", color:"#2D8C5E", aroma:"Woody · Fresh Bark · Citrus · Floral · Green", family:"Earthy", bp:122, bpF:252,
        receptor:"Sedative & Skin Penetration", receptorSide:"sedative",
        receptorNote:"Nerolidol enhances the absorption of compounds through biological membranes — it's been studied as a 'penetration enhancer' for transdermal drug delivery. In cannabis, this means it helps other cannabinoids and terpenes penetrate more effectively, amplifying overall effect.",
        effect:"Powerfully sedating, stress-relieving, anti-parasitic. One of the most sedating terpenes in cannabis. Enhances skin absorption — helps other cannabinoids penetrate more effectively. Best for night use.",
        medical:["Insomnia","Anti-parasitic","Anti-fungal","Anxiety","Sedation"],
        strains:["Jack Herer","Skywalker OG","Chemdawg","Island Sweet Skunk","Sweet Skunk"],
        nature:[
          {e:"🌸",n:"Jasmine",note:"Jasmine absolute contains significant nerolidol — contributing to its rich, deep floral sedative quality"},
          {e:"🌿",n:"Lemongrass",note:"Lemongrass essential oil contains nerolidol alongside citral and myrcene"},
          {e:"🌿",n:"Tea Tree",note:"Australian tea tree oil contains nerolidol — contributing to its penetrating, antiseptic quality"},
          {e:"🫚",n:"Ginger",note:"Fresh ginger root contains nerolidol — part of why ginger has warming, penetrating properties"},
          {e:"💜",n:"Lavender",note:"Lavender contains trace nerolidol alongside its primary linalool"},
          {e:"🌸",n:"Orange blossoms",note:"Neroli oil (orange blossom) is a primary nerolidol source — hence the name"}
        ],
        hack:"Nerolidol is the terpene that makes topical cannabis products work better. It opens biological channels that allow cannabinoids to penetrate skin tissue — which is why high-nerolidol strains are often used in topical formulations."
      },
      { name:"Geraniol", tag:"The Floral Protector", color:"#7B68C8", aroma:"Rose · Geranium · Citrus · Warm Floral · Peach", family:"Floral", bp:230, bpF:446,
        receptor:"Neuroprotective Pathways", receptorSide:"neuro",
        receptorNote:"Geraniol has demonstrated neuroprotective properties in research — it protects neurons from oxidative stress and shows promise in Alzheimer's and Parkinson's research. It also has direct antioxidant activity, scavenging free radicals that damage cell membranes.",
        effect:"Calming, stress-relieving, neuroprotective. One of the most potent antioxidant terpenes. The warm floral note that gives rose its signature smell. Repels insects naturally — probably why cannabis produces it.",
        medical:["Neuroprotection","Antioxidant","Anti-tumor (research)","Anti-fungal","Antibacterial"],
        strains:["Headband","Master Kush","Afghani","OG Shark","Amnesia","Great White Shark"],
        nature:[
          {e:"🌹",n:"Rose",note:"Geraniol is one of the primary compounds in rose essential oil — the warm floral depth of rose"},
          {e:"🌸",n:"Geranium",note:"The flower is named for its geraniol content — geranium oil is extremely high in this terpene"},
          {e:"🌿",n:"Lemongrass",note:"Lemongrass contains geraniol alongside myrcene — contributing to its complex tropical character"},
          {e:"🌸",n:"Citronella",note:"Mosquito-repelling citronella candles work largely through geraniol — cannabis produces it for the same reason"},
          {e:"🍑",n:"Peach",note:"Ripe peach skin contains geraniol — the warm floral note that makes peaches smell more than just sweet"},
          {e:"🌸",n:"Palmarosa grass",note:"Palmarosa (tropical grass) is a commercial geraniol source used in perfumery and cosmetics"}
        ],
        hack:"Natural Bug Repellent: Geraniol is why cannabis plants are naturally pest-resistant. The terpene repels insects. High-geraniol strains grown outdoors tend to have fewer pest problems — the plant is protecting itself."
      },
      { name:"Terpineol", tag:"The Relaxing Floral", color:"#D4A853", aroma:"Floral · Citrus · Sweet · Lilac · Pine", family:"Floral", bp:218, bpF:424,
        receptor:"Sedative Pathways", receptorSide:"sedative",
        receptorNote:"Terpineol has demonstrated sedative properties in animal studies — reducing movement activity and inducing sleep at sufficient doses. It appears to interact with GABA pathways similarly to linalool, producing calming effects.",
        effect:"Calming, sedating, stress-relieving. Often found alongside linalool in indica strains, amplifying sedation. Produces a relaxed, pleasant body feeling with mild euphoria. The lilac-pine floral note of many classic indicas.",
        medical:["Insomnia","Anti-anxiety","Anti-inflammatory","Antioxidant","Antibacterial"],
        strains:["OG Kush","White Widow","Jack Herer","Girl Scout Cookies","Fire OG"],
        nature:[
          {e:"🌸",n:"Linden blossoms",note:"Linden (basswood) flowers are high in terpineol — used in traditional sleep teas across Europe"},
          {e:"🍋",n:"Lime",note:"Lime peel contains terpineol alongside limonene — part of lime's complex citrus-floral profile"},
          {e:"🌿",n:"Eucalyptus",note:"Eucalyptus oil contains terpineol — amplifying its respiratory-opening properties"},
          {e:"🌲",n:"Pine",note:"Some pine varieties contain terpineol alongside pinene — contributing to their layered complexity"},
          {e:"🌸",n:"Petitgrain",note:"Petitgrain oil (from orange tree leaves) is a major terpineol source in natural perfumery"},
          {e:"🌸",n:"Lilac",note:"Lilac's sweet, nostalgic spring scent comes largely from terpineol"}
        ],
        hack:"The Lilac Effect: If you've ever felt inexplicably calm walking past blooming lilacs in spring, terpineol was working on you. Strains with combined linalool and terpineol amplify each other's sedative effects."
      },
      { name:"Farnesene", tag:"The Green Apple", color:"#4A7BC4", aroma:"Floral · Fresh · Green Apple · Citrus · Woody", family:"Fresh", bp:222, bpF:432,
        receptor:"Anti-inflammatory Pathways", receptorSide:"immune",
        receptorNote:"Farnesene demonstrates anti-inflammatory activity through multiple pathways and has shown promise in research for its effects on stress response systems. It's also a natural alarm pheromone in plants — cannabis produces it as a stress signal.",
        effect:"Calming, stress-relieving, anti-inflammatory, antibacterial. Contributes a fresh, green-apple quality to strains. Found in apples, hops, and flowers. Often overlooked but important to overall terpene profiles.",
        medical:["Anti-inflammatory","Antibacterial","Skin health","Anti-tumor (early research)","Relaxation"],
        strains:["Skunk #1","Sour Diesel","MAC","Zkittlez","Green Crack"],
        nature:[
          {e:"🍏",n:"Green apples",note:"Farnesene is the primary reason green apples smell fresher and more tart than red apples"},
          {e:"🍺",n:"Hops",note:"German noble hops used in lagers are high in farnesene — the 'fresh beer' quality"},
          {e:"🌸",n:"Ginger lily",note:"Ginger lily flowers release farnesene as a floral attractant for pollinators"},
          {e:"🥬",n:"Chamomile",note:"German chamomile contains farnesene alongside bisabolol — doubling its calming profile"},
          {e:"🌿",n:"Turmeric",note:"Turmeric rhizomes contain farnesene as part of their complex anti-inflammatory terpene blend"},
          {e:"🌸",n:"Gardenias",note:"Gardenia's rich, sweet-green floral scent includes farnesene"}
        ],
        hack:"The Green Apple Smell: If a cannabis strain has a distinct green apple, fresh-cut grass, or 'just-opened can of beer' quality to it, farnesene is likely a significant component of the terpene profile."
      },
      { name:"Valencene", tag:"The Citrus Peel", color:"#F5A623", aroma:"Sweet Orange · Citrus · Fresh · Woody · Grapefruit", family:"Citrus", bp:254, bpF:489,
        receptor:"Anti-inflammatory Pathways", receptorSide:"immune",
        receptorNote:"Valencene demonstrates anti-inflammatory and insect-repelling properties. Named for Valencia oranges, it acts on inflammatory pathways similar to caryophyllene but with less direct receptor binding activity.",
        effect:"Uplifting, energizing, mood-brightening. Similar to limonene but with a softer, sweeter citrus quality. Found in citrus fruit peel and some exotic cannabis strains. The 'orange soda' terpene.",
        medical:["Anti-inflammatory","Antifungal","Insect repellent","Mood elevation","Nausea relief"],
        strains:["Tangie","Clementine","Agent Orange","Mimosa","Sour Tangie"],
        nature:[
          {e:"🍊",n:"Valencia oranges",note:"Named for the variety — Valencia orange peel is extremely high in valencene"},
          {e:"🍊",n:"Tangerines",note:"The bright, sweet citrus pop of tangerines comes largely from valencene"},
          {e:"🍊",n:"Grapefruit",note:"Alongside limonene, valencene creates grapefruit's distinctive sweet-tart citrus profile"},
          {e:"🫐",n:"Nectarines",note:"Ripe nectarine skin contains valencene — part of their summer-fruit sweetness"},
          {e:"🍹",n:"Mango",note:"Mango's tropical sweetness includes valencene alongside myrcene and ocimene"},
          {e:"🌿",n:"Herbs",note:"Some Mediterranean herbs contain trace valencene as part of complex volatile profiles"}
        ],
        hack:"The Tangie Test: Tangie and its family (Clementine, Agent Orange, Mimosa) are the highest-valencene strains. If you love the orange-soda sweetness of Tangie, you're a valencene person — seek it in other strains."
      },
      { name:"Guaiol", tag:"The Pine & Rose", color:"#6AAF8E", aroma:"Pine · Rose · Woody · Floral · Green", family:"Earthy", bp:288, bpF:550,
        receptor:"Anti-inflammatory Pathways", receptorSide:"immune",
        receptorNote:"Guaiol has demonstrated anti-inflammatory, antimicrobial, and insect-repelling properties in research. It has the highest boiling point of common cannabis terpenes — it survives temperatures that destroy most others.",
        effect:"Calming, stress-relieving, antimicrobial, anti-inflammatory. The woody-floral terpene with the highest boiling point — it's active even in high-temperature consumption. A finishing terpene that comes through at the end of a vaporization session.",
        medical:["Anti-inflammatory","Antimicrobial","Cough suppressant","Insect repellent","Anti-tumor (early)"],
        strains:["Plushberry","Pennywise","Blue Kush","Agent Orange","AK-47"],
        nature:[
          {e:"🌲",n:"Guaiacum tree",note:"Named for the guaiacum wood tree — South American timber historically used for anti-inflammatory medicine"},
          {e:"🌹",n:"Rose",note:"Rose absolute contains guaiol — part of rose's deep, complex woody-floral base note"},
          {e:"🌲",n:"Cypress pine",note:"Cypress pine wood contains guaiol — that distinctive clean-woody smell of Mediterranean architecture"},
          {e:"🌿",n:"Nutmeg",note:"Nutmeg contains guaiol alongside other high-boiling sesquiterpenes"},
          {e:"🌸",n:"Tea rose",note:"Tea rose varieties are particularly high in guaiol alongside geraniol"},
          {e:"🌿",n:"Naematoloma mushrooms",note:"Some edible mushroom species contain guaiol — an unusual cross-kingdom terpene presence"}
        ],
        hack:"The Vaporizer Finish: Because guaiol has such a high boiling point (288°C), it's one of the terpenes that vapers taste at the very end of a session when everything else has already vaporized. The final floral-woody note in a vape session is often guaiol."
      }
    ];

    // remove duplicate Linalool
    const _TERPENES = _TERP.filter(function(t,i){ return _TERP.findIndex(function(x){return x.name===t.name;})===i; });

    const _WT = [
      { name:"Myrcene", tag:"Most Common in Cannabis", color:"#E07B39", aroma:"Earthy, musky, tropical, mango, hops", effect:"Heavy relaxation, couch-lock, sedating. High myrcene = indica-leaning experience regardless of strain type. Enhances CB1 receptor binding — helps cannabinoids cross the blood-brain barrier faster.", found:"mangoes, hops, lemongrass, parsley leaf, grapefruit, orange", boiling:"168°C / 334°F" },
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
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Terpenes — Cannascenti Encyclopedia</title>
<meta name="description" content="Interactive terpene wheel with 15 terpene profiles — aromas, effects, boiling points, and strain pairings. Myrcene, limonene, caryophyllene, terpinolene and more.">
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
/* ── Wheel ── */
.wheel-section{display:grid;grid-template-columns:480px 1fr;gap:48px;align-items:start;margin-bottom:80px}
#terpeneWheel{width:100%;max-width:480px;cursor:pointer;filter:drop-shadow(0 0 30px rgba(82,183,136,0.12))}
.t-slice{cursor:pointer;transition:all .2s}
.t-slice path{transition:opacity .2s,filter .2s}
.t-slice:hover path,.t-slice.sel path{opacity:1!important;filter:brightness(1.2)}
/* ── Info Panel ── */
.twi{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:28px;position:sticky;top:80px}
.twi-prompt{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:340px;text-align:center;gap:12px;color:rgba(242,234,216,0.35)}
.twi-prompt-icon{font-size:40px}
.twi-name{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;line-height:1.2;margin-bottom:2px}
.twi-tag{font-size:.65rem;letter-spacing:.14em;text-transform:uppercase;margin-bottom:14px}
.twi-aroma{font-size:.8rem;color:rgba(242,234,216,0.5);margin-bottom:14px;font-style:italic}
.twi-section{font-size:.6rem;letter-spacing:.14em;text-transform:uppercase;color:rgba(242,234,216,0.3);margin:14px 0 6px}
.twi-effect{font-size:.83rem;line-height:1.75;color:rgba(242,234,216,0.75);margin-bottom:6px}
.twi-receptor{font-size:.78rem;line-height:1.7;color:rgba(82,183,136,0.85);padding:10px 14px;background:rgba(82,183,136,0.06);border-radius:8px;border-left:2px solid #52B788;margin-bottom:12px}
/* Nature grid in panel */
.twi-nature{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px}
.twi-nat-item{background:rgba(255,255,255,0.04);border-radius:8px;padding:8px 10px;cursor:help}
.twi-nat-emoji{font-size:18px;margin-bottom:3px}
.twi-nat-name{font-size:.7rem;font-weight:600;color:rgba(242,234,216,0.8);margin-bottom:2px}
.twi-nat-note{font-size:.65rem;color:rgba(242,234,216,0.45);line-height:1.4}
/* Boiling bar */
.bp-bar-wrap{margin-bottom:12px}
.bp-label{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:rgba(242,234,216,0.3);margin-bottom:5px;display:flex;justify-content:space-between}
.bp-track{height:6px;background:rgba(255,255,255,0.06);border-radius:6px;overflow:hidden}
.bp-fill{height:100%;border-radius:6px;transition:width .5s}
/* Hack box */
.twi-hack{font-size:.75rem;line-height:1.65;color:rgba(232,168,76,0.8);padding:10px 14px;background:rgba(232,168,76,0.06);border-radius:8px;border-left:2px solid rgba(232,168,76,0.4);font-style:italic}
/* Medical & strains */
.twi-pills{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:4px}
.twi-pill{font-size:.68rem;background:rgba(255,255,255,0.05);border-radius:6px;padding:2px 8px;color:rgba(242,234,216,0.6)}
.twi-strain-pill{font-size:.68rem;background:rgba(82,183,136,0.08);color:#52B788;border-radius:6px;padding:2px 8px}
/* ── CB1/CB2 Section ── */
.receptor-section{margin:80px 0;padding:48px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.06);border-radius:20px}
.receptor-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:36px}
.receptor-card{background:rgba(255,255,255,0.03);border-radius:14px;padding:28px;border-top:3px solid}
.rc-title{font-family:'Cormorant Garamond',serif;font-size:1.6rem;font-weight:300;margin-bottom:6px}
.rc-sub{font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;margin-bottom:14px}
.rc-body{font-size:.83rem;line-height:1.8;color:rgba(242,234,216,0.65);margin-bottom:16px}
.rc-terps{display:flex;flex-wrap:wrap;gap:6px}
.rc-terp{font-size:.72rem;border-radius:20px;padding:3px 10px;font-weight:500}
/* ── Boiling Point Chart ── */
.bp-chart{margin:60px 0}
.bp-row{display:flex;align-items:center;gap:12px;margin-bottom:10px;cursor:pointer}
.bp-row:hover .bp-row-fill{filter:brightness(1.3)}
.bp-row-name{font-size:.78rem;width:110px;text-align:right;color:rgba(242,234,216,0.7);flex-shrink:0}
.bp-row-track{flex:1;height:8px;background:rgba(255,255,255,0.05);border-radius:8px;overflow:hidden}
.bp-row-fill{height:100%;border-radius:8px;transition:width 1s}
.bp-row-temp{font-size:.72rem;color:rgba(242,234,216,0.4);width:80px;flex-shrink:0}
/* ── Deep profile cards ── */
.prof-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px;margin-top:32px}
.prof-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;overflow:hidden;cursor:pointer;transition:border-color .2s,transform .15s}
.prof-card:hover{border-color:rgba(255,255,255,0.14);transform:translateY(-2px)}
.prof-card.open{border-color:rgba(82,183,136,0.25)}
.pc-stripe{height:3px}
.pc-inner{padding:18px 20px 16px}
.pc-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
.pc-name{font-family:'Cormorant Garamond',serif;font-size:1.3rem;font-weight:400}
.pc-tag{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;border-radius:20px;padding:3px 9px;font-weight:600}
.pc-aroma{font-size:.75rem;color:rgba(242,234,216,0.4);font-style:italic;margin-bottom:10px}
.pc-effect{font-size:.8rem;line-height:1.65;color:rgba(242,234,216,0.62)}
.pc-expand{display:none;padding:0 20px 20px;border-top:1px solid rgba(255,255,255,0.06);margin-top:4px}
.prof-card.open .pc-expand{display:block}
.pc-elabel{font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:rgba(242,234,216,0.3);margin:14px 0 6px}
.pc-etext{font-size:.8rem;line-height:1.75;color:rgba(242,234,216,0.62)}
.pc-nat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:6px}
.pc-nat{background:rgba(255,255,255,0.04);border-radius:8px;padding:8px;text-align:center}
.pc-nat-e{font-size:18px;margin-bottom:3px}
.pc-nat-n{font-size:.65rem;color:rgba(242,234,216,0.65)}
/* ── Entourage ── */
.entourage-banner{margin:48px 0;padding:40px 48px;background:linear-gradient(135deg,rgba(82,183,136,0.06),rgba(82,183,136,0.02));border:1px solid rgba(82,183,136,0.15);border-radius:20px}
/* Section headers */
h2.tsec{font-family:'Cormorant Garamond',serif;font-size:clamp(1.6rem,4vw,2.4rem);font-weight:300;color:#F2EAD8;line-height:1.2;margin-bottom:8px}
h2.tsec em{color:#52B788;font-style:italic}
.tsec-desc{font-size:.88rem;color:rgba(242,234,216,0.55);line-height:1.75;max-width:700px;margin-bottom:0}
@media(max-width:780px){.wheel-section{grid-template-columns:1fr}.receptor-grid{grid-template-columns:1fr}.entourage-banner{padding:28px}}
@media(max-width:500px){.twi-nature{grid-template-columns:1fr}.pc-nat-grid{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
${ENC_NAV}
<div class="enc-page">
  <div class="enc-page-header">
    <div class="enc-label">✦ Cannascenti Encyclopedia</div>
    <h1 class="enc-title">Terpenes are <em>everything.</em></h1>
    <p class="enc-desc">If you don't know your strain, you know your terpene. If you know your terpene, you know your strain. Terpenes aren't unique to cannabis — they're the aromatic language of the entire plant kingdom. Lavender, black pepper, mangoes, hops, pine forests — your endocannabinoid system has been responding to terpenes your whole life. Cannabis just delivers them in extraordinary concentration.</p>
  </div>

  <!-- INTERACTIVE WHEEL -->
  <div class="wheel-section" id="wheelSection">
    <div>
      <div class="enc-label" style="margin-bottom:12px">✦ Spin the Wheel</div>
      <svg id="terpeneWheel" viewBox="0 0 520 520" xmlns="http://www.w3.org/2000/svg"></svg>
      <p style="font-size:.72rem;color:rgba(242,234,216,0.3);text-align:center;margin-top:8px">Click any slice to explore that terpene</p>
    </div>
    <div class="twi" id="twiPanel">
      <div class="twi-prompt" id="twiPrompt">
        <div class="twi-prompt-icon">🌿</div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:1.1rem;color:rgba(242,234,216,0.5)">Click any terpene</div>
        <div style="font-size:.8rem">Explore where it lives in nature, how it interacts with your brain, and which strains carry it.</div>
      </div>
      <div id="twiContent" style="display:none">
        <div class="twi-name" id="twiName"></div>
        <div class="twi-tag" id="twiTag"></div>
        <div class="twi-aroma" id="twiAroma"></div>
        <div class="twi-section">Effect Profile</div>
        <div class="twi-effect" id="twiEffect"></div>
        <div class="twi-section">Receptor Activity</div>
        <div class="twi-receptor" id="twiReceptor"></div>
        <div class="twi-section">Found in Nature</div>
        <div class="twi-nature" id="twiNature"></div>
        <div class="twi-section">Boiling Point</div>
        <div class="bp-bar-wrap">
          <div class="bp-label"><span id="twiBpLabel"></span><span style="color:rgba(242,234,216,0.3)">Max 300°C</span></div>
          <div class="bp-track"><div class="bp-fill" id="twiBpFill"></div></div>
        </div>
        <div class="twi-section">Medical Uses</div>
        <div class="twi-pills" id="twiMedical"></div>
        <div class="twi-section">Key Strains</div>
        <div class="twi-pills" id="twiStrains"></div>
        <div class="twi-section" style="margin-top:16px">Pro Tip</div>
        <div class="twi-hack" id="twiHack"></div>
      </div>
    </div>
  </div>

  <!-- ENTOURAGE EFFECT -->
  <div class="entourage-banner">
    <div class="enc-label" style="margin-bottom:12px">✦ The Entourage Effect</div>
    <h2 class="tsec" style="margin-bottom:14px">Terpenes don't work alone. <em>Nothing does.</em></h2>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:8px">
      <div>
        <div style="font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:#52B788;margin-bottom:8px">The Theory</div>
        <div style="font-size:.82rem;line-height:1.75;color:rgba(242,234,216,0.6)">Cannabis produces over 400 distinct chemical compounds. THC and CBD are the most studied — but terpenes, flavonoids, and minor cannabinoids work together to produce effects that no isolated compound achieves alone. This is the entourage effect.</div>
      </div>
      <div>
        <div style="font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:#52B788;margin-bottom:8px">Why It Matters</div>
        <div style="font-size:.82rem;line-height:1.75;color:rgba(242,234,216,0.6)">A strain with 25% THC and a rich terpene profile will produce a fundamentally different experience than 25% THC distillate with no terpenes. Myrcene amplifies THC. Pinene counteracts memory impairment. Caryophyllene reduces anxiety. The terpenes are the conductor.</div>
      </div>
      <div>
        <div style="font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:#52B788;margin-bottom:8px">The Takeaway</div>
        <div style="font-size:.82rem;line-height:1.75;color:rgba(242,234,216,0.6)">Stop chasing THC percentage. Start reading terpene profiles. The cannabis that works best for you isn't necessarily the most potent — it's the one with the right combination of terpenes for your chemistry, your mood, and your endocannabinoid system.</div>
      </div>
    </div>
  </div>

  <!-- CB1 & CB2 RECEPTORS -->
  <div class="receptor-section">
    <div class="enc-label" style="margin-bottom:12px">✦ How Terpenes Talk to Your Brain</div>
    <h2 class="tsec">CB1 &amp; CB2 <em>Receptors.</em></h2>
    <p class="tsec-desc" style="margin-top:8px">Your body has an entire system built to receive these compounds. The endocannabinoid system (ECS) maintains homeostasis across nearly every biological function. Terpenes interact with it — some directly, some through adjacent pathways.</p>
    <div class="receptor-grid">
      <div class="receptor-card" style="border-color:#9B72CF">
        <div class="rc-title" style="color:#9B72CF">CB1 Receptors</div>
        <div class="rc-sub" style="color:#9B72CF">Brain &amp; Central Nervous System</div>
        <div class="rc-body">CB1 receptors are densely concentrated in the brain — the hippocampus (memory), prefrontal cortex (decision-making), amygdala (emotion), and cerebellum (coordination). When THC binds CB1, it produces psychoactive effects. Terpenes don't bind CB1 directly — but they modulate it.<br><br>Myrcene increases CB1 sensitivity, amplifying THC's effects. Pinene blocks the enzyme that breaks down acetylcholine near CB1 — counteracting memory impairment. Terpenes are the equalizer that determines what CB1 activation actually feels like.</div>
        <div style="font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:rgba(155,114,207,0.6);margin-bottom:8px">Terpenes that influence CB1</div>
        <div class="rc-terps">
          <span class="rc-terp" style="background:rgba(155,114,207,0.12);color:#9B72CF">Myrcene (amplifier)</span>
          <span class="rc-terp" style="background:rgba(155,114,207,0.12);color:#9B72CF">Pinene (counteracts memory loss)</span>
          <span class="rc-terp" style="background:rgba(155,114,207,0.12);color:#9B72CF">Linalool (calms response)</span>
          <span class="rc-terp" style="background:rgba(155,114,207,0.12);color:#9B72CF">Limonene (mood modulator)</span>
        </div>
      </div>
      <div class="receptor-card" style="border-color:#52B788">
        <div class="rc-title" style="color:#52B788">CB2 Receptors</div>
        <div class="rc-sub" style="color:#52B788">Immune System &amp; Peripheral Nervous System</div>
        <div class="rc-body">CB2 receptors are found primarily in immune cells, the spleen, tonsils, and throughout the peripheral nervous system. They regulate inflammation, immune response, and pain signals. CB2 activation does NOT produce psychoactive effects — it's the body's anti-inflammatory control system.<br><br>Caryophyllene is the only terpene that binds CB2 directly — making it simultaneously a terpene and a dietary cannabinoid. This is why CBD and caryophyllene-rich strains are particularly effective for inflammation and pain without producing a high.</div>
        <div style="font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:rgba(82,183,136,0.6);margin-bottom:8px">Terpenes that influence CB2</div>
        <div class="rc-terps">
          <span class="rc-terp" style="background:rgba(82,183,136,0.12);color:#52B788">Caryophyllene (direct CB2 binder)</span>
          <span class="rc-terp" style="background:rgba(82,183,136,0.12);color:#52B788">Humulene (CB2 modulator)</span>
          <span class="rc-terp" style="background:rgba(82,183,136,0.12);color:#52B788">Bisabolol (anti-inflammatory)</span>
          <span class="rc-terp" style="background:rgba(82,183,136,0.12);color:#52B788">Nerolidol (skin penetration)</span>
        </div>
      </div>
    </div>
    <div style="margin-top:24px;padding:20px 24px;background:rgba(255,255,255,0.03);border-radius:12px;border:1px solid rgba(255,255,255,0.07)">
      <div style="font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:rgba(242,234,216,0.4);margin-bottom:8px">Beyond CB1 & CB2</div>
      <div style="font-size:.83rem;line-height:1.75;color:rgba(242,234,216,0.6)">Terpenes also interact with serotonin receptors (5-HT1A — limonene, linalool), dopamine pathways (limonene), GABA receptors (linalool, terpineol — the same system as benzodiazepines), opioid receptors (myrcene — part of its pain-relieving effect), and TRPV1 receptors (caryophyllene — the capsaicin receptor, explaining its anti-pain effect). Your endocannabinoid system is not isolated — terpenes play across the entire neurochemical orchestra.</div>
    </div>
  </div>

  <!-- BOILING POINT CHART -->
  <div class="bp-chart">
    <div class="enc-label" style="margin-bottom:12px">✦ Vaporization Science</div>
    <h2 class="tsec">Boiling points <em>matter.</em></h2>
    <p class="tsec-desc" style="margin-top:8px;margin-bottom:28px">Each terpene vaporizes at a specific temperature. Low-temp dabs (440–490°F) preserve the volatile terpenes. High temps destroy them. This is why two people consuming the same strain at different temperatures have completely different experiences.</p>
    <div id="bpChart"></div>
  </div>

  <!-- DEEP PROFILES -->
  <div>
    <div class="enc-label" style="margin-bottom:12px">✦ Complete Reference</div>
    <h2 class="tsec">Every terpene, <em>fully documented.</em></h2>
    <p class="tsec-desc" style="margin-top:8px">Click any card to expand the full profile — where it lives in the natural world, how it interacts with your receptors, and which strains carry it most prominently.</p>
    <div class="prof-grid" id="profGrid"></div>
  </div>

</div>
<script>
var TERP = ${JSON.stringify(_TERPENES)};

// ── Wheel ─────────────────────────────────────────────────────────────────
(function(){
  var svg = document.getElementById('terpeneWheel');
  if (!svg) return;
  var cx=260, cy=260, outerR=240, innerR=85, count=TERP.length, slice=(2*Math.PI)/count;
  var activeG = null;

  function polar(r, a){ return [cx + r*Math.cos(a), cy + r*Math.sin(a)]; }

  function makeSlice(i) {
    var t = TERP[i];
    var sa = i*slice - Math.PI/2, ea = sa + slice, gap = 0.025;
    var s = sa+gap, e = ea-gap;
    var p1=polar(innerR,s), p2=polar(outerR,s), p3=polar(outerR,e), p4=polar(innerR,e);
    var lf = (e-s > Math.PI) ? 1 : 0;
    var d = 'M '+p1[0]+' '+p1[1]+
            ' L '+p2[0]+' '+p2[1]+
            ' A '+outerR+' '+outerR+' 0 '+lf+' 1 '+p3[0]+' '+p3[1]+
            ' L '+p4[0]+' '+p4[1]+
            ' A '+innerR+' '+innerR+' 0 '+lf+' 0 '+p1[0]+' '+p1[1]+' Z';
    var g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('class','t-slice');

    var path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', d);
    path.setAttribute('fill', t.color);
    path.setAttribute('opacity', '0.7');
    g.appendChild(path);

    // Label
    var mid = sa + slice/2;
    var lr = (innerR + outerR) / 2;
    var lp = polar(lr, mid);
    var txt = document.createElementNS('http://www.w3.org/2000/svg','text');
    txt.setAttribute('x', lp[0]); txt.setAttribute('y', lp[1]);
    txt.setAttribute('text-anchor','middle'); txt.setAttribute('dominant-baseline','middle');
    txt.setAttribute('fill','rgba(8,28,21,0.9)'); txt.setAttribute('font-size','9');
    txt.setAttribute('font-family','Montserrat,sans-serif'); txt.setAttribute('font-weight','700');
    txt.setAttribute('letter-spacing','0.06em'); txt.setAttribute('pointer-events','none');
    txt.setAttribute('transform','rotate('+((mid*180/Math.PI)+90)+','+lp[0]+','+lp[1]+')');
    txt.textContent = t.name.toUpperCase();
    g.appendChild(txt);

    g.addEventListener('click', function(){ selectT(i, g); });
    svg.insertBefore(g, svg.firstChild);
  }

  // Center
  var bg = document.createElementNS('http://www.w3.org/2000/svg','circle');
  bg.setAttribute('cx',cx); bg.setAttribute('cy',cy); bg.setAttribute('r',innerR-3);
  bg.setAttribute('fill','#060d0a');
  svg.appendChild(bg);
  var ctext = document.createElementNS('http://www.w3.org/2000/svg','text');
  ctext.setAttribute('x',cx); ctext.setAttribute('y',cy-6);
  ctext.setAttribute('text-anchor','middle'); ctext.setAttribute('dominant-baseline','middle');
  ctext.setAttribute('fill','#52B788'); ctext.setAttribute('font-size','9');
  ctext.setAttribute('font-family','Montserrat,sans-serif'); ctext.setAttribute('font-weight','300');
  ctext.setAttribute('letter-spacing','0.2em'); ctext.textContent='CLICK TO';
  svg.appendChild(ctext);
  var ctext2 = document.createElementNS('http://www.w3.org/2000/svg','text');
  ctext2.setAttribute('x',cx); ctext2.setAttribute('y',cy+10);
  ctext2.setAttribute('text-anchor','middle'); ctext2.setAttribute('dominant-baseline','middle');
  ctext2.setAttribute('fill','#52B788'); ctext2.setAttribute('font-size','9');
  ctext2.setAttribute('font-family','Montserrat,sans-serif'); ctext2.setAttribute('font-weight','300');
  ctext2.setAttribute('letter-spacing','0.2em'); ctext2.textContent='EXPLORE';
  svg.appendChild(ctext2);

  for (var i=0; i<count; i++) makeSlice(i);

  function selectT(i, g) {
    if (activeG) {
      activeG.querySelector('path').setAttribute('opacity','0.7');
      activeG.classList.remove('sel');
    }
    g.querySelector('path').setAttribute('opacity','1');
    g.classList.add('sel');
    activeG = g;
    showInfo(TERP[i]);
    // Also highlight corresponding profile card
    document.querySelectorAll('.prof-card').forEach(function(c){ c.classList.remove('open'); });
    var card = document.getElementById('prof-'+i);
    if (card) { card.classList.add('open'); card.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  }

  // Select first on load
  setTimeout(function(){
    var slices = svg.querySelectorAll('.t-slice');
    if (slices.length) selectT(0, slices[slices.length-1]);
  }, 100);
})();

function showInfo(t) {
  document.getElementById('twiPrompt').style.display = 'none';
  var content = document.getElementById('twiContent');
  content.style.display = 'block';
  document.getElementById('twiName').textContent = t.name;
  document.getElementById('twiName').style.color = t.color;
  document.getElementById('twiTag').textContent = t.tag;
  document.getElementById('twiTag').style.color = t.color;
  document.getElementById('twiAroma').textContent = t.aroma;
  document.getElementById('twiEffect').textContent = t.effect;
  document.getElementById('twiReceptor').textContent = t.receptorNote;
  // Nature items
  document.getElementById('twiNature').innerHTML = (t.nature||[]).map(function(n){
    return '<div class="twi-nat-item" title="'+n.note+'"><div class="twi-nat-emoji">'+n.e+'</div><div class="twi-nat-name">'+n.n+'</div><div class="twi-nat-note">'+n.note+'</div></div>';
  }).join('');
  // BP bar
  var bpPct = Math.min(100, Math.round((t.bp / 300)*100));
  document.getElementById('twiBpLabel').textContent = t.bp+'°C / '+t.bpF+'°F';
  document.getElementById('twiBpFill').style.width = bpPct+'%';
  document.getElementById('twiBpFill').style.background = t.color;
  // Medical
  document.getElementById('twiMedical').innerHTML = (t.medical||[]).map(function(m){
    return '<span class="twi-pill">'+m+'</span>';
  }).join('');
  // Strains
  document.getElementById('twiStrains').innerHTML = (t.strains||[]).map(function(s){
    return '<span class="twi-strain-pill">'+s+'</span>';
  }).join('');
  document.getElementById('twiHack').textContent = t.hack || '';
}

// ── Boiling Point Chart ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function(){
  var sorted = TERP.slice().sort(function(a,b){ return a.bp - b.bp; });
  var chart = document.getElementById('bpChart');
  if (!chart) return;
  chart.innerHTML = sorted.map(function(t, i){
    var pct = Math.round((t.bp / 300)*100);
    return '<div class="bp-row" onclick="showInfo(TERP['+TERP.indexOf(t)+'])">' +
      '<div class="bp-row-name">'+t.name+'</div>'+
      '<div class="bp-row-track"><div class="bp-row-fill" style="width:0%;background:'+t.color+'" data-pct="'+pct+'"></div></div>'+
      '<div class="bp-row-temp">'+t.bp+'°C / '+t.bpF+'°F</div>'+
    '</div>';
  }).join('');
  // Animate bars
  setTimeout(function(){
    chart.querySelectorAll('.bp-row-fill').forEach(function(el){
      el.style.width = el.dataset.pct+'%';
    });
  }, 200);

  // ── Deep profile cards ─────────────────────────────────────────────────
  var grid = document.getElementById('profGrid');
  if (!grid) return;
  grid.innerHTML = TERP.map(function(t, i){
    var natHtml = (t.nature||[]).map(function(n){
      return '<div class="pc-nat"><div class="pc-nat-e">'+n.e+'</div><div class="pc-nat-n">'+n.n+'</div></div>';
    }).join('');
    var medHtml = (t.medical||[]).map(function(m){ return '<span class="twi-pill">'+m+'</span>'; }).join('');
    var strHtml = (t.strains||[]).map(function(s){ return '<span class="twi-strain-pill">'+s+'</span>'; }).join('');
    return '<div class="prof-card" id="prof-'+i+'" onclick="toggleProf(this,'+i+')">'+
      '<div class="pc-stripe" style="background:'+t.color+'"></div>'+
      '<div class="pc-inner">'+
        '<div class="pc-head">'+
          '<div class="pc-name">'+t.name+'</div>'+
          '<span class="pc-tag" style="background:'+t.color+'22;color:'+t.color+'">'+t.family+'</span>'+
        '</div>'+
        '<div class="pc-aroma">'+t.aroma+'</div>'+
        '<div class="pc-effect">'+t.effect.substring(0,120)+'...</div>'+
      '</div>'+
      '<div class="pc-expand">'+
        '<div class="pc-elabel">In the Wild — Found Naturally In</div>'+
        '<div class="pc-nat-grid">'+natHtml+'</div>'+
        '<div class="pc-elabel">Full Effect Profile</div>'+
        '<div class="pc-etext">'+t.effect+'</div>'+
        '<div class="pc-elabel">Receptor Activity</div>'+
        '<div class="pc-etext" style="color:rgba(82,183,136,0.85)">'+t.receptorNote+'</div>'+
        '<div class="pc-elabel" style="margin-top:12px">Medical Uses</div>'+
        '<div class="twi-pills">'+medHtml+'</div>'+
        '<div class="pc-elabel">Key Strains</div>'+
        '<div class="twi-pills">'+strHtml+'</div>'+
        '<div class="pc-elabel">Pro Tip</div>'+
        '<div class="twi-hack" style="display:block;margin-top:0">'+t.hack+'</div>'+
        '<div style="font-size:.7rem;color:rgba(242,234,216,0.3);margin-top:14px">Boiling Point: '+t.bp+'°C / '+t.bpF+'°F</div>'+
        '<a href="/terpenes/'+t.name.toLowerCase()+'" class="sc-profile-btn" style="margin-top:18px" onclick="event.stopPropagation()">View Full Profile →</a>'+
      '</div>'+
    '</div>';
  }).join('');
});

function toggleProf(card, i) {
  var wasOpen = card.classList.contains('open');
  document.querySelectorAll('.prof-card').forEach(function(c){ c.classList.remove('open'); });
  if (!wasOpen) { card.classList.add('open'); showInfo(TERP[i]); window.scrollTo({top:document.getElementById('wheelSection').offsetTop-80,behavior:'smooth'}); }
}
</script>
</body></html>`;
    res.writeHead(200, {"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /terpenes/:slug — Individual terpene profile ──────────────────────────
  if (req.method === "GET" && req.url.startsWith("/terpenes/") && req.url.length > 10) {
    const rawSlug = req.url.slice(10).split("?")[0].split("#")[0];
    const terp = TERP_META.find(t => t.slug === rawSlug);

    if (!terp) {
      res.writeHead(404,{"Content-Type":"text/html"});
      res.end(`<!DOCTYPE html><html><head><title>Not Found | Cannascenti</title>${ENC_FONTS}<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#060d0a;color:#F2EAD8;font-family:Montserrat,sans-serif}</style></head><body>${ENC_NAV}<div style="max-width:600px;margin:120px auto;text-align:center;padding:0 32px"><div style="font-size:3rem;margin-bottom:20px;opacity:.3">&#127807;</div><div style="font-family:'Cormorant Garamond',serif;font-size:2rem;margin-bottom:16px">Terpene not found</div><a href="/terpenes" style="color:#52B788;font-size:.85rem">Back to Terpenes</a></div></body></html>`);
      return;
    }

    const toSlug = n => n.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    const dominantStrains = STRAINS_DB.filter(sd => (sd.terpenes||[])[0] === terp.name);
    const allContaining = STRAINS_DB.filter(sd => (sd.terpenes||[]).includes(terp.name));
    const typeColors = {indica:"#9B72CF",sativa:"#E8A84C",hybrid:"#52B788"};

    const strainCards = dominantStrains.slice(0, 24).map(sd => {
      const tc = typeColors[(sd.type||'hybrid').toLowerCase()] || '#52B788';
      const slug = toSlug(sd.name);
      return `<a href="/strains/${slug}" class="tp-strain-card">
        <div class="tp-sc-stripe" style="background:${tc}"></div>
        <div class="tp-sc-inner">
          <div class="tp-sc-name">${sd.name}</div>
          <div class="tp-sc-type" style="color:${tc}">${sd.type}</div>
          <div class="tp-sc-thc">${sd.thc_min}–${sd.thc_max}% THC</div>
        </div>
      </a>`;
    }).join('');

    const medHtml = terp.medical.map(m => `<span class="tp-pill">${m}</span>`).join('');
    const natHtml = terp.nature.map(n => `<div class="tp-nat-item"><div class="tp-nat-emoji">${n.e}</div><div class="tp-nat-name">${n.n}</div><div class="tp-nat-note">${n.note}</div></div>`).join('');
    const bpBarW = Math.min(Math.round((terp.bp - 100) / 150 * 100), 100);

    const tpHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${terp.name} — Terpene Profile | Cannascenti</title>
<meta name="description" content="${terp.aroma}. ${terp.effect.slice(0,120)}...">
${ENC_FONTS}<style>
${ENC_BASE_CSS}
.tp-hero{max-width:860px;margin:100px auto 0;padding:40px 32px 32px}
.tp-back{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:rgba(242,234,216,0.4);text-decoration:none;display:inline-flex;align-items:center;gap:6px;margin-bottom:28px;transition:color .2s}
.tp-back:hover{color:#52B788}
.tp-hero-top{display:flex;align-items:flex-start;gap:24px;flex-wrap:wrap}
.tp-color-dot{width:64px;height:64px;border-radius:50%;flex-shrink:0;margin-top:4px}
.tp-name{font-family:'Cormorant Garamond',serif;font-size:3rem;font-weight:400;line-height:1;margin-bottom:8px}
.tp-tag{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;opacity:.5;margin-bottom:10px}
.tp-aroma{font-size:.9rem;color:rgba(242,234,216,0.6);margin-bottom:18px}
.tp-stat-row{display:flex;gap:24px;flex-wrap:wrap;margin-top:24px}
.tp-stat{display:flex;flex-direction:column;gap:4px}
.tp-stat-label{font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:rgba(242,234,216,0.35)}
.tp-stat-val{font-size:.95rem;font-weight:500}
.tp-content{max-width:860px;margin:0 auto;padding:0 32px 80px}
.tp-section{margin-top:40px;padding-top:32px;border-top:1px solid rgba(255,255,255,0.06)}
.tp-section-title{font-size:.65rem;letter-spacing:.15em;text-transform:uppercase;color:rgba(242,234,216,0.35);margin-bottom:16px}
.tp-effect{font-size:.95rem;line-height:1.8;color:rgba(242,234,216,0.75)}
.tp-receptor{font-size:.9rem;line-height:1.8;color:rgba(82,183,136,0.9);background:rgba(82,183,136,0.06);border-left:2px solid rgba(82,183,136,0.3);padding:14px 18px;border-radius:0 8px 8px 0;margin-top:16px}
.tp-bp-bar{height:6px;background:rgba(255,255,255,0.08);border-radius:3px;margin:12px 0 6px;overflow:hidden}
.tp-bp-fill{height:100%;border-radius:3px}
.tp-bp-label{font-size:.72rem;color:rgba(242,234,216,0.4)}
.tp-pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.tp-pill{font-size:.78rem;padding:5px 12px;border-radius:20px;background:rgba(255,255,255,0.06);color:rgba(242,234,216,0.7);border:1px solid rgba(255,255,255,0.08)}
.tp-nat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-top:12px}
.tp-nat-item{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px;text-align:center}
.tp-nat-emoji{font-size:1.8rem;margin-bottom:6px}
.tp-nat-name{font-size:.78rem;font-weight:600;color:rgba(242,234,216,0.85);margin-bottom:4px}
.tp-nat-note{font-size:.68rem;color:rgba(242,234,216,0.4);line-height:1.5}
.tp-hack{font-size:.85rem;line-height:1.75;color:rgba(242,234,216,0.75);background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:16px 18px}
.tp-strain-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-top:16px}
.tp-strain-card{display:block;text-decoration:none;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;overflow:hidden;transition:border-color .2s,transform .15s}
.tp-strain-card:hover{border-color:rgba(82,183,136,0.3);transform:translateY(-2px)}
.tp-sc-stripe{height:3px}
.tp-sc-inner{padding:12px 14px}
.tp-sc-name{font-family:'Cormorant Garamond',serif;font-size:1.05rem;color:#F2EAD8;margin-bottom:4px;line-height:1.2}
.tp-sc-type{font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px}
.tp-sc-thc{font-size:.72rem;color:rgba(242,234,216,0.4)}
.tp-all-note{font-size:.8rem;color:rgba(242,234,216,0.4);margin-top:16px;font-style:italic}
</style>
</head>
<body>
${ENC_NAV}
<div class="tp-hero">
  <a href="/terpenes" class="tp-back">&#8592; All Terpenes</a>
  <div class="tp-hero-top">
    <div class="tp-color-dot" style="background:${terp.color}"></div>
    <div>
      <div class="tp-name" style="color:${terp.color}">${terp.name}</div>
      <div class="tp-tag">${terp.tag} &middot; ${terp.family} Family</div>
      <div class="tp-aroma">${terp.aroma}</div>
    </div>
  </div>
  <div class="tp-stat-row">
    <div class="tp-stat">
      <div class="tp-stat-label">Boiling Point</div>
      <div class="tp-stat-val">${terp.bp}°C / ${terp.bpF}°F</div>
    </div>
    <div class="tp-stat">
      <div class="tp-stat-label">Family</div>
      <div class="tp-stat-val">${terp.family}</div>
    </div>
    <div class="tp-stat">
      <div class="tp-stat-label">Strains (dominant)</div>
      <div class="tp-stat-val">${dominantStrains.length}</div>
    </div>
    <div class="tp-stat">
      <div class="tp-stat-label">Strains (containing)</div>
      <div class="tp-stat-val">${allContaining.length}</div>
    </div>
  </div>
</div>
<div class="tp-content">
  <div class="tp-section">
    <div class="tp-section-title">Effect Profile</div>
    <div class="tp-effect">${terp.effect}</div>
    <div class="tp-receptor">${terp.receptorNote}</div>
  </div>

  <div class="tp-section">
    <div class="tp-section-title">Boiling Point</div>
    <div class="tp-bp-bar"><div class="tp-bp-fill" style="width:${bpBarW}%;background:${terp.color}"></div></div>
    <div class="tp-bp-label">${terp.bp}°C / ${terp.bpF}°F &mdash; vaporizes above this temperature</div>
  </div>

  <div class="tp-section">
    <div class="tp-section-title">Medical Uses</div>
    <div class="tp-pills">${medHtml}</div>
  </div>

  <div class="tp-section">
    <div class="tp-section-title">Found In Nature</div>
    <div class="tp-nat-grid">${natHtml}</div>
  </div>

  <div class="tp-section">
    <div class="tp-section-title">Pro Tip</div>
    <div class="tp-hack">${terp.hack}</div>
  </div>

  ${dominantStrains.length > 0 ? `<div class="tp-section">
    <div class="tp-section-title">${terp.name} as the Dominant Terpene</div>
    <div class="tp-strain-grid">${strainCards}</div>
    ${allContaining.length > dominantStrains.length ? `<div class="tp-all-note">${allContaining.length - dominantStrains.length} more strains also contain ${terp.name} as a secondary terpene</div>` : ''}
  </div>` : ''}
</div>
</body>
</html>`;

    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(tpHtml);
    return;
  }

  // ─── /strains ──────────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/strains") {
    const _SD = [
      // ── LANDRACES ────────────────────────────────────────────────────────────
      { name:"Afghani", type:"indica", era:"landrace", thc:"15-20%", cbd:"0.1%", genetics:"Pure Afghan Landrace", parents:[], tree:[], landrace:"Afghanistan — Hindu Kush Region", origin:"Hindu Kush Mountains, Afghanistan", breeder:"Nature", effects:["Relaxed","Sleepy","Happy","Hungry","Euphoric"], flavors:["Earthy","Sweet","Woody","Pungent"], terpenes:["Myrcene","Caryophyllene","Limonene"], desc:"The genetic backbone of nearly every modern indica. Grown in the harsh terrain of the Hindu Kush mountains, Afghani developed extreme resin production as protection against UV radiation and temperature swings. One of the most influential plants in cannabis history.", story:"Afghani is not a strain — it is a population of landrace genetics that has grown wild and cultivated in the Hindu Kush for thousands of years. Its dense, resinous buds adapted to altitude. Every modern indica you've ever smoked traces some portion of its DNA here. Hash production in Afghanistan predates written history." },
      { name:"Hindu Kush", type:"indica", era:"landrace", thc:"15-20%", cbd:"0.1%", genetics:"Pure Hindu Kush Landrace", parents:[], tree:[], landrace:"Afghanistan / Pakistan border region", origin:"Hindu Kush Mountains", breeder:"Nature", effects:["Relaxed","Sleepy","Happy","Hungry"], flavors:["Earthy","Sandalwood","Sweet","Woody"], terpenes:["Myrcene","Caryophyllene","Terpinolene"], desc:"Named for the mountain range it was collected from. Shorter, denser, and more compact than most landraces. Extreme hash-producing resin glands adapted over millennia to protect the plant in high-altitude UV conditions. Sensi Seeds brought it to Amsterdam in the 1980s.", story:"Hindu Kush is the original source of the compact, resin-drenched indica body type. Its genetics were brought back by hash enthusiasts in the 1970s and preserved by Sensi Seeds. Nearly every pure indica or Kush variety in the modern market carries Hindu Kush DNA — directly or through multiple generations of crossing." },
      { name:"Durban Poison", type:"sativa", era:"landrace", thc:"15-25%", cbd:"0.1%", genetics:"Pure South African Landrace", parents:[], tree:[], landrace:"Durban, KwaZulu-Natal, South Africa", origin:"Durban, South Africa", breeder:"Collected by Ed Rosenthal (1970s)", effects:["Energetic","Uplifted","Creative","Focused","Happy"], flavors:["Sweet","Anise","Pine","Citrus","Earthy"], terpenes:["Terpinolene","Myrcene","Ocimene"], desc:"Africa's most famous export. A pure sativa landrace from the port city of Durban — uplifting, stimulating, and remarkably clear-headed. One of the few strains that is both high-THC and activating without anxiety. The Durban Poison terpene profile (terpinolene-dominant) is distinct from virtually every other cannabis variety.", story:"Durban Poison was collected from outdoor markets in Durban by American activist Ed Rosenthal in the 1970s and brought to the US. Its terpinolene dominance (rare in modern strains) produces a unique energetic, almost psychedelic-light effect. It became the sativa parent of Girl Scout Cookies — arguably the most important cross of the 2010s." },
      { name:"Colombian Gold", type:"sativa", era:"landrace", thc:"14-19%", cbd:"0.1%", genetics:"Pure Colombian Landrace", parents:[], tree:[], landrace:"Santa Marta Mountains, Colombia", origin:"Sierra Nevada de Santa Marta, Colombia", breeder:"Nature — Collected 1960s-70s", effects:["Euphoric","Creative","Uplifted","Energetic"], flavors:["Citrus","Earthy","Sweet","Skunk"], terpenes:["Limonene","Caryophyllene","Myrcene"], desc:"The gold standard of 1970s American cannabis. Grown at high altitude in Colombia's Sierra Nevada, Colombian Gold was legendary for its golden calyxes and intensely cerebral, creative high. A critical parent of Skunk #1 and therefore an ancestor of a vast percentage of modern cannabis.", story:"Colombian Gold was brought to the US in the early 1970s and became the benchmark for premium sativa. Its genetic contribution to Skunk #1 — the strain that formed the backbone of Dutch cannabis breeding — means Colombian Gold's DNA runs through thousands of modern varieties. The Santa Marta Gold phenotype, still grown in its home mountains, is considered a living treasure of cannabis genetics." },
      { name:"Thai", type:"sativa", era:"landrace", thc:"15-22%", cbd:"0.1%", genetics:"Pure Thai Landrace", parents:[], tree:[], landrace:"Thailand — Multiple regions", origin:"Chiang Mai & Central Thailand", breeder:"Nature — Collected 1970s", effects:["Euphoric","Creative","Energetic","Uplifted"], flavors:["Sweet","Fruity","Floral","Citrus"], terpenes:["Limonene","Terpinolene","Caryophyllene"], desc:"Thai stick — cannabis buds lashed to bamboo with cannabis fiber — was the most potent product on the American market in the 1970s. Pure Thai sativa is a extreme plant: 14-16 week flowering time, enormous vigorous growth, and an intensely cerebral high unlike any indica-influenced strain. Its genetics are present in virtually every modern Haze.", story:"Thai genetics were brought to the US and Europe by travelers and servicemen returning from Southeast Asia. Neville Schoenmakers of the Seed Bank crossed Thai with Afghani in the 1980s to create manageable indoor strains. Thai is the primary sativa parent of most Haze varieties — the fast-thinking, racey edge of Thai genetics runs through Jack Herer, Super Silver Haze, and hundreds of their descendants." },
      { name:"Acapulco Gold", type:"sativa", era:"landrace", thc:"15-23%", cbd:"0.1%", genetics:"Pure Mexican Landrace", parents:[], tree:[], landrace:"Guerrero & Oaxaca, Mexico", origin:"Pacific Coast, Mexico", breeder:"Nature — Collected 1960s", effects:["Euphoric","Energetic","Creative","Happy","Uplifted"], flavors:["Earthy","Sweet","Toffee","Woody"], terpenes:["Caryophyllene","Myrcene","Limonene"], desc:"One of the most legendary cannabis varieties of the 1960s and 70s. Named for its striking golden coloration and produced on Mexico's Pacific coast, Acapulco Gold was considered the finest cannabis available in the US for over a decade. A parent of Skunk #1 and therefore a genetic ancestor of the modern cannabis industry.", story:"Acapulco Gold was so prized that counterfeit bags of 'Gold' were common in the 1970s American market — a sign of its cultural weight. Its rich, toffee-like aroma set it apart from other Mexican varieties. As a parent of Skunk #1 alongside Colombian Gold and Afghani, Acapulco Gold's genetic contribution to modern cannabis is incalculable." },
      { name:"Lamb's Bread", type:"sativa", era:"landrace", thc:"16-21%", cbd:"0.1%", genetics:"Pure Jamaican Landrace", parents:[], tree:[], landrace:"Blue Mountains, Jamaica", origin:"Jamaica", breeder:"Nature", effects:["Uplifted","Creative","Energetic","Happy","Focused"], flavors:["Sweet","Earthy","Woody","Herbal"], terpenes:["Myrcene","Caryophyllene","Limonene"], desc:"Bob Marley's preferred strain. A bright green, sticky sativa landrace from the Blue Mountains of Jamaica. Associated with Rastafarian spiritual practice — ganja as sacrament. Lamb's Bread (also called Lamb's Breath) is an uplifting, introspective strain that promotes creative and spiritual thinking.", story:"Lamb's Bread carries a cultural weight that most strains never achieve. Its association with Bob Marley made it internationally known, and Rastafarian growers in the Blue Mountains have preserved the genetics for generations. Strain Hunters documented Lamb's Bread in Jamaica in 2015, noting that traditional growers consider it sacred and resist hybridization." },
      { name:"Panama Red", type:"sativa", era:"landrace", thc:"14-18%", cbd:"0.1%", genetics:"Pure Panamanian Landrace", parents:[], tree:[], landrace:"Panama — Highland Rainforest", origin:"Panama", breeder:"Nature — Collected 1960s-70s", effects:["Euphoric","Creative","Energetic","Uplifted"], flavors:["Earthy","Sweet","Spicy"], terpenes:["Myrcene","Caryophyllene","Pinene"], desc:"One of the most sought-after sativas of the 1970s. Panama Red was grown in Panama's highland rainforest and prized for its intensely cerebral, almost psychedelic effect. The vivid red pistils gave it its name. A genetic contributor to early American hybrid development.", story:"Panama Red's decline came with the War on Drugs — eradication programs in the 1970s-80s devastated its cultivation. By the time the strain was sought for preservation, much had been lost. What survives has been used by California breeders to reintroduce equatorial sativa traits into modern hybrids." },
      { name:"Malawi Gold", type:"sativa", era:"landrace", thc:"16-24%", cbd:"0.1%", genetics:"Pure Malawian Landrace", parents:[], tree:[], landrace:"Lake Malawi Region, Malawi, East Africa", origin:"Malawi, Southern Africa", breeder:"Nature — Strain Hunters collected 2012", effects:["Euphoric","Creative","Energetic","Uplifted","Happy"], flavors:["Fruity","Sweet","Tropical","Spicy"], terpenes:["Terpinolene","Limonene","Caryophyllene"], desc:"Malawi Gold is one of Africa's great landrace sativas — grown traditionally by the Chewa people on the shores of Lake Malawi. Traditionally rolled into enormous 'cobs' for consumption. Sweet, fruity, and intensely potent for a landrace. Strain Hunters documented their Malawi expedition in their Africa series.", story:"Malawi Gold grows at altitude near Lake Malawi in conditions that produce remarkable potency. The traditional Malawi cob — cannabis compressed into a cylinder and slow-dried — produces a concentrated product distinct from any other preparation. Dutch breeders have used Malawi Gold genetics to add tropical fruit terpene profiles to modern hybrids." },

      // ── CLASSIC ERA (1970s–1990s) ────────────────────────────────────────────
      { name:"Skunk #1", type:"hybrid", era:"classic", thc:"15-19%", cbd:"0.1%", genetics:"Colombian Gold × Acapulco Gold × Afghani", parents:["Colombian Gold","Acapulco Gold","Afghani"], tree:[{n:"Colombian Gold",t:"sativa",c:[]},{n:"Acapulco Gold",t:"sativa",c:[]},{n:"Afghani",t:"indica",c:[]}], landrace:"Colombian · Mexican · Afghan", origin:"California, USA (Sacred Seeds, 1970s)", breeder:"Sam the Skunkman / Sacred Seeds", effects:["Relaxed","Euphoric","Happy","Uplifted","Creative"], flavors:["Skunky","Earthy","Sweet","Pungent"], terpenes:["Myrcene","Caryophyllene","Limonene"], desc:"The genetic foundation of the modern cannabis industry. Skunk #1 was the first truly stable commercial cannabis hybrid — combining sativa vigor and cerebral effect with indica density and fast flowering. Its skunk aroma became the global signature of high-quality cannabis.", story:"Skunk #1 was developed by Sacred Seeds in California in the 1970s — a careful cross of three of the finest landrace populations available. When Sam the Skunkman brought the seeds to Amsterdam in the 1980s, they became the foundation of the Dutch seed industry. Sensi Seeds, Dutch Passion, and nearly every other Amsterdam breeder built their catalogs on Skunk #1 genetics. It won the first Cannabis Cup in 1988 and has since contributed DNA to thousands of modern varieties." },
      { name:"Northern Lights #5", type:"indica", era:"classic", thc:"16-21%", cbd:"0.1%", genetics:"Afghani × Thai", parents:["Afghani","Thai"], tree:[{n:"Afghani",t:"indica",c:[]},{n:"Thai",t:"sativa",c:[]}], landrace:"Afghan · Thai", origin:"Seattle, Washington → Amsterdam", breeder:"The Seed Bank (Neville Schoenmakers)", effects:["Relaxed","Sleepy","Happy","Euphoric","Hungry"], flavors:["Sweet","Spicy","Pine","Earthy"], terpenes:["Myrcene","Caryophyllene","Pinene"], desc:"One of the most decorated strains in cannabis history — 5 Cannabis Cup wins and parent or grandparent of hundreds of modern strains. Northern Lights #5 is the definitive indica: fast-flowering, heavy yields, relaxing body high, sweet piney flavor.", story:"Northern Lights was originally developed in Seattle from Afghani and Thai landrace seeds, then brought to Amsterdam where Neville Schoenmakers at The Seed Bank selected the #5 phenotype as the definitive expression. Its compact structure and extraordinary resin production set the standard for indoor cultivation. NL#5 is a parent of Super Silver Haze (3x Cannabis Cup winner) and one of the most used breeding parents in cannabis history." },
      { name:"Haze", type:"sativa", era:"classic", thc:"18-25%", cbd:"0.1%", genetics:"Colombian Gold × Mexican × Thai × South Indian", parents:["Colombian Gold","Mexican Landrace","Thai","South Indian Landrace"], tree:[{n:"Colombian Gold",t:"sativa",c:[]},{n:"Mexican Landrace",t:"sativa",c:[]},{n:"Thai",t:"sativa",c:[]},{n:"South Indian Landrace",t:"sativa",c:[]}], landrace:"Colombian · Mexican · Thai · South Indian", origin:"Santa Cruz, California, USA (1970s)", breeder:"The Haze Brothers / Neville", effects:["Euphoric","Creative","Energetic","Uplifted","Focused"], flavors:["Spicy","Earthy","Sweet","Citrus","Herbal"], terpenes:["Terpinolene","Caryophyllene","Myrcene"], desc:"The progenitor of modern sativa culture. Original Haze combined four of the world's finest sativa landraces into one plant — producing a sweeping, intellectual high unlike anything before it. 14-16 week flowering time. The foundation of Super Silver Haze, Jack Herer, Amnesia Haze, and hundreds more.", story:"Original Haze was developed in the hills of Santa Cruz by growers known as the Haze Brothers, who spent years working with landrace seeds from Colombia, Mexico, Thailand, and South India. The four-way cross produced extraordinary complexity — a spicy, earthy, cerebral experience that became the benchmark for sativa quality. Neville brought Haze to Amsterdam and it became the genetic template for the entire sativa cannabis category." },
      { name:"White Widow", type:"hybrid", era:"classic", thc:"18-25%", cbd:"0.2%", genetics:"Brazilian Sativa × South Indian Indica", parents:["Brazilian Sativa Landrace","South Indian Indica Landrace"], tree:[{n:"Brazilian Sativa Landrace",t:"sativa",c:[]},{n:"South Indian Indica Landrace",t:"indica",c:[]}], landrace:"Brazilian · South Indian", origin:"Netherlands (Green House Seeds, 1994)", breeder:"Shantibaba / Green House Seeds", effects:["Euphoric","Relaxed","Uplifted","Creative","Happy"], flavors:["Earthy","Woody","Floral","Sweet"], terpenes:["Caryophyllene","Myrcene","Limonene"], desc:"White Widow shocked the cannabis world when it debuted at the 1994 Cannabis Cup — so resinous it appeared frosted white. A landmark strain that proved hybrid vigor could produce extraordinary potency. Parent of White Russian, White Rhino, and numerous other 'White' varieties.", story:"White Widow was developed by Shantibaba (Scott Blakey) at Green House Seeds using an unusual pairing — a Brazilian sativa landrace and a South Indian indica. The Brazilian parent contributed terpene complexity and sativa structure; the South Indian provided resin production unlike anything the Dutch breeding scene had seen. White Widow won the 1994 Cannabis Cup and became one of the best-selling strains in Amsterdam coffeeshop history." },
      { name:"Chemdawg", type:"hybrid", era:"classic", thc:"18-26%", cbd:"0.1%", genetics:"Unknown — Possibly Nepalese × Thai", parents:["Unknown Sativa","Unknown Indica"], tree:[{n:"Possible Nepalese Landrace",t:"sativa",c:[]},{n:"Possible Thai Landrace",t:"sativa",c:[]}], landrace:"Unknown — possibly Himalayan / Thai", origin:"Grateful Dead concert parking lot, 1991", breeder:"Chemdog (Joe Brand)", effects:["Relaxed","Euphoric","Creative","Uplifted","Happy"], flavors:["Diesel","Chemical","Pine","Earthy"], terpenes:["Caryophyllene","Myrcene","Limonene"], desc:"One of the most influential strains ever — and its origins are genuinely mysterious. Chemdawg was obtained from a bag of seed at a Grateful Dead show in 1991. Its diesel chemical aroma was completely unlike anything else. It became the foundation of OG Kush, Sour Diesel, and the entire East/West Coast premium market.", story:"The Chemdawg origin story is part cannabis mythology. Joe Brand (Chemdog) got the seeds from a Colorado bag called 'Dog Bud' at a Grateful Dead show in Deer Creek, Indiana in 1991. The seeds germinated into something nobody had seen — an intensely diesel-chemical aroma, unusual structure, and exceptional potency. Chemdog mailed cuts to breeders in Massachusetts and California. Those cuts became the parents of OG Kush (California cut) and Sour Diesel (East Coast cut), arguably the two most influential American strains ever." },
      { name:"OG Kush", type:"hybrid", era:"classic", thc:"19-26%", cbd:"0.2%", genetics:"Chemdawg × Lemon Thai × Hindu Kush", parents:["Chemdawg","Lemon Thai","Hindu Kush"], tree:[{n:"Chemdawg",t:"hybrid",c:["Unknown Sativa","Unknown Indica"]},{n:"Lemon Thai",t:"sativa",c:["Thai Landrace"]},{n:"Hindu Kush",t:"indica",c:[]}], landrace:"Himalayan · Thai · Afghan", origin:"Los Angeles, California, USA (mid-1990s)", breeder:"Matt Berger / Josh D", effects:["Relaxed","Euphoric","Happy","Uplifted","Hungry"], flavors:["Fuel","Lemon","Earthy","Pine","Spicy"], terpenes:["Myrcene","Limonene","Caryophyllene"], desc:"The defining American strain. OG Kush arrived in LA in the mid-1990s and within a decade had reshaped cannabis culture on the West Coast and beyond. Its fuel-lemon-earth terpene fingerprint became the benchmark for quality. Parent of Bubba Kush, Girl Scout Cookies, Wedding Cake, and hundreds of the most important modern strains.", story:"OG Kush is believed to be a cross of a Chemdawg cut mailed from New England, a Lemon Thai, and a Pakistani Hindu Kush brought together in Florida, then moved to LA by Matt Berger. Josh D is credited with popularizing the strain in Los Angeles dispensaries in the early 2000s. 'OG' means 'Original Gangster' in the LA interpretation — the original, the real thing. OG Kush cuts were among the most hoarded and traded in cannabis history, with authentic 'Josh D OG' and 'SFV OG' cuts commanding extraordinary prices. Its genetic children include essentially the entire modern California market." },
      { name:"Blueberry", type:"indica", era:"classic", thc:"17-24%", cbd:"0.2%", genetics:"Afghani × Thai × Purple Thai", parents:["Afghani","Thai","Purple Thai"], tree:[{n:"Afghani",t:"indica",c:[]},{n:"Thai",t:"sativa",c:[]},{n:"Purple Thai",t:"sativa",c:["Highland Thai","Oaxacan Gold"]}], landrace:"Afghan · Thai · Mexican (Oaxacan)", origin:"Oregon, USA (1970s)", breeder:"DJ Short", effects:["Relaxed","Euphoric","Happy","Sleepy","Uplifted"], flavors:["Blueberry","Sweet","Berry","Vanilla","Earthy"], terpenes:["Myrcene","Caryophyllene","Limonene"], desc:"DJ Short's masterpiece — one of the most distinct flavor profiles in cannabis history. Blueberry's vivid berry sweetness comes from a complex three-way cross of Afghan, Thai, and Purple Thai genetics. Won the 2000 Cannabis Cup. Parent of Blue Dream, the most popular strain in America for nearly a decade.", story:"DJ Short spent years in the 1970s and 80s working with landrace genetics, carefully selecting for a specific flavor profile he had experienced in rare Thai and Oaxacan cannabis. The Purple Thai parent — itself a cross of Highland Thai and Oaxacan Gold — contributed the unusual fruity-sweet terpene signature. Blueberry is one of the only strains where the flavor genuinely matches its name. As the indica parent of Blue Dream, Blueberry's genetics spread across the American market in the 2010s." },
      { name:"Jack Herer", type:"sativa", era:"classic", thc:"18-24%", cbd:"0.1%", genetics:"Haze × Red Skunk × Northern Lights #5", parents:["Haze","Red Skunk","Northern Lights #5"], tree:[{n:"Haze",t:"sativa",c:["Colombian Gold","Mexican Landrace","Thai","South Indian Landrace"]},{n:"Red Skunk",t:"hybrid",c:["Skunk #1"]},{n:"Northern Lights #5",t:"indica",c:["Afghani","Thai"]}], landrace:"Colombian · Mexican · Thai · South Indian · Afghan", origin:"Netherlands (Sensi Seeds, 1994)", breeder:"Sensi Seeds", effects:["Energetic","Uplifted","Creative","Focused","Happy"], flavors:["Pine","Spice","Wood","Earthy","Herbal"], terpenes:["Terpinolene","Caryophyllene","Ocimene"], desc:"Named for the American cannabis activist and author of 'The Emperor Wears No Clothes.' Jack Herer is a masterclass in breeding — it combines the cerebral elevation of Haze with the manageability of Northern Lights and the structure of Skunk, producing a clear-headed, functional sativa. Won the Coffeeshop award multiple times.", story:"Sensi Seeds created Jack Herer in 1994 as a tribute to cannabis activist Jack Herer — the man who more than any other brought hemp and cannabis legalization to mainstream American political discourse. The three-way cross drew on the best of Dutch breeding: Haze sativa genetics, the structure of NL#5, and Skunk's vigor. Jack Herer became one of the most decorated strains in Cannabis Cup history and has been used as a breeding parent for Strawberry Cough, Jack the Ripper, and many others." },
      { name:"AK-47", type:"hybrid", era:"classic", thc:"17-22%", cbd:"0.2%", genetics:"Colombian × Mexican × Thai × Afghani", parents:["Colombian Landrace","Mexican Landrace","Thai","Afghani"], tree:[{n:"Colombian Landrace",t:"sativa",c:[]},{n:"Mexican Landrace",t:"sativa",c:[]},{n:"Thai",t:"sativa",c:[]},{n:"Afghani",t:"indica",c:[]}], landrace:"Colombian · Mexican · Thai · Afghan", origin:"Netherlands (Serious Seeds, 1992)", breeder:"Simon (Serious Seeds)", effects:["Relaxed","Uplifted","Creative","Euphoric","Happy"], flavors:["Earthy","Floral","Woody","Sweet"], terpenes:["Caryophyllene","Myrcene","Limonene"], desc:"Despite the name, AK-47 is a mellow, creatively inspiring hybrid. One of the most awarded strains of the 1990s and 2000s — multiple Cannabis Cups across different categories. A four-way landrace cross that produces a balanced head high with a long-lasting, smooth effect.", story:"Simon of Serious Seeds developed AK-47 in 1992 as a high-performance four-way hybrid combining the best sativa landraces of three continents with Afghan stability. The strain won awards across Europe throughout the 1990s and helped define what a premium balanced hybrid should be. Its wide genetic base produces a complexity — earthy, floral, with slight sweetness — that remains distinctive decades later." },
      { name:"Super Silver Haze", type:"sativa", era:"classic", thc:"18-23%", cbd:"0.1%", genetics:"Skunk #1 × Northern Lights #5 × Haze", parents:["Skunk #1","Northern Lights #5","Haze"], tree:[{n:"Skunk #1",t:"hybrid",c:["Colombian Gold","Acapulco Gold","Afghani"]},{n:"Northern Lights #5",t:"indica",c:["Afghani","Thai"]},{n:"Haze",t:"sativa",c:["Colombian Gold","Mexican Landrace","Thai","South Indian Landrace"]}], landrace:"Colombian · Mexican · Thai · South Indian · Afghan", origin:"Netherlands (Green House Seeds, 1997)", breeder:"Green House Seeds", effects:["Energetic","Euphoric","Creative","Uplifted","Happy"], flavors:["Citrus","Spice","Earthy","Sweet"], terpenes:["Terpinolene","Myrcene","Caryophyllene"], desc:"Three-time Cannabis Cup champion (1997–1999). Super Silver Haze took the best of the Amsterdam golden era — Skunk structure, NL#5 resin, and Haze cerebral elevation — into one legendary sativa. The definitive expression of the Dutch sativa tradition.", story:"Green House Seeds developed SSH as a showcase for their genetic capabilities — crossing three of the most celebrated Amsterdam strains into one. The three consecutive Cannabis Cup wins (1997, 1998, 1999) remain unmatched in the competition's history. Arjan of Green House Seeds attributes the achievement to exceptional selection — they ran thousands of seeds to find the definitive SSH phenotype." },
      { name:"Trainwreck", type:"hybrid", era:"classic", thc:"18-25%", cbd:"0.1%", genetics:"Mexican Sativa × Thai Sativa × Afghani Indica", parents:["Mexican Landrace","Thai","Afghani"], tree:[{n:"Mexican Landrace",t:"sativa",c:[]},{n:"Thai",t:"sativa",c:[]},{n:"Afghani",t:"indica",c:[]}], landrace:"Mexican · Thai · Afghan", origin:"Arcata, Humboldt County, California, USA (1970s)", breeder:"Unknown Humboldt County growers", effects:["Euphoric","Creative","Energetic","Uplifted","Relaxed"], flavors:["Lemon","Pine","Spice","Earthy"], terpenes:["Terpinolene","Myrcene","Caryophyllene"], desc:"A legendary Humboldt County original — sharp lemon-pine aroma, immediate cerebral rush, creative and euphoric. Trainwreck has been a fixture of Northern California cannabis culture since the 1970s. The story goes it was named after a train derailment forced an emergency harvest near where it grew.", story:"Trainwreck's origin story is part of Humboldt County lore. Two brothers were allegedly growing it near Arcata when a nearby train derailment forced them to harvest early — thus 'Trainwreck.' What's clear is that Trainwreck is a genuine old-school California hybrid with exceptional sativa character. A Trainwreck cut has circulated in the Bay Area and Emerald Triangle for decades, considered one of the authentic California sativa classics." },

      // ── OG ERA (1990s–2010s) ─────────────────────────────────────────────────
      { name:"Sour Diesel", type:"sativa", era:"og", thc:"19-25%", cbd:"0.2%", genetics:"Chemdawg 91 × Super Skunk", parents:["Chemdawg 91","Super Skunk"], tree:[{n:"Chemdawg 91",t:"hybrid",c:["Chemdawg"]},{n:"Super Skunk",t:"hybrid",c:["Skunk #1","Afghani"]}], landrace:"Himalayan · Afghan · Colombian · Mexican", origin:"New York, USA (early 1990s)", breeder:"AJ (Asshole Joe)", effects:["Energetic","Euphoric","Creative","Uplifted","Focused"], flavors:["Diesel","Citrus","Earthy","Chemical","Lemon"], terpenes:["Caryophyllene","Myrcene","Limonene"], desc:"New York's signature strain. Sour Diesel's sharp, pungent diesel-citrus aroma is unmistakable. A fast-acting, cerebral, energizing sativa that became the dominant strain in New York City's underground market for two decades. Its distinctive aroma made it one of the few strains recognizable by smell alone.", story:"Sour Diesel emerged from a Chemdawg 91 cut that circulated on the East Coast in the early 90s, crossed with Super Skunk. AJ, a New York grower, is generally credited with developing Sour D as a stable variety. For 20 years it was the most sought-after strain in New York — bags of genuine Sour Diesel commanded premium prices. The strain's cultural impact, from hip-hop references to dispensary menus, makes it one of the defining American cannabis varieties of its era." },
      { name:"Bubba Kush", type:"indica", era:"og", thc:"17-22%", cbd:"0.1%", genetics:"OG Kush × Unknown Indica (Northern Lights descendant)", parents:["OG Kush","Unknown Indica"], tree:[{n:"OG Kush",t:"hybrid",c:["Chemdawg","Lemon Thai","Hindu Kush"]},{n:"Unknown Indica",t:"indica",c:["Possible Northern Lights"]}], landrace:"Himalayan · Thai · Afghan", origin:"Los Angeles, California, USA (late 1990s)", breeder:"Bubba (anonymous breeder)", effects:["Relaxed","Sleepy","Euphoric","Happy","Hungry"], flavors:["Coffee","Chocolate","Earthy","Sweet","Kush"], terpenes:["Myrcene","Caryophyllene","Limonene"], desc:"The heavy body-stone indica of Los Angeles. Bubba Kush has a distinct sweet-coffee-chocolate flavor profile unlike any other Kush variety. Pure sedation and relaxation, with a muscular, dense bud structure. One of the most reliable indica experiences in the dispensary market.", story:"Bubba Kush was developed in the mid-to-late 1990s by a breeder known only as Bubba, who crossed an OG Kush with a mystery indica he obtained from a New Orleans contact (believed to be Northern Lights related). The result was something distinctive — Kush structure and potency with an unusual chocolate-coffee flavor note not found in OG or Hindu Kush. Bubba Kush became a dispensary staple across California and has since been crossed into dozens of modern strains." },
      { name:"Granddaddy Purple", type:"indica", era:"og", thc:"17-23%", cbd:"0.1%", genetics:"Purple Urkle × Big Bud", parents:["Purple Urkle","Big Bud"], tree:[{n:"Purple Urkle",t:"indica",c:["Mendocino Purps Landrace"]},{n:"Big Bud",t:"indica",c:["Afghani","Skunk #1","Northern Lights"]}], landrace:"Afghan · Colombian · Mexican · Mendocino Purps", origin:"San Francisco Bay Area (Ken Estes, 2003)", breeder:"Ken Estes", effects:["Relaxed","Sleepy","Euphoric","Happy","Hungry"], flavors:["Grape","Berry","Sweet","Earthy"], terpenes:["Myrcene","Caryophyllene","Linalool"], desc:"California's most famous purple strain. Granddaddy Purple's vivid grape-berry flavor, deep purple coloration, and heavy sedating indica effect made it one of the most recognizable and requested strains in American dispensaries for over a decade.", story:"Ken Estes developed GDP in San Francisco in 2003 by crossing Purple Urkle — a mysterious Mendocino County purple phenotype — with Big Bud, a heavy-yielding Dutch indica. The cross captured everything the market wanted: vivid purple appearance, grape candy flavor, and couch-lock sedation. GDP popularized the 'purple indica' category and led to a wave of purple-named strains. Its linalool terpene content gives it a distinctly floral, relaxing quality beyond what myrcene alone delivers." },
      { name:"Blue Dream", type:"hybrid", era:"og", thc:"17-24%", cbd:"0.1%", genetics:"Blueberry × Haze", parents:["Blueberry","Haze"], tree:[{n:"Blueberry",t:"indica",c:["Afghani","Thai","Purple Thai"]},{n:"Haze",t:"sativa",c:["Colombian Gold","Mexican Landrace","Thai","South Indian Landrace"]}], landrace:"Afghan · Thai · Colombian · Mexican · South Indian", origin:"Santa Cruz, California, USA (2003)", breeder:"DJ Short / Unknown Santa Cruz breeder", effects:["Relaxed","Euphoric","Creative","Uplifted","Happy"], flavors:["Berry","Sweet","Herbal","Floral","Earthy"], terpenes:["Myrcene","Caryophyllene","Pinene"], desc:"The most popular strain in America for nearly a decade. Blue Dream's remarkable success comes from its balance — cerebral sativa elevation from the Haze side, gentle body relaxation from Blueberry. Wide appeal across experience levels. A perfect entry point and a reliable workhorse.", story:"Blue Dream carries the full spectrum of cannabis genetics in one plant — Afghani, Thai, Colombian, Mexican, South Indian landraces all present through its Blueberry and Haze parents. DJ Short's Blueberry brought the berry sweetness; Haze brought the cerebral lift. The combination proved universally appealing. For several years Blue Dream was the top-selling strain in every legal state with available data — a rare achievement for any agricultural product." },
      { name:"Green Crack", type:"sativa", era:"og", thc:"15-25%", cbd:"0.1%", genetics:"Skunk #1 × Unknown Indica", parents:["Skunk #1","1989 Super Skunk Cut"], tree:[{n:"Skunk #1",t:"hybrid",c:["Colombian Gold","Acapulco Gold","Afghani"]},{n:"Unknown Indica",t:"indica",c:[]}], landrace:"Colombian · Mexican · Afghan", origin:"Athens, Georgia, USA (1990s)", breeder:"Cecil C.", effects:["Energetic","Focused","Uplifted","Creative","Happy"], flavors:["Mango","Citrus","Earthy","Sweet","Tropical"], terpenes:["Myrcene","Caryophyllene","Ocimene"], desc:"Renamed by Snoop Dogg for its intensely energizing effect. Green Crack is a daytime sativa ideal for focus, energy, and creative work. Its mango-citrus flavor is instantly recognizable. Originally called 'Cush' — the name was changed to reflect its stimulating intensity.", story:"Green Crack originated in Athens, Georgia in the 1990s from a Skunk #1 phenotype selected for extreme vigor and energetic effect. Snoop Dogg famously encountered it and gave it the 'Green Crack' name after experiencing its stimulating properties. The name is controversial — many dispensaries sell it under its original name 'Cush' — but the strain's impact is undeniable. Its mango-ocimene terpene profile remains one of the most distinctive in sativa cannabis." },
      { name:"Strawberry Cough", type:"sativa", era:"og", thc:"15-20%", cbd:"0.1%", genetics:"Strawberry Fields × Haze", parents:["Strawberry Fields","Haze"], tree:[{n:"Strawberry Fields",t:"hybrid",c:["Unknown Strawberry Phenotype"]},{n:"Haze",t:"sativa",c:["Colombian Gold","Mexican Landrace","Thai","South Indian Landrace"]}], landrace:"Colombian · Mexican · Thai · South Indian", origin:"Vermont, USA", breeder:"Kyle Kushman", effects:["Uplifted","Energetic","Creative","Happy","Euphoric"], flavors:["Strawberry","Sweet","Herbal","Fruity"], terpenes:["Myrcene","Caryophyllene","Terpinolene"], desc:"One of the most genuinely fruity-smelling strains ever developed. The strawberry aroma is real — not a marketing name. Kyle Kushman found the original plant growing in a strawberry field in Connecticut and has carefully preserved and propagated the genetics since.", story:"Kyle Kushman discovered the original 'Strawberry' plant growing wild near strawberry plants in Connecticut, giving it its fruity quality. He crossed it with a Haze to add complexity and cerebral effect, creating Strawberry Cough. The strain became a cult favorite for its unmistakable aroma and was famously featured in the film 'Children of Men.' Kushman has spent decades preserving the original genetics." },
      { name:"Granddaddy Purple (GDP)", type:"indica", era:"og", thc:"17-23%", cbd:"0.1%", genetics:"Purple Urkle × Big Bud", parents:["Purple Urkle","Big Bud"], tree:[{n:"Purple Urkle",t:"indica",c:["Mendocino Purps"]},{n:"Big Bud",t:"indica",c:["Afghani","Skunk #1"]}], landrace:"Afghan · Mendocino Purps · Colombian", origin:"Bay Area, California (2003)", breeder:"Ken Estes", effects:["Relaxed","Sleepy","Euphoric","Happy","Hungry"], flavors:["Grape","Berry","Sweet","Earthy"], terpenes:["Myrcene","Linalool","Caryophyllene"], desc:"California's most iconic purple indica. Dense purple buds, grape candy aroma, deep body sedation. GDP set the template for the purple indica market and remains one of the most recognized strains globally.", story:"GDP popularized the purple indica category and led to a wave of purple-themed strain naming across California. Ken Estes continued to develop the GDP family with Grand Daddy's phenotypes." },
      { name:"9 Pound Hammer", type:"indica", era:"og", thc:"16-21%", cbd:"0.1%", genetics:"Gooberry × Hells OG × Jack the Ripper", parents:["Gooberry","Hells OG","Jack the Ripper"], tree:[{n:"Gooberry",t:"indica",c:["Afgoo","Blueberry"]},{n:"Hells OG",t:"hybrid",c:["OG Kush descendant"]},{n:"Jack the Ripper",t:"sativa",c:["Jack Herer descendant"]}], landrace:"Afghan · Thai · Colombian · Mexican · South Indian", origin:"Oregon, USA (TGA Subcool Seeds)", breeder:"Subcool (TGA Genetics)", effects:["Relaxed","Sleepy","Happy","Euphoric","Hungry"], flavors:["Grape","Lime","Melon","Earthy"], terpenes:["Myrcene","Caryophyllene","Linalool"], desc:"Heavy indica with an unusually fruity-melon flavor for a sedating strain. 9 Pound Hammer hits hard and stays — one of the more reliable knockout indicas with pleasant grapefruit-lime flavor notes that soften the heavy sedation.", story:"Subcool of TGA Genetics was one of the most innovative breeders of the 2000s, creating complex multi-way crosses that were unusual for the time. 9 Pound Hammer combines the fruit genetics of Gooberry (itself a Blueberry descendant) with the potency of Hells OG and a touch of Haze-lineage sativa from Jack the Ripper." },
      { name:"Headband", type:"hybrid", era:"og", thc:"17-24%", cbd:"0.2%", genetics:"OG Kush × Sour Diesel", parents:["OG Kush","Sour Diesel"], tree:[{n:"OG Kush",t:"hybrid",c:["Chemdawg","Lemon Thai","Hindu Kush"]},{n:"Sour Diesel",t:"sativa",c:["Chemdawg 91","Super Skunk"]}], landrace:"Himalayan · Thai · Afghan · Colombian · Mexican", origin:"California, USA", breeder:"Unknown", effects:["Relaxed","Euphoric","Happy","Creative","Uplifted"], flavors:["Lemon","Diesel","Earthy","Creamy","Pine"], terpenes:["Caryophyllene","Myrcene","Limonene"], desc:"Named for the sensation of gentle pressure felt around the temples and forehead — the 'headband effect' some report when consuming. A premium OG × Diesel cross that combines the lemon-fuel of OG Kush with Sour Diesel's sharp diesel energy.", story:"Headband sits at the intersection of the two most culturally significant California strains — OG Kush and Sour Diesel. The combination produces a distinct creamy diesel aroma with OG earthiness and a cerebral effect that some users describe as producing a physical sensation around the head." },

      // ── COOKIE ERA (2010s) ────────────────────────────────────────────────────
      { name:"Girl Scout Cookies (GSC)", type:"hybrid", era:"cookie", thc:"19-28%", cbd:"0.1%", genetics:"OG Kush × Durban Poison", parents:["OG Kush","Durban Poison"], tree:[{n:"OG Kush",t:"hybrid",c:["Chemdawg","Lemon Thai","Hindu Kush"]},{n:"Durban Poison",t:"sativa",c:["South African Landrace"]}], landrace:"Himalayan · Thai · Afghan · South African", origin:"San Francisco Bay Area, California, USA (2011)", breeder:"Cookie Fam (Berner, Jigga)", effects:["Euphoric","Relaxed","Happy","Creative","Uplifted"], flavors:["Sweet","Earthy","Mint","Cookie","Cherry"], terpenes:["Caryophyllene","Limonene","Humulene"], desc:"The strain that defined the 2010s. GSC's arrival marked a turning point in cannabis culture — potency, terpene complexity, and flavor became the primary values. GSC spawned an entire family of strains (Gelato, Wedding Cake, Sherbet, Dosido) and made the Bay Area the center of global cannabis genetics.", story:"Cookie Fam Genetics — a collective including rapper Berner and breeder Jigga — developed GSC from an OG Kush male and a Durban Poison female selected from seeds. The original 'Forum Cut' and 'Thin Mint' phenotypes became the most sought-after clones in cannabis history. GSC's humulene-caryophyllene terpene profile was unlike anything on the market — a complex sweet-minty-earthy-chemical combination. GSC clones were so valuable that they became currency in the Bay Area underground market. Its children — Gelato, Sherbet, Wedding Cake, Dosido — each became landmark strains in their own right." },
      { name:"Sunset Sherbet", type:"hybrid", era:"cookie", thc:"18-24%", cbd:"0.1%", genetics:"GSC (Girl Scout Cookies) × Pink Panties", parents:["Girl Scout Cookies","Pink Panties"], tree:[{n:"Girl Scout Cookies",t:"hybrid",c:["OG Kush","Durban Poison"]},{n:"Pink Panties",t:"indica",c:["Florida Kush","unknown"]}], landrace:"Himalayan · Thai · Afghan · South African · Florida Kush", origin:"San Francisco Bay Area, California, USA", breeder:"Mr. Sherbinski", effects:["Relaxed","Euphoric","Happy","Uplifted","Creative"], flavors:["Sweet","Berry","Citrus","Earthy","Sherbet"], terpenes:["Caryophyllene","Limonene","Myrcene"], desc:"A GSC child with sweeter, more candy-like fruit notes. Sunset Sherbet softens the GSC edge with Pink Panties' creamy sweetness. Sherbinski built a brand empire around this strain — Sherbinskis is now one of California's most recognized premium cannabis brands.", story:"Sherbinski developed Sunset Sherbet by crossing the prized GSC Forum Cut with Pink Panties — a Florida Kush-derived indica. The cross brought out a sweet, sherbet-like quality hidden in the GSC genetics. Sherbinski's exclusive drop model (limited releases to a select list of customers) created enormous demand and established the 'drop culture' that premium cannabis brands still use today." },
      { name:"Gelato", type:"hybrid", era:"cookie", thc:"20-27%", cbd:"0.2%", genetics:"Sunset Sherbet × Thin Mint GSC", parents:["Sunset Sherbet","Thin Mint GSC"], tree:[{n:"Sunset Sherbet",t:"hybrid",c:["GSC","Pink Panties"]},{n:"Thin Mint GSC",t:"hybrid",c:["OG Kush","Durban Poison"]}], landrace:"Himalayan · Thai · Afghan · South African", origin:"San Francisco Bay Area, California, USA (2014)", breeder:"Cookie Fam / Sherbinski", effects:["Relaxed","Euphoric","Happy","Creative","Uplifted"], flavors:["Sweet","Dessert","Citrus","Lavender","Berry"], terpenes:["Caryophyllene","Limonene","Myrcene"], desc:"Gelato took GSC-family genetics to their sweetest extreme. Dense, colorful buds with dessert-like lavender-citrus sweetness and extraordinary potency. Gelato #33 (Larry Bird) and Gelato #41 became two of the most coveted phenotypes in modern cannabis. One of the best-selling strains in legal cannabis markets.", story:"Cookie Fam worked with Sherbinski to develop the Gelato line, running many phenotypes of the Sunset Sherbet × Thin Mint cross. Gelato #33 (Larry Bird, for the jersey number) and Gelato #41 became the most famous — each with a slightly different flavor profile. The Gelato name became so powerful that dozens of counterfeit 'Gelato' products flooded markets. Gelato's genetics run through Ice Cream Cake, London Pound Cake, Biscotti, and many other modern premium strains." },
      { name:"Wedding Cake", type:"hybrid", era:"cookie", thc:"22-27%", cbd:"0.1%", genetics:"Triangle Kush × Animal Mints", parents:["Triangle Kush","Animal Mints"], tree:[{n:"Triangle Kush",t:"indica",c:["OG Kush Florida Cut"]},{n:"Animal Mints",t:"hybrid",c:["Animal Cookies","SinMint Cookies"]}], landrace:"Himalayan · Thai · Afghan · South African", origin:"Seed Junky Genetics, California, USA", breeder:"Seed Junky Genetics (JBeezy)", effects:["Relaxed","Euphoric","Happy","Hungry","Uplifted"], flavors:["Sweet","Vanilla","Earthy","Pepper","Cookie"], terpenes:["Caryophyllene","Limonene","Myrcene"], desc:"Also known as Pink Cookies in Canada. Wedding Cake's dense, cake-frosted appearance, sweet vanilla-pepper terpene profile, and exceptional potency made it one of the bestselling strains in legal markets in 2019-2021. Seed Junky Genetics created a modern powerhouse.", story:"JBeezy of Seed Junky Genetics is one of the most prolific and respected breeders working today. Wedding Cake was developed from Triangle Kush (a rare Florida OG Kush phenotype) crossed with Animal Mints. The result — later named Wedding Cake — captured both the OG earthiness and the sweet cookie character of its GSC-lineage Animal Mints parent. Wedding Cake became Leafly's Strain of the Year in 2019." },
      { name:"Dosido", type:"hybrid", era:"cookie", thc:"19-26%", cbd:"0.1%", genetics:"Girl Scout Cookies × Face Off OG", parents:["Girl Scout Cookies","Face Off OG"], tree:[{n:"Girl Scout Cookies",t:"hybrid",c:["OG Kush","Durban Poison"]},{n:"Face Off OG",t:"indica",c:["OG Kush Family"]}], landrace:"Himalayan · Thai · Afghan · South African", origin:"Archive Seeds, Oregon, USA", breeder:"Archive Seeds (Gage Green Group)", effects:["Relaxed","Sleepy","Euphoric","Happy","Hungry"], flavors:["Earthy","Sweet","Floral","Lime","Cookie"], terpenes:["Caryophyllene","Limonene","Linalool"], desc:"Dosido amplifies the OG side of GSC genetics — earthier, more body-heavy than parent GSC, with floral lime notes from the linalool profile. Archive Seeds' most celebrated release, Dosido became the parent of many modern hybrids including Jealousy.", story:"Archive Seeds ran the GSC × Face Off OG cross to find a strain with more body effect than GSC while preserving the cookie flavor complexity. Dosido delivered — and then became the parent stock for a generation of new crosses. Dosido #22 is particularly prized and has been widely used as a breeding parent by top-tier California breeders." },
      { name:"London Pound Cake", type:"indica", era:"cookie", thc:"21-29%", cbd:"0.1%", genetics:"Sunset Sherbet × Unknown Heavy Indica", parents:["Sunset Sherbet","Unknown Heavy Indica"], tree:[{n:"Sunset Sherbet",t:"hybrid",c:["GSC","Pink Panties"]},{n:"Unknown Heavy Indica",t:"indica",c:[]}], landrace:"Himalayan · Thai · Afghan · South African", origin:"Cookies (Berner), California, USA", breeder:"Cookies Genetics", effects:["Relaxed","Sleepy","Euphoric","Happy","Hungry"], flavors:["Grape","Lemon","Berry","Sweet","Earthy"], terpenes:["Limonene","Caryophyllene","Myrcene"], desc:"LPC is one of the heaviest hitters in the Cookies family — a deep, sedating indica with bright grape and lemon notes layered over Sherbet sweetness. One of the highest-THC strains consistently available in California dispensaries.", story:"Cookies Genetics developed LPC as an extension of the Sherbet family, selecting for a heavier, more indica-dominant expression. The grape-lemon flavor profile that emerged from combining Sherbet with the unknown indica parent was distinctive enough to make LPC a consistent bestseller. LPC #75 is particularly sought after." },

      // ── GORILLA GLUE FAMILY ──────────────────────────────────────────────────
      { name:"Gorilla Glue #4", type:"hybrid", era:"cookie", thc:"24-30%", cbd:"0.1%", genetics:"Chem's Sister × Chocolate Diesel × Sour Dubb", parents:["Chem's Sister","Chocolate Diesel","Sour Dubb"], tree:[{n:"Chem's Sister",t:"hybrid",c:["Chemdawg"]},{n:"Chocolate Diesel",t:"hybrid",c:["Sour Diesel","Chocolate Thai"]},{n:"Sour Dubb",t:"hybrid",c:["Sour Diesel","East Coast Sour Diesel"]}], landrace:"Himalayan · Thai · Afghan · Colombian · Mexican", origin:"Nevada, USA (2013)", breeder:"Joesy Whales / Lone Watty (GG Strains)", effects:["Relaxed","Euphoric","Happy","Sleepy","Hungry"], flavors:["Earthy","Pungent","Chemical","Diesel","Chocolate"], terpenes:["Caryophyllene","Myrcene","Limonene"], desc:"GG#4 is one of the most potent strains ever consistently tested — regularly exceeding 28% THC. Named for the sticky, glue-like resin that makes trimming the buds nearly impossible. A full-body, heavy-hitting hybrid that became a global bestseller.", story:"GG#4 was an accidental creation — Joesy Whales grew out a bagseed from his Chem's Sister plants that had been pollinated. The resulting plant was so extraordinary that he stabilized it into a line. GG#4 won the Los Angeles Cannabis Cup in 2014 and the Michigan Cannabis Cup (hybrid category) the same year. GG Strains entered into a legal battle with the hair care company Gorilla Glue over the name, eventually settling. The strain is now technically known as 'Original Glue' in some markets." },

      // ── MODERN EXOTICS (2015+) ───────────────────────────────────────────────
      { name:"Zkittlez", type:"hybrid", era:"modern", thc:"16-23%", cbd:"0.1%", genetics:"Grape Ape × Grapefruit", parents:["Grape Ape","Grapefruit"], tree:[{n:"Grape Ape",t:"indica",c:["Mendocino Purps","Skunk #1","Afghani"]},{n:"Grapefruit",t:"sativa",c:["Cinderella 99 descendant"]}], landrace:"Afghan · Colombian · Mexican · Mendocino Purps", origin:"Northern California (3rd Gen Family / Terp Hogz, 2012)", breeder:"3rd Gen Family / Terp Hogz (Zkittlez collective)", effects:["Relaxed","Euphoric","Happy","Uplifted","Creative"], flavors:["Tropical","Sweet","Fruity","Candy","Grape"], terpenes:["Caryophyllene","Myrcene","Limonene"], desc:"Zkittlez redefined what cannabis flavor could be — a genuine tropical candy experience. Won 1st place indica at the 2016 Emerald Cup and the Indica category at the 2015 Cannabis Cup. It launched the 'candy-fruit' flavor trend that still dominates modern cannabis breeding.", story:"The Zkittlez collective (Terp Hogz) developed the strain in secret for several years before releasing it publicly. They ran many phenotypes of Grape Ape × Grapefruit, selecting for extreme sweetness and tropical fruit terpenes. Zkittlez's debut at competitions was a revelation — judges had never encountered this kind of candy-fruit flavor profile in cannabis. It subsequently became the parent of Runtz and dozens of other modern hybrids. The Zkittlez trademark battle with candy brand Skittles was eventually settled." },
      { name:"Runtz", type:"hybrid", era:"modern", thc:"19-29%", cbd:"0.1%", genetics:"Zkittlez × Gelato", parents:["Zkittlez","Gelato"], tree:[{n:"Zkittlez",t:"hybrid",c:["Grape Ape","Grapefruit"]},{n:"Gelato",t:"hybrid",c:["Sunset Sherbet","Thin Mint GSC"]}], landrace:"Afghan · Colombian · Mexican · South African · Mendocino Purps", origin:"Los Angeles, California, USA (2017-2018)", breeder:"Cookies (Berner) / Runtz crew", effects:["Euphoric","Relaxed","Happy","Uplifted","Creative"], flavors:["Sweet","Fruity","Candy","Tropical","Creamy"], terpenes:["Caryophyllene","Limonene","Myrcene"], desc:"Runtz became one of the fastest-rising strains in cannabis history — going from underground LA dispensary exclusive to Leafly Strain of the Year 2020 in just two years. The Zkittlez-Gelato cross captures both candy sweetness and dessert creaminess at extreme potency.", story:"Runtz emerged from the Los Angeles underground market around 2017-2018, rapidly gaining a cult following. Cookies dropped a collaboration called 'Runtz' that accelerated its visibility — but the original genetics predate the Cookies collaboration. White Runtz and Pink Runtz phenotypes each developed their own followings. Runtz's crossing of the two most flavorful strains of the previous decade produced something genuinely new — and it spawned a naming convention ('___ Runtz') that continues proliferating today." },
      { name:"MAC (Miracle Alien Cookies)", type:"hybrid", era:"modern", thc:"20-24%", cbd:"0.2%", genetics:"Alien Cookies F2 × Colombian × Starfighter", parents:["Alien Cookies F2","Colombian Landrace","Starfighter"], tree:[{n:"Alien Cookies F2",t:"hybrid",c:["Alien Dawg","GSC"]},{n:"Colombian Landrace",t:"sativa",c:[]},{n:"Starfighter",t:"hybrid",c:["Alien Tahoe OG","Tahoe Alien"]}], landrace:"Colombian · Afghan · South African · Himalayan", origin:"USA (Capulator, 2016)", breeder:"Capulator", effects:["Euphoric","Creative","Relaxed","Happy","Uplifted"], flavors:["Citrus","Floral","Earthy","Sour","Spice"], terpenes:["Caryophyllene","Limonene","Myrcene"], desc:"MAC is one of the most visually striking modern strains — dense buds covered in trichomes with a milky-white appearance at peak ripeness. The unique citrus-floral-spice terpene profile and well-balanced euphoric effect have made it a connoisseur favorite.", story:"Capulator developed MAC after years of working with Alien Cookies genetics, which itself combined Alien Dawg and GSC. He introduced a Colombian landrace male to add genetic diversity and reintroduce landrace sativa vigor, then combined with Starfighter. MAC #1 is the most prized phenotype — a female-only variety with exceptional resin production and complex terpenes. Capulator's careful curation of who receives MAC cuts has maintained the strain's prestige and authenticity." },
      { name:"Gary Payton", type:"hybrid", era:"modern", thc:"20-25%", cbd:"0.2%", genetics:"The Y × Snowman", parents:["The Y","Snowman"], tree:[{n:"The Y",t:"hybrid",c:["Y Griega","unknown"]},{n:"Snowman",t:"hybrid",c:["Girl Scout Cookies phenotype"]}], landrace:"Himalayan · Afghan · South African", origin:"Cookies Genetics, California, USA (2020)", breeder:"Cookies Genetics / Powerzzzup Genetics", effects:["Uplifted","Energetic","Creative","Focused","Euphoric"], flavors:["Gas","Earthy","Sweet","Spice","Cookie"], terpenes:["Caryophyllene","Limonene","Myrcene"], desc:"Named for NBA Hall of Famer Gary Payton ('The Glove'). Created in collaboration with Powerzzzup Genetics and endorsed by Gary Payton himself. Pungent gas aroma with sweet cookie notes — a high-energy daytime hybrid with significant media presence.", story:"Cookies Genetics partnered with Powerzzzup Genetics (known for their work with The Y strain) to develop Gary Payton. The NBA legend's involvement brought mainstream media attention to the strain, and Cookies leveraged the brand partnership across dispensaries nationwide. Gary Payton has been widely used as a breeding parent, with Gary Payton × MAC and Gary Payton × Gelato crosses becoming popular in their own right." },
      { name:"Ice Cream Cake", type:"indica", era:"modern", thc:"20-25%", cbd:"0.1%", genetics:"Wedding Cake × Gelato #33", parents:["Wedding Cake","Gelato #33"], tree:[{n:"Wedding Cake",t:"hybrid",c:["Triangle Kush","Animal Mints"]},{n:"Gelato #33",t:"hybrid",c:["Sunset Sherbet","Thin Mint GSC"]}], landrace:"Himalayan · Thai · Afghan · South African", origin:"Seed Junky Genetics, California, USA (2019)", breeder:"Seed Junky Genetics (JBeezy)", effects:["Relaxed","Sleepy","Euphoric","Happy","Hungry"], flavors:["Vanilla","Cream","Sweet","Cookie","Earthy"], terpenes:["Caryophyllene","Limonene","Linalool"], desc:"The ultimate dessert indica. ICC combines Wedding Cake's vanilla-pepper complexity with Gelato's sweet-cream profile — the result smells and tastes genuinely like vanilla ice cream. One of the most consistent indica experiences in modern dispensaries.", story:"JBeezy's second major hit after Wedding Cake, ICC took the GSC family's dessert flavors to their absolute sweetest expression. The Gelato × Wedding Cake cross had been anticipated — both were already megastars — but the result exceeded expectations. ICC became Leafly's Strain of the Year in 2021 and has since become the parent of ICC-derived hybrids across multiple generations." },
      { name:"Jealousy", type:"hybrid", era:"modern", thc:"21-28%", cbd:"0.1%", genetics:"Sherbet BX1 × Dosido #22", parents:["Sherbet BX1","Dosido #22"], tree:[{n:"Sherbet BX1",t:"hybrid",c:["Sunset Sherbet","GSC"]},{n:"Dosido #22",t:"hybrid",c:["GSC","Face Off OG"]}], landrace:"Himalayan · Thai · Afghan · South African", origin:"Seed Junky Genetics, California, USA (2021)", breeder:"Seed Junky Genetics (JBeezy)", effects:["Relaxed","Euphoric","Happy","Creative","Uplifted"], flavors:["Sweet","Creamy","Earthy","Cookie","Gas"], terpenes:["Caryophyllene","Limonene","Myrcene"], desc:"Jealousy became one of the most sought-after strains of 2021-2022 — a highly resinous, gas-terpy hybrid that combined the best of the Sherbet and Dosido genetic lines. Used extensively as a breeding parent by top-tier California breeders immediately upon release.", story:"JBeezy developed Jealousy by stacking Sherbet genetics on top of Dosido — essentially concentrating GSC-family DNA from two different directions. The result was a strain with exceptional terpene density and a unique flavor profile that sits between the cookie-sweet and the gassy-earthy. Jealousy became a breeding cornerstone immediately after release, with Jealousy × Runtz, Jealousy × MAC, and Jealousy × Gary Payton all becoming sought-after in their own right." },
      { name:"Biscotti", type:"indica", era:"modern", thc:"21-27%", cbd:"0.1%", genetics:"Gelato #25 × South Florida OG × GSC", parents:["Gelato #25","South Florida OG","GSC"], tree:[{n:"Gelato #25",t:"hybrid",c:["Sunset Sherbet","Thin Mint GSC"]},{n:"South Florida OG",t:"indica",c:["OG Kush Family"]},{n:"GSC",t:"hybrid",c:["OG Kush","Durban Poison"]}], landrace:"Himalayan · Thai · Afghan · South African", origin:"Cookies Genetics, California, USA", breeder:"Cookies Genetics", effects:["Relaxed","Euphoric","Happy","Sleepy","Creative"], flavors:["Sweet","Cookie","Diesel","Earthy","Nutty"], terpenes:["Caryophyllene","Limonene","Myrcene"], desc:"Biscotti is the definition of a connoisseur indica — dense, frosted buds with a distinct diesel-cookie-nutty flavor profile. High potency, full-body relaxation with a gassy edge that separates it from the sweeter members of the GSC family.", story:"Cookies developed Biscotti as a more savory, diesel-leaning counterpart to the sweeter Gelato and Sherbet lines. By introducing South Florida OG genetics — a Kush-heavy Florida cut — they pulled out the gassy, fuel notes that were latent in the Gelato genetics. Biscotti became one of Cookies' strongest performers in California dispensaries." },
      { name:"Apple Fritter", type:"hybrid", era:"modern", thc:"22-28%", cbd:"0.1%", genetics:"Sour Apple × Animal Cookies", parents:["Sour Apple","Animal Cookies"], tree:[{n:"Sour Apple",t:"hybrid",c:["Cinderella 99","Sour Diesel"]},{n:"Animal Cookies",t:"hybrid",c:["GSC","Fire OG"]}], landrace:"Himalayan · Thai · Afghan · South African · Colombian", origin:"Lumpy's Flowers, Northern California, USA", breeder:"Lumpy's Flowers", effects:["Relaxed","Euphoric","Happy","Creative","Uplifted"], flavors:["Apple","Sweet","Earthy","Vanilla","Cookie"], terpenes:["Caryophyllene","Limonene","Myrcene"], desc:"Leafly Strain of the Year 2021 co-winner. Apple Fritter's apple-pastry sweetness combined with Animal Cookies' gaseous depth produced one of the most unique flavor profiles in modern cannabis. Consistently exceeds 25% THC with exceptional terpene density.", story:"Lumpy's Flowers — a Sonoma County, California cultivation operation — developed Apple Fritter as a passion project using Sour Apple and Animal Cookies parents. The strain circulated in Northern California's wholesale market before suddenly becoming nationally recognized. Apple Fritter represents the 'micro-breeder makes it big' story that defines much of modern premium cannabis genetics." },
      { name:"Mimosa", type:"hybrid", era:"modern", thc:"17-24%", cbd:"0.1%", genetics:"Clementine × Purple Punch", parents:["Clementine","Purple Punch"], tree:[{n:"Clementine",t:"sativa",c:["Tangie","Lemon Skunk"]},{n:"Purple Punch",t:"indica",c:["Larry OG","Granddaddy Purple"]}], landrace:"Afghan · Colombian · Mendocino Purps · Skunk", origin:"Symbiotic Genetics, California, USA", breeder:"Symbiotic Genetics", effects:["Energetic","Uplifted","Happy","Creative","Euphoric"], flavors:["Citrus","Orange","Sweet","Fruity","Tropical"], terpenes:["Limonene","Myrcene","Caryophyllene"], desc:"Mimosa delivers what the name promises — a bright, citrus-forward morning sativa experience with tropical sweetness. One of the most popular daytime strains in California dispensaries. The Clementine × Purple Punch cross produces vivid orange citrus terpenes with a smooth, functional energy.", story:"Symbiotic Genetics created Mimosa by combining Clementine (itself a Tangie-Lemon Skunk cross) with Purple Punch — an unusual pairing of an uplifting citrus sativa and a heavy grape indica. The result leaned sativa in effect while developing a vivid orange aroma from the Tangie genetics. Mimosa spawned an 'E' version (Mimosa EVO) and has been used extensively in breeding for citrus terpene profiles." },
      { name:"Purple Punch", type:"indica", era:"modern", thc:"18-20%", cbd:"0.1%", genetics:"Larry OG × Granddaddy Purple", parents:["Larry OG","Granddaddy Purple"], tree:[{n:"Larry OG",t:"hybrid",c:["OG Kush Family"]},{n:"Granddaddy Purple",t:"indica",c:["Purple Urkle","Big Bud"]}], landrace:"Himalayan · Afghan · Mendocino Purps · Colombian", origin:"Supernova Gardens, Northern California, USA", breeder:"Supernova Gardens", effects:["Relaxed","Sleepy","Euphoric","Happy","Hungry"], flavors:["Grape","Blueberry","Candy","Sweet","Vanilla"], terpenes:["Myrcene","Caryophyllene","Linalool"], desc:"Purple Punch is a dessert indica through and through — grape candy and blueberry muffin aromas, dense purple buds, and a heavy sedating high. Became enormously popular in California as a sleep-aid indica. Parent of Mimosa and numerous other modern crosses.", story:"Purple Punch combines OG Kush family structure with Granddaddy Purple's grape flavor genetics — bringing together California's two most important indica lineages. The result is approachable and flavorful, appealing to a broad consumer base. Its linalool content contributes to its notably sedating quality beyond what the myrcene alone would produce." },
      { name:"Cereal Milk", type:"hybrid", era:"modern", thc:"18-23%", cbd:"0.1%", genetics:"Y Life × Snowman", parents:["Y Life","Snowman"], tree:[{n:"Y Life",t:"hybrid",c:["GSC","Cookies and Cream"]},{n:"Snowman",t:"hybrid",c:["GSC phenotype"]}], landrace:"Himalayan · Afghan · South African", origin:"Cookies Genetics, California, USA", breeder:"Powerzzzup Genetics / Cookies", effects:["Uplifted","Relaxed","Euphoric","Happy","Creative"], flavors:["Creamy","Sweet","Fruity","Vanilla","Berry"], terpenes:["Limonene","Myrcene","Caryophyllene"], desc:"Cereal Milk's name captures its flavor perfectly — a creamy, sweet, slightly fruity quality reminiscent of the milk left after eating fruity cereal. A GSC-family hybrid with an unusually smooth, dessert-sweet character. Became a Cookies flagship alongside Gary Payton.", story:"Powerzzzup Genetics developed Cereal Milk from their Y Life (GSC × Cookies and Cream) crossed with the GSC Snowman phenotype — doubling down on GSC genetics to maximize the creamy-sweet profile. Cookies brought it to market and it became one of their top-performing strains, with Cereal Milk vapes and pre-rolls becoming dispensary bestsellers across multiple states." },
      { name:"Gushers", type:"hybrid", era:"modern", thc:"18-26%", cbd:"0.1%", genetics:"Gelato #41 × Triangle Kush", parents:["Gelato #41","Triangle Kush"], tree:[{n:"Gelato #41",t:"hybrid",c:["Sunset Sherbet","Thin Mint GSC"]},{n:"Triangle Kush",t:"indica",c:["OG Kush Florida Cut"]}], landrace:"Himalayan · Thai · Afghan · South African", origin:"Cookies Genetics, California, USA", breeder:"Cookies Genetics", effects:["Relaxed","Euphoric","Happy","Uplifted","Creative"], flavors:["Tropical","Sweet","Earthy","Fruity","Gas"], terpenes:["Caryophyllene","Limonene","Myrcene"], desc:"Gushers smells like tropical gummy candy with a gas edge — one of the more complex sweet-terpene profiles in the Cookies catalog. Dense, resin-coated buds with excellent bag appeal and a balanced effect that earned it consistent sales across demographics.", story:"Cookies developed Gushers from Gelato #41 (the gassier, denser Gelato phenotype) and Triangle Kush (a prized Florida OG Kush cut). The Triangle Kush added the OG earthiness and potency while Gelato brought tropical sweetness. Gushers is a key parent in many subsequent Cookie-family crosses and has proven as durable as Gelato and Wedding Cake in the marketplace." },
      { name:"Permanent Marker", type:"hybrid", era:"modern", thc:"25-30%", cbd:"0.1%", genetics:"Biscotti × Jealousy × Sherb BX", parents:["Biscotti","Jealousy","Sherb BX"], tree:[{n:"Biscotti",t:"hybrid",c:["Gelato #25","South Florida OG","GSC"]},{n:"Jealousy",t:"hybrid",c:["Sherbet BX1","Dosido #22"]},{n:"Sherb BX",t:"hybrid",c:["Sunset Sherbet","GSC"]}], landrace:"Himalayan · Thai · Afghan · South African", origin:"Seed Junky Genetics, California, USA (2022)", breeder:"Seed Junky Genetics (JBeezy)", effects:["Relaxed","Euphoric","Happy","Creative","Uplifted"], flavors:["Gas","Fuel","Sweet","Earthy","Chemical"], terpenes:["Caryophyllene","Myrcene","Limonene"], desc:"One of the most pungent strains released in recent years — the 'permanent marker' name references the sharp, chemical-fuel aroma that dominates the nose. A stacked GSC-family cross that maximizes resin density and THC potential.", story:"Permanent Marker represents the third generation of JBeezy's work — taking Biscotti and Jealousy (both already landmark strains from Seed Junky) and adding Sherb BX to create something even more concentrated in the GSC-family genetic space. The result is a high-complexity, high-potency strain that appealed immediately to extract artists and rosin pressers for its exceptional resin production." },
      { name:"RS-11 (Rainbow Sherbet #11)", type:"hybrid", era:"modern", thc:"20-25%", cbd:"0.1%", genetics:"Pink Guava × OZK", parents:["Pink Guava","OZK"], tree:[{n:"Pink Guava",t:"hybrid",c:["Papaya","unknown"]},{n:"OZK",t:"hybrid",c:["Zkittlez phenotype"]}], landrace:"Afghan · Colombian · Mexican · Mendocino Purps", origin:"Doja Pak, California, USA", breeder:"Doja Pak", effects:["Relaxed","Euphoric","Happy","Uplifted","Creative"], flavors:["Tropical","Guava","Fruity","Sweet","Candy"], terpenes:["Limonene","Caryophyllene","Myrcene"], desc:"RS-11 is Doja Pak's landmark release — a tropical-fruit-forward strain that became one of the most influential genetics packages of 2021-2022. The guava-tropical flavor profile spawned an entire wave of Doja Pak crosses that now circulate among top-tier breeders globally.", story:"Doja Pak built a reputation as one of the premier genetics sources in California through meticulous selection and limited releases. RS-11 (Rainbow Sherbet #11) combined Pink Guava with an OZK male (Zkittlez phenotype) to produce a tropical-forward strain with exceptional bag appeal and dense, resin-heavy structure. RS-11 has been used as breeding stock by dozens of elite breeders, with Doja Pak collaborations becoming among the most anticipated releases in the genetics community." },
      { name:"Papaya", type:"indica", era:"modern", thc:"20-25%", cbd:"0.1%", genetics:"Citral × Ice #2", parents:["Citral","Ice #2"], tree:[{n:"Citral",t:"indica",c:["Afghani Landrace"]},{n:"Ice #2",t:"hybrid",c:["Skunk #1","Northern Lights","Shiva","White Widow"]}], landrace:"Afghan · Colombian · Mexican · Thai · South Indian", origin:"Nirvana Seeds, Netherlands (late 1990s)", breeder:"Nirvana Seeds", effects:["Relaxed","Sleepy","Euphoric","Happy","Hungry"], flavors:["Tropical","Mango","Papaya","Sweet","Earthy"], terpenes:["Myrcene","Caryophyllene","Limonene"], desc:"Papaya is a cult classic among solventless extractors — its exceptional trichome production and tropical mango-papaya flavor produce some of the most flavorful hash rosin available. Often listed as a 'must-grow' for premium hash production.", story:"Nirvana Seeds developed Papaya in the Netherlands from Citral (an Afghan-heavy indica) and their Ice #2 (a multi-way classic cross). The tropical terpene profile that emerged — genuine mango and papaya notes from myrcene expression — was unexpected. Papaya remained a connoisseur variety for years before becoming widely adopted in the solventless extract scene, where its resin quality and terpene expression are consistently praised." }
    ];

    const eraLabel = {landrace:"Landrace",classic:"Classic Era",og:"OG Era",cookie:"Cookie Era",modern:"Modern"};
    const eraColors = {landrace:"#C9973A",classic:"#9B72CF",og:"#5B8DD9",cookie:"#52B788",modern:"#E05C5C"};
    const typeColors = {indica:"#9B72CF",sativa:"#E8A84C",hybrid:"#52B788"};

    // Merge full STRAINS_DB (392) with rich _SD encyclopedia data
    const sdByName = new Map(_SD.map(s => [s.name.toLowerCase(), s]));
    const mergedSD = STRAINS_DB.map(db => {
      const rich = sdByName.get(db.name.toLowerCase());
      if (rich) return rich;
      return {
        name: db.name,
        type: db.type || 'hybrid',
        era: 'modern',
        thc: (db.thc_min||0) + '-' + (db.thc_max||25) + '%',
        cbd: (db.cbd||0.1) + '%',
        genetics: db.genetics || '',
        effects: db.effects || [],
        flavors: db.flavors || [],
        terpenes: db.terpenes || [],
        desc: db.description || '',
        tags: db.tags || [],
        rating: db.rating || 4.2,
      };
    });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Strain Library — Cannascenti Encyclopedia</title>
<meta name="description" content="Complete cannabis strain library. Full genetics, lineage trees, crosses, effects, and flavor profiles for every major strain.">
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
/* Search & filters */
.strain-search-wrap{position:sticky;top:60px;z-index:50;background:#060d0a;padding:16px 0 12px;margin-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.06)}
.strain-search{width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:14px 20px 14px 46px;color:#F2EAD8;font-family:Montserrat,sans-serif;font-size:.9rem;outline:none;transition:border-color .2s}
.strain-search:focus{border-color:rgba(82,183,136,0.4);background:rgba(255,255,255,0.06)}
.search-icon{position:absolute;left:16px;top:50%;transform:translateY(-50%);color:rgba(242,234,216,0.3);font-size:16px;pointer-events:none}
.search-rel{position:relative}
.filters-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center}
.sf-btn{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:6px 16px;color:rgba(242,234,216,0.55);font-family:Montserrat,sans-serif;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .2s}
.sf-btn:hover{border-color:rgba(255,255,255,0.25);color:rgba(242,234,216,0.85)}
.sf-btn.active{background:rgba(255,255,255,0.06)}
.sf-btn.t-indica.active{border-color:#9B72CF;color:#9B72CF}
.sf-btn.t-sativa.active{border-color:#E8A84C;color:#E8A84C}
.sf-btn.t-hybrid.active{border-color:#52B788;color:#52B788}
.sf-btn.t-all.active{border-color:#F2EAD8;color:#F2EAD8}
.sf-sep{width:1px;height:20px;background:rgba(255,255,255,0.1);margin:0 4px}
.effect-chip{background:none;border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:5px 12px;color:rgba(242,234,216,0.45);font-family:Montserrat,sans-serif;font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;transition:all .2s}
.effect-chip:hover{border-color:rgba(255,255,255,0.2);color:rgba(242,234,216,0.7)}
.effect-chip.active{border-color:#52B788;color:#52B788;background:rgba(82,183,136,0.08)}
/* Count & Era header */
.count-bar{font-size:.8rem;color:rgba(242,234,216,0.35);margin:16px 0 24px;display:flex;align-items:center;gap:10px}
.era-header{font-family:Montserrat,sans-serif;font-size:.7rem;letter-spacing:.15em;text-transform:uppercase;color:rgba(242,234,216,0.3);margin:32px 0 14px;display:flex;align-items:center;gap:10px}
.era-header::after{content:'';flex:1;height:1px;background:rgba(255,255,255,0.06)}
/* Cards */
.strain-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.sc{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;overflow:hidden;transition:border-color .2s,transform .15s;cursor:pointer;position:relative}
.sc:hover{border-color:rgba(255,255,255,0.14);transform:translateY(-2px)}
.sc.open{border-color:rgba(82,183,136,0.25)}
.sc-stripe{height:3px;width:100%}
.sc-inner{padding:18px 20px 16px}
.sc-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
.sc-name{font-family:'Cormorant Garamond',serif;font-size:1.3rem;font-weight:400;color:#F2EAD8;line-height:1.2}
.sc-name-link{text-decoration:none;transition:color .2s}.sc-name-link:hover{color:#52B788}
.sc-badges{display:flex;gap:6px;align-items:center;flex-shrink:0;margin-left:8px}
.sc-type{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;border-radius:20px;padding:3px 9px;font-weight:600;white-space:nowrap}
.sc-era{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;border-radius:20px;padding:3px 9px;font-weight:600;white-space:nowrap}
.sc-genetics{font-size:.75rem;color:rgba(242,234,216,0.4);margin-bottom:10px;font-style:italic}
.sc-thc-row{display:flex;gap:16px;margin-bottom:10px}
.sc-stat{display:flex;flex-direction:column;gap:1px}
.sc-stat-label{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:rgba(242,234,216,0.3)}
.sc-stat-val{font-size:.82rem;color:#F2EAD8;font-weight:500}
.sc-effects{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px}
.sc-eff{font-size:.68rem;background:rgba(255,255,255,0.05);border-radius:6px;padding:2px 7px;color:rgba(242,234,216,0.55)}
.sc-flavors{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px}
.sc-flav{font-size:.68rem;background:rgba(232,168,76,0.07);border-radius:6px;padding:2px 7px;color:rgba(232,168,76,0.6)}
.sc-desc{font-size:.78rem;line-height:1.65;color:rgba(242,234,216,0.5)}
/* Expanded detail */
.sc-detail{display:none;padding:0 20px 20px;border-top:1px solid rgba(255,255,255,0.06);margin-top:2px}
.sc.open .sc-detail{display:block}
.sc-det-label{font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:rgba(242,234,216,0.3);margin:16px 0 6px}
.sc-det-text{font-size:.8rem;line-height:1.75;color:rgba(242,234,216,0.62)}
.sc-profile-btn{display:inline-flex;align-items:center;gap:6px;margin-top:18px;font-size:.75rem;letter-spacing:.06em;color:#52B788;border:1px solid rgba(82,183,136,0.25);border-radius:6px;padding:8px 14px;text-decoration:none;transition:border-color .2s,background .2s;font-family:Montserrat,sans-serif}
.sc-profile-btn:hover{border-color:rgba(82,183,136,0.55);background:rgba(82,183,136,0.06)}
/* Genetic tree */
.gene-tree{margin-top:4px}
.gene-root{font-family:'Cormorant Garamond',serif;font-size:1rem;color:#F2EAD8;margin-bottom:10px;display:flex;align-items:center;gap:8px}
.gene-children{display:flex;flex-direction:column;gap:6px;padding-left:16px;border-left:2px solid rgba(255,255,255,0.08)}
.gene-branch{padding-left:12px;position:relative}
.gene-branch::before{content:'';position:absolute;left:-2px;top:10px;width:12px;height:2px;background:rgba(255,255,255,0.08)}
.gene-node{font-size:.78rem;color:rgba(242,234,216,0.65);display:flex;align-items:center;gap:6px;margin-bottom:4px}
.gene-node-kids{padding-left:16px;border-left:1px solid rgba(255,255,255,0.05);margin-left:6px;margin-top:4px}
.gene-kid{font-size:.72rem;color:rgba(242,234,216,0.4);padding:1px 0;display:flex;align-items:center;gap:5px}
.gene-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.terp-chip{display:inline-flex;align-items:center;background:rgba(82,183,136,0.08);color:#52B788;border-radius:10px;padding:2px 9px;font-size:.7rem;margin:2px}
.origin-box{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:12px 14px;margin-top:12px;font-size:.78rem;color:rgba(242,234,216,0.55);line-height:1.6}
.origin-box strong{color:rgba(242,234,216,0.8);font-weight:500}
@media(max-width:600px){.strain-grid{grid-template-columns:1fr}.filters-row{gap:6px}}
</style>
</head>
<body>
${ENC_NAV}
<div class="enc-page">
  <div class="enc-page-header">
    <div class="enc-label">✦ Cannascenti Encyclopedia</div>
    <h1 class="enc-title">Every strain. <em>Full genetics.</em></h1>
    <p class="enc-desc">From ancient Afghan landraces to Liquid Diamonds-era California drops — the complete genetic record. Every strain traced back to its roots. Know your strain, know your product.</p>
  </div>

  <div class="strain-search-wrap">
    <div class="search-rel">
      <span class="search-icon">⌕</span>
      <input class="strain-search" id="sSearch" placeholder="Search by name, effect, flavor, terpene, genetics, origin..." oninput="doFilter()">
    </div>
    <div class="filters-row">
      <button class="sf-btn t-all active" onclick="setType('all',this)">All Types</button>
      <button class="sf-btn t-indica" onclick="setType('indica',this)">Indica</button>
      <button class="sf-btn t-sativa" onclick="setType('sativa',this)">Sativa</button>
      <button class="sf-btn t-hybrid" onclick="setType('hybrid',this)">Hybrid</button>
      <div class="sf-sep"></div>
      <button class="effect-chip" onclick="toggleEffect('Relaxed',this)">Relaxed</button>
      <button class="effect-chip" onclick="toggleEffect('Energetic',this)">Energetic</button>
      <button class="effect-chip" onclick="toggleEffect('Creative',this)">Creative</button>
      <button class="effect-chip" onclick="toggleEffect('Focused',this)">Focused</button>
      <button class="effect-chip" onclick="toggleEffect('Sleepy',this)">Sleepy</button>
      <button class="effect-chip" onclick="toggleEffect('Euphoric',this)">Euphoric</button>
      <button class="effect-chip" onclick="toggleEffect('Happy',this)">Happy</button>
      <button class="effect-chip" onclick="toggleEffect('Uplifted',this)">Uplifted</button>
    </div>
  </div>

  <div class="count-bar" id="countBar"></div>
  <div id="strainOutput"></div>
</div>

<script>
var SD = ${JSON.stringify(mergedSD)};
var ERA_LABEL = ${JSON.stringify(eraLabel)};
var ERA_COLOR = ${JSON.stringify(eraColors)};
var TYPE_COLOR = ${JSON.stringify(typeColors)};

var curType = 'all';
var activeEffects = [];

function setType(t, btn) {
  curType = t;
  document.querySelectorAll('.sf-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  doFilter();
}

function toggleEffect(eff, btn) {
  var idx = activeEffects.indexOf(eff);
  if (idx >= 0) { activeEffects.splice(idx, 1); btn.classList.remove('active'); }
  else { activeEffects.push(eff); btn.classList.add('active'); }
  doFilter();
}

function doFilter() {
  var q = (document.getElementById('sSearch').value || '').toLowerCase().trim();
  var list = SD.filter(function(s) {
    if (curType !== 'all' && s.type !== curType) return false;
    if (activeEffects.length > 0) {
      var hasAll = activeEffects.every(function(e){ return (s.effects||[]).indexOf(e) >= 0; });
      if (!hasAll) return false;
    }
    if (!q) return true;
    var haystack = [s.name, s.genetics, s.landrace, s.origin, s.breeder, s.desc, s.story,
      (s.effects||[]).join(' '), (s.flavors||[]).join(' '), (s.terpenes||[]).join(' '), (s.tags||[]).join(' ')].join(' ').toLowerCase();
    return haystack.indexOf(q) >= 0;
  });

  document.getElementById('countBar').textContent = list.length + ' strain' + (list.length !== 1 ? 's' : '') + ' shown';

  // Group by era
  var eras = ['landrace','classic','og','cookie','modern'];
  var grouped = {};
  eras.forEach(function(e){ grouped[e] = []; });
  list.forEach(function(s){ if (grouped[s.era]) grouped[s.era].push(s); });

  var html = '';
  eras.forEach(function(era) {
    var arr = grouped[era];
    if (!arr || arr.length === 0) return;
    var eCol = ERA_COLOR[era] || '#52B788';
    html += '<div class="era-header" style="color:'+eCol+'"><span style="width:8px;height:8px;border-radius:50%;background:'+eCol+';display:inline-block"></span>'+ERA_LABEL[era]+'</div>';
    html += '<div class="strain-grid" style="margin-bottom:12px">';
    arr.forEach(function(s) {
      html += buildCard(s);
    });
    html += '</div>';
  });

  document.getElementById('strainOutput').innerHTML = html;
}

function buildCard(s) {
  var tc = TYPE_COLOR[s.type] || '#52B788';
  var ec = ERA_COLOR[s.era] || '#52B788';
  var slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');

  // Effects
  var effHtml = (s.effects||[]).map(function(e){ return '<span class="sc-eff">'+e+'</span>'; }).join('');
  // Flavors
  var flavHtml = (s.flavors||[]).slice(0,4).map(function(f){ return '<span class="sc-flav">'+f+'</span>'; }).join('');
  // Terpenes
  var terpHtml = (s.terpenes||[]).map(function(t){ return '<span class="terp-chip">'+t+'</span>'; }).join('');

  // Genetic tree
  var treeHtml = '';
  if (s.tree && s.tree.length > 0) {
    treeHtml = '<div class="gene-tree">';
    treeHtml += '<div class="gene-root"><span class="gene-dot" style="background:'+tc+'"></span>'+s.name+'</div>';
    treeHtml += '<div class="gene-children">';
    s.tree.forEach(function(node) {
      var nc = TYPE_COLOR[node.t] || '#52B788';
      treeHtml += '<div class="gene-branch"><div class="gene-node"><span class="gene-dot" style="background:'+nc+'"></span>'+node.n+' <span style="font-size:.65rem;color:rgba(242,234,216,0.3);text-transform:uppercase;letter-spacing:.08em">'+node.t+'</span></div>';
      if (node.c && node.c.length > 0) {
        treeHtml += '<div class="gene-node-kids">';
        node.c.forEach(function(kid){ treeHtml += '<div class="gene-kid"><span style="width:5px;height:1px;background:rgba(255,255,255,0.15);display:inline-block;flex-shrink:0"></span>'+kid+'</div>'; });
        treeHtml += '</div>';
      }
      treeHtml += '</div>';
    });
    treeHtml += '</div></div>';
  } else if (s.era === 'landrace') {
    treeHtml = '<div style="font-size:.78rem;color:rgba(242,234,216,0.4);font-style:italic;margin-top:4px">Pure landrace — no hybrid cross. This is the source.</div>';
  }

  // Origin box (only for strains with full encyclopedia data)
  var era = s.era || 'modern';
  var originHtml = s.origin ? '<div class="origin-box">'+
    '<strong>Origin:</strong> '+s.origin+'<br>'+
    (s.breeder ? '<strong>Breeder:</strong> '+s.breeder+'<br>' : '')+
    (s.landrace ? '<strong>Landrace DNA:</strong> '+s.landrace : '')+
  '</div>' : '';

  var originStat = s.origin ? s.origin.split(',')[0] : (s.type === 'sativa' ? 'Sativa' : s.type === 'indica' ? 'Indica' : 'Hybrid');

  return '<div class="sc" id="sc-'+s.name.replace(/[^a-z0-9]/gi,'-')+'" onclick="toggleCard(this)">'+
    '<div class="sc-stripe" style="background:'+tc+'"></div>'+
    '<div class="sc-inner">'+
      '<div class="sc-top">'+
        '<a class="sc-name sc-name-link" href="/strains/'+slug+'" onclick="event.stopPropagation()">'+s.name+'</a>'+
        '<div class="sc-badges">'+
          '<span class="sc-type" style="background:'+tc+'22;color:'+tc+'">'+s.type+'</span>'+
          '<span class="sc-era" style="background:'+ec+'18;color:'+ec+'">'+ERA_LABEL[era]+'</span>'+
        '</div>'+
      '</div>'+
      (s.genetics ? '<div class="sc-genetics">'+s.genetics+'</div>' : '')+
      '<div class="sc-thc-row">'+
        '<div class="sc-stat"><div class="sc-stat-label">THC</div><div class="sc-stat-val">'+(s.thc||'—')+'</div></div>'+
        '<div class="sc-stat"><div class="sc-stat-label">CBD</div><div class="sc-stat-val">'+(s.cbd||'—')+'</div></div>'+
        '<div class="sc-stat"><div class="sc-stat-label">Type</div><div class="sc-stat-val" style="font-size:.72rem">'+originStat+'</div></div>'+
      '</div>'+
      '<div class="sc-effects">'+effHtml+'</div>'+
      '<div class="sc-flavors">'+flavHtml+'</div>'+
      '<div class="sc-desc">'+(s.desc||'').substring(0,140)+((s.desc||'').length>140?'...':'')+'</div>'+
    '</div>'+
    '<div class="sc-detail">'+
      (treeHtml ? '<div class="sc-det-label">Genetics Cross</div>'+treeHtml : '')+
      (s.story ? '<div class="sc-det-label">The Genetics Story</div><div class="sc-det-text">'+s.story+'</div>' : '')+
      (terpHtml ? '<div class="sc-det-label">Terpene Profile</div><div>'+terpHtml+'</div>' : '')+
      '<div class="sc-det-label">Full Description</div>'+
      '<div class="sc-det-text">'+(s.desc||'')+'</div>'+
      originHtml+
      '<a href="/strains/'+slug+'" class="sc-profile-btn" onclick="event.stopPropagation()">View Full Profile →</a>'+
    '</div>'+
  '</div>';
}

function toggleCard(card) {
  card.classList.toggle('open');
}

document.addEventListener('DOMContentLoaded', function(){ doFilter(); });
</script>
</body></html>`;
    res.writeHead(200, {"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /strains/:slug — Individual strain profile ────────────────────────────
  if (req.method === "GET" && req.url.startsWith("/strains/") && req.url.length > 9) {
    const rawSlug = req.url.slice(9).split("?")[0].split("#")[0];
    const toSlug = n => n.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    const s = STRAINS_DB.find(sd => toSlug(sd.name) === rawSlug);

    if (!s) {
      res.writeHead(404,{"Content-Type":"text/html"});
      res.end(`<!DOCTYPE html><html><head><title>Not Found | Cannascenti</title>${ENC_FONTS}<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#060d0a;color:#F2EAD8;font-family:Montserrat,sans-serif}</style></head><body>${ENC_NAV}<div style="max-width:600px;margin:120px auto;text-align:center;padding:0 32px"><div style="font-size:3rem;margin-bottom:20px;opacity:.3">&#127807;</div><div style="font-family:'Cormorant Garamond',serif;font-size:2rem;margin-bottom:16px">Strain not found</div><a href="/strains" style="color:#52B788;font-size:.85rem">Back to All Strains</a></div></body></html>`);
      return;
    }

    const typeColors = {indica:"#9B72CF",sativa:"#E8A84C",hybrid:"#52B788"};
    const typeName = (s.type||'hybrid').toLowerCase();
    const tc = typeColors[typeName] || "#52B788";
    const thcMin = s.thc_min || 0;
    const thcMax = s.thc_max || 25;
    const thcBarW = Math.min(Math.round(thcMax / 35 * 100), 100);
    const cbd = s.cbd || 0;
    const cbdBarW = Math.max(Math.min(Math.round(cbd / 25 * 100), 100), 3);
    const rating = s.rating || 4.2;
    const ratingFull = Math.round(rating);
    const starStr = '&#9733;'.repeat(ratingFull) + '&#9734;'.repeat(5 - ratingFull);

    const TERP_INFO = {
      Myrcene:        {color:'#E07B39', icon:'&#127818;', aroma:'Earthy · Musky · Tropical', effect:'The most abundant cannabis terpene. Increases cell membrane permeability, allowing THC to cross the blood-brain barrier faster. High myrcene = heavier, more sedating effect regardless of strain type. The primary predictor of couch-lock.'},
      Limonene:       {color:'#F2C94C', icon:'&#127819;', aroma:'Citrus · Lemon · Bright', effect:'Mood elevation and stress relief. Interacts with serotonin receptors, reducing anxiety and brightening mood. The terpene behind citrus-forward strains that feel uplifting rather than heavy.'},
      Caryophyllene:  {color:'#C97B4B', icon:'&#127798;', aroma:'Spicy · Pepper · Woody', effect:'The only terpene known to directly activate CB2 receptors, producing anti-inflammatory effects without psychoactivity. Reduces stress and may help lower cortisol. Found in black pepper and cloves.'},
      Linalool:       {color:'#9B72CF', icon:'&#128525;', aroma:'Floral · Lavender · Sweet', effect:'Calming and anti-anxiety, similar to lavender aromatherapy. Modulates glutamate and GABA activity to promote deep relaxation. Especially beneficial for sleep and anxiety relief.'},
      Pinene:         {color:'#52B788', icon:'&#127794;', aroma:'Pine · Fresh · Earthy', effect:'Mental alertness and memory retention. Alpha-pinene may counteract THC-induced memory impairment. Acts as a bronchodilator, opening airways. The clearest-headed, most cognitively present terpene.'},
      Terpinolene:    {color:'#5B8DD9', icon:'&#127800;', aroma:'Fresh · Floral · Herbaceous · Pine', effect:'Uplifting and cerebral. Rare in high concentrations — dominant-terpinolene strains tend to be energetic and psychedelic-light rather than sedating. Signature terpene of Jack Herer and Durban Poison.'},
      Ocimene:        {color:'#52B788', icon:'&#127807;', aroma:'Sweet · Herbal · Tropical · Woody', effect:'Uplifting and energizing. Commonly found in tropical sativas, contributing to their bright, sweet, almost floral character. Has antiviral and antifungal properties.'},
      Humulene:       {color:'#C9973A', icon:'&#127866;', aroma:'Earthy · Woody · Hoppy', effect:'Anti-inflammatory and appetite suppressant — unusual for cannabis. Found in hops (the flavor backbone of IPAs), sage, and coriander. Works synergistically with caryophyllene for enhanced anti-inflammatory action.'},
      Bisabolol:      {color:'#E8A84C', icon:'&#127804;', aroma:'Floral · Sweet · Chamomile', effect:'Calming and anti-irritation. Found in chamomile flowers. Often present in CBD-rich strains and those with a particularly smooth, clean, floral character. Gentle, healing, and subtle.'},
      Valencene:      {color:'#F2C94C', icon:'&#127818;', aroma:'Sweet · Citrus · Orange Peel', effect:'Uplifting and mood-boosting. Named for Valencia oranges. Contributes a bright, fresh orange sweetness to tropical and fruity strains — often found alongside limonene for layered citrus complexity.'},
      Geraniol:       {color:'#E05C5C', icon:'&#127801;', aroma:'Floral · Rose · Fruity · Peach', effect:'Calming and neuroprotective. Naturally found in rose oil and geraniums. Present in many berry and floral-forward strains. Has natural insect-repellent properties and a distinctly rosy character.'},
      Camphene:       {color:'#9B72CF', icon:'&#127795;', aroma:'Damp Earth · Fir Needles · Woody', effect:'Anti-inflammatory with a cool, damp forest aroma. Found alongside myrcene in heavy indicas. Contributes to the deep, musty earthiness of classic Kush and Afghani-derived varieties.'},
    };

    const terpCards = (s.terpenes || []).map(t => {
      const ti = TERP_INFO[t] || {color:'#52B788', icon:'&#10022;', aroma:t, effect:'A terpene contributing to this strain\'s unique aromatic profile.'};
      return `<div class="sp-terp-card" style="border-top:3px solid ${ti.color}22;border-color:${ti.color}22">
        <div class="sp-terp-head" style="color:${ti.color}"><span>${ti.icon}</span><span class="sp-terp-name">${t}</span></div>
        <div class="sp-terp-aroma">${ti.aroma}</div>
        <div class="sp-terp-effect">${ti.effect}</div>
      </div>`;
    }).join('');

    const related = STRAINS_DB
      .filter(r => r.name !== s.name && (r.type||'').toLowerCase() === typeName)
      .filter(r => (r.effects||[]).filter(e => (s.effects||[]).includes(e)).length >= 2)
      .slice(0, 4);

    const relCards = related.map(r => {
      const rc = typeColors[(r.type||'').toLowerCase()] || '#52B788';
      const rSlug = toSlug(r.name);
      return `<a href="/strains/${rSlug}" class="sp-rel-card">
        <div style="height:3px;background:${rc}"></div>
        <div class="sp-rel-body">
          <div class="sp-rel-name">${r.name}</div>
          <div style="font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:${rc};margin-bottom:8px;font-weight:600">${r.type}</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${(r.effects||[]).slice(0,3).map(e=>`<span style="font-size:.65rem;background:rgba(255,255,255,0.05);border-radius:4px;padding:2px 7px;color:rgba(242,234,216,0.45)">${e}</span>`).join('')}</div>
        </div>
      </a>`;
    }).join('');

    const tagsHtml = (s.tags||[]).map(tag => `<span class="sp-tag">${tag}</span>`).join('');
    const geneticsHtml = s.genetics ? `<div class="sp-genetics">${s.genetics}</div>` : '';
    const typeLabel = typeName.charAt(0).toUpperCase() + typeName.slice(1);
    const pageTitle = `${s.name} — ${typeLabel} Strain, THC ${thcMin}–${thcMax}% | Cannascenti`;

    const spHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${pageTitle}</title>
<meta name="description" content="${s.name}: A ${typeName} cannabis strain with ${thcMin}-${thcMax}% THC. ${(s.description||'').replace(/"/g,'').slice(0,140)}">
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
.sp-hero{padding:48px 0 40px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:52px}
.sp-breadcrumb{font-size:.72rem;letter-spacing:.06em;color:rgba(242,234,216,0.3);margin-bottom:28px;display:flex;align-items:center;gap:8px}
.sp-breadcrumb a{color:rgba(242,234,216,0.4);text-decoration:none;transition:color .2s}.sp-breadcrumb a:hover{color:#52B788}
.sp-name{font-family:'Cormorant Garamond',serif;font-size:clamp(2.5rem,6vw,4.5rem);font-weight:300;color:#F2EAD8;line-height:1.1;margin-bottom:18px}
.sp-badges{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:36px}
.sp-type-badge{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;border-radius:20px;padding:5px 16px;font-weight:600}
.sp-rating{display:flex;align-items:center;gap:8px;font-size:.85rem;color:rgba(242,234,216,0.5)}
.sp-stars{color:#E8A84C;font-size:.9rem;letter-spacing:2px}
.sp-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}
.sp-stat{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:18px 20px}
.sp-stat-label{font-size:.6rem;letter-spacing:.14em;text-transform:uppercase;color:rgba(242,234,216,0.3);margin-bottom:8px}
.sp-stat-val{font-size:1.5rem;font-family:'Cormorant Garamond',serif;color:#F2EAD8;margin-bottom:10px}
.sp-bar{height:4px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden}
.sp-bar-fill{height:100%;border-radius:4px}
.sp-section{margin-bottom:52px}
.sp-section-title{font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(242,234,216,0.3);margin-bottom:20px;display:flex;align-items:center;gap:14px}
.sp-section-title::after{content:'';flex:1;height:1px;background:rgba(255,255,255,0.06)}
.sp-desc{font-family:'Cormorant Garamond',serif;font-size:1.1rem;line-height:1.9;color:rgba(242,234,216,0.82);max-width:760px}
.sp-effects{display:flex;flex-wrap:wrap;gap:10px}
.sp-eff{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:24px;padding:8px 18px;font-size:.8rem;color:rgba(242,234,216,0.75);letter-spacing:.04em}
.sp-flavors{display:flex;flex-wrap:wrap;gap:10px}
.sp-flav{background:rgba(232,168,76,0.07);border:1px solid rgba(232,168,76,0.15);border-radius:24px;padding:8px 18px;font-size:.8rem;color:rgba(232,168,76,0.8)}
.sp-terp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}
.sp-terp-card{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:18px 20px}
.sp-terp-head{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:.9rem;font-weight:600}
.sp-terp-name{letter-spacing:.04em}
.sp-terp-aroma{font-size:.7rem;color:rgba(242,234,216,0.32);letter-spacing:.06em;margin-bottom:10px;text-transform:uppercase}
.sp-terp-effect{font-size:.82rem;line-height:1.68;color:rgba(242,234,216,0.6)}
.sp-tags{display:flex;flex-wrap:wrap;gap:8px}
.sp-tag{background:rgba(82,183,136,0.08);border:1px solid rgba(82,183,136,0.2);border-radius:6px;padding:5px 12px;font-size:.7rem;color:rgba(82,183,136,0.85);letter-spacing:.07em;text-transform:uppercase}
.sp-genetics{font-size:.9rem;color:rgba(242,234,216,0.6);line-height:1.6;font-style:italic;border-left:2px solid rgba(82,183,136,0.2);padding-left:14px}
.sp-rel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
.sp-rel-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;overflow:hidden;text-decoration:none;transition:border-color .2s,transform .15s;display:block}
.sp-rel-card:hover{border-color:rgba(255,255,255,0.15);transform:translateY(-2px)}
.sp-rel-body{padding:14px 16px}
.sp-rel-name{font-family:'Cormorant Garamond',serif;font-size:1.1rem;color:#F2EAD8;margin-bottom:4px}
.sp-ask-mj{display:inline-flex;align-items:center;gap:5px;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:#52B788;border:1px solid rgba(82,183,136,0.3);border-radius:20px;padding:5px 14px;text-decoration:none;font-family:Montserrat,sans-serif;transition:background .2s,border-color .2s}
.sp-ask-mj:hover{background:rgba(82,183,136,0.08);border-color:rgba(82,183,136,0.6)}
@media(max-width:640px){.sp-name{font-size:2.2rem}.sp-stats{grid-template-columns:1fr 1fr}.sp-terp-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
${ENC_NAV}
<div class="enc-page">
  <div class="sp-hero">
    <div class="sp-breadcrumb">
      <a href="/strains">All Strains</a>
      <span style="opacity:.4">/</span>
      <span style="color:rgba(242,234,216,0.6)">${s.name}</span>
    </div>
    <div class="sp-name">${s.name}</div>
    <div class="sp-badges">
      <span class="sp-type-badge" style="background:${tc}22;color:${tc}">${typeLabel}</span>
      <span class="sp-rating">
        <span class="sp-stars">${starStr}</span>
        <span>${rating.toFixed(1)}</span>
      </span>
      <a href="/?ask=${encodeURIComponent('Tell me about ' + s.name + ' — effects, who it is for, and when to use it.')}" class="sp-ask-mj">Ask Mary Jane →</a>
    </div>
    <div class="sp-stats">
      <div class="sp-stat">
        <div class="sp-stat-label">THC Range</div>
        <div class="sp-stat-val">${thcMin}&#8211;${thcMax}%</div>
        <div class="sp-bar"><div class="sp-bar-fill" style="width:${thcBarW}%;background:${tc}"></div></div>
      </div>
      <div class="sp-stat">
        <div class="sp-stat-label">CBD</div>
        <div class="sp-stat-val">${cbd}%</div>
        <div class="sp-bar"><div class="sp-bar-fill" style="width:${cbdBarW}%;background:#52B788"></div></div>
      </div>
      <div class="sp-stat">
        <div class="sp-stat-label">Dominant Terpene</div>
        <div class="sp-stat-val" style="font-size:1.05rem;margin-top:4px">${(s.terpenes||[])[0] || '&#8212;'}</div>
        <div style="font-size:.7rem;color:rgba(242,234,216,0.28);margin-top:4px">${(s.terpenes||[]).slice(1).join(' &middot; ') || ''}</div>
      </div>
    </div>
  </div>

  <div class="sp-section">
    <div class="sp-section-title">About This Strain</div>
    <div class="sp-desc">${s.description || ''}</div>
  </div>

  ${(s.effects||[]).length > 0 ? `<div class="sp-section">
    <div class="sp-section-title">Effects</div>
    <div class="sp-effects">${(s.effects||[]).map(e=>`<span class="sp-eff">${e}</span>`).join('')}</div>
  </div>` : ''}

  ${(s.flavors||[]).length > 0 ? `<div class="sp-section">
    <div class="sp-section-title">Flavor Profile</div>
    <div class="sp-flavors">${(s.flavors||[]).map(f=>`<span class="sp-flav">${f}</span>`).join('')}</div>
  </div>` : ''}

  ${terpCards ? `<div class="sp-section">
    <div class="sp-section-title">Terpene Deep Dive</div>
    <div class="sp-terp-grid">${terpCards}</div>
  </div>` : ''}

  ${tagsHtml ? `<div class="sp-section">
    <div class="sp-section-title">Best For</div>
    <div class="sp-tags">${tagsHtml}</div>
  </div>` : ''}

  ${geneticsHtml ? `<div class="sp-section">
    <div class="sp-section-title">Genetic Lineage</div>
    ${geneticsHtml}
  </div>` : ''}

  ${relCards ? `<div class="sp-section">
    <div class="sp-section-title">Similar Strains</div>
    <div class="sp-rel-grid">${relCards}</div>
  </div>` : ''}
</div>
</body>
</html>`;

    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(spHtml);
    return;
  }

  // ─── /cooking ──────────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/edibles/cooking") {
    res.writeHead(301,{"Location":"/cooking"});res.end();return;
  }
  if (req.method === "GET" && req.url === "/cooking") {
    const _RECIPES = [
      { id:"cannabutter", cat:"foundation", icon:"🧈", name:"Cannabutter", difficulty:"Easy", time:"3.5 hrs", yield:"1 cup ~80mg THC", tip:"Adding water prevents burning and strips chlorophyll for cleaner-tasting butter. THC stays in the fat — not the water.", ingredients:["1 cup (2 sticks) unsalted butter","1 cup water","3.5–7g decarboxylated cannabis","Cheesecloth for straining"], method:["Melt butter and water together in a heavy saucepan over lowest possible heat.","Add decarboxylated cannabis. Stir to combine.","Simmer on lowest heat for 2–3 hours, stirring every 30 minutes. Never let it reach a boil.","Strain through cheesecloth into a glass container, pressing firmly to extract all butter.","Refrigerate for 2 hours — the water layer separates to the bottom. Remove solidified butter from top.","Store refrigerated up to 2 weeks or frozen up to 6 months."] },
      { id:"coconut-oil", cat:"foundation", icon:"🥥", name:"Cannabis Coconut Oil", difficulty:"Easy", time:"4 hrs", yield:"1 cup ~90mg THC", tip:"Coconut oil's high saturated fat content binds ~25% more THC than butter. Most versatile infusion for both cooking and capsules.", ingredients:["1 cup virgin coconut oil","3.5–7g decarboxylated cannabis","Slow cooker or double boiler","Cheesecloth or fine-mesh strainer"], method:["Combine coconut oil and decarboxylated cannabis in slow cooker.","Set slow cooker to LOW and infuse for 4–6 hours. Keep below 245°F at all times.","Alternatively, use a double boiler on lowest heat for 2–3 hours.","Stir every hour. The oil will deepen in color.","Strain through cheesecloth into a glass jar, squeezing to extract every drop.","Store at room temperature up to 2 months or refrigerate to extend shelf life."] },
      { id:"tincture", cat:"foundation", icon:"💧", name:"Green Dragon Tincture", difficulty:"Easy", time:"24 hrs", yield:"1oz ~5–15mg/dropper", tip:"A standard 1oz dropper bottle has ~30 full droppers. Divide total mg by 30 to find your per-dropper dose.", ingredients:["1 oz Everclear 190-proof grain alcohol","1g decarboxylated cannabis per oz alcohol","Glass mason jar with tight lid","Coffee filter + dropper bottles"], method:["Place decarboxylated cannabis in a sealed glass mason jar.","Cover completely with Everclear. Use 1 oz per gram of cannabis.","Slow method: Seal and let sit at room temperature for 24 hours, shaking occasionally.","Fast method: Place sealed jar in freezer for 3 hours, shaking every 30 minutes.","Strain twice through coffee filter into clean glass.","Transfer to dropper bottles. Label with batch date and estimated potency."] },
      { id:"cannabis-honey", cat:"foundation", icon:"🍯", name:"Cannabis Honey", difficulty:"Easy", time:"2 hrs", yield:"1 cup infused honey", tip:"Never exceed 200°F with honey — high heat destroys both terpenes and honey's natural enzymes. Low and slow is essential.", ingredients:["1 cup raw honey","3.5g decarboxylated cannabis","Small slow cooker or double boiler","Cheesecloth for straining"], method:["Place honey and decarboxylated cannabis in a small slow cooker or double boiler.","Set to lowest heat setting. Target 160–180°F — never above 200°F.","Infuse for 2 hours, stirring gently every 30 minutes.","Remove from heat. While still warm (honey flows better), strain through cheesecloth.","Squeeze gently — honey is thick, be patient.","Store in sealed jar at room temperature up to 3 months."] },
      { id:"pancakes", cat:"breakfast", icon:"🥞", name:"Banana Canna Pancakes", difficulty:"Easy", time:"30 min", yield:"8–10 pancakes", tip:"Ripe bananas add natural sweetness and bind moisture — you need less added sugar. The fat in cannabutter maximizes THC bioavailability at breakfast.", ingredients:["2 tbsp cannabutter (melted)","2 ripe bananas (mashed)","2 eggs","1 cup all-purpose flour","1 tsp baking powder","1/2 tsp cinnamon","Pinch of salt","3/4 cup milk"], method:["Mash bananas until smooth in a large mixing bowl.","Whisk in eggs and melted cannabutter until fully combined.","Add flour, baking powder, cinnamon, and salt. Stir until just combined — do not overmix.","Add milk and stir until batter reaches pourable consistency.","Heat a non-stick pan over medium heat. Ladle batter into 4-inch rounds.","Cook until bubbles form on surface (2–3 min), flip, cook 1–2 min more.","Serve with fresh fruit, maple syrup, or cannabis honey."] },
      { id:"avo-toast", cat:"breakfast", icon:"🥑", name:"Elevated Avocado Toast", difficulty:"Easy", time:"15 min", yield:"2 servings", tip:"Avocado fat dramatically increases THC bioavailability. This is one of the most bioavailable ways to consume cannabis — the healthy fats prime absorption.", ingredients:["2 tbsp cannabis-infused olive oil","2 ripe avocados","2 thick slices sourdough bread","Flaky sea salt","Red pepper flakes","Lemon juice (half a lemon)","Optional: poached eggs, microgreens"], method:["Toast sourdough until deeply golden and crispy.","Halve avocados, remove pit, scoop flesh into a bowl.","Add lemon juice and a pinch of salt. Smash with a fork — leave texture, don't puree.","Spread generously onto toast.","Drizzle cannabis-infused olive oil over the top.","Finish with flaky sea salt and red pepper flakes.","Add poached eggs or microgreens if desired."] },
      { id:"golden-milk", cat:"drinks", icon:"🌿", name:"Cannabis Golden Milk", difficulty:"Easy", time:"15 min", yield:"2 cups", tip:"Black pepper contains piperine, which amplifies curcumin (turmeric) absorption by 2000%. This drink is an anti-inflammatory powerhouse on multiple levels.", ingredients:["2 cups full-fat coconut milk","1 tsp turmeric","1/2 tsp cinnamon","1/4 tsp ground ginger","Pinch of black pepper","1 tbsp cannabis honey or 1 tsp cannabis coconut oil","Optional: pinch of cayenne"], method:["Combine coconut milk, turmeric, cinnamon, ginger, and black pepper in a small saucepan.","Warm over medium-low heat, whisking constantly. Do not boil.","Heat until steaming and fragrant — about 5 minutes.","Remove from heat. Whisk in cannabis honey or cannabis coconut oil until fully dissolved.","Taste and adjust spices. Add cayenne for warmth.","Pour into mugs through a fine strainer if desired.","Serve immediately."] },
      { id:"hot-choc", cat:"drinks", icon:"☕", name:"THC Hot Chocolate", difficulty:"Easy", time:"10 min", yield:"2 mugs", tip:"Dark chocolate 70%+ contains anandamide — the body's natural endocannabinoid. Combining real dark chocolate with cannabis creates genuine synergy.", ingredients:["2 cups cannabis-infused heavy cream (or 2 cups whole milk + 1 tbsp cannabis oil)","2 tbsp Dutch-process cocoa powder","2 oz dark chocolate (70%+), roughly chopped","1–2 tbsp sugar or cannabis honey","Pinch of cayenne","Pinch of flaky salt"], method:["Warm cannabis-infused cream or milk mixture in a saucepan over medium-low heat.","Whisk in cocoa powder until fully dissolved with no lumps.","Add chopped dark chocolate. Whisk constantly as it melts — about 3 minutes.","Add sweetener to taste. Whisk in cayenne and salt.","Once steaming and fully combined, remove from heat.","Pour into mugs. Top with whipped cream or a dusting of cocoa."] },
      { id:"cold-brew", cat:"drinks", icon:"🧊", name:"Canna Cold Brew", difficulty:"Easy", time:"16 hrs", yield:"4 servings", tip:"Cold brew concentrate is 2x strength of regular coffee. Add tincture per serving at pour time for precise dosing — this keeps each cup accurately dosed.", ingredients:["1 cup coarse ground coffee","4 cups cold water","Green Dragon Tincture (dosed per serving)","Ice","Optional: cannabis-infused cream for serving"], method:["Combine coarse coffee grounds and cold water in a large mason jar.","Stir gently to ensure all grounds are saturated.","Cover loosely and refrigerate 16–24 hours. Longer = stronger.","Strain through a coffee filter or fine-mesh strainer lined with cheesecloth.","Store concentrate in sealed jar in refrigerator up to 2 weeks.","To serve: Fill glass with ice, add 1 part concentrate to 1 part water or milk.","Add desired drops of tincture directly to your glass for precise individual dosing."] },
      { id:"aglio-olio", cat:"savory", icon:"🍝", name:"Canna Aglio e Olio", difficulty:"Easy", time:"25 min", yield:"2 servings", tip:"Add cannabis olive oil OFF HEAT after plating. Terpenes vaporize above 160°F — cooking cannabis oil destroys the aromatic compounds that make it special.", ingredients:["200g spaghetti or linguine","4 tbsp cannabis-infused olive oil","6 cloves garlic, thinly sliced","1/2 tsp red pepper flakes","Large handful fresh parsley, chopped","Parmesan for serving","Salt and freshly cracked black pepper"], method:["Boil pasta in heavily salted water until just al dente. Reserve 1 cup pasta water.","While pasta cooks, heat 2 tbsp regular olive oil (not cannabis oil) in a wide pan over medium-low.","Add sliced garlic. Cook slowly until golden — 6–8 minutes. Do not burn.","Add red pepper flakes, cook 1 minute. Add 1/2 cup pasta water.","Drain pasta and add to pan. Toss vigorously with pasta water to emulsify.","Remove from heat. Plate pasta immediately.","Drizzle cannabis olive oil over each plate after plating. Finish with parsley and parmesan."] },
      { id:"compound-butter-steak", cat:"savory", icon:"🥩", name:"Cannabis Herb Compound Butter Steak", difficulty:"Intermediate", time:"45 min", yield:"2 servings", tip:"Always slice compound butter over rested steak — not during cooking. The melting butter carries THC directly onto the meat as it rests.", ingredients:["2 ribeye or NY strip steaks","4 tbsp cannabutter","3 cloves garlic (minced)","1 tbsp fresh thyme","1 tbsp fresh rosemary (finely chopped)","1 tsp lemon zest","Salt and black pepper","2 tbsp neutral oil for searing"], method:["Compound butter: Mix softened cannabutter with garlic, thyme, rosemary, and lemon zest.","Roll compound butter tightly in plastic wrap into a log. Refrigerate 30 minutes until firm.","Season steaks generously with salt and pepper. Bring to room temperature.","Heat cast iron skillet until smoking hot. Add neutral oil.","Sear steaks 3–4 minutes per side for medium-rare. Baste with pan drippings.","Rest steaks 5 minutes on a cutting board — critical for juiciness.","Slice 2 rounds of compound butter over each rested steak. Let it melt into the meat."] },
      { id:"pesto", cat:"savory", icon:"🌿", name:"Cannabis Pesto", difficulty:"Easy", time:"15 min", yield:"1 cup pesto", tip:"No-heat preparation preserves every terpene. Raw cannabis oil in pesto is one of the purest possible expressions of the plant's aromatic profile.", ingredients:["1/2 cup cannabis-infused olive oil","2 cups fresh basil leaves (packed)","1/3 cup pine nuts (toasted)","2 cloves garlic","1/2 cup freshly grated Parmigiano-Reggiano","Juice of half a lemon","Salt and black pepper"], method:["Toast pine nuts in a dry skillet over medium heat until golden — watch carefully, they burn fast.","Combine basil, garlic, and pine nuts in a food processor. Pulse until coarsely chopped.","With processor running, drizzle in cannabis olive oil slowly.","Add parmesan, lemon juice, salt, and pepper. Pulse to combine.","Taste and adjust seasoning.","Store with a thin film of regular olive oil over the surface to prevent oxidation.","Toss with pasta immediately before serving — do not heat."] },
      { id:"brownies", cat:"desserts", icon:"🍫", name:"The Perfect Brownie", difficulty:"Easy", time:"1 hr", yield:"16 brownies ~8–12mg each", tip:"Underbaking by 2–3 minutes creates fudgy brownies. The internal temperature should reach 165°F — use a thermometer for consistent results.", ingredients:["1 cup cannabutter","2 cups granulated sugar","4 large eggs","1 tsp pure vanilla extract","3/4 cup Dutch-process cocoa powder","1 cup all-purpose flour","1/2 tsp salt","1/2 tsp baking powder"], method:["Preheat oven to 350°F. Grease a 9x13 baking pan.","Melt cannabutter over low heat. Let cool 5 minutes.","Whisk sugar into cooled butter until combined.","Add eggs one at a time, whisking after each. Add vanilla.","Sift in cocoa, flour, salt, and baking powder. Fold until just combined — do not overmix.","Spread evenly in prepared pan.","Bake 25–30 minutes. A toothpick should come out with moist crumbs, not wet batter.","Cool completely before cutting. Cut into 16 even squares."] },
      { id:"truffles", cat:"desserts", icon:"✨", name:"Cannabis Chocolate Truffles", difficulty:"Intermediate", time:"2 hrs + chill", yield:"24 truffles ~5mg each", tip:"Temperature is everything with ganache. Too hot and it won't set; too cold and it cracks when rolled. Aim for 85°F when rolling.", ingredients:["1 cup cannabis-infused heavy cream","12 oz dark chocolate (70%+), finely chopped","2 tbsp unsalted butter","Pinch of flaky salt","Coating: cocoa powder, crushed nuts, or sea salt"], method:["Finely chop chocolate and place in a heatproof bowl.","Warm cannabis-infused cream over medium heat until just simmering — do not boil.","Pour hot cream over chocolate. Let sit 2 minutes without stirring.","Add butter and pinch of salt. Stir from center outward until perfectly smooth ganache forms.","Cover with plastic wrap touching the surface. Refrigerate 2 hours until firm.","Use a melon baller or tablespoon to scoop rounds. Roll quickly between palms.","Roll immediately in coating of choice. Refrigerate until serving."] },
      { id:"cookies", cat:"desserts", icon:"🍋", name:"Lemon Lavender Cannabis Cookies", difficulty:"Easy", time:"45 min", yield:"24 cookies", tip:"Pair with a linalool-dominant strain like Lavender Kush for terpene synergy — linalool in both the lavender and the cannabis creates a compounded calming effect.", ingredients:["1 cup cannabutter (softened)","3/4 cup granulated sugar","3/4 cup powdered sugar","2 eggs","2 tbsp fresh lemon zest","1 tbsp culinary lavender (finely chopped)","2.5 cups all-purpose flour","1 tsp cream of tartar","1/2 tsp baking soda","1/4 tsp salt"], method:["Preheat oven to 375°F. Line baking sheets with parchment.","Beat softened cannabutter with both sugars until light and fluffy — 3 minutes.","Add eggs one at a time. Beat in lemon zest and lavender.","Whisk together flour, cream of tartar, baking soda, and salt.","Gradually add dry ingredients to butter mixture. Mix until dough forms.","Roll into 1-inch balls. Place 2 inches apart on prepared sheets.","Flatten slightly with a glass bottom dipped in sugar.","Bake 9–11 minutes until edges are just set. Centers will look underdone — that's right.","Cool on pan 5 minutes before transferring to wire rack."] }
    ];
    const _DECARB = [
      { temp:"220°F", tempC:"104°C", time:"60 min", name:"CBD Activation", desc:"Ideal for CBD-dominant flower. Lower heat preserves the most terpenes and converts CBDA to CBD with minimal THC degradation. Best for therapeutic, non-intoxicating preparations.", badge:"CBD Focus", badgeColor:"#52B788" },
      { temp:"240°F", tempC:"115°C", time:"40 min", name:"The Gold Standard", desc:"The perfect balance of THC conversion and terpene preservation. The most reliable method used by professional infusion kitchens worldwide. Maximum potency with minimum degradation.", badge:"Recommended", badgeColor:"#52B788" },
      { temp:"250°F", tempC:"121°C", time:"25 min", name:"Balanced Decarb", desc:"Slightly faster with minimal quality loss. Good when short on time. Higher probability of some THC-to-CBN conversion beginning, adding mild sedative character to the final product.", badge:"Good", badgeColor:"#C9973A" },
      { temp:"300°F", tempC:"149°C", time:"10 min", name:"Fast Decarb", desc:"Quick but risks degrading THC into CBN. Significant terpene loss at this temperature. Use only when time is genuinely critical and you accept a reduction in quality and potency.", badge:"Use Carefully", badgeColor:"#E07030" }
    ];
    const _DOSE_RULES = [
      { num:"01", title:"Start at 5mg or below", body:"Even experienced smokers should start low with edibles. 11-hydroxy-THC — the liver metabolite — is a fundamentally different and more potent molecule than inhaled THC. A joint-tolerant person can be completely overwhelmed by 20mg of edible THC on an empty stomach." },
      { num:"02", title:"Wait the full 2 hours", body:"The single most common mistake people make. Onset is 30 minutes to 2 full hours depending on your metabolism and what you've eaten. Re-dosing at 90 minutes because nothing is happening yet has ruined more evenings than any other error in cannabis." },
      { num:"03", title:"Eat a meal before dosing", body:"Food in your stomach slows absorption and creates a smoother, more predictable onset. An empty stomach accelerates effects and can intensify them dramatically. If it's your first time with edibles, eat a full meal first — always." }
    ];
    const _PAIRINGS = [
      { flavor:"Earthy & Savory", strains:["OG Kush","Chemdawg","Headband","Sour Diesel"], recipes:["Canna Aglio e Olio","Herb Compound Butter","Cannabis Pesto"], desc:"Earthy, fuel-forward terpene profiles dominated by myrcene and caryophyllene complement savory, umami-rich dishes. The cannabis becomes another layer of depth — like adding a finishing herb." },
      { flavor:"Citrus & Bright", strains:["Lemon Haze","Super Lemon OG","Durban Poison","Tangie"], recipes:["Lemon Lavender Cookies","Avocado Toast","Canna Cold Brew"], desc:"Limonene-dominant strains with bright citrus terpenes pair beautifully with breakfast dishes and anything with lemon, grapefruit, or orange notes. The terpene profiles reinforce each other." },
      { flavor:"Sweet & Fruity", strains:["Blue Dream","Strawberry Cough","Zkittlez","Gelato"], recipes:["Banana Canna Pancakes","Cannabis Golden Milk","Cannabis Honey"], desc:"Sweet, berry, and stone-fruit terpene profiles from strains like Zkittlez and Gelato complement sweet preparations. The fruity terpenes linger in infused honey and dairy-based drinks." },
      { flavor:"Chocolate & Kush", strains:["Lavender Kush","Granddaddy Purple","Purple Punch","Wedding Cake"], recipes:["THC Hot Chocolate","The Perfect Brownie","Cannabis Chocolate Truffles"], desc:"Kush genetics with linalool and myrcene are the classic pairing for chocolate. Linalool's floral-lavender quality and cocoa's natural anandamide create a genuinely synergistic experience." }
    ];
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Cannabis Kitchen — Cannascenti</title>
<meta name="description" content="The cannabis cooking show. 15 recipes across 5 categories, decarboxylation guide, dosing science, and strain pairings.">
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
.kitchen-hero{background:linear-gradient(135deg,rgba(14,26,17,0.95) 0%,rgba(6,13,10,0.98) 100%);border-bottom:1px solid rgba(82,183,136,0.15);padding:80px 32px 60px;text-align:center}
.kitchen-hero-label{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#52B788;margin-bottom:20px}
.kitchen-hero-title{font-family:'Cormorant Garamond',serif;font-size:clamp(2.8rem,7vw,5rem);font-weight:300;color:#F2EAD8;line-height:1.1;margin-bottom:16px}
.kitchen-hero-title em{color:#E07B39;font-style:italic}
.kitchen-hero-sub{font-size:1rem;color:rgba(242,234,216,0.55);max-width:560px;margin:0 auto 40px;line-height:1.7}
.kitchen-stats{display:flex;gap:40px;justify-content:center;flex-wrap:wrap}
.kitchen-stat{text-align:center}
.kitchen-stat-num{font-family:'Cormorant Garamond',serif;font-size:2rem;color:#52B788}
.kitchen-stat-label{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:rgba(242,234,216,0.4)}
.cat-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:32px;padding:0 32px}
.cat-btn{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:9px 20px;color:rgba(242,234,216,0.6);font-family:Montserrat,sans-serif;font-size:11px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .2s}
.cat-btn.active,.cat-btn:hover{border-color:#E07B39;color:#F2EAD8;background:rgba(224,123,57,0.1)}
.recipe-section{max-width:1200px;margin:0 auto;padding:48px 32px}
.recipe-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;margin-bottom:32px}
.r-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:24px;cursor:pointer;transition:all .25s;position:relative}
.r-card:hover{border-color:rgba(224,123,57,0.4);background:rgba(224,123,57,0.04);transform:translateY(-2px)}
.r-card.hidden{display:none}
.r-card.expanded{border-color:#E07B39;background:rgba(224,123,57,0.06)}
.r-icon{font-size:2.2rem;margin-bottom:12px}
.r-name{font-family:'Cormorant Garamond',serif;font-size:1.3rem;margin-bottom:8px;color:#F2EAD8}
.r-meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.r-diff{font-size:10px;letter-spacing:.08em;text-transform:uppercase;border-radius:20px;padding:3px 10px}
.r-diff.easy{background:rgba(82,183,136,0.15);color:#52B788}
.r-diff.intermediate{background:rgba(201,151,58,0.15);color:#C9973A}
.r-diff.advanced{background:rgba(224,123,57,0.15);color:#E07B39}
.r-time{font-size:.78rem;color:rgba(242,234,216,0.45)}
.r-yield{font-size:.78rem;color:rgba(242,234,216,0.35)}
.r-expand{display:none;margin-top:20px;border-top:1px solid rgba(255,255,255,0.06);padding-top:20px}
.r-card.expanded .r-expand{display:block}
.r-section-label{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#52B788;margin-bottom:10px}
.r-ing-list{list-style:none;margin-bottom:20px}
.r-ing-list li{font-size:.82rem;color:rgba(242,234,216,0.65);padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04)}
.r-method-list{list-style:none;counter-reset:step;margin-bottom:20px}
.r-method-list li{font-size:.82rem;color:rgba(242,234,216,0.65);padding:8px 0 8px 28px;border-bottom:1px solid rgba(255,255,255,0.04);position:relative;counter-increment:step}
.r-method-list li::before{content:counter(step);position:absolute;left:0;color:#E07B39;font-weight:700;font-size:.78rem}
.r-tip{font-size:.8rem;line-height:1.65;color:rgba(242,234,216,0.5);border-left:2px solid rgba(224,123,57,0.4);padding-left:14px;font-style:italic}
.r-close{display:block;margin-top:16px;font-size:.78rem;color:rgba(242,234,216,0.35);cursor:pointer;text-align:center;letter-spacing:.08em;text-transform:uppercase}
.r-close:hover{color:#F2EAD8}
.sec-block{max-width:1200px;margin:0 auto;padding:48px 32px}
.sec-title{font-family:'Cormorant Garamond',serif;font-size:2.2rem;font-weight:300;color:#F2EAD8;margin-bottom:8px}
.sec-title em{color:#52B788;font-style:italic}
.sec-sub{font-size:.88rem;color:rgba(242,234,216,0.5);margin-bottom:36px;line-height:1.7;max-width:640px}
.decarb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.decarb-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:28px;text-align:center}
.decarb-temp{font-family:'Cormorant Garamond',serif;font-size:2.4rem;font-weight:300;color:#52B788;margin-bottom:4px}
.decarb-time{font-size:.78rem;color:rgba(242,234,216,0.4);margin-bottom:10px}
.decarb-name{font-size:.9rem;font-weight:600;margin-bottom:10px;color:#F2EAD8}
.decarb-desc{font-size:.78rem;line-height:1.65;color:rgba(242,234,216,0.5)}
.decarb-badge{display:inline-block;margin-top:14px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;border-radius:20px;padding:3px 12px}
.dose-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
@media(max-width:640px){.dose-grid{grid-template-columns:1fr}}
.dose-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:32px;text-align:center}
.dose-num{font-family:'Cormorant Garamond',serif;font-size:3.5rem;font-weight:300;color:#52B788;line-height:1}
.dose-title{font-size:.95rem;font-weight:600;margin:14px 0 10px;color:#F2EAD8}
.dose-body{font-size:.82rem;line-height:1.7;color:rgba(242,234,216,0.55)}
.pairing-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}
.pairing-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:24px}
.pairing-flavor{font-family:'Cormorant Garamond',serif;font-size:1.2rem;color:#F2EAD8;margin-bottom:14px}
.pairing-label{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#52B788;margin-bottom:6px;margin-top:14px}
.pairing-tags{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:4px}
.pairing-tag{font-size:.73rem;background:rgba(255,255,255,0.05);border-radius:6px;padding:2px 8px;color:rgba(242,234,216,0.6)}
.pairing-desc{font-size:.78rem;line-height:1.65;color:rgba(242,234,216,0.45);margin-top:12px;font-style:italic}
.divider{border:none;border-top:1px solid rgba(255,255,255,0.06);margin:0 32px}
</style>
</head>
<body>
${ENC_NAV}
<div class="kitchen-hero">
  <div class="kitchen-hero-label">✦ Cannascenti Kitchen</div>
  <h1 class="kitchen-hero-title">The Cannabis <em>Kitchen.</em></h1>
  <p class="kitchen-hero-sub">Professional cannabis cuisine — 15 recipes across 5 categories, full decarboxylation science, dosing math, and strain pairing guides. Cook with confidence.</p>
  <div class="kitchen-stats">
    <div class="kitchen-stat"><div class="kitchen-stat-num">15</div><div class="kitchen-stat-label">Recipes</div></div>
    <div class="kitchen-stat"><div class="kitchen-stat-num">5</div><div class="kitchen-stat-label">Categories</div></div>
    <div class="kitchen-stat"><div class="kitchen-stat-num">4</div><div class="kitchen-stat-label">Foundation Infusions</div></div>
    <div class="kitchen-stat"><div class="kitchen-stat-num">4</div><div class="kitchen-stat-label">Strain Pairings</div></div>
  </div>
</div>

<div class="recipe-section">
  <div class="cat-filters" id="catFilters"></div>
  <div class="recipe-grid" id="recipeGrid"></div>
</div>

<hr class="divider">

<div class="sec-block">
  <div class="sec-title">The <em>Decarboxylation</em> Guide</div>
  <p class="sec-sub">Raw cannabis contains THCA — not THC. Heat converts THCA into active THC. Skip this step and your edibles will not work. Temperature and time are everything.</p>
  <div class="decarb-grid" id="decarbGrid"></div>
</div>

<hr class="divider">

<div class="sec-block">
  <div class="sec-title"><em>Dosing</em> Science</div>
  <p class="sec-sub">Edibles produce 11-hydroxy-THC — a different, more potent molecule than inhaled THC. Follow these three rules without exception.</p>
  <div class="dose-grid" id="doseGrid"></div>
</div>

<hr class="divider">

<div class="sec-block">
  <div class="sec-title">Strain <em>Pairing</em></div>
  <p class="sec-sub">Different terpene profiles pair naturally with different flavor categories. Match your cannabis strain to your dish for compounded aromatic experiences.</p>
  <div class="pairing-grid" id="pairingGrid"></div>
</div>

<script>
var RECIPES = ${JSON.stringify(_RECIPES)};
var DECARB = ${JSON.stringify(_DECARB)};
var DOSE_RULES = ${JSON.stringify(_DOSE_RULES)};
var PAIRINGS = ${JSON.stringify(_PAIRINGS)};
var currentCat = 'all';

var CATS = [
  {id:'all',label:'All'},
  {id:'foundation',label:'Foundation'},
  {id:'breakfast',label:'Breakfast'},
  {id:'drinks',label:'Drinks'},
  {id:'savory',label:'Savory'},
  {id:'desserts',label:'Desserts'}
];

function renderFilters(){
  document.getElementById('catFilters').innerHTML = CATS.map(function(c){
    return '<button class="cat-btn' + (c.id===currentCat?' active':'') + '" onclick="filterCat(\'' + c.id + '\')">' + c.label + '</button>';
  }).join('');
}

function filterCat(cat){
  currentCat = cat;
  renderFilters();
  document.querySelectorAll('.r-card').forEach(function(card){
    var cardCat = card.getAttribute('data-cat');
    if(cat === 'all' || cardCat === cat){
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
      card.classList.remove('expanded');
    }
  });
}

function toggleRecipe(id){
  var card = document.getElementById('rcard-' + id);
  if(card.classList.contains('expanded')){
    card.classList.remove('expanded');
  } else {
    document.querySelectorAll('.r-card.expanded').forEach(function(c){c.classList.remove('expanded');});
    card.classList.add('expanded');
    setTimeout(function(){card.scrollIntoView({behavior:'smooth',block:'nearest'});},100);
  }
}

function renderRecipes(){
  document.getElementById('recipeGrid').innerHTML = RECIPES.map(function(r){
    var diffClass = r.difficulty.toLowerCase();
    var ings = r.ingredients.map(function(i){return '<li>' + i + '</li>';}).join('');
    var steps = r.method.map(function(s){return '<li>' + s + '</li>';}).join('');
    return '<div class="r-card" id="rcard-' + r.id + '" data-cat="' + r.cat + '" onclick="toggleRecipe(\'' + r.id + '\')">' +
      '<div class="r-icon">' + r.icon + '</div>' +
      '<div class="r-name">' + r.name + '</div>' +
      '<div class="r-meta">' +
        '<span class="r-diff ' + diffClass + '">' + r.difficulty + '</span>' +
        '<span class="r-time">' + r.time + '</span>' +
      '</div>' +
      '<div class="r-yield">' + r.yield + '</div>' +
      '<div class="r-expand">' +
        '<div class="r-section-label">Ingredients</div>' +
        '<ul class="r-ing-list">' + ings + '</ul>' +
        '<div class="r-section-label">Method</div>' +
        '<ol class="r-method-list">' + steps + '</ol>' +
        '<p class="r-tip">' + r.tip + '</p>' +
        '<span class="r-close">collapse recipe</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderDecarb(){
  document.getElementById('decarbGrid').innerHTML = DECARB.map(function(d){
    return '<div class="decarb-card">' +
      '<div class="decarb-temp">' + d.temp + '</div>' +
      '<div class="decarb-time">' + d.tempC + ' &bull; ' + d.time + '</div>' +
      '<div class="decarb-name">' + d.name + '</div>' +
      '<div class="decarb-desc">' + d.desc + '</div>' +
      '<span class="decarb-badge" style="background:rgba(82,183,136,0.1);color:' + d.badgeColor + '">' + d.badge + '</span>' +
    '</div>';
  }).join('');
}

function renderDose(){
  document.getElementById('doseGrid').innerHTML = DOSE_RULES.map(function(r){
    return '<div class="dose-card">' +
      '<div class="dose-num">' + r.num + '</div>' +
      '<div class="dose-title">' + r.title + '</div>' +
      '<div class="dose-body">' + r.body + '</div>' +
    '</div>';
  }).join('');
}

function renderPairings(){
  document.getElementById('pairingGrid').innerHTML = PAIRINGS.map(function(p){
    var strainTags = p.strains.map(function(s){return '<span class="pairing-tag">' + s + '</span>';}).join('');
    var recipeTags = p.recipes.map(function(s){return '<span class="pairing-tag">' + s + '</span>';}).join('');
    return '<div class="pairing-card">' +
      '<div class="pairing-flavor">' + p.flavor + '</div>' +
      '<div class="pairing-label">Strains</div>' +
      '<div class="pairing-tags">' + strainTags + '</div>' +
      '<div class="pairing-label">Pairs With</div>' +
      '<div class="pairing-tags">' + recipeTags + '</div>' +
      '<div class="pairing-desc">' + p.desc + '</div>' +
    '</div>';
  }).join('');
}

document.addEventListener('DOMContentLoaded', function(){
  renderFilters();
  renderRecipes();
  renderDecarb();
  renderDose();
  renderPairings();
});
</script>
</body></html>`;
    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /edibles ──────────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/edibles") {
    const _CATS = [
      { id:"gummies", icon:"🍬", name:"Gummies", tagline:"The most popular cannabis format in legal markets.",
        desc:"Gummies are the category that converted a generation of cannabis-curious consumers. Precise dosing, no smell, portable, discreet, and available in every cannabinoid formulation imaginable. The real story is the quality divide between distillate, live resin, and live rosin — a spectrum that changes everything about the experience.",
        onset:"45–90 min standard · 15–45 min nano-emulsified", duration:"4–8 hours",
        look:["Distillate vs live resin vs live rosin — see the Gummy Spectrum below","Check the COA (Certificate of Analysis) — 3rd-party lab tested","Nano-emulsified = faster onset, shorter duration","Vegan pectin-based vs gelatin-based (labeled on packaging)","Store below 70°F — heat degrades THC and melts the gummy"],
        tip:"Eat a meal with healthy fat before dosing (avocado, nuts, olive oil). Fat opens absorption pathways and creates a smoother, more predictable experience."
      },
      { id:"chocolate", icon:"🍫", name:"Chocolate", tagline:"Anandamide + THC — cannabis's most natural pairing.",
        desc:"Dark chocolate contains anandamide — the body's own endocannabinoid — and fat that significantly improves THC bioavailability. The synergy is real. Hash chocolate (charas pressed into cacao) is the oldest cannabis food on earth. Modern craft producers now make single-origin, strain-specific cannabis chocolate bars with the same precision as fine wine.",
        onset:"45–90 min", duration:"4–8 hours",
        look:["70%+ dark chocolate = more anandamide synergy and better fat profile","Hash chocolate vs distillate chocolate are fundamentally different experiences","Look for micro-dosed squares (2.5mg–5mg per piece) for precision control","Single-origin bean-to-bar cannabis chocolate is an emerging premium category","Milk chocolate is fine, but dark is preferred for flavor and bioavailability"],
        tip:"Chocolate fat is one of the highest-bioavailability edible formats. Taking with full-fat dairy (cream, whole milk) further amplifies absorption — the fat opens lipid transport pathways."
      },
      { id:"beverages", icon:"🥤", name:"Beverages", tagline:"Fast onset, social format, zero smoke.",
        desc:"Cannabis beverages are the fastest-growing category in regulated markets. The breakthrough was nano-emulsification — breaking THC into microscopic droplets (10–200nm) that absorb through the gut wall in 15–30 minutes, bypassing the first-pass liver metabolism that makes standard edibles slow. Available as sparkling seltzers, shots, teas, cold brew, lemonade, and cocktail mixers. Low-dose (2mg–5mg) beverages are quickly becoming the preferred alcohol replacement.",
        onset:"15–30 min nano-emulsified · 45–90 min standard", duration:"2–4 hours (shorter than solid edibles)",
        look:["'Water-soluble', 'nano', or 'nano-emulsified' on the label = faster onset","THC:CBD 1:1 ratios mimic alcohol's social quality without the hangover","Low-dose options (2mg, 5mg) for functional social consumption","Refrigerate after opening — most cannabis beverages are perishable","Cannabis tonics pair well with sparkling water and citrus for a mocktail"],
        tip:"The microdose beverage (2mg THC + 4mg CBD) is the best cannabis product for social situations. Sessionable, predictable onset, no hangover. Replace 2 drinks with 2 cans."
      },
      { id:"capsules", icon:"💊", name:"Capsules & Pills", tagline:"Clinical precision. No flavor. Pharmaceutical consistency.",
        desc:"Softgels and capsules deliver cannabis with pharmaceutical-grade precision — no taste, no ritual, predictable dosing in every unit. Popular with medical patients, microdosers, and anyone who wants edible-style effects without sugar or gelatin. Softgels (oil-filled) absorb faster than pressed tablets. Time-release capsules offer 6–10 hour extended duration for pain management and overnight coverage.",
        onset:"45–90 min", duration:"5–8 hours (time-release up to 10 hours)",
        look:["Softgels outperform pressed tablets for absorption speed","MCT oil base in the softgel improves bioavailability significantly","Full-spectrum vs isolate — full-spectrum includes minor cannabinoids","Time-release options for overnight pain coverage","CBN sleep capsules for nighttime; CBG focus capsules for daytime"],
        tip:"Take with food containing fat — a tablespoon of peanut butter or a small handful of nuts dramatically increases THC absorption by opening lipid transport pathways."
      },
      { id:"tinctures", icon:"💧", name:"Tinctures", tagline:"Sublingual absorption. Fastest non-inhaled onset.",
        desc:"Tinctures are cannabis extracted into a carrier — either food-grade alcohol or MCT oil — administered under the tongue. When held sublingually for 60–90 seconds, cannabinoids absorb directly through the mucous membrane into the bloodstream, bypassing the digestive system. Onset in 15–45 minutes — significantly faster than other edibles. Ratio tinctures (1:1, 4:1 CBD:THC, 10:1) allow precise, custom cannabinoid ratios drop by drop.",
        onset:"15–45 min sublingual · 45–90 min if swallowed", duration:"4–6 hours",
        look:["Alcohol-based tinctures are more bioavailable than MCT oil","Ratio tinctures enable precise cannabinoid customization","Full-spectrum vs broad-spectrum vs isolate — distinctly different experiences","Know your mg-per-dropper (usually 1mL) before dosing","Green Dragon = high-proof alcohol tincture; most potent tincture format"],
        tip:"Hold it under your tongue for a full 90 seconds before swallowing. If you swallow immediately, you've just made a slow-acting edible. The sublingual route is what makes tinctures special."
      },
      { id:"topicals", icon:"🧴", name:"Topicals", tagline:"Localized relief. Zero intoxication.",
        desc:"Topicals are cannabis-infused creams, balms, salves, bath soaks, and patches applied directly to skin. Standard topicals bind to CB2 receptors in peripheral tissue without crossing the blood-brain barrier — no psychoactive effect. Ideal for localized pain, muscle soreness, joint inflammation, and skin conditions. Transdermal patches are the exception: engineered to penetrate the skin barrier and enter the bloodstream for systemic, long-duration effects.",
        onset:"Topical: 5–20 min local · Transdermal patch: 60–90 min systemic", duration:"2–6 hours topical · 8–12 hours patch",
        look:["Transdermal patches can produce mild psychoactive effect — different from cream/balm","THC topicals are legal in most places and don't produce a high","Caryophyllene-dominant formulations enhance CB2 activation","CBDA (raw) and CBD topicals both have anti-inflammatory research support","Arnica, menthol, and camphor additions enhance topical pain relief"],
        tip:"Apply to clean, warm skin right after a shower. Dilated pores and increased surface blood flow dramatically improve cannabinoid absorption. For joint pain, apply directly over the joint."
      }
    ];
    const _GUMMIES = [
      { tier:"Entry", name:"Distillate Gummies", icon:"🍬", color:"#74C69D", badge:"Most Common",
        what:"Made with distillate — a highly refined cannabis oil produced through molecular distillation. During this process, everything but THC is stripped away: terpenes, flavonoids, minor cannabinoids, waxes, chlorophyll. What remains is a clear oil at 90–99% THC. Flavors are added artificially. The result is consistent, affordable, and widely available.",
        pros:["Predictable, consistent dosing batch to batch","Long shelf life — stable at room temperature","More affordable than full-spectrum options","Widely available in all legal markets","Neutral base takes on added fruit flavors cleanly"],
        cons:["No entourage effect — isolated THC only","Added terpenes are synthetic replicas, not plant-derived","Flatter, more one-dimensional high quality","Some consumers report a heavier or more anxious feeling vs full-spectrum"],
        bestFor:"First-timers, budget-conscious consumers, precise single-cannabinoid dosing",
        brands:"Wana, Kiva Terra Bites, Wyld (standard line), Plus Products, Camino base line"
      },
      { tier:"Mid", name:"Live Resin Gummies", icon:"✨", color:"#C9973A", badge:"Best Value",
        what:"Made with live resin — extracted from fresh-frozen cannabis harvested at peak terpene production and immediately flash-frozen rather than dried and cured. This preservation keeps the full terpene profile and minor cannabinoid spectrum intact. The result is full-spectrum: real plant terpenes, real cannabinoid ratios, real entourage effect.",
        pros:["True entourage effect with real plant terpenes","Strain-specific options — you can taste the cultivar","More nuanced, complex experience than distillate","Notably different high quality — preferred by most experienced consumers","Terpene profile drives mood effects more accurately"],
        cons:["Higher price (1.5–2x distillate)","More variable batch-to-batch as a natural product","Shorter shelf life — refrigerate recommended","Cannabis-forward flavor not for everyone"],
        bestFor:"Experienced consumers, flavor-seekers, those who want strain-specific effects",
        brands:"Camino Live Resin (Kiva), Wana Quick, Raw Garden Gummies, Jeeter, Stiiizy Live Resin"
      },
      { tier:"Premium", name:"Live Rosin Gummies", icon:"👑", color:"#9B72CF", badge:"Connoisseur",
        what:"The pinnacle — 100% solventless extraction. Fresh-frozen cannabis is pressed between heated plates under controlled pressure. No butane, no ethanol, no CO2. Just heat and pressure. The resulting full-spectrum oil preserves every cannabinoid, terpene, flavonoid, and minor compound exactly as nature produced them. Live rosin gummies are the craft caviar of the edible world.",
        pros:["Completely solventless — chemically clean","Maximum entourage effect — nothing removed or synthesized","Strain-specific terroir-driven experience","Best possible terpene preservation","Cleanest, most complete full-spectrum option available"],
        cons:["Premium price — 2–4x the cost of distillate gummies","Lower THC% by weight (natural rosin = 60–80% THC vs distillate 90%+)","Limited availability — smaller craft producers","Shortest shelf life — always refrigerate","Strong cannabis flavor — not masked by added flavoring"],
        bestFor:"Connoisseurs, solvent-sensitive consumers, medical patients seeking full-spectrum",
        brands:"Emerald Bay, Papa & Barkley (rosin), Kiva Rosin line, Stiiizy Live Rosin, local craft producers"
      }
    ];
    const _CANNABS = [
      { abbr:"CBD", full:"Cannabidiol", color:"#74C69D", dose:"10–50mg", avail:"★★★★★",
        role:"The great balancer. Non-intoxicating. Reduces THC-induced anxiety by modulating CB1 receptors allosterically. Anti-inflammatory, anxiolytic, and neuroprotective. The only FDA-approved cannabinoid (Epidiolex for epilepsy). Works synergistically with THC — a small amount of CBD meaningfully changes the THC experience.",
        edible:"Best in 1:1 ratios with THC for a balanced, functional high. Standalone CBD gummies and tinctures for daytime stress and inflammation without intoxication. CBD in topicals for localized inflammation without systemic effects.",
        products:"CBD gummies, 1:1 seltzers (Cann), sublingual tinctures, softgel capsules, topicals",
        note:"Safe at high doses. No intoxication ceiling. Keep a CBD tincture on hand — it genuinely reduces the intensity of an overwhelming THC experience."
      },
      { abbr:"CBN", full:"Cannabinol", color:"#C9973A", dose:"2–10mg", avail:"★★★☆☆",
        role:"THC's metabolite — forms as THC oxidizes over time in aged or improperly stored cannabis. Mildly psychoactive at higher doses. Heavily marketed as a sleep aid. The scientific evidence is limited but anecdotal support is substantial, especially when CBN is combined with THC and CBD.",
        edible:"Best in sleep gummies and capsules taken 30–60 minutes before bed. Often combined with melatonin (1–3mg) and CBD in nighttime formulations. The CBN+CBD+THC combination outperforms any single cannabinoid alone for sleep.",
        products:"Wana Dream gummies, sleep capsules, Papa & Barkley Sleep tincture, Winberry Farms CBN",
        note:"Standalone CBN products often underperform expectations. Works best in combination — look for CBN+CBD or CBN+CBD+THC sleep formulations."
      },
      { abbr:"THCV", full:"Tetrahydrocannabivarin", color:"#E07B39", dose:"5–15mg", avail:"★★☆☆☆",
        role:"The 'sports car' cannabinoid. At low doses (under 15mg), THCV acts as a CB1 antagonist — suppressing appetite and blocking THC's sedating effects. At higher doses it becomes mildly euphoric. Known for clear-headed, energetic, short-duration effects (2–3 hours vs THC's 4–8). Rare in most cultivars.",
        edible:"Emerging in daytime gummies and focus capsules. Look for 'energy' or 'daytime' positioning in dispensaries. Pairs well with CBG for a clean, focused, functional experience without significant intoxication.",
        products:"Daytime focus gummies, select tincture lines, CBG+THCV capsule formulations",
        note:"Most commercial THCV is synthesized from CBD — naturally occurring THCV from African landrace genetics is rare and expensive. Suppresses appetite at low doses — don't use before eating."
      },
      { abbr:"CBC", full:"Cannabichromene", color:"#9B72CF", dose:"10–30mg", avail:"★★☆☆☆",
        role:"Non-intoxicating. Anti-inflammatory and analgesic through TRP channel activation — not CB1 or CB2. Works synergistically with THC for pain relief via the entourage effect. Early research shows promise for neurogenesis, acne treatment, and gut health. The fourth most abundant cannabinoid in the plant.",
        edible:"Rarely found in standalone products. Most often present naturally in full-spectrum tinctures and live rosin gummies. Ask for a COA showing CBC content when purchasing full-spectrum products — it should be there.",
        products:"Full-spectrum tinctures, live rosin gummies, some CBG+CBC combined capsule lines",
        note:"CBC acts through TRPA1 and TRPV1 channels — the same channels activated by capsaicin (chili) and menthol. This explains its warming, analgesic character."
      },
      { abbr:"CBG", full:"Cannabigerol", color:"#D4A853", dose:"10–25mg", avail:"★★★☆☆",
        role:"The 'mother cannabinoid' — CBGA is the biosynthetic precursor to THC, CBD, and CBC. Non-intoxicating. Anti-inflammatory, antibacterial, and neuroprotective. Growing research for focus enhancement, gut health, and glaucoma (IOP reduction). The fastest-growing minor cannabinoid product category in 2024–2025.",
        edible:"Increasingly marketed for focus and daytime functional use in gummies, tinctures, and capsules. CBG:CBD ratios offer a completely non-intoxicating, functional alternative for consumers who want effects without THC.",
        products:"CBG gummies (Cann, Social, Sunday Goods), daytime focus tinctures, CBG+CBD capsules",
        note:"CBG extraction requires early-harvest hemp and specialized processing — more expensive than CBD. Prices are dropping as the category matures and production scales."
      }
    ];
    const _DOSE = [
      { mg:"1–2.5mg", level:"Microdose", color:"#52B788",
        who:"Absolute beginners, THC-sensitive consumers, daytime micro-dosers",
        feel:"Sub-perceptual for most people. Subtle mood lift, mild edge reduction. The dose range used in clinical cannabis microdosing studies.",
        products:"Petra Mints (2.5mg), Cann beverages (2mg), micro-dose gummy lines, low-dose tincture drops"
      },
      { mg:"5mg", level:"Low", color:"#74C69D",
        who:"New consumers, low tolerance, functional daytime use",
        feel:"Mild relaxation, gentle mood elevation, slightly heavier body. Clear-headed for most. The California regulated standard serving size.",
        products:"Most regulated-market gummies (1 piece = 5mg), Camino, Wyld, nano beverage shots"
      },
      { mg:"10mg", level:"Standard", color:"#C9973A",
        who:"Occasional consumers, moderate tolerance",
        feel:"Noticeable effect. Body warmth, mood shift, altered perception. May cause couch-lock in low-tolerance users. The most common 'one gummy' dose in the market.",
        products:"2 standard gummies, most capsules (10mg standard), standard tincture full dropper"
      },
      { mg:"20–25mg", level:"Elevated", color:"#E07B39",
        who:"Regular consumers, higher tolerance, medical patients",
        feel:"Strong effect. Significant intoxication, sedation, altered time perception. Not recommended without established tolerance. Start here only if 10mg produced minimal effect.",
        products:"2–3 standard gummies, medical capsules (25mg), higher-dose tincture servings"
      },
      { mg:"50mg+", level:"High", color:"#D95F3B",
        who:"High-tolerance consumers, medical patients managing chronic conditions",
        feel:"Intense and potentially overwhelming without tolerance. Deep sedation, heavy body effect. Medical patients managing chronic pain or cancer-related symptoms often require these doses.",
        products:"Medical-grade capsules, multiple gummies, RSO (Rick Simpson Oil), high-potency tinctures"
      }
    ];
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Edibles &amp; Infused Products — Cannascenti</title>
<meta name="description" content="The complete consumer guide to cannabis edibles — gummies, chocolate, beverages, capsules, tinctures, and topicals. Distillate vs live resin vs live rosin gummies explained. CBD, CBN, THCV, CBC, CBG dosing guide.">
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
.ed-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:40px}
.ed-tab{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:100px;padding:10px 20px;font-family:Montserrat,sans-serif;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:rgba(242,234,216,0.6);cursor:pointer;transition:all .2s}
.ed-tab:hover{border-color:rgba(82,183,136,0.4);color:#F2EAD8}
.ed-tab.active{background:rgba(82,183,136,0.12);border-color:#52B788;color:#52B788}
.ed-section{display:none;animation:edFadeIn .3s}
.ed-section.active{display:block}
@keyframes edFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.ed-cat-header{display:flex;align-items:flex-start;gap:20px;margin-bottom:24px}
.ed-cat-icon{font-size:3rem;line-height:1;flex-shrink:0}
.ed-cat-title{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;color:#F2EAD8;margin-bottom:4px}
.ed-cat-tagline{font-size:.75rem;color:#52B788;letter-spacing:.08em;text-transform:uppercase}
.ed-cat-desc{font-size:.88rem;line-height:1.85;color:rgba(242,234,216,0.65);margin-bottom:28px;max-width:800px}
.ed-meta-row{display:flex;gap:16px;margin-bottom:28px;flex-wrap:wrap}
.ed-meta-item{background:rgba(82,183,136,0.06);border:1px solid rgba(82,183,136,0.15);border-radius:10px;padding:14px 20px;flex:1;min-width:160px}
.ed-meta-label{font-size:.6rem;letter-spacing:.15em;text-transform:uppercase;color:#52B788;display:block;margin-bottom:4px}
.ed-meta-val{font-size:.82rem;color:#F2EAD8;font-weight:500;line-height:1.4}
.ed-look{margin-bottom:24px}
.ed-look h3{font-size:.65rem;letter-spacing:.15em;text-transform:uppercase;color:rgba(242,234,216,0.35);margin-bottom:12px}
.ed-look ul{list-style:none;display:flex;flex-direction:column;gap:8px}
.ed-look li{font-size:.85rem;color:rgba(242,234,216,0.68);padding-left:18px;position:relative;line-height:1.6}
.ed-look li::before{content:"→";position:absolute;left:0;color:#52B788;font-size:.75rem;top:2px}
.ed-tip-box{background:rgba(82,183,136,0.07);border-left:3px solid #52B788;border-radius:0 8px 8px 0;padding:16px 20px;font-size:.85rem;color:rgba(242,234,216,0.8);line-height:1.7}
.ed-divider{margin-top:80px;padding-top:60px;border-top:1px solid rgba(255,255,255,0.06)}
.ed-sec-label{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#52B788;margin-bottom:10px}
.ed-sec-title{font-family:'Cormorant Garamond',serif;font-size:clamp(1.8rem,4vw,2.8rem);font-weight:300;color:#F2EAD8;line-height:1.15;margin-bottom:12px}
.ed-sec-desc{font-size:.88rem;line-height:1.85;color:rgba(242,234,216,0.55);max-width:680px;margin-bottom:40px}
.gummy-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.gummy-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px;transition:border-color .2s}
.gummy-card:hover{border-color:rgba(255,255,255,0.15)}
.gummy-badge{font-size:.6rem;letter-spacing:.15em;text-transform:uppercase;font-weight:700;padding:3px 10px;border-radius:20px;display:inline-block;margin-bottom:16px}
.gummy-icon{font-size:2.2rem;margin-bottom:12px}
.gummy-name{font-family:'Cormorant Garamond',serif;font-size:1.35rem;font-weight:400;margin-bottom:16px;line-height:1.2}
.gummy-what{font-size:.78rem;line-height:1.8;color:rgba(242,234,216,0.55);margin-bottom:20px}
.gummy-pros-cons{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
.gummy-pros-cons h4{font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px}
.gummy-pros-cons ul{list-style:none}
.gummy-pros-cons li{font-size:.74rem;color:rgba(242,234,216,0.6);padding:3px 0 3px 14px;position:relative;line-height:1.5}
.gummy-pros-cons li::before{position:absolute;left:0;font-size:.7rem;top:4px}
.gummy-pros h4{color:#52B788}
.gummy-pros li::before{content:"✓";color:#52B788}
.gummy-cons h4{color:#E07B39}
.gummy-cons li::before{content:"✗";color:#E07B39}
.gummy-footer{font-size:.74rem;color:rgba(242,234,216,0.4);border-top:1px solid rgba(255,255,255,0.06);padding-top:14px;line-height:1.65}
.gummy-footer strong{color:rgba(242,234,216,0.6)}
.cb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr));gap:16px}
.cb-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:24px;transition:border-color .2s}
.cb-card:hover{border-color:rgba(255,255,255,0.14)}
.cb-top{display:flex;align-items:baseline;gap:10px;margin-bottom:6px;flex-wrap:wrap}
.cb-abbr{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:400;line-height:1}
.cb-full{font-size:.72rem;color:rgba(242,234,216,0.4);letter-spacing:.03em}
.cb-dose{font-size:.68rem;background:rgba(255,255,255,0.07);border-radius:20px;padding:3px 10px;color:rgba(242,234,216,0.5);white-space:nowrap;align-self:center}
.cb-avail{font-size:.65rem;color:rgba(242,234,216,0.35);margin-bottom:12px;letter-spacing:.04em}
.cb-role{font-size:.82rem;line-height:1.75;color:rgba(242,234,216,0.68);margin-bottom:12px}
.cb-detail{font-size:.78rem;line-height:1.7;color:rgba(242,234,216,0.45);margin-bottom:6px}
.cb-note{font-size:.75rem;color:rgba(82,183,136,0.75);border-top:1px solid rgba(255,255,255,0.06);padding-top:12px;margin-top:12px;line-height:1.65;font-style:italic}
.dose-grid{display:flex;flex-direction:column;gap:10px;margin-bottom:40px}
.dose-tier{display:grid;grid-template-columns:110px 100px 1fr;align-items:start;gap:16px 20px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:16px 20px}
.dose-mg{font-family:'Cormorant Garamond',serif;font-size:1.2rem;font-weight:400;line-height:1.2;align-self:center}
.dose-level{font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;align-self:center;text-align:center}
.dose-who{font-size:.78rem;color:#F2EAD8;font-weight:500;margin-bottom:4px;line-height:1.5}
.dose-feel{font-size:.78rem;color:rgba(242,234,216,0.5);line-height:1.6;margin-bottom:4px}
.dose-products{font-size:.72rem;color:rgba(82,183,136,0.65)}
.ed-11h{background:rgba(82,183,136,0.05);border:1px solid rgba(82,183,136,0.15);border-radius:16px;padding:32px;margin-top:40px}
.ed-11h-title{font-family:'Cormorant Garamond',serif;font-size:1.5rem;font-weight:300;color:#F2EAD8;margin-bottom:14px}
.ed-11h-body{font-size:.88rem;line-height:1.9;color:rgba(242,234,216,0.65)}
@media(max-width:900px){.gummy-grid{grid-template-columns:1fr}}
@media(max-width:600px){
  .ed-tab{font-size:10px;padding:8px 14px}
  .ed-cat-icon{font-size:2.2rem}
  .gummy-pros-cons{grid-template-columns:1fr}
  .dose-tier{grid-template-columns:90px 1fr;row-gap:8px}
  .dose-tier .dose-level{grid-column:2}
  .dose-tier .dose-feel,.dose-tier .dose-products,.dose-tier .dose-who{grid-column:1/-1}
  .enc-page{padding:60px 20px 100px}
}
</style>
</head>
<body>
${ENC_NAV}
<div class="enc-page">
  <div class="enc-page-header">
    <div class="enc-label">&#10022; Cannascenti Encyclopedia</div>
    <h1 class="enc-title">Edibles &amp; Infused <em>Products.</em></h1>
    <p class="enc-desc">The consumer's complete guide to cannabis-infused products — what's in them, what makes them different, how they feel, and how to choose wisely. From distillate gummies to live rosin, nano beverages to transdermal patches, minor cannabinoids to precise dosing science.</p>
  </div>

  <div class="ed-tabs" id="edTabs"></div>
  <div id="edSections"></div>

  <div class="ed-divider">
    <div class="ed-sec-label">&#10022; Quality Spectrum</div>
    <h2 class="ed-sec-title">The Gummy <em>Spectrum.</em></h2>
    <p class="ed-sec-desc">Not all gummies are the same. The difference between distillate, live resin, and live rosin gummies is the difference between a mass-produced wine and a single-vineyard natural. Here is the full breakdown.</p>
    <div class="gummy-grid" id="gummyGrid"></div>
  </div>

  <div class="ed-divider">
    <div class="ed-sec-label">&#10022; Minor Cannabinoids</div>
    <h2 class="ed-sec-title">Beyond <em>THC.</em></h2>
    <p class="ed-sec-desc">CBD, CBN, THCV, CBC, and CBG are increasingly available in precision-dosed edibles. Each has a distinct mechanism, a distinct feel, and distinct products built around it.</p>
    <div class="cb-grid" id="cbGrid"></div>
  </div>

  <div class="ed-divider">
    <div class="ed-sec-label">&#10022; Cooking with Cannabis</div>
    <h2 class="ed-sec-title">Make Your <em>Own.</em></h2>
    <p class="ed-sec-desc">Ready to go beyond buying? The Cannabis Kitchen covers everything — decarboxylation charts, cannabutter, infusion methods, dosing calculators, and full recipes from breakfast to dessert.</p>
    <a href="/cooking" style="display:inline-flex;align-items:center;gap:10px;background:rgba(82,183,136,0.1);border:1px solid rgba(82,183,136,0.3);color:#52B788;font-family:Montserrat,sans-serif;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:16px 36px;border-radius:100px;text-decoration:none;transition:all .2s" onmouseover="this.style.background='rgba(82,183,136,0.18)'" onmouseout="this.style.background='rgba(82,183,136,0.1)'">Explore the Cannabis Kitchen &#8594;</a>
  </div>

  <div class="ed-divider">
    <div class="ed-sec-label">&#10022; Dosing Guide</div>
    <h2 class="ed-sec-title">The Dosing <em>Guide.</em></h2>
    <p class="ed-sec-desc">Edible dosing is not like inhalation. The same person who smokes a gram can be overwhelmed by 20mg eaten on an empty stomach. Start low. Wait fully. Adjust next time — not the same session.</p>
    <div class="dose-grid" id="doseGrid"></div>
    <div class="ed-11h">
      <h3 class="ed-11h-title">Why Edibles Hit Differently: 11-Hydroxy-THC</h3>
      <p class="ed-11h-body">When you inhale cannabis, THC enters the bloodstream directly through the lungs — onset in seconds, peak in 10–20 minutes, largely metabolized in 2–3 hours. When you eat cannabis, it travels through your digestive system where the liver converts Delta-9-THC into <strong>11-hydroxy-THC</strong> — a fundamentally different molecule that crosses the blood-brain barrier more efficiently, produces a more sedating and body-heavy effect, and persists in the system for 4–8 hours or longer. This is why an experienced smoker can be completely overwhelmed by 20mg of an edible on an empty stomach. You are not consuming the same molecule you inhale.</p>
    </div>
  </div>
</div>

<script>
var _CATS = ${JSON.stringify(_CATS)};
var _GUMMIES = ${JSON.stringify(_GUMMIES)};
var _CANNABS = ${JSON.stringify(_CANNABS)};
var _DOSE = ${JSON.stringify(_DOSE)};

function renderTabs() {
  var h = '';
  _CATS.forEach(function(c, i) {
    h += '<button class="ed-tab' + (i===0?' active':'') + '" onclick="showTab(\'' + c.id + '\')">' + c.icon + ' ' + c.name + '</button>';
  });
  document.getElementById('edTabs').innerHTML = h;
}

function showTab(id) {
  document.querySelectorAll('.ed-tab').forEach(function(t, i) {
    t.classList.toggle('active', _CATS[i] && _CATS[i].id === id);
  });
  document.querySelectorAll('.ed-section').forEach(function(s) {
    s.classList.toggle('active', s.getAttribute('data-id') === id);
  });
}

function renderSections() {
  var h = '';
  _CATS.forEach(function(c, i) {
    var look = '';
    c.look.forEach(function(l) { look += '<li>' + l + '</li>'; });
    h += '<div class="ed-section' + (i===0?' active':'') + '" data-id="' + c.id + '">' +
      '<div class="ed-cat-header">' +
        '<div class="ed-cat-icon">' + c.icon + '</div>' +
        '<div><div class="ed-cat-title">' + c.name + '</div><div class="ed-cat-tagline">' + c.tagline + '</div></div>' +
      '</div>' +
      '<p class="ed-cat-desc">' + c.desc + '</p>' +
      '<div class="ed-meta-row">' +
        '<div class="ed-meta-item"><span class="ed-meta-label">Onset</span><span class="ed-meta-val">' + c.onset + '</span></div>' +
        '<div class="ed-meta-item"><span class="ed-meta-label">Duration</span><span class="ed-meta-val">' + c.duration + '</span></div>' +
      '</div>' +
      '<div class="ed-look"><h3>What to look for</h3><ul>' + look + '</ul></div>' +
      '<div class="ed-tip-box">&#128161; ' + c.tip + '</div>' +
    '</div>';
  });
  document.getElementById('edSections').innerHTML = h;
}

function renderGummies() {
  var h = '';
  _GUMMIES.forEach(function(g) {
    var pros = '';
    g.pros.forEach(function(p) { pros += '<li>' + p + '</li>'; });
    var cons = '';
    g.cons.forEach(function(c) { cons += '<li>' + c + '</li>'; });
    h += '<div class="gummy-card">' +
      '<div class="gummy-badge" style="background:' + g.color + '22;color:' + g.color + '">' + g.badge + '</div>' +
      '<div class="gummy-icon">' + g.icon + '</div>' +
      '<div class="gummy-name" style="color:' + g.color + '">' + g.name + '</div>' +
      '<p class="gummy-what">' + g.what + '</p>' +
      '<div class="gummy-pros-cons">' +
        '<div class="gummy-pros"><h4>Pros</h4><ul>' + pros + '</ul></div>' +
        '<div class="gummy-cons"><h4>Cons</h4><ul>' + cons + '</ul></div>' +
      '</div>' +
      '<div class="gummy-footer"><strong>Best for:</strong> ' + g.bestFor + '<br><strong>Brands:</strong> ' + g.brands + '</div>' +
    '</div>';
  });
  document.getElementById('gummyGrid').innerHTML = h;
}

function renderCannabs() {
  var h = '';
  _CANNABS.forEach(function(c) {
    h += '<div class="cb-card" style="border-top:2px solid ' + c.color + '">' +
      '<div class="cb-top">' +
        '<div class="cb-abbr" style="color:' + c.color + '">' + c.abbr + '</div>' +
        '<div class="cb-full">' + c.full + '</div>' +
        '<div class="cb-dose">' + c.dose + '</div>' +
      '</div>' +
      '<div class="cb-avail">Market availability: ' + c.avail + '</div>' +
      '<p class="cb-role">' + c.role + '</p>' +
      '<p class="cb-detail"><strong style="color:rgba(242,234,216,0.6)">In edibles:</strong> ' + c.edible + '</p>' +
      '<p class="cb-detail">Find in: ' + c.products + '</p>' +
      '<div class="cb-note">' + c.note + '</div>' +
    '</div>';
  });
  document.getElementById('cbGrid').innerHTML = h;
}

function renderDose() {
  var h = '';
  _DOSE.forEach(function(d) {
    h += '<div class="dose-tier">' +
      '<div class="dose-mg" style="color:' + d.color + '">' + d.mg + '</div>' +
      '<div class="dose-level" style="background:' + d.color + '22;color:' + d.color + '">' + d.level + '</div>' +
      '<div class="dose-who">' + d.who + '</div>' +
      '<div class="dose-feel" style="grid-column:3">' + d.feel + '</div>' +
      '<div class="dose-products" style="grid-column:3">' + d.products + '</div>' +
    '</div>';
  });
  document.getElementById('doseGrid').innerHTML = h;
}

document.addEventListener('DOMContentLoaded', function() {
  renderTabs();
  renderSections();
  renderGummies();
  renderCannabs();
  renderDose();
});
</script>
</body>
</html>`;
    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /cannabinoids ─────────────────────────────────────────────────────────
  if (req.method === "GET" && (req.url === "/cannabinoids" || req.url === "/cannabinoids#body-map")) {
    const _CB = [
      { abbr:"THC", full:"Tetrahydrocannabinol", psycho:95, color:"#52B788", desc:"The primary psychoactive compound in cannabis. THC binds directly to CB1 receptors in the brain, producing euphoria, altered perception, and heightened sensory awareness. Also the most clinically studied cannabinoid for pain, nausea, and appetite stimulation.", uses:["Euphoria","Pain relief","Appetite stimulation","Anti-nausea","Glaucoma"], found:"10–35% in modern cultivars. Trace amounts in hemp." },
      { abbr:"CBD", full:"Cannabidiol", psycho:5, color:"#74C69D", desc:"The most therapeutically versatile cannabinoid. Non-intoxicating. Modulates THC through allosteric receptor action, has FDA-approved efficacy for epilepsy (Epidiolex), and is a potent anti-inflammatory and anxiolytic.", uses:["Anxiety reduction","Epilepsy","Anti-inflammatory","Pain","Nausea"], found:"High in hemp (up to 25%). Dominant in Charlotte's Web, ACDC, Harlequin." },
      { abbr:"CBG", full:"Cannabigerol", psycho:10, color:"#D4A853", desc:"The 'mother cannabinoid' — CBGA is the biosynthetic precursor to THC, CBD, and CBC. Non-intoxicating. Strong antibacterial activity against MRSA, and early research supports promise for IBD, glaucoma, and Huntington's disease.", uses:["Antibacterial","Glaucoma","IBD","Neuroprotection","Bone growth"], found:"Usually under 1% in mature plants. Highest in early-harvest hemp cultivars." },
      { abbr:"CBN", full:"Cannabinol", psycho:20, color:"#C9973A", desc:"A THC degradation product formed as cannabis oxidizes over time. Mildly psychoactive. Marketed as a sleep aid — limited but growing evidence. More established: antibacterial properties and appetite stimulation. Old cannabis has higher CBN.", uses:["Sleep aid","Antibacterial","Appetite","Anticonvulsant","Mild pain"], found:"Highest in aged, oxidized cannabis. Increases as THC degrades with heat and light." },
      { abbr:"THCV", full:"Tetrahydrocannabivarin", psycho:40, color:"#E07B39", desc:"A structural THC analog with opposite appetite effects at low doses — it blocks CB1 and suppresses hunger. At higher doses it becomes mildly euphoric. Associated with clear-headed, energetic, short-duration highs and metabolic research.", uses:["Appetite suppression","Diabetes research","Panic attacks","Bone growth","Energy"], found:"Rare. Highest in African landrace sativas — Durban Poison, Pineapple Purps." },
      { abbr:"CBC", full:"Cannabichromene", psycho:0, color:"#5CA0E8", desc:"The third most abundant cannabinoid in cannabis but largely overlooked. Non-psychoactive. Shows strong synergistic activity with CBD for anti-inflammatory and anti-acne effects. Binds TRP channels rather than CB receptors — a unique mechanism.", uses:["Anti-inflammatory","Anti-acne","Neurogenesis","Pain (synergy)","Antifungal"], found:"Usually 0.1–1% in most strains. Higher in tropical landrace varieties and young plants." },
      { abbr:"THCA", full:"Tetrahydrocannabinolic Acid", psycho:0, color:"#9B7FD4", desc:"The raw, non-psychoactive precursor to THC in the live plant. THCA converts to THC through decarboxylation (heat). When consumed raw (juiced, capsule), THCA does not intoxicate but shows anti-inflammatory, neuroprotective, and antiemetic properties.", uses:["Anti-inflammatory","Neuroprotection","Anti-nausea","Raw consumption","Research"], found:"Dominant cannabinoid in fresh, undried cannabis. All THC starts as THCA." },
      { abbr:"CBDA", full:"Cannabidiolic Acid", psycho:0, color:"#B7E4C7", desc:"The raw precursor to CBD. CBDA is found in fresh cannabis and hemp plants before decarboxylation. Early research suggests CBDA may be more bioavailable than CBD and shows potent antiemetic effects. Being studied for COVID-19 spike protein binding.", uses:["Anti-nausea","Antiemetic","Anti-inflammatory","Bioavailability","Research"], found:"Raw/fresh cannabis and hemp. Converts to CBD when dried, heated, or processed." },
      { abbr:"Δ8-THC", full:"Delta-8 Tetrahydrocannabinol", psycho:60, color:"#A78BFA", desc:"An isomer of Delta-9 THC with its double bond on the 8th carbon chain. Produces similar but milder psychoactive effects — lighter, clearer, less anxiety-prone. Naturally occurs in trace amounts; most commercial Delta-8 is synthesized from CBD.", uses:["Mild euphoria","Antiemetic","Appetite","Anxiety reduction","Neuroprotection"], found:"Trace amounts naturally. Most commercial D8 is hemp-derived via CBD isomerization." },
      { abbr:"Δ10-THC", full:"Delta-10 Tetrahydrocannabinol", psycho:50, color:"#F472B6", desc:"The newest commercially available THC isomer. Effects are reported as more sativa-like — energizing, uplifting, and clear-headed — with less sedation than Delta-8. Very low natural occurrence; produced synthetically from CBD or Delta-9 THC.", uses:["Mild euphoria","Energy","Focus","Mood lift","Appetite"], found:"Essentially zero in natural cannabis. All commercial D10 is synthetically derived." }
    ];
    const _RATIOS = [
      { ratio:"30:1", thc:30, cbd:1, label:"High THC", tag:"Recreational / Intense", color:"#52B788", desc:"Dominant THC experience with minimal CBD modulation. Full psychoactive effect — euphoria, sedation, sensory enhancement. Best for experienced users seeking maximum effect.", uses:["Experienced users","Deep sedation","Intense euphoria","Creative sessions"], caution:"Anxiety risk for sensitive users. Not recommended for beginners.", strains:"OG Kush, Gorilla Glue #4, Gelato 33" },
      { ratio:"20:1", thc:20, cbd:1, label:"High THC / Trace CBD", tag:"Near-Pure THC", color:"#65C28B", desc:"Strong psychoactive effect with a very minor CBD buffer. Most recreational cannabis falls here. The trace CBD is detectable but not enough to meaningfully modify the THC experience.", uses:["Recreational users","Pain","Appetite","Sleep (indica)"], caution:"Full psychoactivity — use caution in social or unfamiliar situations.", strains:"Blue Dream, Wedding Cake, GSC" },
      { ratio:"10:1", thc:10, cbd:1, label:"Mostly THC", tag:"Popular Recreational", color:"#78C08A", desc:"THC dominant with a minor CBD presence that slightly softens the edges. Standard high-THC recreational experience. The small CBD component may lightly reduce anxiety without significantly altering the high.", uses:["Recreational","Pain relief","Mood elevation","Appetite"], caution:"Still strongly psychoactive.", strains:"Runtz, Sunset Sherbet, Mimosa" },
      { ratio:"5:1", thc:5, cbd:1, label:"THC Forward", tag:"Mild CBD Buffer", color:"#8BC48A", desc:"THC remains dominant but CBD starts to visibly soften the experience. Anxiety and paranoia risk decreases. A solid choice for moderate users who want the full high with fewer side effects.", uses:["Moderate users","Anxiety-prone","Social settings","Daytime use"], caution:"Psychoactive. CBD buffer helps but doesn't eliminate intoxication.", strains:"Harlequin (some cuts), ACDC crosses" },
      { ratio:"3:1", thc:3, cbd:1, label:"Balanced-THC", tag:"Therapeutic + Buzz", color:"#98C88A", desc:"A popular medical ratio offering meaningful pain, anxiety, and inflammation relief alongside a noticeable but moderate high. The CBD meaningfully modulates THC's psychoactivity without eliminating it.", uses:["Pain management","PTSD","Sleep","Medical + recreational"], caution:"Moderate psychoactivity. Good transitional ratio.", strains:"Sativex formulation (approx.), some dispensary tinctures" },
      { ratio:"1:1", thc:1, cbd:1, label:"Balanced", tag:"The Sweet Spot", color:"#B2D4A8", desc:"The most studied ratio in clinical research. CBD significantly dampens THC's psychoactivity, reducing anxiety and paranoia while preserving therapeutic benefits. Ideal for daytime medical use, first-timers, and anxiety-prone users.", uses:["First-timers","Anxiety","Inflammation","PTSD","MS spasticity"], caution:"Mild psychoactivity. Most tolerable for sensitive users.", strains:"Pennywise, Cannatonic, some ACDC crosses, Sativex" },
      { ratio:"1:3", thc:1, cbd:3, label:"CBD Forward", tag:"Therapeutic Focus", color:"#74C69D", desc:"CBD dominates. Mild THC presence provides a light mood lift and enhances CBD's analgesic effects (the entourage effect), but intoxication is minimal for most users.", uses:["Daytime medical","Anxiety","Seizure management","Inflammation","Beginner-friendly"], caution:"Very low psychoactivity. May cause mild lightheadedness.", strains:"Harlequin, Charlotte's Web crosses, Ringo's Gift" },
      { ratio:"1:10", thc:1, cbd:10, label:"High CBD / Trace THC", tag:"Near Non-Psychoactive", color:"#52B788", desc:"CBD clearly leads. The trace THC is below the threshold for significant psychoactivity for most users, but still contributes to the entourage effect and may enhance pain relief versus CBD alone.", uses:["Medical patients","Pediatric use","Seizures","Anti-inflammatory","Workplace-friendly"], caution:"Minimal psychoactivity. Some users may sense a very mild lift.", strains:"Charlotte's Web, ACDC, Harle-Tsu, Valentine X" },
      { ratio:"1:20", thc:1, cbd:20, label:"Dominant CBD", tag:"Medical / Non-Psychoactive", color:"#3DA374", desc:"Essentially non-psychoactive for most users. Full CBD therapeutic profile with just enough THC for entourage effect enhancement. Standard medical dispensary ratio for anxiety, epilepsy, and inflammation.", uses:["Epilepsy","Anxiety disorder","Pediatric","Drug-tested individuals","Seniors"], caution:"No significant psychoactivity expected.", strains:"ACDC, Ringo's Gift, Sour Tsunami" },
      { ratio:"1:30", thc:1, cbd:30, label:"Hemp-Level", tag:"CBD Dominant", color:"#2D9E68", desc:"Hemp-compliant (under 0.3% THC). Pure CBD therapeutic application. No measurable psychoactive effect. Used in mass-market CBD products, tinctures, and clinical formulations.", uses:["Wellness","Daily supplementation","Non-cannabis users","Clinical CBD"], caution:"No psychoactivity.", strains:"Industrial hemp, Charlotte's Web, Lifter" },
      { ratio:"10:10:10", thc:10, cbd:10, label:"Trifecta THC+CBD+CBG", tag:"Full-Spectrum Synergy", color:"#D4A853", isSpecial:true, desc:"Equal parts THC, CBD, and CBG — an emerging formulation designed for maximum entourage effect. CBG adds antibacterial, anti-inflammatory, and neuroprotective benefits while the balanced THC:CBD minimizes anxiety and maximizes therapeutic range.", uses:["Full-spectrum therapy","IBD","Neuroprotection","Anti-inflammatory","Medical research"], caution:"Moderate psychoactivity from THC component. CBD and CBG buffer the experience.", strains:"Custom blends, full-spectrum products, specific cultivars" },
      { ratio:"1:1:1", thc:1, cbd:1, label:"THC+CBD+CBN Nighttime", tag:"Sleep Blend", color:"#9B7FD4", isSpecial:true, third:"CBN", desc:"Equal THC, CBD, and CBN — the ideal nighttime formula. THC provides the sedating body effect, CBD reduces anxiety, and CBN amplifies sleep-promoting properties. A popular sleep tincture and edible formulation.", uses:["Insomnia","Sleep disorders","Nighttime pain","Anxiety at bedtime"], caution:"Moderate sedation. Not for daytime use.", strains:"Custom blends. CBN is typically added from isolated extract." },
      { ratio:"1:1:1 (THCV)", thc:1, cbd:1, label:"THC+CBD+THCV Daytime", tag:"Energy Blend", color:"#E07B39", isSpecial:true, third:"THCV", desc:"Daytime counterpart to the sleep blend. THCV's appetite suppression and clear-headed energy plus balanced THC and CBD creates a focused, motivating effect with reduced hunger. Sought after for productivity.", uses:["Daytime focus","Appetite suppression","Energy","Weight management","Creativity"], caution:"THCV very rare and expensive. Most products are proprietary blends.", strains:"Durban Poison (high THCV) + CBD flower, or custom blended products" },
    ];
    const _ZONES = [
      { id:"brain", label:"Brain", cx:100, cy:44, color:"#9B7FD4", receptors:"CB1 receptors dense throughout cortex, hippocampus, basal ganglia, and cerebellum. CB2 present in microglia.", headline:"The command center of your cannabis experience", desc:"The brain has the highest CB1 receptor density of any organ. These receptors regulate mood, memory, pain perception, coordination, and appetite. THC binds directly to CB1 — the source of euphoria, altered time perception, and heightened sensory awareness. The hippocampus — the memory center — is especially CB1-dense, which is why high THC temporarily impairs short-term memory. CBD does not bind CB1 directly but modulates its activity, reducing anxiety and dampening overactive neural circuits.", positive:["THC: euphoria, mood elevation, creativity, heightened sensory perception","CBD: anxiety reduction, anti-epileptic, neuroprotection (FDA-approved Epidiolex)","CBN: sedation and sleep promotion","CBG: neuroprotection, possible antidepressant activity","THCV: mental clarity, short-duration alerting effect"], negative:["THC: short-term memory impairment, anxiety at high doses, paranoia in susceptible individuals","Heavy adolescent use associated with cognitive development concerns"], research:"The discovery of CB1 receptors in 1988 (Howlett et al.) revolutionized neuroscience. CBD's mechanism in treating Dravet syndrome and Lennox-Gastaut syndrome is FDA-recognized (Epidiolex, 2018).", cannabinoids:["THC","CBD","CBN","CBG","THCV"] },
      { id:"eyes", label:"Eyes", cx:100, cy:57, color:"#5CA0E8", receptors:"CB1 receptors in ciliary body (regulates intraocular pressure). CB2 in retinal ganglion cells and Muller glia.", headline:"Bloodshot eyes, reduced pressure, retinal protection", desc:"The redness associated with cannabis use is caused by THC binding CB1 receptors in the eye's blood vessels, causing vasodilation. This same mechanism reduces intraocular pressure (IOP) by 25–30%, which is why cannabis was one of the first plant medicines studied for glaucoma. The 3–4 hour window limits its clinical utility versus modern glaucoma drugs. CBD has shown promise as a retinal neuroprotectant in preclinical research.", positive:["THC: reduces intraocular pressure 25–30% — relevant to glaucoma management","CBD: antioxidant neuroprotection of retinal cells in preclinical models"], negative:["THC: conjunctival redness (reliable)","IOP reduction is short-duration — not a standalone glaucoma treatment","High-dose CBD may paradoxically increase IOP in some studies"], research:"Hepler and Frank (1971) published the first clinical study documenting cannabis-induced IOP reduction. The American Glaucoma Society notes cannabis reduces IOP but its short duration limits primary therapy use.", cannabinoids:["THC","CBD"] },
      { id:"lungs", label:"Lungs", cx:100, cy:118, color:"#52B788", receptors:"CB1 in bronchial smooth muscle (bronchodilation). CB2 in alveolar macrophages and immune cells of lung tissue.", headline:"Acute bronchodilation vs. chronic smoking damage", desc:"Cannabis has a dual lung relationship depending on consumption method. Acutely, THC causes bronchodilation — studied as an asthma treatment in the 1970s. CBD exerts anti-inflammatory effects on bronchial tissue. The complication is delivery: smoking involves combustion products (CO, benzene, tar) causing chronic bronchitis. Vaporization eliminates combustion products while preserving bronchodilatory effects.", positive:["THC: acute bronchodilation — opens airways short-term","CBD: reduces pulmonary inflammation via CB2 immune modulation","Vaporized cannabis avoids combustion toxins entirely"], negative:["Smoked cannabis: chronic bronchitis, increased respiratory mucus, cough","Combustion produces CO, benzene, tar — same as tobacco smoke"], research:"Tashkin et al. (UCLA) found heavy cannabis smokers do not show COPD rates seen in tobacco smokers — attributed to cannabis's anti-inflammatory CB2 activity. Vaporizer studies (Abrams et al., 2007) confirmed equivalent delivery without combustion.", cannabinoids:["THC","CBD"] },
      { id:"heart", label:"Heart", cx:88, cy:130, color:"#E07B39", receptors:"CB1 in cardiac muscle and autonomic neurons. CB2 in vascular endothelium and immune cells.", headline:"Rate increase first, then cardioprotection", desc:"THC's initial cardiovascular effect is dose-dependent tachycardia — typically 20–50 BPM above baseline — driven by CB1 activation of sympathetic neurons. Blood pressure shows an initial mild increase then decreases via CB1-mediated vasodilation. CBD has a cardioprotective profile: reduces ischemia-reperfusion injury, lowers resting blood pressure, and demonstrates vascular anti-inflammatory effects. CBG also produces vasodilation independent of CB1.", positive:["CBD: cardioprotective — reduces ischemia damage, lowers blood pressure","CBG: vasodilatory, reduces arterial tension","CB2 activation: reduces cardiac inflammation and atherosclerosis progression"], negative:["THC: tachycardia — heart rate increase of 20–50 BPM","Elevated risk for individuals with pre-existing cardiac arrhythmia"], research:"CBD's antihypertensive properties confirmed in double-blind trial (Jadoon et al., 2017). The CARDIA study followed cannabis users 25+ years and found associations between heavy use and cardiovascular risk.", cannabinoids:["THC","CBD","CBG"] },
      { id:"gut", label:"Gut", cx:100, cy:188, color:"#74C69D", receptors:"CB1 throughout enteric nervous system. CB2 dense in gut wall immune cells (Peyer's patches, lamina propria).", headline:"The gut-cannabis axis — digestion, immunity, IBD", desc:"The GI tract has the second-highest cannabinoid receptor concentration after the brain. The enteric nervous system is extensively modulated by CB1 — governing motility, secretions, and the gut-brain axis. This is why cannabis reliably combats nausea and stimulates appetite. CB2 receptors in gut wall immune cells regulate intestinal inflammation, making cannabinoids relevant to Crohn's, ulcerative colitis, and IBS. CBG shows remarkable specificity for gut inflammation.", positive:["THC: powerful anti-nausea, appetite stimulation (FDA-approved Marinol for chemo nausea)","CBD: anti-inflammatory for Crohn's disease and ulcerative colitis","CBG: IBD-specific anti-inflammatory, H. pylori antibacterial activity","THCV: appetite suppression — the metabolic opposite of the THC munchies"], negative:["Heavy THC use associated with Cannabinoid Hyperemesis Syndrome (CHS) in a subset","High THC may slow gastric motility — contraindicated in gastroparesis"], research:"FDA-approved dronabinol (synthetic THC) validated the gut-cannabinoid connection. Crohn's trial (Naftali et al., 2018) showed 65% clinical remission with cannabis vs. 35% placebo. CBG's efficacy against H. pylori: Appendino et al. (2008).", cannabinoids:["THC","CBD","CBG","THCV"] },
      { id:"muscles", label:"Muscles", cx:55, cy:258, color:"#F4A261", receptors:"CB1 in motor neurons and neuromuscular junctions. CB2 in skeletal muscle satellite cells and immune cells.", headline:"Spasticity relief, recovery, inflammation control", desc:"CB1 receptors in motor neurons modulate involuntary muscle contractions — why cannabis has documented efficacy for MS spasticity (Sativex approved in 25+ countries). CBD's anti-inflammatory and antioxidant properties reduce delayed onset muscle soreness (DOMS) through prostaglandin inhibition and cytokine signaling. CBC shows synergistic effects with CBD on muscle tissue inflammation.", positive:["THC: spasticity reduction — clinically proven in MS (Sativex, 25+ countries)","CBD: reduces DOMS, exercise-induced inflammation, oxidative stress in muscle","CBC: synergistic anti-inflammatory activity alongside CBD"], negative:["THC impairs motor coordination at higher doses — counterproductive for athletic performance","Smoking irritates airways — athletes should use non-combustion methods"], research:"MUSEC trial (Zajicek et al., 2012): significant spasticity reduction in MS with cannabis extract. WADA removed CBD from prohibited list in 2018.", cannabinoids:["THC","CBD","CBC"] },
      { id:"joints", label:"Joints / Bones", cx:68, cy:335, color:"#C9973A", receptors:"CB1 in periarticular nerve fibers (pain signaling). CB2 in osteoblasts, osteoclasts, and synovial joint macrophages.", headline:"Arthritis, bone growth, pain signal modulation", desc:"Joints and bones are governed primarily by CB2 receptors. CB2 is found on osteoblasts (bone-forming cells) and osteoclasts (bone-resorbing cells), giving cannabinoids a direct role in bone remodeling and fracture healing. CBG and CBD have both shown osteogenic effects in preclinical models. CBD's anti-inflammatory action on synovial macrophages reduces joint swelling. THC addresses the pain signal side via CB1 periarticular nerves.", positive:["CBD: reduces synovial inflammation in both osteoarthritis and rheumatoid arthritis","THC: modulates pain signal transmission from joints via CB1","CBG: stimulates bone growth via osteoblast CB2 activation — accelerates fracture healing","CB2 activation: reduces joint immune-mediated destruction"], negative:["THC's psychoactivity limits daytime use for arthritis management","Topical preferred for localized joint relief — avoids systemic effects"], research:"Sophocleous et al. (2017) showed CB2 knockout mice have reduced bone mass. RCT (Blake et al., Rheumatology 2006): Sativex significantly reduced pain and improved sleep in rheumatoid arthritis.", cannabinoids:["CBD","THC","CBG"] },
      { id:"skin", label:"Skin", cx:148, cy:158, color:"#E8A87C", receptors:"CB1 and CB2 in keratinocytes, sebocytes, mast cells, and sensory nerve endings throughout the dermis.", headline:"Acne, eczema, topical pain — no psychoactivity", desc:"The skin is one of the most cannabinoid-receptor-rich organs. CBD regulates sebum production via CB2 on sebocytes — reducing overproduction that causes acne. It also reduces inflammatory cascades in eczema and psoriasis. CBG is broad-spectrum antibacterial against skin pathogens including MRSA. Standard topical cannabinoids do not cross the blood-brain barrier — zero psychoactive effect.", positive:["CBD: reduces sebum overproduction — clinically relevant for acne vulgaris","CBD: reduces inflammatory cytokines in eczema, psoriasis, atopic dermatitis","THC (topical): pain and itch relief via CB1 skin nerve endings — zero psychoactivity","CBG: broad-spectrum antibacterial against skin pathogens including MRSA","CBC: synergistic anti-acne activity, reduces lipogenesis in sebocytes"], negative:["Transdermal absorption is low — most topicals stay in skin layers only","Transdermal patches can deliver systemically — potential mild psychoactivity","Product quality varies enormously"], research:"Olah et al. (2014, JCI) demonstrated CBD's sebostatic effects in human sebocyte culture. CBG vs. MRSA: Appendino et al. (Journal of Natural Products, 2008).", cannabinoids:["CBD","THC","CBG","CBC"] }
    ];
    const _CB_INFO = [
      { id:"THC",  label:"THC",     color:"#52B788", zones:["brain","eyes","lungs","heart","gut","muscles","joints","skin"], summary:"The primary psychoactive cannabinoid. Binds CB1 across nearly every body system — euphoria and pain relief centrally, anti-nausea and appetite in the gut, bronchodilation in lungs, IOP reduction in eyes. The most researched and commercially dominant cannabinoid." },
      { id:"CBD",  label:"CBD",     color:"#74C69D", zones:["brain","eyes","lungs","heart","gut","muscles","joints","skin"], summary:"The most therapeutically versatile cannabinoid. Non-psychoactive. Modulates CB1 rather than binding it directly. Anti-inflammatory systemically, neuroprotective in the brain, cardioprotective in the heart, sebostatic in skin, and FDA-approved for epilepsy." },
      { id:"CBG",  label:"CBG",     color:"#D4A853", zones:["brain","heart","gut","joints","skin"], summary:"The mother cannabinoid — precursor to THC and CBD. Neuroprotective in the brain, vasodilatory in the heart, powerfully anti-inflammatory in the gut (IBD specialist), osteogenic in joints, and antibacterial on skin. Non-psychoactive." },
      { id:"CBN",  label:"CBN",     color:"#9B7FD4", zones:["brain"], summary:"A THC degradation product. Mildly sedating via CB1 in the brain. Primarily active centrally — most relevant for sleep and mild pain relief. Forms as cannabis ages." },
      { id:"CBC",  label:"CBC",     color:"#5CA0E8", zones:["muscles","skin"], summary:"Non-psychoactive. Synergistic anti-inflammatory with CBD in muscle tissue. In skin, reduces lipogenesis in sebocytes and works alongside CBD for anti-acne effects. An entourage effect amplifier." },
      { id:"THCV", label:"THCV",    color:"#E07B39", zones:["brain","gut"], summary:"Opposite appetite effects to THC at low doses — suppresses appetite via CB1 antagonism in the gut. Produces mental clarity and short-duration energy in the brain. Rarest major cannabinoid — highest in African sativa landraces." },
    ];
    const _HOTSPOTS = [
      {id:"brain",   cx:100, cy:44,  color:"#9B7FD4", label:"Brain"},
      {id:"eyes",    cx:100, cy:57,  color:"#5CA0E8", label:"Eyes"},
      {id:"lungs",   cx:100, cy:118, color:"#52B788", label:"Lungs"},
      {id:"heart",   cx:88,  cy:130, color:"#E07B39", label:"Heart"},
      {id:"gut",     cx:100, cy:188, color:"#74C69D", label:"Gut"},
      {id:"muscles", cx:55,  cy:258, color:"#F4A261", label:"Muscles"},
      {id:"joints",  cx:68,  cy:335, color:"#C9973A", label:"Joints"},
      {id:"skin",    cx:148, cy:158, color:"#E8A87C", label:"Skin"}
    ];
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cannabinoids &amp; Your Body — Cannascenti Encyclopedia</title>
<meta name="description" content="THC, CBD, CBG, CBN, THCV, CBC and more — full profiles, interactive body map, and ratio guide. Everything you need to understand cannabinoids.">
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
/* ── Tab nav ── */
.cn-tabs{display:flex;gap:4px;margin-bottom:36px;border-bottom:1px solid rgba(255,255,255,0.07);padding-bottom:0}
.cn-tab{background:none;border:none;color:rgba(242,234,216,0.4);font-family:Montserrat,sans-serif;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:14px 20px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .2s}
.cn-tab:hover{color:rgba(242,234,216,0.8)}
.cn-tab.active{color:#52B788;border-bottom-color:#52B788}
.cn-panel{display:none}.cn-panel.active{display:block}
/* ── Cannabinoid cards ── */
.cb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}
.cb-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:28px;transition:border-color .2s}
.cb-card:hover{border-color:rgba(255,255,255,0.14)}
.cb-abbr{font-family:'Cormorant Garamond',serif;font-size:2.4rem;font-weight:300;margin-bottom:4px}
.cb-full{font-size:.78rem;color:rgba(242,234,216,0.35);margin-bottom:16px;letter-spacing:.05em;text-transform:uppercase}
.cb-psycho-track{height:5px;background:rgba(255,255,255,0.07);border-radius:3px;margin-bottom:5px;overflow:hidden}
.cb-psycho-fill{height:100%;border-radius:3px;transition:width .6s ease}
.cb-psycho-label{font-size:.7rem;color:rgba(242,234,216,0.3);margin-bottom:14px}
.cb-desc{font-size:.83rem;line-height:1.74;color:rgba(242,234,216,0.68);margin-bottom:16px}
.cb-uses{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.cb-use{font-size:.74rem;background:rgba(255,255,255,0.05);border-radius:6px;padding:3px 9px;color:rgba(242,234,216,0.55)}
.cb-found{font-size:.76rem;color:rgba(242,234,216,0.35);font-style:italic;border-top:1px solid rgba(255,255,255,0.05);padding-top:12px;margin-top:4px}
/* ── Body map ── */
.yb-main{display:grid;grid-template-columns:260px 1fr;gap:48px;align-items:start;margin-top:8px}
@media(max-width:800px){.yb-main{grid-template-columns:1fr}}
.yb-svg-wrap{position:sticky;top:80px}
.yb-svg-title{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:rgba(242,234,216,0.35);margin-bottom:16px;text-align:center}
.yb-svg-container{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:20px;padding:24px;display:flex;justify-content:center}
.yb-dot{cursor:pointer;transition:opacity .3s}
.yb-dot circle.pulse{animation:ybPulse 2s ease-in-out infinite}
@keyframes ybPulse{0%,100%{r:7;opacity:0.6}50%{r:11;opacity:0.15}}
.yb-dot.active circle.inner{fill:#52B788 !important}
.yb-dot.active circle.pulse{stroke:#52B788 !important}
.yb-dot.dim{opacity:0.18}
.yb-dot.highlight circle.inner{fill:#52B788 !important}
.yb-zone-tags{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:16px}
.yb-zone-tag{font-size:10px;letter-spacing:.07em;text-transform:uppercase;background:rgba(255,255,255,0.05);border-radius:6px;padding:3px 9px;color:rgba(242,234,216,0.5);cursor:pointer;border:1px solid rgba(255,255,255,0.07);transition:all .2s}
.yb-zone-tag:hover{border-color:rgba(82,183,136,0.4);color:#F2EAD8}
.yb-info{min-height:400px}
.yb-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:420px;text-align:center;color:rgba(242,234,216,0.25);gap:12px;border:1px dashed rgba(255,255,255,0.07);border-radius:20px}
.yb-placeholder-icon{font-size:2.5rem;opacity:0.3}
.yb-placeholder-text{font-size:.85rem;line-height:1.7}
.yb-zone-panel{display:none;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:20px;padding:32px}
.yb-zone-panel.active{display:block}
.yb-zone-name{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;margin-bottom:8px;color:#F2EAD8}
.yb-zone-receptors{font-size:.78rem;color:#52B788;background:rgba(82,183,136,0.08);border-radius:8px;padding:8px 14px;margin-bottom:16px;line-height:1.6}
.yb-zone-headline{font-size:.98rem;font-weight:600;color:#F2EAD8;margin-bottom:12px}
.yb-zone-desc{font-size:.84rem;line-height:1.82;color:rgba(242,234,216,0.63);margin-bottom:20px}
.yb-cb-pills{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:20px}
.yb-cb-pill{font-size:11px;font-weight:600;letter-spacing:.06em;border-radius:20px;padding:4px 13px;border:1px solid}
.yb-effects-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
@media(max-width:540px){.yb-effects-grid{grid-template-columns:1fr}}
.yb-effects-label{font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px}
.yb-effects-label.pos{color:#52B788}.yb-effects-label.neg{color:#C9973A}
.yb-effects-list{list-style:none}
.yb-effects-list li{font-size:.77rem;line-height:1.65;color:rgba(242,234,216,0.58);padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);padding-left:16px;position:relative}
.yb-effects-list.pos li::before{content:"+";position:absolute;left:0;color:#52B788;font-weight:700}
.yb-effects-list.neg li::before{content:"!";position:absolute;left:0;color:#C9973A;font-weight:700}
.yb-research{font-size:.76rem;line-height:1.72;color:rgba(242,234,216,0.38);border-left:2px solid rgba(82,183,136,0.22);padding-left:14px;font-style:italic}
/* Lens */
.yb-lens-section{margin-top:48px;padding-top:40px;border-top:1px solid rgba(255,255,255,0.06)}
.yb-lens-title{font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:300;color:#F2EAD8;margin-bottom:8px}
.yb-lens-title em{color:#52B788;font-style:italic}
.yb-lens-sub{font-size:.85rem;color:rgba(242,234,216,0.45);margin-bottom:20px;line-height:1.7;max-width:600px}
.yb-lens-pills{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:24px}
.yb-lens-btn{background:none;border:1px solid rgba(255,255,255,0.12);border-radius:24px;padding:8px 20px;color:rgba(242,234,216,0.6);font-family:Montserrat,sans-serif;font-size:12px;font-weight:600;letter-spacing:.08em;cursor:pointer;transition:all .2s}
.yb-lens-card{display:none;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:24px}
.yb-lens-card.active{display:block}
.yb-lens-card-name{font-family:'Cormorant Garamond',serif;font-size:1.4rem;margin-bottom:10px}
.yb-lens-card-summary{font-size:.85rem;line-height:1.78;color:rgba(242,234,216,0.62);margin-bottom:16px}
.yb-lens-zones{display:flex;flex-wrap:wrap;gap:8px}
.yb-lens-zone-tag{font-size:.78rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:4px 13px;color:rgba(242,234,216,0.6);cursor:pointer;transition:all .2s}
.yb-lens-zone-tag:hover{border-color:rgba(82,183,136,0.4);color:#F2EAD8}
/* ECS section */
.yb-ecs-section{background:rgba(255,255,255,0.015);border:1px solid rgba(255,255,255,0.06);border-radius:20px;padding:40px;margin-top:40px}
.yb-ecs-header{margin-bottom:28px}
.yb-ecs-title{font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:300;color:#F2EAD8;margin-bottom:8px}
.yb-ecs-title em{color:#52B788;font-style:italic}
.yb-ecs-sub{font-size:.86rem;color:rgba(242,234,216,0.45);line-height:1.78;max-width:600px}
.yb-ecs-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:680px){.yb-ecs-cards{grid-template-columns:1fr}}
.yb-ecs-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:24px}
.yb-ecs-card-icon{font-size:1.3rem;margin-bottom:12px;color:#52B788}
.yb-ecs-card-title{font-size:.9rem;font-weight:600;color:#F2EAD8;margin-bottom:8px}
.yb-ecs-card-body{font-size:.79rem;line-height:1.78;color:rgba(242,234,216,0.52)}
/* ── Ratios ── */
.ratio-intro{max-width:680px;margin-bottom:36px}
.ratio-intro p{font-size:.88rem;line-height:1.8;color:rgba(242,234,216,0.6)}
.ratio-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:18px}
.ratio-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:24px;transition:border-color .2s}
.ratio-card:hover{border-color:rgba(255,255,255,0.14)}
.ratio-card-top{display:flex;align-items:baseline;gap:12px;margin-bottom:4px;flex-wrap:wrap}
.ratio-value{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300}
.ratio-label{font-size:.78rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:rgba(242,234,216,0.5)}
.ratio-tag{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:20px;border:1px solid;margin-left:auto}
.ratio-bar-wrap{display:flex;height:6px;border-radius:3px;overflow:hidden;margin:12px 0 6px;background:rgba(255,255,255,0.06)}
.ratio-bar-thc{background:#52B788;height:100%}
.ratio-bar-cbd{background:#74C69D;height:100%}
.ratio-bar-other{background:#D4A853;height:100%}
.ratio-bar-labels{display:flex;gap:14px;margin-bottom:14px}
.ratio-bar-label{font-size:.68rem;color:rgba(242,234,216,0.35);display:flex;align-items:center;gap:5px}
.ratio-bar-label span{display:inline-block;width:8px;height:8px;border-radius:2px}
.ratio-desc{font-size:.82rem;line-height:1.74;color:rgba(242,234,216,0.65);margin-bottom:14px}
.ratio-uses{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px}
.ratio-use{font-size:.72rem;background:rgba(255,255,255,0.05);border-radius:5px;padding:2px 8px;color:rgba(242,234,216,0.5)}
.ratio-caution{font-size:.75rem;color:rgba(242,234,216,0.4);font-style:italic;border-top:1px solid rgba(255,255,255,0.05);padding-top:10px}
.ratio-strains{font-size:.74rem;color:rgba(82,183,136,0.6);margin-top:6px}
.ratio-special-badge{font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;background:rgba(212,168,83,0.15);color:#D4A853;border:1px solid rgba(212,168,83,0.3);padding:2px 8px;border-radius:10px;margin-left:8px}
</style>
</head>
<body>
${ENC_NAV}
<div class="enc-page">
  <div class="enc-page-header">
    <div class="enc-label">&#10022; Cannascenti Encyclopedia</div>
    <h1 class="enc-title">Cannabinoids &amp; Your <em>Body.</em></h1>
    <p class="enc-desc">THC is just the beginning. Explore every major cannabinoid, an interactive body map showing where each one acts, and a complete ratio guide for dialing in your experience.</p>
  </div>
  <div class="cn-tabs">
    <button class="cn-tab active" onclick="cnTab('cannabinoids',this)">Cannabinoids</button>
    <button class="cn-tab" onclick="cnTab('bodymap',this)">Body Map</button>
    <button class="cn-tab" onclick="cnTab('ratios',this)">Ratios &amp; Blends</button>
  </div>

  <!-- ── TAB: CANNABINOIDS ── -->
  <div class="cn-panel active" id="cnCannabinoids">
    <div class="cb-grid" id="cbGrid"></div>
  </div>

  <!-- ── TAB: BODY MAP ── -->
  <div class="cn-panel" id="cnBodymap">
    <div class="yb-main">
      <div class="yb-svg-wrap">
        <div class="yb-svg-title">Click a zone to explore</div>
        <div class="yb-svg-container">
          <svg viewBox="0 0 200 480" width="200" height="480" xmlns="http://www.w3.org/2000/svg">
            <ellipse cx="100" cy="32" rx="22" ry="26" fill="rgba(82,183,136,0.06)" stroke="rgba(82,183,136,0.18)" stroke-width="1"/>
            <rect x="93" y="56" width="14" height="14" rx="4" fill="rgba(82,183,136,0.05)" stroke="rgba(82,183,136,0.12)" stroke-width="1"/>
            <path d="M68,70 Q62,72 58,82 L52,160 Q52,168 60,170 L140,170 Q148,168 148,160 L142,82 Q138,72 132,70 Z" fill="rgba(82,183,136,0.05)" stroke="rgba(82,183,136,0.12)" stroke-width="1"/>
            <path d="M68,72 Q58,76 54,90 L46,178 Q44,188 50,190 L58,190 Q64,188 66,178 L70,100" fill="rgba(82,183,136,0.04)" stroke="rgba(82,183,136,0.1)" stroke-width="1"/>
            <path d="M132,72 Q142,76 146,90 L154,178 Q156,188 150,190 L142,190 Q136,188 134,178 L130,100" fill="rgba(82,183,136,0.04)" stroke="rgba(82,183,136,0.1)" stroke-width="1"/>
            <path d="M80,170 L72,300 Q70,310 74,318 L84,318 Q90,316 92,306 L96,170" fill="rgba(82,183,136,0.04)" stroke="rgba(82,183,136,0.1)" stroke-width="1"/>
            <path d="M120,170 L128,300 Q130,310 126,318 L116,318 Q110,316 108,306 L104,170" fill="rgba(82,183,136,0.04)" stroke="rgba(82,183,136,0.1)" stroke-width="1"/>
            <ellipse cx="78" cy="326" rx="10" ry="6" fill="rgba(82,183,136,0.04)" stroke="rgba(82,183,136,0.08)" stroke-width="1"/>
            <ellipse cx="122" cy="326" rx="10" ry="6" fill="rgba(82,183,136,0.04)" stroke="rgba(82,183,136,0.08)" stroke-width="1"/>
            <g id="yb-dots"></g>
          </svg>
        </div>
        <div class="yb-zone-tags" id="yb-zone-tags"></div>
      </div>
      <div class="yb-info">
        <div class="yb-placeholder" id="yb-placeholder">
          <div class="yb-placeholder-icon">&#9678;</div>
          <div class="yb-placeholder-text">Click a glowing dot on the body<br>or a zone tag below to begin</div>
        </div>
        <div id="yb-panels"></div>
      </div>
    </div>
    <!-- Cannabinoid Lens -->
    <div class="yb-lens-section">
      <div class="yb-lens-title">The <em>Cannabinoid</em> Lens</div>
      <p class="yb-lens-sub">Select a cannabinoid to highlight every body system where it is active and read its whole-body summary.</p>
      <div class="yb-lens-pills" id="yb-lens-pills"></div>
      <div id="yb-lens-cards"></div>
    </div>
    <!-- ECS -->
    <div class="yb-ecs-section">
      <div class="yb-ecs-header">
        <div class="yb-ecs-title">How the <em>ECS</em> Works</div>
        <p class="yb-ecs-sub">The endocannabinoid system is one of the most widespread receptor networks in the human body — and one of the least taught in medical schools.</p>
      </div>
      <div class="yb-ecs-cards">
        <div class="yb-ecs-card"><div class="yb-ecs-card-icon">&#9881;</div><div class="yb-ecs-card-title">What is the ECS?</div><div class="yb-ecs-card-body">The endocannabinoid system (ECS) is a retrograde signaling network — it works backwards from the receiving neuron to the sending neuron. When a neuron fires too strongly, the receiving cell produces endocannabinoids (anandamide, 2-AG) that travel back to suppress the signal. Cannabis cannabinoids fit this system because they are structurally similar to your body's own endocannabinoids.</div></div>
        <div class="yb-ecs-card"><div class="yb-ecs-card-icon">&#9679;</div><div class="yb-ecs-card-title">CB1 — The Psychoactive Pathway</div><div class="yb-ecs-card-body">CB1 receptors are concentrated in the central nervous system — brain and spinal cord. They regulate mood, memory, pain perception, appetite, and coordination. THC's binding to CB1 produces euphoria, altered time perception, and intoxication. CB1 is also present in peripheral tissues — heart, lungs, gut — where it governs autonomic functions.</div></div>
        <div class="yb-ecs-card"><div class="yb-ecs-card-icon">&#9675;</div><div class="yb-ecs-card-title">CB2 — The Immune Pathway</div><div class="yb-ecs-card-body">CB2 receptors are concentrated in immune tissues — spleen, tonsils, bone marrow, and immune cells throughout the body. They regulate inflammation, immune cell migration, and the body's response to injury. CB2 activation does not produce psychoactivity. CBD, CBG, and CBC all have CB2 affinity — which explains their anti-inflammatory profiles without intoxication.</div></div>
      </div>
    </div>
  </div>

  <!-- ── TAB: RATIOS ── -->
  <div class="cn-panel" id="cnRatios">
    <div class="ratio-intro">
      <p>The ratio of THC to CBD — and increasingly to CBG, CBN, or THCV — determines the character of the experience more than any single cannabinoid alone. From a 30:1 THC-dominant experience to a 1:30 hemp-level CBD formulation, each ratio has a distinct therapeutic and recreational profile. Blended ratios like 10:10:10 (THC:CBD:CBG) represent the frontier of cannabinoid formulation science.</p>
    </div>
    <div class="ratio-grid" id="ratioGrid"></div>
  </div>
</div>

<script>
var CB = ${JSON.stringify(_CB)};
var RATIOS = ${JSON.stringify(_RATIOS)};
var ZONES = ${JSON.stringify(_ZONES)};
var CB_INFO = ${JSON.stringify(_CB_INFO)};
var HOTSPOTS = ${JSON.stringify(_HOTSPOTS)};
var CB_COLORS = {THC:'#52B788',CBD:'#74C69D',CBG:'#D4A853',CBN:'#9B7FD4',CBC:'#5CA0E8',THCV:'#E07B39',THCA:'#9B7FD4',CBDA:'#B7E4C7','Δ8-THC':'#A78BFA','Δ10-THC':'#F472B6'};
var selectedLens = null;

function cnTab(id, btn) {
  document.querySelectorAll('.cn-tab').forEach(function(t){t.classList.remove('active');});
  document.querySelectorAll('.cn-panel').forEach(function(p){p.classList.remove('active');});
  btn.classList.add('active');
  document.getElementById('cn'+id.charAt(0).toUpperCase()+id.slice(1)).classList.add('active');
  if (id==='bodymap') { initDots(); renderPanels(); renderLens(); }
  if (id==='ratios') renderRatios();
}

// ── Cannabinoid cards ──
document.getElementById('cbGrid').innerHTML = CB.map(function(c){
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

// ── Ratios ──
function renderRatios() {
  var el = document.getElementById('ratioGrid');
  if (el.innerHTML) return;
  el.innerHTML = RATIOS.map(function(r) {
    var total = r.thc + r.cbd + (r.isSpecial ? r.thc : 0); // approximate
    var thcPct = Math.round((r.thc / (r.thc + r.cbd)) * 100);
    var cbdPct = 100 - thcPct;
    var col = r.color || '#52B788';
    var isSpecial = r.isSpecial;
    return '<div class="ratio-card">'+
      '<div class="ratio-card-top">'+
        '<span class="ratio-value" style="color:'+col+'">'+(isSpecial ? r.ratio : r.ratio+' THC:CBD')+'</span>'+
        (isSpecial ? '<span class="ratio-special-badge">Multi</span>' : '')+
        '<span class="ratio-tag" style="color:'+col+';border-color:'+col+'55;background:'+col+'12">'+r.tag+'</span>'+
      '</div>'+
      '<div style="font-size:.8rem;font-weight:600;color:rgba(242,234,216,0.5);margin-bottom:10px;letter-spacing:.04em">'+r.label+'</div>'+
      (isSpecial ? '' :
        '<div class="ratio-bar-wrap">'+
          '<div class="ratio-bar-thc" style="width:'+thcPct+'%"></div>'+
          '<div class="ratio-bar-cbd" style="width:'+cbdPct+'%"></div>'+
        '</div>'+
        '<div class="ratio-bar-labels">'+
          '<span class="ratio-bar-label"><span style="background:#52B788"></span>THC '+thcPct+'%</span>'+
          '<span class="ratio-bar-label"><span style="background:#74C69D"></span>CBD '+cbdPct+'%</span>'+
        '</div>'
      )+
      '<p class="ratio-desc">'+r.desc+'</p>'+
      '<div class="ratio-uses">'+r.uses.map(function(u){return '<span class="ratio-use">'+u+'</span>';}).join('')+'</div>'+
      '<div class="ratio-caution">&#9888; '+r.caution+'</div>'+
      '<div class="ratio-strains">&#9670; Example strains: '+r.strains+'</div>'+
    '</div>';
  }).join('');
}

// ── Body map ──
var _bodyInit = false;
function initDots() {
  if (_bodyInit) return; _bodyInit = true;
  var svgNS = 'http://www.w3.org/2000/svg';
  var dotsG = document.getElementById('yb-dots');
  var tagsDiv = document.getElementById('yb-zone-tags');
  if (!dotsG) return;
  // Use createElementNS + addEventListener — inline onclick on SVG via innerHTML is unreliable
  HOTSPOTS.forEach(function(h) {
    var g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', 'yb-dot');
    g.setAttribute('id', 'dot-'+h.id);
    g.style.cursor = 'pointer';
    var pulse = document.createElementNS(svgNS, 'circle');
    pulse.setAttribute('class', 'pulse');
    pulse.setAttribute('cx', h.cx); pulse.setAttribute('cy', h.cy);
    pulse.setAttribute('r', '7'); pulse.setAttribute('fill', 'none');
    pulse.setAttribute('stroke', h.color); pulse.setAttribute('stroke-width', '1.5');
    var inner = document.createElementNS(svgNS, 'circle');
    inner.setAttribute('class', 'inner');
    inner.setAttribute('cx', h.cx); inner.setAttribute('cy', h.cy);
    inner.setAttribute('r', '4.5'); inner.setAttribute('fill', h.color);
    inner.setAttribute('opacity', '0.9');
    var title = document.createElementNS(svgNS, 'title');
    title.textContent = h.label;
    g.appendChild(pulse); g.appendChild(inner); g.appendChild(title);
    g.addEventListener('click', (function(id){ return function(){ selectZone(id); }; })(h.id));
    dotsG.appendChild(g);
  });
  if (tagsDiv) {
    tagsDiv.innerHTML = '';
    HOTSPOTS.forEach(function(h) {
      var span = document.createElement('span');
      span.className = 'yb-zone-tag';
      span.textContent = h.label;
      span.addEventListener('click', (function(id){ return function(){ selectZone(id); }; })(h.id));
      tagsDiv.appendChild(span);
    });
  }
}
function renderPanels() {
  var el = document.getElementById('yb-panels');
  if (!el || el.innerHTML) return;
  el.innerHTML = ZONES.map(function(z){
    var cbPills = z.cannabinoids.map(function(c){
      var col = CB_COLORS[c]||'#52B788';
      return '<span class="yb-cb-pill" style="color:'+col+';border-color:'+col+'55;background:'+col+'18">'+c+'</span>';
    }).join('');
    var posItems = z.positive.map(function(e){return '<li>'+e+'</li>';}).join('');
    var negItems = z.negative.map(function(e){return '<li>'+e+'</li>';}).join('');
    return '<div class="yb-zone-panel" id="yb-panel-'+z.id+'">'+
      '<div class="yb-zone-name">'+z.label+'</div>'+
      '<div class="yb-zone-receptors">'+z.receptors+'</div>'+
      '<div class="yb-zone-headline">'+z.headline+'</div>'+
      '<p class="yb-zone-desc">'+z.desc+'</p>'+
      '<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:rgba(242,234,216,0.3);margin-bottom:8px">Active cannabinoids</div>'+
      '<div class="yb-cb-pills">'+cbPills+'</div>'+
      '<div class="yb-effects-grid">'+
        '<div><div class="yb-effects-label pos">Benefits</div><ul class="yb-effects-list pos">'+posItems+'</ul></div>'+
        '<div><div class="yb-effects-label neg">Considerations</div><ul class="yb-effects-list neg">'+negItems+'</ul></div>'+
      '</div>'+
      '<p class="yb-research">'+z.research+'</p>'+
    '</div>';
  }).join('');
}
function renderLens() {
  var pillsEl = document.getElementById('yb-lens-pills');
  if (!pillsEl || pillsEl.innerHTML) return;
  pillsEl.innerHTML = CB_INFO.map(function(cb){
    var col = CB_COLORS[cb.id]||'#52B788';
    return '<button class="yb-lens-btn" id="lens-btn-'+cb.id+'" onclick="activateLens(\\''+cb.id+'\\''+')" style="border-color:'+col+'55">'+cb.label+'</button>';
  }).join('');
  document.getElementById('yb-lens-cards').innerHTML = CB_INFO.map(function(cb){
    var col = CB_COLORS[cb.id]||'#52B788';
    var zoneTags = cb.zones.map(function(zid){
      var zone = ZONES.find(function(zz){return zz.id===zid;});
      return '<span class="yb-lens-zone-tag" onclick="selectZone(\\''+zid+'\\')">'+( zone?zone.label:zid )+'</span>';
    }).join('');
    return '<div class="yb-lens-card" id="lens-card-'+cb.id+'">'+
      '<div class="yb-lens-card-name" style="color:'+col+'">'+cb.label+' &mdash; System Overview</div>'+
      '<p class="yb-lens-card-summary">'+cb.summary+'</p>'+
      '<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:rgba(242,234,216,0.3);margin-bottom:10px">Active in these systems</div>'+
      '<div class="yb-lens-zones">'+zoneTags+'</div>'+
    '</div>';
  }).join('');
}
function selectZone(id){
  document.getElementById('yb-placeholder').style.display='none';
  document.querySelectorAll('.yb-dot').forEach(function(d){d.classList.remove('active','dim');d.classList.add('dim');});
  var dot = document.getElementById('dot-'+id);
  if(dot){dot.classList.remove('dim');dot.classList.add('active');}
  document.querySelectorAll('.yb-zone-panel').forEach(function(p){p.classList.remove('active');});
  var panel = document.getElementById('yb-panel-'+id);
  if(panel){panel.classList.add('active');panel.scrollIntoView({behavior:'smooth',block:'nearest'});}
  if(selectedLens) applyLens(selectedLens);
}
function activateLens(cbId){
  selectedLens=cbId;
  document.querySelectorAll('.yb-lens-btn').forEach(function(b){b.style.background='';b.style.color='rgba(242,234,216,0.6)';});
  document.querySelectorAll('.yb-lens-card').forEach(function(c){c.classList.remove('active');});
  var col=CB_COLORS[cbId]||'#52B788';
  var btn=document.getElementById('lens-btn-'+cbId);
  if(btn){btn.style.background=col;btn.style.color='#060d0a';}
  var card=document.getElementById('lens-card-'+cbId);
  if(card) card.classList.add('active');
  applyLens(cbId);
}
function applyLens(cbId){
  var cb=CB_INFO.find(function(c){return c.id===cbId;});
  if(!cb) return;
  HOTSPOTS.forEach(function(h){
    var dot=document.getElementById('dot-'+h.id);
    if(!dot) return;
    dot.classList.remove('dim','highlight');
    if(cb.zones.indexOf(h.id)>=0){dot.classList.add('highlight');}else{dot.classList.add('dim');}
  });
}
// Initialize body map on load (don't wait for tab click)
document.addEventListener('DOMContentLoaded', function() {
  renderPanels(); renderLens(); initDots();
  if(window.location.hash==='#body-map'){
    var bodyTab = document.querySelector('.cn-tab:nth-child(2)');
    if (bodyTab) bodyTab.click();
  }
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
<meta name="description" content="Smoking, vaping, edibles, tinctures, topicals — onset times, bioavailability, duration, pros and cons for every cannabis consumption method compared side by side.">
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
    const _ENVIRONMENTS = [
      { id:"indoor", icon:"&#128161;", label:"Indoor", tagline:"Total control. Year-round. Best quality.", pros:["Year-round growing — no seasonal limits","Complete environment control (temp, humidity, CO2, light spectrum)","Highest potency and trichome density achievable","Privacy and security","Multiple harvests per year"], cons:["Significant setup cost (lights, fans, tent or room, HVAC)","Ongoing electricity costs — even LEDs draw 200–600W","Requires active daily monitoring","Lower yield per plant than outdoor"], lights:"LED preferred — 150–200W per m². Full-spectrum quantum board LEDs deliver the best yield-per-watt ratio. HPS still viable but runs hot and less efficient.", temp:"70–80°F (21–27°C) lights-on. 10°F drop at night encourages terpene and anthocyanin development in late flower.", humidity:"Seedling 65–70%. Veg 50–70%. Flower 40–50%. Late flower 40–45% to prevent bud rot in dense colas.", strains:["OG Kush","White Widow","Gorilla Glue #4","Wedding Cake","Gelato","Girl Scout Cookies"] },
      { id:"outdoor", icon:"&#9728;", label:"Outdoor", tagline:"Free sunlight. Massive yields. Seasonal.", pros:["Free, full-spectrum natural sunlight","Highest possible yield per plant","Lowest cost of entry by far","Largest plants achievable — 10+ feet possible","Natural terpene complexity from real sun cycles"], cons:["Seasonal — one main harvest per year in most climates","Weather and climate dependent","Privacy concerns depending on jurisdiction","Pest and pathogen exposure","No control over light cycle — season triggers flowering"], lights:"Natural sunlight — free and unbeatable. Plants need 6+ hours of direct sun minimum. South-facing slopes or hillsides maximize exposure.", temp:"Ideal 65–85°F. Sensitive to frost — plant after last frost date in spring, harvest before first fall frost.", humidity:"Ambient. High-humidity regions require mold-resistant genetics (fast finishers, loose bud structure). Arid climates need consistent irrigation.", strains:["Blue Dream","Durban Poison","Zkittlez","Trainwreck","Sour Diesel","Jack Herer"] },
      { id:"greenhouse", icon:"&#127969;", label:"Greenhouse", tagline:"Best of both. Most cost-effective.", pros:["Free sunlight with full climate protection","Extended season — plant earlier, harvest later than outdoor","Most cost-effective setup for premium quality","Weather protection without full HVAC cost","Light deprivation allows multiple harvests per year"], cons:["Upfront construction or purchase cost","Heat management in summer requires active venting","Less precise control than full indoor","Humidity accumulates — requires active management"], lights:"Free solar during the day. Supplemental LED for early-season starts. Light deprivation tarps enable photoperiod control for year-round harvest.", temp:"Sun-regulated naturally. Shade cloth and ridge vents manage summer heat. Propane or electric heaters extend the season into cooler months.", humidity:"Monitor and vent actively. Oscillating fans and ridge vents are essential. Greenhouse humidity builds faster than open outdoor.", strains:["Northern Lights","Gelato","Amnesia Haze","Strawberry Cough","Auto-flowering varieties","Zkittlez"] }
    ];
    const _TECHNIQUES = [
      { id:"lst", level:"beginner", name:"LST — Low Stress Training", short:"Bend and tie branches horizontally to expose lower bud sites directly to the light source. Creates a wide, even canopy without any cutting.", benefit:"Up to 30% yield increase by maximizing the number of bud sites receiving direct light. Zero recovery time — the plant continues growing during training.", howto:"During veg, gently bend the main stem and side branches outward and downward. Secure with soft plant ties or garden wire to stakes inserted at the pot rim. As new growth emerges upright, continue bending it outward. A little bending each day is better than forcing a large bend all at once." },
      { id:"topping", level:"beginner", name:"Topping", short:"Cut the main apical stem cleanly at the 5th node. This removes apical dominance and forces the plant to grow two equal main colas from the two nodes below the cut.", benefit:"Doubles main cola count immediately. Combined with a second topping, creates four mains. A cornerstone technique for increasing total yield indoors.", howto:"Using sterilized scissors, cut the main stem cleanly between the 5th and 6th node during mid-veg. Wait 5–7 days for the two new growth tips to emerge and strengthen before applying any additional stress. The plant will look stalled briefly — this is normal recovery." },
      { id:"fim", level:"beginner", name:"FIM — F*** I Missed", short:"Pinch or cut approximately 70–80% of the new growth tip, leaving the bottom 20–30% intact. Creates 4 new colas instead of the 2 produced by full topping.", benefit:"Produces 4 main colas with less plant stress and faster recovery than full topping. Gentler and faster — ideal for impatient growers.", howto:"Identify the newest growth tip when 4–5 small leaves are just emerging. Pinch or snip 70–80% of that new growth cluster — do not cut the full stem. The remaining base will divide into 4 new growth tips over 5–8 days." },
      { id:"scrog", level:"intermediate", name:"SCROG — Screen of Green", short:"Install a horizontal net or screen 10–12 inches above the pot tops. Weave branches through the net laterally as they grow up, creating a completely flat and even canopy.", benefit:"Maximizes the number of bud sites in the prime light zone directly beneath your fixtures. Dramatically improves light efficiency in square-footage-limited indoor grows.", howto:"Install a net or trellis screen 10–12 inches above the pots before plants reach it. During late veg, gently push branches through net openings and weave them horizontally. Tuck any vertical growth back under the screen. Flip to 12/12 flower when the screen is 70–80% filled." },
      { id:"sog", level:"intermediate", name:"SOG — Sea of Green", short:"Grow many small plants and flip to flower very early — at 2–3 weeks of veg — so each plant becomes essentially one large main cola. Pack plants tightly to fill the canopy.", benefit:"Fastest possible harvest cycles. Maximum use of your light footprint. Ideal for cloning operations and auto-flowering strains.", howto:"Start plants in 1–2 gallon containers. Flip to 12/12 light cycle when plants are 6–10 inches tall. Pack 4–16 plants per square meter depending on pot size. Remove lower growth that will not reach the canopy. Harvest the entire table at once." },
      { id:"supercropping", level:"intermediate", name:"Super Cropping", short:"Pinch and gently crush the inner tissue of a thick stem at the target bending point, then slowly bend 90 degrees. A reinforced knuckle forms at the bend as it heals.", benefit:"Creates multiple low-effort bending points without cutting. The healed knuckle delivers more nutrient flow to the branch. Excellent for controlling tall plants in height-limited spaces.", howto:"Find the stem section to bend. Firmly pinch between thumb and forefinger and roll gently back and forth to soften the inner pith without tearing the outer skin. Slowly bend to 90 degrees — support with a stake if needed. The knuckle forms and hardens within 5–7 days and becomes stronger than the original stem." },
      { id:"lollipopping", level:"intermediate", name:"Lollipopping", short:"Remove all lower growth — leaves, branches, and bud sites — below the main canopy line. Concentrates the plant's energy entirely on the top colas that receive direct light.", benefit:"Focuses all growth energy on the highest-quality top buds. Dramatically improves airflow in the lower canopy — critical for preventing bud rot. Produces larger, denser upper colas.", howto:"At week 3 of flower, identify the lower 25–30% of the plant. Remove all branches, growth tips, and large fan leaves in that zone working from the bottom up. Do not remove more than 30% of total foliage in one session — spread the work over 3–4 days to minimize stress." },
      { id:"defoliation", level:"intermediate", name:"Strategic Defoliation", short:"Selectively remove fan leaves that are blocking light from reaching bud sites below, or crowding airflow channels within the canopy. Not a wholesale strip — a targeted edit.", benefit:"Improves light penetration to lower bud sites. Reduces canopy humidity and mold risk. The plant's mild stress response temporarily increases terpene production.", howto:"Perform two defoliation passes: one at week 3 of flower and one at week 6. Remove only fan leaves that are directly blocking bud sites or impeding airflow. Remove no more than 20–25% of leaves per session. The fan leaves are the plant's solar panels — less is always more." },
      { id:"manifolding", level:"advanced", name:"Manifolding / Mainlining", short:"A precise multi-step technique using sequential topping and symmetrical LST to produce a perfectly even 8-cola structure from a single plant where every cola receives identical light and nutrients.", benefit:"Produces extremely predictable, even yields with 8 near-identical top colas per plant. Maximizes light efficiency for indoor grows. The most structured training method available.", howto:"Top at the 3rd node. Remove all growth below the 2nd node — leave only the two growth tips at node 2. Once both tips have 3 nodes each, top both again at their 3rd nodes. Tie all 4 resulting branches outward symmetrically. Top once more to produce the final 8 even branches. Allow full 7-day recovery between each topping." },
      { id:"rdwc", level:"advanced", name:"RDWC Hydroponics", short:"Recirculating Deep Water Culture. Plant roots are suspended directly in oxygenated, pH-controlled nutrient solution. A pump continuously recirculates solution through multiple connected buckets.", benefit:"20–30% faster vegetative growth than soil. Maximum nutrient uptake efficiency. Largest yields achievable in indoor cultivation. The highest-performance grow system available.", howto:"Connect DWC buckets via tubing to a central reservoir. Maintain nutrient solution EC at 0.5–0.8 in seedling, scaling to 1.4–2.0 in peak flower. pH must stay at 5.5–6.2 — check daily. Keep dissolved oxygen high with large air stones. Reservoir temperature must stay below 68°F to prevent pythium root rot." },
      { id:"kno", level:"advanced", name:"Korean Natural Farming — Living Soil", short:"Build a biologically active soil ecosystem using fermented plant extracts, compost teas, and diverse microbial inoculants. The soil microbiome feeds the plant — no synthetic nutrients required.", benefit:"Produces the most complex, layered terpene profiles achievable. No synthetic nutrient cost at scale. Regenerative — the same soil improves with each successive grow cycle. Exceptional finished flavor and aroma.", howto:"Start with a quality living soil mix: compost, worm castings, perlite, rock dust, and biochar. Inoculate with mycorrhizal fungi and beneficial bacteria at transplant. Water with aerated compost teas weekly. Supplement with fermented plant juice (FPJ) during veg and fermented fruit juice (FFJ) during flower. Water gently — preserve soil structure and microbial habitat." }
    ];
    const _CULTURES = [
      { region:"Emerald Triangle, California", flag:"&#127482;&#127480;", style:"Craft Sun-Grown Outdoor", badge:"Legacy", strains:["OG Kush","Trainwreck","Wedding Cake","SFV OG"], desc:"The birthplace of American cannabis culture. Three counties — Humboldt, Trinity, and Mendocino — produce the most celebrated outdoor cannabis in the world. Mediterranean climate, rich old-growth soil, and 3000+ ft elevation create ideal growing conditions. Small craft farms hand-trim and sun-cure. A legal gray area for decades shaped a culture of deep horticultural expertise and fierce strain stewardship that no commercial operation has replicated." },
      { region:"Amsterdam, Netherlands", flag:"&#127475;&#127473;", style:"Commercial Technical Indoor", badge:"Breeding Hub", strains:["White Widow","AK-47","Amnesia Haze","Super Silver Haze"], desc:"Low natural light forced Dutch growers to master indoor cultivation long before the rest of the world caught up. The coffeeshop system created commercial demand for consistent, high-quality product. Green House Seeds, Sensi Seeds, and Dutch Passion pioneered modern cannabis breeding and the global seed bank industry. Sea of Green technique was largely developed here. Amsterdam remains the center of cannabis genetics and horticultural innovation." },
      { region:"British Columbia, Canada", flag:"&#127464;&#127462;", style:"Boutique Premium Indoor", badge:"Craft Indoor", strains:["Pink Kush","Death Bubba","Rockstar","BC Big Bud"], desc:"BC Bud is internationally respected as some of the finest indoor cannabis produced anywhere. Cool climate drove innovation in artificial cultivation. The province developed a culture of high-end craft indoor growing — meticulous genetics selection, dialed environments, and long slow cures. Post-legalization, BC craft producers set the standard for premium packaged cannabis in Canada's regulated market." },
      { region:"Rif Mountains, Morocco", flag:"&#127474;&#127462;", style:"Traditional Hash Production", badge:"Hash Heritage", strains:["Beldia (Ketama landrace)","Local Rif landraces"], desc:"Morocco produces more hashish by volume than any other nation. Landrace Beldia and Ketama strains grow semi-wild at altitude throughout the Rif. Dry-sieve kief is pressed into slabs using techniques unchanged for centuries. Family farms have cultivated these plants for generations. Kif — raw cannabis mixed with black tobacco and smoked in a sebsi pipe — is a traditional Moroccan social practice. Hash export is the region's primary agricultural economy." },
      { region:"Bekaa Valley, Lebanon", flag:"&#127473;&#127463;", style:"Old-World Hash", badge:"Legendary Hash", strains:["Lebanese Red","Lebanese Blonde"], desc:"Lebanese Red and Lebanese Blonde were the benchmark hash varieties of 1960s–70s counterculture — a quality standard that shaped a generation's expectations. Cold water and dry-sieve methods produced compressed red and blonde slabs with distinctive terroir-specific flavor profiles. Civil war in the 1980s devastated production. The tradition is experiencing a revival as international interest in heritage cannabis genetics and artisanal hash grows." },
      { region:"Hindu Kush, Afghanistan & Pakistan", flag:"&#127462;&#127467;", style:"Hand-Rubbed Charas", badge:"Ancient Tradition", strains:["Afghani","Mazar-i-Sharif","Hindu Kush"], desc:"The Hindu Kush mountain range is the genetic source of indica cannabis for the entire world. Hash has been produced here for over 3000 years. Hand-rubbed charas — made by rolling live resinous flowers between the palms — is the original concentrate. Afghan indica genetics (short, dense, resin-heavy plants adapted to harsh mountain climate) became the foundation for virtually all modern indica and hybrid breeding programs globally." },
      { region:"Blue Mountains, Jamaica", flag:"&#127471;&#127474;", style:"Mountain Sativa Outdoor", badge:"Cultural Heritage", strains:["Lamb's Bread","Jamaican Lambsbread"], desc:"Lamb's Bread — most famously associated with Bob Marley — grows in Jamaica's Blue Mountains as a pure, long-season mountain sativa. Cannabis (ganja) is a sacrament in Rastafari, used in nyabinghi ceremonies for meditation and reasoning. Jamaican genetics shaped the sativa imports that reached the American market in the 1970s. Jamaica legalized personal use in 2015 and now cultivates a legal medical market built on its unique landrace heritage." },
      { region:"Colorado, USA", flag:"&#127482;&#127480;", style:"Commercial Recreational Indoor", badge:"Legal Pioneer", strains:["Ghost Train Haze","Gorilla Glue","Bruce Banner","Chemdawg"], desc:"Colorado legalized adult-use cannabis in 2012 — the first US state to do so. The regulatory framework developed in Denver became the blueprint for legal cannabis markets worldwide. Retail cannabis prices dropped 70% between 2012 and 2020 as supply scaled — while average potency and product quality simultaneously improved through intense commercial breeding competition. Colorado remains the testing ground for cannabis policy, product innovation, and consumption science." }
    ];
    const _STRAINS_GUIDE = [
      { name:"Northern Lights", env:"Indoor / Both", difficulty:"Beginner", yield:"High", flower:"7–9 weeks", notes:"The most forgiving strain in cannabis. Resilient to overwatering, underfeeding, and humidity swings. Compact indica structure. The definitive first-grow strain." },
      { name:"Blue Dream", env:"Outdoor / Greenhouse", difficulty:"Beginner", yield:"Very High", flower:"9–10 weeks", notes:"Easy outdoor giant. Vigorous, disease-resistant, forgiving. Balanced hybrid. Thrives with minimal intervention in most climates." },
      { name:"White Widow", env:"Indoor / Both", difficulty:"Beginner", yield:"Medium", flower:"8–9 weeks", notes:"Classic Dutch genetics. Resilient and highly trainable. Excellent for learning topping and LST. Consistent resin production in any environment." },
      { name:"Gorilla Glue #4", env:"Indoor / Both", difficulty:"Intermediate", yield:"Very High", flower:"8–9 weeks", notes:"Heavy producer requiring branch support due to cola weight. Extremely resinous — gloves are mandatory at harvest. Worth the extra management." },
      { name:"Amnesia Haze", env:"Outdoor / Greenhouse", difficulty:"Intermediate", yield:"High", flower:"10–11 weeks", notes:"Needs space and sun — a tall sativa reaching 2m+ outdoors. Longer flower time than most. Rewards patience with exceptional terpene complexity." },
      { name:"Wedding Cake", env:"Indoor", difficulty:"Advanced", yield:"High", flower:"9–10 weeks", notes:"Demanding but produces extraordinary quality. Sensitive to nutrient levels, requires dialed conditions. Best suited to growers with two or more successful grows." }
    ];
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cultivation — Cannascenti Encyclopedia</title>
<meta name="description" content="The definitive cannabis cultivation guide: environment selection, seed-to-harvest growth stages, training techniques, global growing cultures, and beginner strain recommendations.">
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
.gr-hero{padding:72px 32px 56px;max-width:1100px;margin:0 auto}
.gr-hero-label{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#52B788;margin-bottom:16px}
.gr-hero-title{font-family:'Cormorant Garamond',serif;font-size:clamp(2.2rem,5vw,3.8rem);font-weight:300;color:#F2EAD8;line-height:1.1;margin-bottom:16px}
.gr-hero-title em{color:#52B788;font-style:italic}
.gr-hero-sub{font-size:.95rem;color:rgba(242,234,216,0.55);max-width:620px;line-height:1.8}
.gr-section{max-width:1100px;margin:0 auto;padding:0 32px 72px}
.gr-sec-title{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;color:#F2EAD8;margin-bottom:8px}
.gr-sec-title em{color:#52B788;font-style:italic}
.gr-sec-sub{font-size:.86rem;color:rgba(242,234,216,0.45);margin-bottom:28px;line-height:1.7;max-width:640px}
.env-tabs{display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap}
.env-tab{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 22px;color:rgba(242,234,216,0.6);font-family:Montserrat,sans-serif;font-size:11px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .2s}
.env-tab.active,.env-tab:hover{border-color:#52B788;color:#F2EAD8;background:rgba(82,183,136,0.08)}
.env-panel{display:none;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:18px;padding:36px}
.env-panel.active{display:block}
.env-panel-header{display:flex;align-items:center;gap:16px;margin-bottom:8px}
.env-label{font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:300;color:#F2EAD8}
.env-tagline{font-size:.88rem;color:#52B788;margin-bottom:24px;font-style:italic}
.env-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
@media(max-width:560px){.env-grid{grid-template-columns:1fr}}
.env-col-label{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:rgba(242,234,216,0.32);margin-bottom:8px}
.env-list{list-style:none}
.env-list li{font-size:.82rem;color:rgba(242,234,216,0.62);padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);padding-left:16px;position:relative}
.env-list.pro li::before{content:"+";position:absolute;left:0;color:#52B788;font-weight:700}
.env-list.con li::before{content:"&#8722;";position:absolute;left:0;color:#C9973A;font-weight:700}
.env-spec{background:rgba(255,255,255,0.03);border-radius:10px;padding:12px 16px;font-size:.8rem;color:rgba(242,234,216,0.58);line-height:1.65;margin-bottom:10px}
.env-spec strong{color:#52B788}
.env-strains{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.env-strain-tag{font-size:.75rem;background:rgba(82,183,136,0.08);border:1px solid rgba(82,183,136,0.18);color:#52B788;border-radius:6px;padding:3px 10px}
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
.stage-tips li::before{content:"&#8594;";position:absolute;left:0;color:#52B788;font-size:.7rem}
.stage-watch{font-size:.79rem;color:rgba(232,168,76,0.8);background:rgba(232,168,76,0.06);border-radius:8px;padding:8px 12px;margin-bottom:10px}
.stage-tip{font-size:.79rem;line-height:1.6;color:rgba(242,234,216,0.45);border-left:2px solid rgba(82,183,136,0.3);padding-left:12px;font-style:italic}
.level-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px}
.level-btn{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 18px;color:rgba(242,234,216,0.6);font-family:Montserrat,sans-serif;font-size:11px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .2s}
.level-btn.active,.level-btn:hover{border-color:#52B788;color:#F2EAD8;background:rgba(82,183,136,0.08)}
.tech-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.tech-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:24px;transition:border-color .2s}
.tech-card:hover{border-color:rgba(82,183,136,0.3)}
.tech-card.hidden{display:none}
.tech-level{font-size:10px;letter-spacing:.1em;text-transform:uppercase;border-radius:20px;padding:2px 10px;margin-bottom:12px;display:inline-block}
.tech-level.beginner{background:rgba(82,183,136,0.12);color:#52B788}
.tech-level.intermediate{background:rgba(201,151,58,0.12);color:#C9973A}
.tech-level.advanced{background:rgba(224,123,57,0.12);color:#E07B39}
.tech-name{font-family:'Cormorant Garamond',serif;font-size:1.2rem;color:#F2EAD8;margin-bottom:8px}
.tech-short{font-size:.82rem;line-height:1.72;color:rgba(242,234,216,0.6);margin-bottom:12px}
.tech-benefit{font-size:.78rem;color:#52B788;background:rgba(82,183,136,0.07);border-radius:8px;padding:7px 12px;margin-bottom:12px;line-height:1.6}
.tech-howto{font-size:.78rem;line-height:1.72;color:rgba(242,234,216,0.43);border-left:2px solid rgba(82,183,136,0.2);padding-left:12px;font-style:italic}
.culture-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.culture-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:24px}
.culture-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px}
.culture-region{font-size:.85rem;font-weight:600;color:#F2EAD8;margin-bottom:4px}
.culture-style-lbl{font-size:.73rem;color:rgba(242,234,216,0.38)}
.culture-badge{font-size:10px;letter-spacing:.08em;text-transform:uppercase;background:rgba(82,183,136,0.1);color:#52B788;border-radius:20px;padding:2px 10px;white-space:nowrap;flex-shrink:0;margin-left:8px}
.culture-strains{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px}
.culture-strain{font-size:.72rem;background:rgba(255,255,255,0.05);border-radius:5px;padding:2px 8px;color:rgba(242,234,216,0.52)}
.culture-desc{font-size:.78rem;line-height:1.72;color:rgba(242,234,216,0.48)}
.strain-table{width:100%;border-collapse:collapse}
.strain-table th{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(242,234,216,0.32);padding:8px 12px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.06)}
.strain-table td{font-size:.82rem;color:rgba(242,234,216,0.62);padding:12px;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:top}
.strain-table tr:hover td{background:rgba(255,255,255,0.02)}
.s-name{font-weight:600;color:#F2EAD8}
.s-diff{font-size:10px;letter-spacing:.07em;text-transform:uppercase;border-radius:20px;padding:2px 9px}
.s-diff.beginner{background:rgba(82,183,136,0.12);color:#52B788}
.s-diff.intermediate{background:rgba(201,151,58,0.12);color:#C9973A}
.s-diff.advanced{background:rgba(224,123,57,0.12);color:#E07B39}
.s-notes{font-size:.74rem;color:rgba(242,234,216,0.38);font-style:italic}
.gr-philosophy{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
@media(max-width:680px){.gr-philosophy{grid-template-columns:1fr}}
.phil-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:30px}
.phil-icon{font-size:1.8rem;margin-bottom:16px}
.phil-title{font-family:'Cormorant Garamond',serif;font-size:1.3rem;color:#F2EAD8;margin-bottom:10px}
.phil-body{font-size:.82rem;line-height:1.82;color:rgba(242,234,216,0.48)}
.gr-divider{border:none;border-top:1px solid rgba(255,255,255,0.06);margin:0 32px}
</style>
</head>
<body>
${ENC_NAV}
<div class="gr-hero">
  <div class="gr-hero-label">&#10022; Cannascenti Encyclopedia</div>
  <h1 class="gr-hero-title">The Art &amp; Science of<br><em>Cannabis Cultivation.</em></h1>
  <p class="gr-hero-sub">From seed to harvest — a comprehensive guide to growing cannabis: environment selection, every stage of the plant life cycle, training techniques from beginner to expert, global growing cultures, and the strains that define each approach.</p>
</div>

<div class="gr-section">
  <div class="gr-sec-title">Choose Your <em>Environment</em></div>
  <p class="gr-sec-sub">The environment you choose shapes everything — strain selection, training methods, setup cost, and annual yield. Each carries a distinct philosophy.</p>
  <div class="env-tabs" id="envTabs"></div>
  <div id="envPanels"></div>
</div>

<hr class="gr-divider">

<div class="gr-section" style="padding-top:60px">
  <div class="gr-sec-title">The <em>Life Cycle</em> — Seed to Harvest</div>
  <p class="gr-sec-sub">Every stage of the cannabis plant's life demands a different environment, nutrient profile, and level of attention. Know what your plant needs at every phase.</p>
  <div class="stage-timeline" id="stageTimeline"></div>
</div>

<hr class="gr-divider">

<div class="gr-section" style="padding-top:60px">
  <div class="gr-sec-title">Training <em>Techniques</em></div>
  <p class="gr-sec-sub">How you shape your plant determines how many bud sites receive direct light — which directly determines yield and quality. Filter by experience level.</p>
  <div class="level-filters">
    <button class="level-btn active" id="lvl-all" onclick="filterLevel('all')">All</button>
    <button class="level-btn" id="lvl-beginner" onclick="filterLevel('beginner')">Beginner</button>
    <button class="level-btn" id="lvl-intermediate" onclick="filterLevel('intermediate')">Intermediate</button>
    <button class="level-btn" id="lvl-advanced" onclick="filterLevel('advanced')">Expert</button>
  </div>
  <div class="tech-grid" id="techGrid"></div>
</div>

<hr class="gr-divider">

<div class="gr-section" style="padding-top:60px">
  <div class="gr-sec-title">Global Growing <em>Cultures</em></div>
  <p class="gr-sec-sub">Cannabis cultivation has deep roots in cultures across six continents. Each region developed unique techniques, strains, and traditions shaped by climate, history, and necessity.</p>
  <div class="culture-grid" id="cultureGrid"></div>
</div>

<hr class="gr-divider">

<div class="gr-section" style="padding-top:60px">
  <div class="gr-sec-title">Beginner <em>Strain Guide</em></div>
  <p class="gr-sec-sub">Not all strains are equal in difficulty. These six cultivars represent the best entry points — forgiving genetics that reward basic technique and teach good habits.</p>
  <div style="overflow-x:auto"><table class="strain-table" id="strainTable"></table></div>
</div>

<hr class="gr-divider">

<div class="gr-section" style="padding-top:60px">
  <div class="gr-sec-title">The Grower's <em>Philosophy</em></div>
  <p class="gr-sec-sub">The environment you choose reveals something about your relationship with the plant.</p>
  <div class="gr-philosophy">
    <div class="phil-card">
      <div class="phil-icon">&#128161;</div>
      <div class="phil-title">The Indoor Grower</div>
      <div class="phil-body">You are a craftsperson. You control every variable — light spectrum, temperature to the degree, humidity to the percentage, CO2 concentration, nutrient EC to three decimal places. For you, growing is engineering. The plant is a system to be optimized. The result is the most potent, most precisely crafted cannabis achievable — and the satisfaction of a process completely within your command.</div>
    </div>
    <div class="phil-card">
      <div class="phil-icon">&#9728;</div>
      <div class="phil-title">The Outdoor Grower</div>
      <div class="phil-body">You are a farmer, in the oldest sense. You work with nature rather than against it — reading seasons, building living soil, surrendering some control in exchange for scale and authenticity. The plant grows as it evolved to grow: under full-spectrum sun, developing terpene complexity that no artificial light fully replicates. There is a quality to sun-grown cannabis that comes from exactly this: the plant was not comfortable, and it responded.</div>
    </div>
    <div class="phil-card">
      <div class="phil-icon">&#127969;</div>
      <div class="phil-title">The Greenhouse Grower</div>
      <div class="phil-body">You are a pragmatist with taste. You recognize that free sunlight is the most powerful grow light ever created, and that climate protection multiplies what nature provides. The greenhouse represents a philosophy of amplification — taking what the environment gives and extending, protecting, and optimizing it. The most cost-effective path to exceptional cannabis. The approach professional cultivators worldwide increasingly favor for its combination of quality, sustainability, and scalability.</div>
    </div>
  </div>
</div>

<script>
var STAGES = ${JSON.stringify(_CS)};
var ENVIRONMENTS = ${JSON.stringify(_ENVIRONMENTS)};
var TECHNIQUES = ${JSON.stringify(_TECHNIQUES)};
var CULTURES = ${JSON.stringify(_CULTURES)};
var STRAINS = ${JSON.stringify(_STRAINS_GUIDE)};
var currentEnv = 'indoor';

function renderEnvTabs() {
  document.getElementById('envTabs').innerHTML = ENVIRONMENTS.map(function(e) {
    return '<button class="env-tab' + (e.id === currentEnv ? ' active' : '') + '" onclick="selectEnv(\'' + e.id + '\')">' + e.icon + ' ' + e.label + '</button>';
  }).join('');
}

function selectEnv(id) {
  currentEnv = id;
  renderEnvTabs();
  document.querySelectorAll('.env-panel').forEach(function(p) { p.classList.remove('active'); });
  var panel = document.getElementById('env-panel-' + id);
  if (panel) panel.classList.add('active');
}

function renderEnvPanels() {
  document.getElementById('envPanels').innerHTML = ENVIRONMENTS.map(function(e) {
    var proItems = e.pros.map(function(p) { return '<li>' + p + '</li>'; }).join('');
    var conItems = e.cons.map(function(c) { return '<li>' + c + '</li>'; }).join('');
    var strainTags = e.strains.map(function(s) { return '<span class="env-strain-tag">' + s + '</span>'; }).join('');
    return '<div class="env-panel' + (e.id === currentEnv ? ' active' : '') + '" id="env-panel-' + e.id + '">' +
      '<div class="env-panel-header"><div class="env-label">' + e.label + '</div></div>' +
      '<div class="env-tagline">' + e.tagline + '</div>' +
      '<div class="env-grid">' +
        '<div><div class="env-col-label">Advantages</div><ul class="env-list pro">' + proItems + '</ul></div>' +
        '<div><div class="env-col-label">Disadvantages</div><ul class="env-list con">' + conItems + '</ul></div>' +
      '</div>' +
      '<div class="env-spec"><strong>Lighting:</strong> ' + e.lights + '</div>' +
      '<div class="env-spec"><strong>Temperature:</strong> ' + e.temp + '</div>' +
      '<div class="env-spec"><strong>Humidity:</strong> ' + e.humidity + '</div>' +
      '<div class="env-col-label" style="margin-top:16px;margin-bottom:8px">Recommended strains</div>' +
      '<div class="env-strains">' + strainTags + '</div>' +
    '</div>';
  }).join('');
}

function renderStages() {
  document.getElementById('stageTimeline').innerHTML = STAGES.map(function(s) {
    return '<div class="stage">' +
      '<div class="stage-line"><div class="stage-dot">' + s.icon + '</div><div class="stage-connector"></div></div>' +
      '<div class="stage-body">' +
        '<div class="stage-header"><div class="stage-name">' + s.name + '</div><div class="stage-dur">' + s.dur + '</div></div>' +
        '<p class="stage-desc">' + s.desc + '</p>' +
        '<div class="stage-env">' + s.environment + '</div>' +
        '<ul class="stage-tips">' + s.tips.map(function(t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' +
        '<div class="stage-watch">&#9888; Watch for: ' + s.watch + '</div>' +
        '<p class="stage-tip">' + s.tip + '</p>' +
      '</div>' +
    '</div>';
  }).join('');
}

function filterLevel(level) {
  document.querySelectorAll('.level-btn').forEach(function(b) { b.classList.remove('active'); });
  var btn = document.getElementById('lvl-' + level);
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.tech-card').forEach(function(card) {
    if (level === 'all' || card.getAttribute('data-level') === level) {
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
  });
}

function renderTech() {
  document.getElementById('techGrid').innerHTML = TECHNIQUES.map(function(t) {
    return '<div class="tech-card" data-level="' + t.level + '">' +
      '<span class="tech-level ' + t.level + '">' + t.level + '</span>' +
      '<div class="tech-name">' + t.name + '</div>' +
      '<p class="tech-short">' + t.short + '</p>' +
      '<div class="tech-benefit">' + t.benefit + '</div>' +
      '<p class="tech-howto">' + t.howto + '</p>' +
    '</div>';
  }).join('');
}

function renderCultures() {
  document.getElementById('cultureGrid').innerHTML = CULTURES.map(function(c) {
    var strainTags = c.strains.map(function(s) { return '<span class="culture-strain">' + s + '</span>'; }).join('');
    return '<div class="culture-card">' +
      '<div class="culture-top">' +
        '<div><div class="culture-region">' + c.flag + ' ' + c.region + '</div><div class="culture-style-lbl">' + c.style + '</div></div>' +
        '<span class="culture-badge">' + c.badge + '</span>' +
      '</div>' +
      '<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(242,234,216,0.3);margin-bottom:6px">Notable strains</div>' +
      '<div class="culture-strains">' + strainTags + '</div>' +
      '<p class="culture-desc">' + c.desc + '</p>' +
    '</div>';
  }).join('');
}

function renderStrains() {
  var rows = STRAINS.map(function(s) {
    var diffClass = s.difficulty.toLowerCase();
    return '<tr>' +
      '<td class="s-name">' + s.name + '</td>' +
      '<td>' + s.env + '</td>' +
      '<td><span class="s-diff ' + diffClass + '">' + s.difficulty + '</span></td>' +
      '<td>' + s.yield + '</td>' +
      '<td>' + s.flower + '</td>' +
      '<td class="s-notes">' + s.notes + '</td>' +
    '</tr>';
  }).join('');
  document.getElementById('strainTable').innerHTML =
    '<thead><tr><th>Strain</th><th>Environment</th><th>Difficulty</th><th>Yield</th><th>Flower Time</th><th>Notes</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>';
}

document.addEventListener('DOMContentLoaded', function() {
  renderEnvTabs();
  renderEnvPanels();
  renderStages();
  renderTech();
  renderCultures();
  renderStrains();
});
</script>
</body></html>`;
    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /yourbody ─────────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/cannalogy") {
    res.writeHead(301, { "Location": "/cannabinoids#body-map" });
    res.end();
    return;
  }
  if (false && req.method === "GET" && req.url === "/cannalogy-old") {
    const _ZONES = [
      {
        id:"brain", label:"Brain", cx:100, cy:44, color:"#9B7FD4",
        receptors:"CB1 receptors dense throughout cortex, hippocampus, basal ganglia, and cerebellum. CB2 present in microglia.",
        headline:"The command center of your cannabis experience",
        desc:"The brain has the highest CB1 receptor density of any organ in the body. These receptors regulate mood, memory consolidation, pain perception, coordination, and appetite. THC binds directly to CB1 receptors — this is the source of the euphoria, altered time perception, and heightened sensory awareness that defines the cannabis experience. CBD does not bind CB1 directly but modulates its activity, reducing anxiety and dampening overactive neural circuits. The hippocampus — the brain's memory formation center — is especially CB1-dense, which explains why high THC temporarily impairs short-term memory formation.",
        positive:["THC: euphoria, mood elevation, creativity, heightened sensory perception","CBD: anxiety reduction, anti-epileptic, neuroprotection","CBN: sedation and sleep promotion","CBG: neuroprotection, possible antidepressant activity","THCV: mental clarity, short-duration alerting effect"],
        negative:["THC: short-term memory impairment, anxiety at high doses, paranoia in susceptible individuals","Heavy adolescent use associated with cognitive development concerns"],
        research:"The discovery of CB1 receptors in 1988 (Howlett et al.) revolutionized neuroscience. The endocannabinoid system — with anandamide as its primary endogenous ligand — regulates synaptic plasticity throughout the CNS. CBD's mechanism in treating Dravet syndrome and Lennox-Gastaut syndrome is FDA-recognized (Epidiolex, 2018).",
        cannabinoids:["THC","CBD","CBN","CBG","THCV"]
      },
      {
        id:"eyes", label:"Eyes", cx:100, cy:57, color:"#5CA0E8",
        receptors:"CB1 receptors in ciliary body (regulates intraocular pressure). CB2 in retinal ganglion cells and Muller glia.",
        headline:"Bloodshot eyes, reduced pressure, retinal protection",
        desc:"The redness associated with cannabis use — formally called conjunctival vasodilation — is caused by THC binding CB1 receptors in the eye's blood vessels, causing them to dilate. This same mechanism reduces intraocular pressure (IOP), which is why cannabis was one of the first plant medicines seriously studied for glaucoma. IOP reduction of 25–30% has been documented after THC use, though the 3–4 hour window limits its clinical utility compared to modern glaucoma drugs. CBD has shown promise as a retinal neuroprotectant, reducing oxidative damage to retinal cells in preclinical research.",
        positive:["THC: reduces intraocular pressure 25–30% — relevant to glaucoma management","CBD: antioxidant neuroprotection of retinal cells in preclinical models","Both: vasodilation reduces vascular strain on retinal tissue"],
        negative:["THC: conjunctival redness (cosmetic but reliable)","IOP reduction is short-duration — not a standalone glaucoma treatment","High-dose CBD may paradoxically increase IOP in some studies"],
        research:"Hepler and Frank (1971) published the first clinical study documenting cannabis-induced IOP reduction. The American Glaucoma Society currently notes that while cannabis reduces IOP, its short duration and side effects make it unsuitable as primary glaucoma therapy. Retinal CB2 receptor research is ongoing.",
        cannabinoids:["THC","CBD"]
      },
      {
        id:"lungs", label:"Lungs", cx:100, cy:118, color:"#52B788",
        receptors:"CB1 in bronchial smooth muscle (bronchodilation). CB2 in alveolar macrophages and immune cells of lung tissue.",
        headline:"Acute bronchodilation vs. chronic smoking damage",
        desc:"Cannabis has a complex, dual relationship with the lungs that depends heavily on consumption method. Acutely, THC causes bronchodilation — relaxation of bronchial smooth muscle — which is why cannabis was studied as an asthma treatment in the 1970s. CBD exerts anti-inflammatory effects on bronchial tissue, and CB2 receptors in lung macrophages regulate immune responses to respiratory pathogens. The complication is delivery method: smoking cannabis involves combustion products (including carbon monoxide, benzene, and tar) that cause chronic bronchitis with regular use. Vaporization eliminates combustion products while preserving bronchodilatory effects.",
        positive:["THC: acute bronchodilation — opens airways in the short term","CBD: reduces pulmonary inflammation via CB2 immune modulation","Vaporized cannabis avoids combustion toxins entirely"],
        negative:["Smoked cannabis: chronic bronchitis, increased respiratory mucus, cough","Combustion produces carbon monoxide, benzene, tar — same as tobacco smoke","Regular heavy smoking associated with increased respiratory infections"],
        research:"Tashkin et al. (University of California) conducted decades of pulmonary cannabis research. Notably, even heavy cannabis smokers do not show the COPD rates seen in tobacco smokers — a finding attributed to cannabis's anti-inflammatory CB2 activity partially counteracting smoking damage. Vaporizer bioavailability studies (Abrams et al., 2007) confirmed equivalent cannabinoid delivery without combustion products.",
        cannabinoids:["THC","CBD"]
      },
      {
        id:"heart", label:"Heart", cx:88, cy:130, color:"#E07B39",
        receptors:"CB1 in cardiac muscle and autonomic neurons (rate, contractility). CB2 in vascular endothelium and immune cells.",
        headline:"Rate increase, then cardioprotection",
        desc:"The cardiovascular effects of cannabis are among the most important to understand, particularly for older users. THC's initial effect on the heart is a dose-dependent increase in heart rate (tachycardia) — typically 20–50 beats per minute above baseline — driven by CB1 activation of sympathetic neurons. This effect peaks at 10–15 minutes and subsides within an hour. Blood pressure shows an initial mild increase followed by a decrease as CB1-mediated vasodilation takes effect. CBD has a directly cardioprotective profile: it reduces ischemia-reperfusion injury, lowers resting blood pressure, and has demonstrated vascular anti-inflammatory effects. CBG also produces vasodilation independent of CB1.",
        positive:["CBD: cardioprotective — reduces ischemia damage, lowers blood pressure","CBG: vasodilatory, reduces arterial tension","THC: mild analgesic effect reduces pain-induced cardiac stress","CB2 activation: reduces cardiac inflammation and atherosclerosis progression"],
        negative:["THC: tachycardia — heart rate increase of 20–50 BPM","Risk elevated for individuals with pre-existing cardiac arrhythmia or coronary disease","Case reports link acute cannabis use to adverse cardiac events in vulnerable individuals"],
        research:"CBD's antihypertensive properties were confirmed in a double-blind crossover trial (Jadoon et al., 2017) showing single-dose CBD reduced resting systolic blood pressure. The CARDIA study (Rodondi et al.) followed cannabis users over 25 years and found associations between heavy use and increased cardiovascular risk, though confounding factors complicate interpretation.",
        cannabinoids:["THC","CBD","CBG"]
      },
      {
        id:"gut", label:"Gut", cx:100, cy:188, color:"#74C69D",
        receptors:"CB1 throughout enteric nervous system (ENS) — the gut's own nervous system. CB2 dense in gut wall immune cells (Peyer's patches, lamina propria).",
        headline:"The gut-cannabis axis — digestion, immunity, IBD",
        desc:"The gastrointestinal tract has the second-highest concentration of cannabinoid receptors in the body after the brain. The enteric nervous system — which governs gut motility, secretions, and the gut-brain axis — is extensively modulated by CB1 receptors. This is why cannabis is so reliably effective for nausea (THC directly suppresses the vomiting reflex via CB1) and appetite stimulation. CB2 receptors in gut wall immune cells regulate the inflammatory environment of the intestines, making cannabinoids highly relevant to Crohn's disease, ulcerative colitis, and IBS. CBG has shown remarkable specificity for gut inflammation, with preclinical data showing efficacy against both inflammatory bowel disease and H. pylori.",
        positive:["THC: powerful anti-nausea, appetite stimulation (FDA-approved as Marinol for chemotherapy nausea)","CBD: anti-inflammatory for Crohn's disease and ulcerative colitis","CBG: IBD-specific anti-inflammatory, H. pylori antibacterial activity","THCV: appetite suppression — the metabolic opposite of the THC munchies"],
        negative:["Heavy THC use associated with Cannabinoid Hyperemesis Syndrome (CHS) in a subset of users","High THC may slow gastric motility — contraindicated in gastroparesis","Appetite stimulation can complicate weight management goals"],
        research:"The FDA-approved dronabinol (synthetic THC) for chemotherapy-induced nausea validated the gut-cannabinoid connection clinically. A 2018 Crohn's disease trial (Naftali et al.) showed 65% clinical remission with cannabis vs. 35% with placebo. CBG's efficacy against H. pylori was demonstrated at Microbes and Infection (Appendino et al., 2008) — notably effective against antibiotic-resistant strains.",
        cannabinoids:["THC","CBD","CBG","THCV"]
      },
      {
        id:"muscles", label:"Muscles", cx:55, cy:258, color:"#F4A261",
        receptors:"CB1 in motor neurons and neuromuscular junctions. CB2 in skeletal muscle satellite cells (involved in repair) and immune cells.",
        headline:"Spasticity relief, recovery, inflammation control",
        desc:"Cannabinoid receptors in the motor system and muscle tissue serve primarily regulatory and protective functions. CB1 receptors in motor neurons modulate the signals that cause involuntary muscle contractions — which is why cannabis has documented efficacy for spasticity in multiple sclerosis. This led to the approval of Sativex (THC:CBD 1:1 oromucosal spray) in over 25 countries for MS spasticity. CBD's anti-inflammatory and antioxidant properties make it popular for exercise recovery — reducing delayed onset muscle soreness (DOMS) through prostaglandin inhibition and reduced cytokine signaling. CBC has shown synergistic effects with CBD on muscle tissue inflammation.",
        positive:["THC: spasticity reduction — clinically proven in MS (Sativex approved in 25+ countries)","CBD: reduces DOMS, exercise-induced inflammation, oxidative stress in muscle tissue","CBC: synergistic anti-inflammatory activity alongside CBD","CB2: regulates satellite cell activity relevant to muscle repair"],
        negative:["THC impairs motor coordination at higher doses — counterproductive for athletic performance","Psychoactive effects limit daytime use for active recovery","Smoking delivery irritates airways — athletes should use non-combustion methods"],
        research:"The MUSEC trial (Zajicek et al., 2012) demonstrated significant spasticity reduction with cannabis extract in MS patients. Meta-analysis by Whiting et al. (JAMA, 2015) confirmed moderate evidence for cannabinoids in spasticity management. The World Anti-Doping Agency removed CBD from its prohibited list in 2018.",
        cannabinoids:["THC","CBD","CBC"]
      },
      {
        id:"joints", label:"Joints", cx:68, cy:335, color:"#C9973A",
        receptors:"CB1 in periarticular nerve fibers (pain signaling). CB2 in osteoblasts (bone-forming cells), osteoclasts, and synovial joint macrophages.",
        headline:"Arthritis, bone growth, pain signal modulation",
        desc:"The joint and skeletal system is governed predominantly by CB2 receptors — the non-psychoactive arm of the endocannabinoid system. CB2 receptors are found on osteoblasts (cells that build bone) and osteoclasts (cells that resorb bone), giving cannabinoids a direct role in bone remodeling and fracture healing. CBG and CBD have both shown osteogenic (bone-promoting) effects in preclinical models. For arthritis, CBD's anti-inflammatory action on synovial macrophages reduces joint swelling and degradation. THC addresses the pain signal side — CB1 receptors on periarticular nerves reduce the transmission of pain signals from inflamed joints to the brain.",
        positive:["CBD: reduces synovial inflammation in arthritis — both osteoarthritis and rheumatoid types","THC: modulates pain signal transmission from joints via CB1 periarticular nerves","CBG: stimulates bone growth via osteoblast CB2 activation — accelerates fracture healing in models","CB2 activation: reduces joint immune-mediated destruction"],
        negative:["THC's psychoactive effects limit daytime use for arthritis management","Topical application preferred for localized joint relief — avoids systemic effects","Evidence base is preclinical-heavy; large RCTs for arthritis remain limited"],
        research:"Sophocleous et al. (2017, British Journal of Pharmacology) demonstrated that CB2 receptor knockout mice show reduced bone mass, confirming CB2's role in bone homeostasis. A randomized controlled trial by Blake et al. (Rheumatology, 2006) showed Sativex significantly reduced pain and improved sleep in rheumatoid arthritis patients.",
        cannabinoids:["CBD","THC","CBG"]
      },
      {
        id:"skin", label:"Skin", cx:148, cy:158, color:"#E8A87C",
        receptors:"CB1 and CB2 in keratinocytes (skin cells), sebocytes (oil-producing cells), mast cells, and sensory nerve endings throughout the dermis.",
        headline:"Acne, eczema, topical pain — no psychoactivity",
        desc:"The skin is the body's largest organ and one of the most cannabinoid-receptor-rich. Both CB1 and CB2 are expressed throughout the skin — in the cells that form the barrier (keratinocytes), cells that produce sebum (sebocytes), immune mast cells, and the sensory nerve endings that detect pain and itch. CBD regulates sebum production via CB2 on sebocytes — reducing the overproduction that causes acne. It also reduces the inflammatory cascade in eczema and psoriasis through cytokine modulation. Critically, standard topical cannabinoids do not cross the blood-brain barrier and produce no psychoactive effect.",
        positive:["CBD: reduces sebum overproduction — clinically relevant for acne vulgaris","CBD: reduces inflammatory cytokines in eczema, psoriasis, atopic dermatitis","THC (topical): pain and itch relief via CB1 skin nerve endings — zero psychoactivity","CBG: broad-spectrum antibacterial against skin pathogens including MRSA","CBC: synergistic anti-acne activity, reduces lipogenesis in sebocytes"],
        negative:["Transdermal absorption is low — most topicals stay in skin layers only","Transdermal patches can deliver systemically — potential mild psychoactivity","Product quality varies enormously — poorly formulated products do not penetrate effectively"],
        research:"Olah et al. (2014, Journal of Clinical Investigation) demonstrated CBD's sebostatic effects in human sebocyte cell culture, establishing the mechanism for CBD in acne treatment. The antibacterial activity of CBG against MRSA was published by Appendino et al. in the Journal of Natural Products (2008).",
        cannabinoids:["CBD","THC","CBG","CBC"]
      }
    ];
    const _CB_INFO = [
      { id:"THC", label:"THC", color:"#E07B39", zones:["brain","eyes","lungs","heart","gut","muscles","joints","skin"], summary:"The primary psychoactive cannabinoid. Binds directly to CB1 receptors across nearly every body system. Produces euphoria and pain relief centrally, anti-nausea and appetite stimulation in the gut, bronchodilation in lungs, and IOP reduction in eyes — all via CB1." },
      { id:"CBD", label:"CBD", color:"#52B788", zones:["brain","eyes","lungs","heart","gut","muscles","joints","skin"], summary:"The most therapeutically versatile cannabinoid. Non-psychoactive. Modulates CB1 activity rather than binding it directly. Anti-inflammatory systemically, neuroprotective in the brain, cardioprotective in the heart, sebostatic in skin, and FDA-approved for epilepsy." },
      { id:"CBG", label:"CBG", color:"#74C69D", zones:["brain","heart","gut","joints","skin"], summary:"The mother cannabinoid — biosynthetic precursor to THC and CBD. Neuroprotective in the brain, vasodilatory in the heart, powerfully anti-inflammatory in the gut (IBD specialist), osteogenic in joints, and antibacterial on skin. Non-psychoactive." },
      { id:"CBN", label:"CBN", color:"#9B7FD4", zones:["brain"], summary:"A THC degradation product formed as cannabis ages and oxidizes. Mildly sedating via CB1 in the brain. Primarily active centrally — less systemic relevance than other cannabinoids. Associated with sleep and mild pain relief." },
      { id:"CBC", label:"CBC", color:"#5CA0E8", zones:["muscles","skin"], summary:"Cannabichromene — non-psychoactive and often overlooked. Shows synergistic anti-inflammatory activity with CBD in muscle tissue. In skin, reduces lipogenesis in sebocytes and works alongside CBD for anti-acne effects. An entourage effect amplifier." },
      { id:"THCV", label:"THCV", color:"#F4A261", zones:["brain","gut"], summary:"A structural analog of THC with opposite appetite effects at low doses. Suppresses appetite via CB1 antagonism in the gut and produces mental clarity and short-duration energy in the brain. Rarest of the major cannabinoids — highest in African sativa landraces." }
    ];
    const _HOTSPOTS = [
      {id:"brain",   cx:100, cy:44,  color:"#9B7FD4", label:"Brain"},
      {id:"eyes",    cx:100, cy:57,  color:"#5CA0E8", label:"Eyes"},
      {id:"lungs",   cx:100, cy:118, color:"#52B788", label:"Lungs"},
      {id:"heart",   cx:88,  cy:130, color:"#E07B39", label:"Heart"},
      {id:"gut",     cx:100, cy:188, color:"#74C69D", label:"Gut"},
      {id:"muscles", cx:55,  cy:258, color:"#F4A261", label:"Muscles"},
      {id:"joints",  cx:68,  cy:335, color:"#C9973A", label:"Joints"},
      {id:"skin",    cx:148, cy:158, color:"#E8A87C", label:"Skin"}
    ];
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cannalogy — Cannabis &amp; Your Body — Cannascenti</title>
<meta name="description" content="Interactive guide to how cannabinoids affect every body system. CB1, CB2, THC, CBD, CBG and more — explained per organ.">
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
.yb-hero{padding:72px 32px 56px;max-width:1100px;margin:0 auto}
.yb-hero-label{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#52B788;margin-bottom:16px}
.yb-hero-title{font-family:'Cormorant Garamond',serif;font-size:clamp(2.4rem,6vw,4rem);font-weight:300;color:#F2EAD8;line-height:1.1;margin-bottom:16px}
.yb-hero-title em{color:#52B788;font-style:italic}
.yb-hero-sub{font-size:.95rem;color:rgba(242,234,216,0.55);max-width:580px;line-height:1.8}
.yb-main{max-width:1100px;margin:0 auto;padding:0 32px 80px;display:grid;grid-template-columns:260px 1fr;gap:48px;align-items:start}
@media(max-width:800px){.yb-main{grid-template-columns:1fr}}
.yb-svg-wrap{position:sticky;top:80px}
.yb-svg-title{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:rgba(242,234,216,0.35);margin-bottom:16px;text-align:center}
.yb-svg-container{background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:20px;padding:24px;display:flex;justify-content:center}
.yb-dot{cursor:pointer;transition:opacity .3s}
.yb-dot circle.pulse{animation:ybPulse 2s ease-in-out infinite}
@keyframes ybPulse{0%,100%{r:7;opacity:0.6}50%{r:11;opacity:0.15}}
.yb-dot.active circle.inner{fill:#52B788 !important}
.yb-dot.active circle.pulse{stroke:#52B788 !important}
.yb-dot.dim{opacity:0.18}
.yb-dot.highlight circle.inner{fill:#52B788 !important}
.yb-zone-tags{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:16px}
.yb-zone-tag{font-size:10px;letter-spacing:.07em;text-transform:uppercase;background:rgba(255,255,255,0.05);border-radius:6px;padding:3px 9px;color:rgba(242,234,216,0.5);cursor:pointer;border:1px solid rgba(255,255,255,0.07);transition:all .2s}
.yb-zone-tag:hover{border-color:rgba(82,183,136,0.4);color:#F2EAD8}
.yb-info{min-height:400px}
.yb-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:420px;text-align:center;color:rgba(242,234,216,0.25);gap:12px;border:1px dashed rgba(255,255,255,0.07);border-radius:20px}
.yb-placeholder-icon{font-size:2.5rem;opacity:0.3}
.yb-placeholder-text{font-size:.85rem;line-height:1.7}
.yb-zone-panel{display:none;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:20px;padding:32px}
.yb-zone-panel.active{display:block}
.yb-zone-name{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;margin-bottom:8px;color:#F2EAD8}
.yb-zone-receptors{font-size:.78rem;color:#52B788;background:rgba(82,183,136,0.08);border-radius:8px;padding:8px 14px;margin-bottom:16px;line-height:1.6}
.yb-zone-headline{font-size:.98rem;font-weight:600;color:#F2EAD8;margin-bottom:12px}
.yb-zone-desc{font-size:.84rem;line-height:1.82;color:rgba(242,234,216,0.63);margin-bottom:20px}
.yb-cb-pills{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:20px}
.yb-cb-pill{font-size:11px;font-weight:600;letter-spacing:.06em;border-radius:20px;padding:4px 13px;border:1px solid}
.yb-effects-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
@media(max-width:540px){.yb-effects-grid{grid-template-columns:1fr}}
.yb-effects-label{font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px}
.yb-effects-label.pos{color:#52B788}
.yb-effects-label.neg{color:#C9973A}
.yb-effects-list{list-style:none}
.yb-effects-list li{font-size:.77rem;line-height:1.65;color:rgba(242,234,216,0.58);padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);padding-left:16px;position:relative}
.yb-effects-list.pos li::before{content:"+";position:absolute;left:0;color:#52B788;font-weight:700}
.yb-effects-list.neg li::before{content:"!";position:absolute;left:0;color:#C9973A;font-weight:700}
.yb-research{font-size:.76rem;line-height:1.72;color:rgba(242,234,216,0.38);border-left:2px solid rgba(82,183,136,0.22);padding-left:14px;font-style:italic}
.yb-lens-section{max-width:1100px;margin:0 auto;padding:0 32px 80px}
.yb-lens-title{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;color:#F2EAD8;margin-bottom:8px}
.yb-lens-title em{color:#52B788;font-style:italic}
.yb-lens-sub{font-size:.85rem;color:rgba(242,234,216,0.45);margin-bottom:24px;line-height:1.7;max-width:620px}
.yb-lens-pills{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:28px}
.yb-lens-btn{background:none;border:1px solid rgba(255,255,255,0.12);border-radius:24px;padding:10px 24px;color:rgba(242,234,216,0.6);font-family:Montserrat,sans-serif;font-size:12px;font-weight:600;letter-spacing:.08em;cursor:pointer;transition:all .2s}
.yb-lens-card{display:none;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px}
.yb-lens-card.active{display:block}
.yb-lens-card-name{font-family:'Cormorant Garamond',serif;font-size:1.5rem;margin-bottom:10px}
.yb-lens-card-summary{font-size:.86rem;line-height:1.78;color:rgba(242,234,216,0.62);margin-bottom:18px}
.yb-lens-zones{display:flex;flex-wrap:wrap;gap:8px}
.yb-lens-zone-tag{font-size:.78rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:4px 13px;color:rgba(242,234,216,0.6);cursor:pointer;transition:all .2s}
.yb-lens-zone-tag:hover{border-color:rgba(82,183,136,0.4);color:#F2EAD8}
.yb-ecs-section{background:rgba(255,255,255,0.015);border-top:1px solid rgba(255,255,255,0.06);padding:72px 32px}
.yb-ecs-inner{max-width:1100px;margin:0 auto}
.yb-ecs-header{text-align:center;margin-bottom:48px}
.yb-ecs-title{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;color:#F2EAD8;margin-bottom:10px}
.yb-ecs-title em{color:#52B788;font-style:italic}
.yb-ecs-sub{font-size:.88rem;color:rgba(242,234,216,0.45);max-width:560px;margin:0 auto;line-height:1.78}
.yb-ecs-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
@media(max-width:680px){.yb-ecs-cards{grid-template-columns:1fr}}
.yb-ecs-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:28px}
.yb-ecs-card-icon{font-size:1.5rem;margin-bottom:14px;color:#52B788}
.yb-ecs-card-title{font-size:.95rem;font-weight:600;color:#F2EAD8;margin-bottom:10px}
.yb-ecs-card-body{font-size:.81rem;line-height:1.78;color:rgba(242,234,216,0.52)}
</style>
</head>
<body>
${ENC_NAV}
<div class="yb-hero">
  <div class="yb-hero-label">&#10022; Cannascenti Encyclopedia</div>
  <h1 class="yb-hero-title">Cannabis &amp; Your <em>Body.</em></h1>
  <p class="yb-hero-sub">What's actually happening inside you. Click any glowing zone to explore how cannabinoids interact with that organ system — from receptor distribution to clinical research.</p>
</div>

<div class="yb-main">
  <div class="yb-svg-wrap">
    <div class="yb-svg-title">Click a zone to explore</div>
    <div class="yb-svg-container">
      <svg viewBox="0 0 200 480" width="200" height="480" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="100" cy="32" rx="22" ry="26" fill="rgba(82,183,136,0.06)" stroke="rgba(82,183,136,0.18)" stroke-width="1"/>
        <rect x="93" y="56" width="14" height="14" rx="4" fill="rgba(82,183,136,0.05)" stroke="rgba(82,183,136,0.12)" stroke-width="1"/>
        <path d="M68,70 Q62,72 58,82 L52,160 Q52,168 60,170 L140,170 Q148,168 148,160 L142,82 Q138,72 132,70 Z" fill="rgba(82,183,136,0.05)" stroke="rgba(82,183,136,0.12)" stroke-width="1"/>
        <path d="M68,72 Q58,76 54,90 L46,178 Q44,188 50,190 L58,190 Q64,188 66,178 L70,100" fill="rgba(82,183,136,0.04)" stroke="rgba(82,183,136,0.1)" stroke-width="1"/>
        <path d="M132,72 Q142,76 146,90 L154,178 Q156,188 150,190 L142,190 Q136,188 134,178 L130,100" fill="rgba(82,183,136,0.04)" stroke="rgba(82,183,136,0.1)" stroke-width="1"/>
        <path d="M80,170 L72,300 Q70,310 74,318 L84,318 Q90,316 92,306 L96,170" fill="rgba(82,183,136,0.04)" stroke="rgba(82,183,136,0.1)" stroke-width="1"/>
        <path d="M120,170 L128,300 Q130,310 126,318 L116,318 Q110,316 108,306 L104,170" fill="rgba(82,183,136,0.04)" stroke="rgba(82,183,136,0.1)" stroke-width="1"/>
        <ellipse cx="78" cy="326" rx="10" ry="6" fill="rgba(82,183,136,0.04)" stroke="rgba(82,183,136,0.08)" stroke-width="1"/>
        <ellipse cx="122" cy="326" rx="10" ry="6" fill="rgba(82,183,136,0.04)" stroke="rgba(82,183,136,0.08)" stroke-width="1"/>
        <g id="yb-dots"></g>
      </svg>
    </div>
    <div class="yb-zone-tags" id="yb-zone-tags"></div>
  </div>

  <div class="yb-info">
    <div class="yb-placeholder" id="yb-placeholder">
      <div class="yb-placeholder-icon">&#9678;</div>
      <div class="yb-placeholder-text">Click a glowing dot on the body<br>or a zone tag below to begin</div>
    </div>
    <div id="yb-panels"></div>
  </div>
</div>

<div class="yb-lens-section">
  <div class="yb-lens-title">The <em>Cannabinoid</em> Lens</div>
  <p class="yb-lens-sub">Select a cannabinoid to highlight every body system where it is active and read its whole-body summary.</p>
  <div class="yb-lens-pills" id="yb-lens-pills"></div>
  <div id="yb-lens-cards"></div>
</div>

<div class="yb-ecs-section">
  <div class="yb-ecs-inner">
    <div class="yb-ecs-header">
      <div class="yb-ecs-title">How the <em>ECS</em> Works</div>
      <p class="yb-ecs-sub">The endocannabinoid system is one of the most widespread receptor networks in the human body — and one of the least taught in medical schools.</p>
    </div>
    <div class="yb-ecs-cards">
      <div class="yb-ecs-card">
        <div class="yb-ecs-card-icon">&#9881;</div>
        <div class="yb-ecs-card-title">What is the ECS?</div>
        <div class="yb-ecs-card-body">The endocannabinoid system (ECS) is a retrograde signaling network — it works backwards from the receiving neuron back to the sending neuron. When a neuron fires too strongly, the receiving cell produces endocannabinoids (anandamide, 2-AG) that travel back to suppress the signal. The ECS is a biological volume knob. Cannabis cannabinoids fit this system because they are structurally similar to your body's own endocannabinoids.</div>
      </div>
      <div class="yb-ecs-card">
        <div class="yb-ecs-card-icon">&#9679;</div>
        <div class="yb-ecs-card-title">CB1 Receptors — The Psychoactive Pathway</div>
        <div class="yb-ecs-card-body">CB1 receptors are concentrated in the central nervous system — brain and spinal cord. They regulate mood, memory, pain perception, appetite, coordination, and consciousness itself. THC's binding to CB1 produces euphoria, altered time perception, and intoxication. CB1 is also present in peripheral tissues — heart, lungs, gut — where it governs autonomic functions without psychoactivity at normal levels.</div>
      </div>
      <div class="yb-ecs-card">
        <div class="yb-ecs-card-icon">&#9675;</div>
        <div class="yb-ecs-card-title">CB2 Receptors — The Immune Pathway</div>
        <div class="yb-ecs-card-body">CB2 receptors are concentrated in immune tissues — spleen, tonsils, bone marrow, and immune cells throughout the body. They regulate inflammation, immune cell migration, and the body's response to injury. CB2 activation does not produce psychoactivity. CBD, CBG, and CBC all have affinity for CB2, which explains their anti-inflammatory profiles across skin, joints, gut, and lungs without intoxication.</div>
      </div>
    </div>
  </div>
</div>

<script>
var ZONES = ${JSON.stringify(_ZONES)};
var CB_INFO = ${JSON.stringify(_CB_INFO)};
var HOTSPOTS = ${JSON.stringify(_HOTSPOTS)};
var CB_COLORS = {THC:'#E07B39',CBD:'#52B788',CBG:'#74C69D',CBN:'#9B7FD4',CBC:'#5CA0E8',THCV:'#F4A261'};
var selectedLens = null;

function initDots() {
  var dotsG = document.getElementById('yb-dots');
  var tagsDiv = document.getElementById('yb-zone-tags');
  dotsG.innerHTML = HOTSPOTS.map(function(h) {
    return '<g class="yb-dot" id="dot-' + h.id + '" onclick="selectZone(\'' + h.id + '\')">' +
      '<circle class="pulse" cx="' + h.cx + '" cy="' + h.cy + '" r="7" fill="none" stroke="' + h.color + '" stroke-width="1.5"/>' +
      '<circle class="inner" cx="' + h.cx + '" cy="' + h.cy + '" r="4.5" fill="' + h.color + '" opacity="0.9"/>' +
      '<title>' + h.label + '</title>' +
    '</g>';
  }).join('');
  tagsDiv.innerHTML = HOTSPOTS.map(function(h) {
    return '<span class="yb-zone-tag" onclick="selectZone(\'' + h.id + '\')">' + h.label + '</span>';
  }).join('');
}

function selectZone(id) {
  document.getElementById('yb-placeholder').style.display = 'none';
  document.querySelectorAll('.yb-dot').forEach(function(d) {
    d.classList.remove('active', 'dim');
    d.classList.add('dim');
  });
  var activeDot = document.getElementById('dot-' + id);
  if (activeDot) { activeDot.classList.remove('dim'); activeDot.classList.add('active'); }
  document.querySelectorAll('.yb-zone-panel').forEach(function(p) { p.classList.remove('active'); });
  var panel = document.getElementById('yb-panel-' + id);
  if (panel) {
    panel.classList.add('active');
    panel.scrollIntoView({behavior:'smooth', block:'nearest'});
  }
  if (selectedLens) applyLens(selectedLens);
}

function renderPanels() {
  document.getElementById('yb-panels').innerHTML = ZONES.map(function(z) {
    var cbPills = z.cannabinoids.map(function(c) {
      var col = CB_COLORS[c] || '#52B788';
      return '<span class="yb-cb-pill" style="color:' + col + ';border-color:' + col + '55;background:' + col + '18">' + c + '</span>';
    }).join('');
    var posItems = z.positive.map(function(e) { return '<li>' + e + '</li>'; }).join('');
    var negItems = z.negative.map(function(e) { return '<li>' + e + '</li>'; }).join('');
    return '<div class="yb-zone-panel" id="yb-panel-' + z.id + '">' +
      '<div class="yb-zone-name">' + z.label + '</div>' +
      '<div class="yb-zone-receptors">' + z.receptors + '</div>' +
      '<div class="yb-zone-headline">' + z.headline + '</div>' +
      '<p class="yb-zone-desc">' + z.desc + '</p>' +
      '<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:rgba(242,234,216,0.3);margin-bottom:8px">Active cannabinoids</div>' +
      '<div class="yb-cb-pills">' + cbPills + '</div>' +
      '<div class="yb-effects-grid">' +
        '<div>' +
          '<div class="yb-effects-label pos">Benefits</div>' +
          '<ul class="yb-effects-list pos">' + posItems + '</ul>' +
        '</div>' +
        '<div>' +
          '<div class="yb-effects-label neg">Considerations</div>' +
          '<ul class="yb-effects-list neg">' + negItems + '</ul>' +
        '</div>' +
      '</div>' +
      '<p class="yb-research">' + z.research + '</p>' +
    '</div>';
  }).join('');
}

function renderLens() {
  document.getElementById('yb-lens-pills').innerHTML = CB_INFO.map(function(cb) {
    var col = CB_COLORS[cb.id] || '#52B788';
    return '<button class="yb-lens-btn" id="lens-btn-' + cb.id + '" onclick="activateLens(\'' + cb.id + '\')" style="border-color:' + col + '55">' + cb.label + '</button>';
  }).join('');
  document.getElementById('yb-lens-cards').innerHTML = CB_INFO.map(function(cb) {
    var col = CB_COLORS[cb.id] || '#52B788';
    var zoneTags = cb.zones.map(function(zid) {
      var zone = ZONES.find(function(zz) { return zz.id === zid; });
      return '<span class="yb-lens-zone-tag" onclick="selectZone(\'' + zid + '\')">' + (zone ? zone.label : zid) + '</span>';
    }).join('');
    return '<div class="yb-lens-card" id="lens-card-' + cb.id + '">' +
      '<div class="yb-lens-card-name" style="color:' + col + '">' + cb.label + ' &mdash; System Overview</div>' +
      '<p class="yb-lens-card-summary">' + cb.summary + '</p>' +
      '<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:rgba(242,234,216,0.3);margin-bottom:10px">Active in these systems</div>' +
      '<div class="yb-lens-zones">' + zoneTags + '</div>' +
    '</div>';
  }).join('');
}

function activateLens(cbId) {
  selectedLens = cbId;
  document.querySelectorAll('.yb-lens-btn').forEach(function(b) {
    b.style.background = '';
    b.style.color = 'rgba(242,234,216,0.6)';
  });
  document.querySelectorAll('.yb-lens-card').forEach(function(c) { c.classList.remove('active'); });
  var col = CB_COLORS[cbId] || '#52B788';
  var btn = document.getElementById('lens-btn-' + cbId);
  if (btn) { btn.style.background = col; btn.style.color = '#060d0a'; }
  var card = document.getElementById('lens-card-' + cbId);
  if (card) card.classList.add('active');
  applyLens(cbId);
}

function applyLens(cbId) {
  var cb = CB_INFO.find(function(c) { return c.id === cbId; });
  if (!cb) return;
  HOTSPOTS.forEach(function(h) {
    var dot = document.getElementById('dot-' + h.id);
    if (!dot) return;
    dot.classList.remove('dim', 'highlight');
    if (cb.zones.indexOf(h.id) >= 0) {
      dot.classList.add('highlight');
    } else {
      dot.classList.add('dim');
    }
  });
}

document.addEventListener('DOMContentLoaded', function() {
  initDots();
  renderPanels();
  renderLens();
});
</script>
</body></html>`;
    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /growing → redirect to /cultivation ──────────────────────────────────
  if (req.method === "GET" && req.url === "/growing") {
    res.writeHead(301,{"Location":"/cultivation"});
    res.end();
    return;
  }
  if (false && req.method === "GET" && req.url === "/growing-old") {
    const _ENVIRONMENTS = [
      {
        id:"indoor", icon:"&#128161;", label:"Indoor",
        tagline:"Total control. Year-round. Best quality.",
        pros:["Year-round growing — no seasonal limits","Complete environment control (temp, humidity, CO2, light spectrum)","Highest potency and trichome density achievable","Privacy and security","Multiple harvests per year"],
        cons:["Significant setup cost (lights, fans, tent or room, HVAC)","Ongoing electricity costs — even LEDs draw 200–600W","Requires active daily monitoring","Lower yield per plant than outdoor"],
        lights:"LED preferred — 150–200W per m². Full-spectrum quantum board LEDs deliver the best yield-per-watt ratio. HPS still viable but runs hot and less efficient.",
        temp:"70–80°F (21–27°C) lights-on. 10°F drop at night encourages terpene and anthocyanin development in late flower.",
        humidity:"Seedling 65–70%. Veg 50–70%. Flower 40–50%. Late flower 40–45% to prevent bud rot in dense colas.",
        strains:["OG Kush","White Widow","Gorilla Glue #4","Wedding Cake","Gelato","Girl Scout Cookies"]
      },
      {
        id:"outdoor", icon:"&#9728;", label:"Outdoor",
        tagline:"Free sunlight. Massive yields. Seasonal.",
        pros:["Free, full-spectrum natural sunlight","Highest possible yield per plant","Lowest cost of entry by far","Largest plants achievable — 10+ feet possible","Natural terpene complexity from real sun cycles"],
        cons:["Seasonal — one main harvest per year in most climates","Weather and climate dependent","Privacy concerns depending on jurisdiction","Pest and pathogen exposure","No control over light cycle — season triggers flowering"],
        lights:"Natural sunlight — free and unbeatable. Plants need 6+ hours of direct sun minimum. South-facing slopes or hillsides maximize exposure.",
        temp:"Ideal 65–85°F. Sensitive to frost — plant after last frost date in spring, harvest before first fall frost.",
        humidity:"Ambient. High-humidity regions require mold-resistant genetics (fast finishers, loose bud structure). Arid climates need consistent irrigation.",
        strains:["Blue Dream","Durban Poison","Zkittlez","Trainwreck","Sour Diesel","Jack Herer"]
      },
      {
        id:"greenhouse", icon:"&#127969;", label:"Greenhouse",
        tagline:"Best of both. Most cost-effective.",
        pros:["Free sunlight with full climate protection","Extended season — plant earlier, harvest later than outdoor","Most cost-effective setup for premium quality","Weather protection without full HVAC cost","Light deprivation allows multiple harvests per year"],
        cons:["Upfront construction or purchase cost","Heat management in summer requires active venting","Less precise control than full indoor","Humidity accumulates — requires active management"],
        lights:"Free solar during the day. Supplemental LED for early-season starts. Light deprivation tarps enable photoperiod control for year-round harvest.",
        temp:"Sun-regulated naturally. Shade cloth and ridge vents manage summer heat. Propane or electric heaters extend the season into cooler months.",
        humidity:"Monitor and vent actively. Oscillating fans and ridge vents are essential. Greenhouse humidity builds faster than open outdoor.",
        strains:["Northern Lights","Gelato","Amnesia Haze","Strawberry Cough","Auto-flowering varieties","Zkittlez"]
      }
    ];
    const _TECHNIQUES = [
      { id:"lst", level:"beginner", name:"LST — Low Stress Training", short:"Bend and tie branches horizontally to expose lower bud sites directly to the light source. Creates a wide, even canopy without any cutting.", benefit:"Up to 30% yield increase by maximizing the number of bud sites receiving direct light. Zero recovery time — the plant continues growing during training.", howto:"During veg, gently bend the main stem and side branches outward and downward. Secure with soft plant ties or garden wire to stakes inserted at the pot rim. As new growth emerges upright, continue bending it outward. A little bending each day is better than forcing a large bend all at once." },
      { id:"topping", level:"beginner", name:"Topping", short:"Cut the main apical stem cleanly at the 5th node. This removes apical dominance and forces the plant to grow two equal main colas from the two nodes below the cut.", benefit:"Doubles main cola count immediately. Combined with a second topping, creates four mains. A cornerstone technique for increasing total yield indoors.", howto:"Using sterilized scissors, cut the main stem cleanly between the 5th and 6th node during mid-veg. Wait 5–7 days for the two new growth tips to emerge and strengthen before applying any additional stress. The plant will look stalled briefly — this is normal recovery." },
      { id:"fim", level:"beginner", name:"FIM — F*** I Missed", short:"Pinch or cut approximately 70–80% of the new growth tip, leaving the bottom 20–30% intact. Creates 4 new colas instead of the 2 produced by full topping.", benefit:"Produces 4 main colas with less plant stress and faster recovery than full topping. Gentler and faster — ideal for impatient growers.", howto:"Identify the newest growth tip when 4–5 small leaves are just emerging. Pinch or snip 70–80% of that new growth cluster — do not cut the full stem. The remaining base will divide into 4 new growth tips over 5–8 days." },
      { id:"scrog", level:"intermediate", name:"SCROG — Screen of Green", short:"Install a horizontal net or screen 10–12 inches above the pot tops. Weave branches through the net laterally as they grow up, creating a completely flat and even canopy.", benefit:"Maximizes the number of bud sites in the prime light zone directly beneath your fixtures. Dramatically improves light efficiency in square-footage-limited indoor grows.", howto:"Install a net or trellis screen 10–12 inches above the pots before plants reach it. During late veg, gently push branches through net openings and weave them horizontally. Tuck any vertical growth back under the screen. Flip to 12/12 flower when the screen is 70–80% filled." },
      { id:"sog", level:"intermediate", name:"SOG — Sea of Green", short:"Grow many small plants and flip to flower very early — at 2–3 weeks of veg — so each plant becomes essentially one large main cola. Pack plants tightly to fill the canopy.", benefit:"Fastest possible harvest cycles. Maximum use of your light footprint. Ideal for cloning operations and auto-flowering strains.", howto:"Start plants in 1–2 gallon containers. Flip to 12/12 light cycle when plants are 6–10 inches tall. Pack 4–16 plants per square meter depending on pot size. Remove lower growth that will not reach the canopy. Harvest the entire table at once." },
      { id:"supercropping", level:"intermediate", name:"Super Cropping", short:"Pinch and gently crush the inner tissue of a thick stem at the target bending point, then slowly bend 90 degrees. A reinforced knuckle forms at the bend as it heals.", benefit:"Creates multiple low-effort bending points without cutting. The healed knuckle delivers more nutrient flow to the branch. Excellent for controlling tall plants in height-limited spaces.", howto:"Find the stem section to bend. Firmly pinch between thumb and forefinger and roll gently back and forth to soften the inner pith without tearing the outer skin. Slowly bend to 90 degrees — support with a stake if needed. The knuckle forms and hardens within 5–7 days and becomes stronger than the original stem." },
      { id:"lollipopping", level:"intermediate", name:"Lollipopping", short:"Remove all lower growth — leaves, branches, and bud sites — below the main canopy line. Concentrates the plant's energy entirely on the top colas that receive direct light.", benefit:"Focuses all growth energy on the highest-quality top buds. Dramatically improves airflow in the lower canopy — critical for preventing bud rot. Produces larger, denser upper colas.", howto:"At week 3 of flower, identify the lower 25–30% of the plant. Remove all branches, growth tips, and large fan leaves in that zone working from the bottom up. Do not remove more than 30% of total foliage in one session — spread the work over 3–4 days to minimize stress." },
      { id:"defoliation", level:"intermediate", name:"Strategic Defoliation", short:"Selectively remove fan leaves that are blocking light from reaching bud sites below, or crowding airflow channels within the canopy. Not a wholesale strip — a targeted edit.", benefit:"Improves light penetration to lower bud sites. Reduces canopy humidity and mold risk. The plant's mild stress response temporarily increases terpene production.", howto:"Perform two defoliation passes: one at week 3 of flower and one at week 6. Remove only fan leaves that are directly blocking bud sites or impeding airflow. Remove no more than 20–25% of leaves per session. The fan leaves are the plant's solar panels — less is always more." },
      { id:"manifolding", level:"advanced", name:"Manifolding / Mainlining", short:"A precise multi-step technique using sequential topping and symmetrical LST to produce a perfectly even 8-cola structure from a single plant where every cola receives identical light and nutrients.", benefit:"Produces extremely predictable, even yields with 8 near-identical top colas per plant. Maximizes light efficiency for indoor grows. The most structured training method available.", howto:"Top at the 3rd node. Remove all growth below the 2nd node — leave only the two growth tips at node 2. Once both tips have 3 nodes each, top both again at their 3rd nodes. Tie all 4 resulting branches outward symmetrically. Top once more to produce the final 8 even branches. Allow full 7-day recovery between each topping." },
      { id:"rdwc", level:"advanced", name:"RDWC Hydroponics", short:"Recirculating Deep Water Culture. Plant roots are suspended directly in oxygenated, pH-controlled nutrient solution. A pump continuously recirculates solution through multiple connected buckets.", benefit:"20–30% faster vegetative growth than soil. Maximum nutrient uptake efficiency. Largest yields achievable in indoor cultivation. The highest-performance grow system available.", howto:"Connect DWC buckets via tubing to a central reservoir. Maintain nutrient solution EC at 0.5–0.8 in seedling, scaling to 1.4–2.0 in peak flower. pH must stay at 5.5–6.2 — check daily. Keep dissolved oxygen high with large air stones. Reservoir temperature must stay below 68°F to prevent pythium root rot." },
      { id:"kno", level:"advanced", name:"Korean Natural Farming — Living Soil", short:"Build a biologically active soil ecosystem using fermented plant extracts, compost teas, and diverse microbial inoculants. The soil microbiome feeds the plant — no synthetic nutrients required.", benefit:"Produces the most complex, layered terpene profiles achievable. No synthetic nutrient cost at scale. Regenerative — the same soil improves with each successive grow cycle. Exceptional finished flavor and aroma.", howto:"Start with a quality living soil mix: compost, worm castings, perlite, rock dust, and biochar. Inoculate with mycorrhizal fungi and beneficial bacteria at transplant. Water with aerated compost teas weekly. Supplement with fermented plant juice (FPJ) during veg and fermented fruit juice (FFJ) during flower. Water gently — preserve soil structure and microbial habitat." }
    ];
    const _CULTURES = [
      { region:"Emerald Triangle, California", flag:"&#127482;&#127480;", style:"Craft Sun-Grown Outdoor", badge:"Legacy", strains:["OG Kush","Trainwreck","Wedding Cake","SFV OG"], desc:"The birthplace of American cannabis culture. Three counties — Humboldt, Trinity, and Mendocino — produce the most celebrated outdoor cannabis in the world. Mediterranean climate, rich old-growth soil, and 3000+ ft elevation create ideal growing conditions. Small craft farms hand-trim and sun-cure. A legal gray area for decades shaped a culture of deep horticultural expertise and fierce strain stewardship that no commercial operation has replicated." },
      { region:"Amsterdam, Netherlands", flag:"&#127475;&#127473;", style:"Commercial Technical Indoor", badge:"Breeding Hub", strains:["White Widow","AK-47","Amnesia Haze","Super Silver Haze"], desc:"Low natural light forced Dutch growers to master indoor cultivation long before the rest of the world caught up. The coffeeshop system created commercial demand for consistent, high-quality product. Green House Seeds, Sensi Seeds, and Dutch Passion pioneered modern cannabis breeding and the global seed bank industry. Sea of Green technique was largely developed here. Amsterdam remains the center of cannabis genetics and horticultural innovation." },
      { region:"British Columbia, Canada", flag:"&#127464;&#127462;", style:"Boutique Premium Indoor", badge:"Craft Indoor", strains:["Pink Kush","Death Bubba","Rockstar","BC Big Bud"], desc:"BC Bud is internationally respected as some of the finest indoor cannabis produced anywhere. Cool climate drove innovation in artificial cultivation. The province developed a culture of high-end craft indoor growing — meticulous genetics selection, dialed environments, and long slow cures. Post-legalization, BC craft producers set the standard for premium packaged cannabis in Canada's regulated market." },
      { region:"Rif Mountains, Morocco", flag:"&#127474;&#127462;", style:"Traditional Hash Production", badge:"Hash Heritage", strains:["Beldia (Ketama landrace)","Local Rif landraces"], desc:"Morocco produces more hashish by volume than any other nation. Landrace Beldia and Ketama strains grow semi-wild at altitude throughout the Rif. Dry-sieve kief is pressed into slabs using techniques unchanged for centuries. Family farms have cultivated these plants for generations. Kif — raw cannabis mixed with black tobacco and smoked in a sebsi pipe — is a traditional Moroccan social practice. Hash export is the region's primary agricultural economy." },
      { region:"Bekaa Valley, Lebanon", flag:"&#127473;&#127463;", style:"Old-World Hash", badge:"Legendary Hash", strains:["Lebanese Red","Lebanese Blonde"], desc:"Lebanese Red and Lebanese Blonde were the benchmark hash varieties of 1960s–70s counterculture — a quality standard that shaped a generation's expectations. Cold water and dry-sieve methods produced compressed red and blonde slabs with distinctive terroir-specific flavor profiles. Civil war in the 1980s devastated production. The tradition is experiencing a revival as international interest in heritage cannabis genetics and artisanal hash grows." },
      { region:"Hindu Kush, Afghanistan & Pakistan", flag:"&#127462;&#127467;", style:"Hand-Rubbed Charas", badge:"Ancient Tradition", strains:["Afghani","Mazar-i-Sharif","Hindu Kush"], desc:"The Hindu Kush mountain range is the genetic source of indica cannabis for the entire world. Hash has been produced here for over 3000 years. Hand-rubbed charas — made by rolling live resinous flowers between the palms — is the original concentrate. Afghan indica genetics (short, dense, resin-heavy plants adapted to harsh mountain climate) became the foundation for virtually all modern indica and hybrid breeding programs globally." },
      { region:"Blue Mountains, Jamaica", flag:"&#127471;&#127474;", style:"Mountain Sativa Outdoor", badge:"Cultural Heritage", strains:["Lamb's Bread","Jamaican Lambsbread"], desc:"Lamb's Bread — most famously associated with Bob Marley — grows in Jamaica's Blue Mountains as a pure, long-season mountain sativa. Cannabis (ganja) is a sacrament in Rastafari, used in nyabinghi ceremonies for meditation and reasoning. Jamaican genetics shaped the sativa imports that reached the American market in the 1970s. Jamaica legalized personal use in 2015 and now cultivates a legal medical market built on its unique landrace heritage." },
      { region:"Colorado, USA", flag:"&#127482;&#127480;", style:"Commercial Recreational Indoor", badge:"Legal Pioneer", strains:["Ghost Train Haze","Gorilla Glue","Bruce Banner","Chemdawg"], desc:"Colorado legalized adult-use cannabis in 2012 — the first US state to do so. The regulatory framework developed in Denver became the blueprint for legal cannabis markets worldwide. Retail cannabis prices dropped 70% between 2012 and 2020 as supply scaled — while average potency and product quality simultaneously improved through intense commercial breeding competition. Colorado remains the testing ground for cannabis policy, product innovation, and consumption science." }
    ];
    const _STRAINS_GUIDE = [
      { name:"Northern Lights", env:"Indoor / Both", difficulty:"Beginner", yield:"High", flower:"7–9 weeks", notes:"The most forgiving strain in cannabis. Resilient to overwatering, underfeeding, and humidity swings. Compact indica structure. The definitive first-grow strain." },
      { name:"Blue Dream", env:"Outdoor / Greenhouse", difficulty:"Beginner", yield:"Very High", flower:"9–10 weeks", notes:"Easy outdoor giant. Vigorous, disease-resistant, forgiving. Balanced hybrid. Thrives with minimal intervention in most climates." },
      { name:"White Widow", env:"Indoor / Both", difficulty:"Beginner", yield:"Medium", flower:"8–9 weeks", notes:"Classic Dutch genetics. Resilient and highly trainable. Excellent for learning topping and LST. Consistent resin production in any environment." },
      { name:"Gorilla Glue #4", env:"Indoor / Both", difficulty:"Intermediate", yield:"Very High", flower:"8–9 weeks", notes:"Heavy producer requiring branch support due to cola weight. Extremely resinous — gloves are mandatory at harvest. Worth the extra management." },
      { name:"Amnesia Haze", env:"Outdoor / Greenhouse", difficulty:"Intermediate", yield:"High", flower:"10–11 weeks", notes:"Needs space and sun — a tall sativa reaching 2m+ outdoors. Longer flower time than most. Rewards patience with exceptional terpene complexity." },
      { name:"Wedding Cake", env:"Indoor", difficulty:"Advanced", yield:"High", flower:"9–10 weeks", notes:"Demanding but produces extraordinary quality. Sensitive to nutrient levels, requires dialed conditions. Best suited to growers with two or more successful grows." }
    ];
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Grower's Guide — Cannascenti</title>
<meta name="description" content="Complete cannabis growing guide: indoor, outdoor, greenhouse, training techniques, global cultures, and beginner strain recommendations.">
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
.gr-hero{padding:72px 32px 56px;max-width:1100px;margin:0 auto}
.gr-hero-label{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#52B788;margin-bottom:16px}
.gr-hero-title{font-family:'Cormorant Garamond',serif;font-size:clamp(2.2rem,5vw,3.8rem);font-weight:300;color:#F2EAD8;line-height:1.1;margin-bottom:16px}
.gr-hero-title em{color:#52B788;font-style:italic}
.gr-hero-sub{font-size:.95rem;color:rgba(242,234,216,0.55);max-width:620px;line-height:1.8}
.gr-section{max-width:1100px;margin:0 auto;padding:0 32px 72px}
.gr-sec-title{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;color:#F2EAD8;margin-bottom:8px}
.gr-sec-title em{color:#52B788;font-style:italic}
.gr-sec-sub{font-size:.86rem;color:rgba(242,234,216,0.45);margin-bottom:28px;line-height:1.7;max-width:640px}
.env-tabs{display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap}
.env-tab{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 22px;color:rgba(242,234,216,0.6);font-family:Montserrat,sans-serif;font-size:11px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .2s}
.env-tab.active,.env-tab:hover{border-color:#52B788;color:#F2EAD8;background:rgba(82,183,136,0.08)}
.env-panel{display:none;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:18px;padding:36px}
.env-panel.active{display:block}
.env-panel-header{display:flex;align-items:center;gap:16px;margin-bottom:8px}
.env-label{font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:300;color:#F2EAD8}
.env-tagline{font-size:.88rem;color:#52B788;margin-bottom:24px;font-style:italic}
.env-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
@media(max-width:560px){.env-grid{grid-template-columns:1fr}}
.env-col-label{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:rgba(242,234,216,0.32);margin-bottom:8px}
.env-list{list-style:none}
.env-list li{font-size:.82rem;color:rgba(242,234,216,0.62);padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04);padding-left:16px;position:relative}
.env-list.pro li::before{content:"+";position:absolute;left:0;color:#52B788;font-weight:700}
.env-list.con li::before{content:"&#8722;";position:absolute;left:0;color:#C9973A;font-weight:700}
.env-spec{background:rgba(255,255,255,0.03);border-radius:10px;padding:12px 16px;font-size:.8rem;color:rgba(242,234,216,0.58);line-height:1.65;margin-bottom:10px}
.env-spec strong{color:#52B788}
.env-strains{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.env-strain-tag{font-size:.75rem;background:rgba(82,183,136,0.08);border:1px solid rgba(82,183,136,0.18);color:#52B788;border-radius:6px;padding:3px 10px}
.level-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px}
.level-btn{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 18px;color:rgba(242,234,216,0.6);font-family:Montserrat,sans-serif;font-size:11px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .2s}
.level-btn.active,.level-btn:hover{border-color:#52B788;color:#F2EAD8;background:rgba(82,183,136,0.08)}
.tech-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.tech-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:24px;transition:border-color .2s}
.tech-card:hover{border-color:rgba(82,183,136,0.3)}
.tech-card.hidden{display:none}
.tech-level{font-size:10px;letter-spacing:.1em;text-transform:uppercase;border-radius:20px;padding:2px 10px;margin-bottom:12px;display:inline-block}
.tech-level.beginner{background:rgba(82,183,136,0.12);color:#52B788}
.tech-level.intermediate{background:rgba(201,151,58,0.12);color:#C9973A}
.tech-level.advanced{background:rgba(224,123,57,0.12);color:#E07B39}
.tech-name{font-family:'Cormorant Garamond',serif;font-size:1.2rem;color:#F2EAD8;margin-bottom:8px}
.tech-short{font-size:.82rem;line-height:1.72;color:rgba(242,234,216,0.6);margin-bottom:12px}
.tech-benefit{font-size:.78rem;color:#52B788;background:rgba(82,183,136,0.07);border-radius:8px;padding:7px 12px;margin-bottom:12px;line-height:1.6}
.tech-howto{font-size:.78rem;line-height:1.72;color:rgba(242,234,216,0.43);border-left:2px solid rgba(82,183,136,0.2);padding-left:12px;font-style:italic}
.culture-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.culture-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:24px}
.culture-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px}
.culture-region{font-size:.85rem;font-weight:600;color:#F2EAD8;margin-bottom:4px}
.culture-style-lbl{font-size:.73rem;color:rgba(242,234,216,0.38)}
.culture-badge{font-size:10px;letter-spacing:.08em;text-transform:uppercase;background:rgba(82,183,136,0.1);color:#52B788;border-radius:20px;padding:2px 10px;white-space:nowrap;flex-shrink:0;margin-left:8px}
.culture-strains{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px}
.culture-strain{font-size:.72rem;background:rgba(255,255,255,0.05);border-radius:5px;padding:2px 8px;color:rgba(242,234,216,0.52)}
.culture-desc{font-size:.78rem;line-height:1.72;color:rgba(242,234,216,0.48)}
.strain-table{width:100%;border-collapse:collapse}
.strain-table th{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(242,234,216,0.32);padding:8px 12px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.06)}
.strain-table td{font-size:.82rem;color:rgba(242,234,216,0.62);padding:12px;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:top}
.strain-table tr:hover td{background:rgba(255,255,255,0.02)}
.s-name{font-weight:600;color:#F2EAD8}
.s-diff{font-size:10px;letter-spacing:.07em;text-transform:uppercase;border-radius:20px;padding:2px 9px}
.s-diff.beginner{background:rgba(82,183,136,0.12);color:#52B788}
.s-diff.intermediate{background:rgba(201,151,58,0.12);color:#C9973A}
.s-diff.advanced{background:rgba(224,123,57,0.12);color:#E07B39}
.s-notes{font-size:.74rem;color:rgba(242,234,216,0.38);font-style:italic}
.gr-philosophy{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
@media(max-width:680px){.gr-philosophy{grid-template-columns:1fr}}
.phil-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:30px}
.phil-icon{font-size:1.8rem;margin-bottom:16px}
.phil-title{font-family:'Cormorant Garamond',serif;font-size:1.3rem;color:#F2EAD8;margin-bottom:10px}
.phil-body{font-size:.82rem;line-height:1.82;color:rgba(242,234,216,0.48)}
.gr-divider{border:none;border-top:1px solid rgba(255,255,255,0.06);margin:0 32px}
</style>
</head>
<body>
${ENC_NAV}
<div class="gr-hero">
  <div class="gr-hero-label">&#10022; Cannascenti Encyclopedia</div>
  <h1 class="gr-hero-title">From Seed to Harvest &mdash;<br><em>The Grower's Guide.</em></h1>
  <p class="gr-hero-sub">A comprehensive guide to cannabis cultivation: environment selection, training techniques from beginner to expert, global growing cultures, and the strains that define each approach.</p>
</div>

<div class="gr-section">
  <div class="gr-sec-title">Choose Your <em>Environment</em></div>
  <p class="gr-sec-sub">The environment you choose shapes everything — strain selection, training methods, setup cost, and annual yield. Each carries a distinct philosophy.</p>
  <div class="env-tabs" id="envTabs"></div>
  <div id="envPanels"></div>
</div>

<hr class="gr-divider">

<div class="gr-section" style="padding-top:60px">
  <div class="gr-sec-title">Training <em>Techniques</em></div>
  <p class="gr-sec-sub">How you shape your plant determines how many bud sites receive direct light — which directly determines yield and quality. Filter by experience level.</p>
  <div class="level-filters">
    <button class="level-btn active" id="lvl-all" onclick="filterLevel('all')">All</button>
    <button class="level-btn" id="lvl-beginner" onclick="filterLevel('beginner')">Beginner</button>
    <button class="level-btn" id="lvl-intermediate" onclick="filterLevel('intermediate')">Intermediate</button>
    <button class="level-btn" id="lvl-advanced" onclick="filterLevel('advanced')">Expert</button>
  </div>
  <div class="tech-grid" id="techGrid"></div>
</div>

<hr class="gr-divider">

<div class="gr-section" style="padding-top:60px">
  <div class="gr-sec-title">Global Growing <em>Cultures</em></div>
  <p class="gr-sec-sub">Cannabis cultivation has deep roots in cultures across six continents. Each region developed unique techniques, strains, and traditions shaped by climate, history, and necessity.</p>
  <div class="culture-grid" id="cultureGrid"></div>
</div>

<hr class="gr-divider">

<div class="gr-section" style="padding-top:60px">
  <div class="gr-sec-title">Beginner <em>Strain Guide</em></div>
  <p class="gr-sec-sub">Not all strains are equal in difficulty. These six cultivars represent the best entry points — forgiving genetics that reward basic technique and teach good habits.</p>
  <div style="overflow-x:auto"><table class="strain-table" id="strainTable"></table></div>
</div>

<hr class="gr-divider">

<div class="gr-section" style="padding-top:60px">
  <div class="gr-sec-title">The Grower's <em>Philosophy</em></div>
  <p class="gr-sec-sub">The environment you choose reveals something about your relationship with the plant.</p>
  <div class="gr-philosophy">
    <div class="phil-card">
      <div class="phil-icon">&#128161;</div>
      <div class="phil-title">The Indoor Grower</div>
      <div class="phil-body">You are a craftsperson. You control every variable — light spectrum, temperature to the degree, humidity to the percentage, CO2 concentration, nutrient EC to three decimal places. For you, growing is engineering. The plant is a system to be optimized. The result is the most potent, most precisely crafted cannabis achievable — and the satisfaction of a process completely within your command.</div>
    </div>
    <div class="phil-card">
      <div class="phil-icon">&#9728;</div>
      <div class="phil-title">The Outdoor Grower</div>
      <div class="phil-body">You are a farmer, in the oldest sense. You work with nature rather than against it — reading seasons, building living soil, surrendering some control in exchange for scale and authenticity. The plant grows as it evolved to grow: under full-spectrum sun, developing terpene complexity that no artificial light fully replicates. There is a quality to sun-grown cannabis that comes from exactly this: the plant was not comfortable, and it responded.</div>
    </div>
    <div class="phil-card">
      <div class="phil-icon">&#127969;</div>
      <div class="phil-title">The Greenhouse Grower</div>
      <div class="phil-body">You are a pragmatist with taste. You recognize that free sunlight is the most powerful grow light ever created, and that climate protection multiplies what nature provides. The greenhouse represents a philosophy of amplification — taking what the environment gives and extending, protecting, and optimizing it. The most cost-effective path to exceptional cannabis. The approach professional cultivators worldwide increasingly favor for its combination of quality, sustainability, and scalability.</div>
    </div>
  </div>
</div>

<script>
var ENVIRONMENTS = ${JSON.stringify(_ENVIRONMENTS)};
var TECHNIQUES = ${JSON.stringify(_TECHNIQUES)};
var CULTURES = ${JSON.stringify(_CULTURES)};
var STRAINS = ${JSON.stringify(_STRAINS_GUIDE)};
var currentEnv = 'indoor';

function renderEnvTabs() {
  document.getElementById('envTabs').innerHTML = ENVIRONMENTS.map(function(e) {
    return '<button class="env-tab' + (e.id === currentEnv ? ' active' : '') + '" onclick="selectEnv(\'' + e.id + '\')">' + e.icon + ' ' + e.label + '</button>';
  }).join('');
}

function selectEnv(id) {
  currentEnv = id;
  renderEnvTabs();
  document.querySelectorAll('.env-panel').forEach(function(p) { p.classList.remove('active'); });
  var panel = document.getElementById('env-panel-' + id);
  if (panel) panel.classList.add('active');
}

function renderEnvPanels() {
  document.getElementById('envPanels').innerHTML = ENVIRONMENTS.map(function(e) {
    var proItems = e.pros.map(function(p) { return '<li>' + p + '</li>'; }).join('');
    var conItems = e.cons.map(function(c) { return '<li>' + c + '</li>'; }).join('');
    var strainTags = e.strains.map(function(s) { return '<span class="env-strain-tag">' + s + '</span>'; }).join('');
    return '<div class="env-panel' + (e.id === currentEnv ? ' active' : '') + '" id="env-panel-' + e.id + '">' +
      '<div class="env-panel-header"><div class="env-label">' + e.label + '</div></div>' +
      '<div class="env-tagline">' + e.tagline + '</div>' +
      '<div class="env-grid">' +
        '<div><div class="env-col-label">Advantages</div><ul class="env-list pro">' + proItems + '</ul></div>' +
        '<div><div class="env-col-label">Disadvantages</div><ul class="env-list con">' + conItems + '</ul></div>' +
      '</div>' +
      '<div class="env-spec"><strong>Lighting:</strong> ' + e.lights + '</div>' +
      '<div class="env-spec"><strong>Temperature:</strong> ' + e.temp + '</div>' +
      '<div class="env-spec"><strong>Humidity:</strong> ' + e.humidity + '</div>' +
      '<div class="env-col-label" style="margin-top:16px;margin-bottom:8px">Recommended strains</div>' +
      '<div class="env-strains">' + strainTags + '</div>' +
    '</div>';
  }).join('');
}

function filterLevel(level) {
  document.querySelectorAll('.level-btn').forEach(function(b) { b.classList.remove('active'); });
  var btn = document.getElementById('lvl-' + level);
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.tech-card').forEach(function(card) {
    if (level === 'all' || card.getAttribute('data-level') === level) {
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
  });
}

function renderTech() {
  document.getElementById('techGrid').innerHTML = TECHNIQUES.map(function(t) {
    return '<div class="tech-card" data-level="' + t.level + '">' +
      '<span class="tech-level ' + t.level + '">' + t.level + '</span>' +
      '<div class="tech-name">' + t.name + '</div>' +
      '<p class="tech-short">' + t.short + '</p>' +
      '<div class="tech-benefit">' + t.benefit + '</div>' +
      '<p class="tech-howto">' + t.howto + '</p>' +
    '</div>';
  }).join('');
}

function renderCultures() {
  document.getElementById('cultureGrid').innerHTML = CULTURES.map(function(c) {
    var strainTags = c.strains.map(function(s) { return '<span class="culture-strain">' + s + '</span>'; }).join('');
    return '<div class="culture-card">' +
      '<div class="culture-top">' +
        '<div><div class="culture-region">' + c.flag + ' ' + c.region + '</div><div class="culture-style-lbl">' + c.style + '</div></div>' +
        '<span class="culture-badge">' + c.badge + '</span>' +
      '</div>' +
      '<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(242,234,216,0.3);margin-bottom:6px">Notable strains</div>' +
      '<div class="culture-strains">' + strainTags + '</div>' +
      '<p class="culture-desc">' + c.desc + '</p>' +
    '</div>';
  }).join('');
}

function renderStrains() {
  var rows = STRAINS.map(function(s) {
    var diffClass = s.difficulty.toLowerCase();
    return '<tr>' +
      '<td class="s-name">' + s.name + '</td>' +
      '<td>' + s.env + '</td>' +
      '<td><span class="s-diff ' + diffClass + '">' + s.difficulty + '</span></td>' +
      '<td>' + s.yield + '</td>' +
      '<td>' + s.flower + '</td>' +
      '<td class="s-notes">' + s.notes + '</td>' +
    '</tr>';
  }).join('');
  document.getElementById('strainTable').innerHTML =
    '<thead><tr><th>Strain</th><th>Environment</th><th>Difficulty</th><th>Yield</th><th>Flower Time</th><th>Notes</th></tr></thead>' +
    '<tbody>' + rows + '</tbody>';
}

document.addEventListener('DOMContentLoaded', function() {
  renderEnvTabs();
  renderEnvPanels();
  renderTech();
  renderCultures();
  renderStrains();
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
<meta name="description" content="12,000 years of cannabis history — from ancient China and the Silk Road to modern legalization. The complete timeline of the world's most consequential plant.">
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

  // ─── /extractions → redirect to /concentrates ─────────────────────────────
  if (req.method === "GET" && req.url === "/extractions") {
    res.writeHead(301,{"Location":"/concentrates"});
    res.end();
    return;
  }
  if (false && req.method === "GET" && req.url === "/extractions-old") {
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
    const _EM = [
      { tier:"solventless", name:"Ice Water Hash", sub:"Bubble hash · Cold water agitation", quality:"★★★★★", solvent:"None", yield:"3–8%", safety:"Completely safe", desc:"Cannabis is agitated in ice water, causing trichome heads to break off and sink. Collected through a series of mesh bags in increasingly fine micron sizes. Full-melt 6-star ice water hash is among the purest expressions of the plant.", notes:"The 73 and 90 micron bags produce the finest heads-only hash. Freeze-drying has revolutionized water hash quality, preserving terpenes that were lost in traditional air-drying." },
      { tier:"solventless", name:"Rosin", sub:"Heat + pressure extraction · Solventless concentrate", quality:"★★★★★", solvent:"None", yield:"10–25% (flower), 40–70% (hash)", safety:"Completely safe", desc:"Rosin is produced by applying heat and pressure to cannabis flower, kief, or ice water hash — squeezing out a sap-like concentrate. Zero solvents, instant results, full spectrum, and exceptional flavor.", notes:"Hash rosin from 6-star water hash is the most prized concentrate in the current market. Pressing at 160°F for 90 seconds yields the most terpene-rich product. Dab at 450°F max." },
      { tier:"solventless", name:"Dry Sift", sub:"Mechanical trichome separation · Kief collection", quality:"★★★★☆", solvent:"None", yield:"5–15%", safety:"Completely safe", desc:"The most ancient form of concentration — mechanically separating trichome heads from plant material through screens. Quality ranges from full-plant kief to hyper-refined 'pure gold' dry sift that rivals the best hash in purity.", notes:"Traditional Moroccan dry sift is worked with bare hands, using body heat to cold-press the kief into dark exterior, lighter interior slabs. The smell and flavor of properly made dry sift is irreplaceable." },
      { tier:"solvent", name:"BHO / PHO", sub:"Butane or Propane Hash Oil · Hydrocarbon extraction", quality:"★★★★★", solvent:"Butane / Propane", yield:"15–30%", safety:"Professional use only — explosion risk", desc:"Hydrocarbon extraction uses butane or propane to strip cannabinoids and terpenes from plant material. The most versatile extraction method — produces everything from shatter to live resin, budder, wax, and sauce.", notes:"Live resin BHO — made from fresh-frozen cannabis — preserves a terpene profile closer to the living plant than any other method. The gold standard for terpene-forward concentrates at scale." },
      { tier:"solvent", name:"CO2 Extraction", sub:"Supercritical carbon dioxide extraction", quality:"★★★★☆", solvent:"CO2 (no residue)", yield:"10–20%", safety:"Safe — no flammable solvents", desc:"CO2 becomes supercritical under specific temperature and pressure conditions, making it an effective solvent. Highly selective, tunable extraction that leaves no solvent residue. The dominant method for oil cartridges and commercial extract production.", notes:"CO2 oil has lower terpene content than hydrocarbon extracts but is more consumer-safe and infinitely scalable. Most vape cartridges use CO2 oil with added botanical terpenes." },
      { tier:"solvent", name:"Ethanol Extraction", sub:"High-proof alcohol wash · QWET / QWISO", quality:"★★★☆☆", solvent:"Food-grade ethanol", yield:"15–25%", safety:"Flammable — ventilation required", desc:"Ethanol is a food-safe solvent that efficiently extracts cannabinoids and terpenes. Quick-wash ethanol extraction (QWET) minimizes chlorophyll and lipid co-extraction. The preferred method for large-scale edibles production and RSO.", notes:"RSO (Rick Simpson Oil) is full-spectrum ethanol extract consumed orally for cancer treatment in alternative medicine contexts. The scientific evidence is limited but the cultural significance is substantial." },
      { tier:"solvent", name:"Distillate", sub:"Fractional distillation · THC isolate", quality:"★★★☆☆", solvent:"Process-dependent", yield:"Depends on source oil", safety:"Safe — final product is solvent-free", desc:"Distillate is the final step in refining cannabis oil — short-path fractional distillation purifies and concentrates specific cannabinoids to 90%+ purity. Nearly odorless and tasteless on its own. The backbone of the commercial vape cartridge industry.", notes:"Distillate is a blank canvas. High-quality live resin cartridges use actual plant terpenes instead of added botanical terpenes." },
      { tier:"traditional", name:"Charas", sub:"Hand-rubbed live resin · Ancient Indian tradition", quality:"★★★★☆", solvent:"None", yield:"Very low — grams per hour", safety:"Completely safe", desc:"The oldest known concentrate. Made by rubbing fresh, living cannabis plants between the palms, collecting the resin that adheres to the hands. Because it's made from living plant material, charas preserves terpene compounds that are destroyed during the drying process.", notes:"Malana Cream from the Parvati Valley is considered among the finest charas in the world. The isolation of the village and the specific landrace genetics create a product that cannot be replicated elsewhere." }
    ];
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
<meta name="description" content="From ancient charas to liquid diamonds — every cannabis concentrate and extraction method documented. Traditional hash, solventless rosin, hydrocarbon extracts, and more.">
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
/* Extraction methods */
.ext-section{margin-top:80px}
.ext-sec-title{font-family:'Cormorant Garamond',serif;font-size:clamp(1.6rem,4vw,2.4rem);font-weight:300;color:#F2EAD8;line-height:1.2;margin-bottom:8px}
.ext-sec-title em{color:#52B788;font-style:italic}
.ext-sec-sub{font-size:.88rem;color:rgba(242,234,216,0.45);margin-bottom:28px;line-height:1.7;max-width:640px}
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
.ext-tier-badge{font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;border-radius:12px;padding:2px 8px;font-weight:600}
.ext-tier-badge.solventless{background:rgba(82,183,136,0.15);color:#52B788}
.ext-tier-badge.solvent{background:rgba(232,168,76,0.15);color:#E8A84C}
.ext-tier-badge.traditional{background:rgba(155,114,207,0.15);color:#9B72CF}
.ext-desc{font-size:.84rem;line-height:1.7;color:rgba(242,234,216,0.7);margin-bottom:12px}
.ext-notes{font-size:.8rem;line-height:1.65;color:rgba(242,234,216,0.45);border-left:2px solid rgba(82,183,136,0.25);padding-left:12px;font-style:italic}
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

  <!-- Extraction Methods Section -->
  <div class="ext-section">
    <div class="enc-label" style="margin-bottom:12px">&#10022; The Extraction Process</div>
    <h2 class="ext-sec-title">How Concentrates <em>Are Made.</em></h2>
    <p class="ext-sec-sub">Every concentrate product starts with an extraction method. Understanding the process reveals why some products are prized for purity, others for flavor, and others for sheer potency.</p>
    <div class="ext-filter">
      <button class="ext-btn active" onclick="filterExt('all',this)">All Methods</button>
      <button class="ext-btn" onclick="filterExt('solventless',this)">Solventless</button>
      <button class="ext-btn" onclick="filterExt('solvent',this)">Solvent-Based</button>
      <button class="ext-btn" onclick="filterExt('traditional',this)">Traditional</button>
    </div>
    <div class="ext-grid" id="extGrid"></div>
  </div>
</div>

<script>
var CONC = ${JSON.stringify(_CONC)};
var EM = ${JSON.stringify(_EM)};
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

function filterExt(tier, btn) {
  document.querySelectorAll('.ext-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  document.querySelectorAll('.ext-card').forEach(function(c){
    c.classList.toggle('hidden', tier !== 'all' && c.dataset.tier !== tier);
  });
}

function renderMethods() {
  document.getElementById('extGrid').innerHTML = EM.map(function(m) {
    return '<div class="ext-card" data-tier="' + m.tier + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">' +
        '<div class="ext-name">' + m.name + '</div>' +
        '<span class="ext-tier-badge ' + m.tier + '">' + m.tier + '</span>' +
      '</div>' +
      '<div class="ext-sub">' + m.sub + '</div>' +
      '<div class="ext-meta">' +
        '<span class="ext-meta-item ext-quality">' + m.quality + '</span>' +
        '<span class="ext-meta-item">Yield: ' + m.yield + '</span>' +
        '<span class="ext-meta-item">' + m.solvent + '</span>' +
        '<span class="ext-meta-item">' + m.safety + '</span>' +
      '</div>' +
      '<p class="ext-desc">' + m.desc + '</p>' +
      '<p class="ext-notes">' + m.notes + '</p>' +
    '</div>';
  }).join('');
}

document.addEventListener('DOMContentLoaded', function(){
  renderCards('all');
  renderMethods();
});
</script>
</body></html>`;
    res.writeHead(200, {"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /glossary ────────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/glossary") {
    const _GL = [
      // ── SCIENCE ──
      { term:"Anandamide", cat:"science", def:"The body's naturally produced endocannabinoid — often called the 'bliss molecule.' Anandamide binds to CB1 receptors and regulates mood, memory, appetite, and pain. THC mimics anandamide's structure, which is why cannabis produces its psychoactive effects." },
      { term:"Bioavailability", cat:"science", def:"The percentage of a consumed cannabinoid that actually reaches the bloodstream. Smoked cannabis: 20–35%. Vaporized: 50–80%. Oral edibles: 4–20%. Sublingual tinctures: 40–50%. Method of consumption is the single biggest variable in how potent cannabis feels." },
      { term:"Broad Spectrum", cat:"science", def:"A cannabis extract containing multiple cannabinoids and terpenes, but with THC fully removed. Retains some entourage effect benefits without any psychoactive component. Common in CBD products aimed at people who cannot have any THC." },
      { term:"CB1 Receptor", cat:"science", def:"The primary receptor for THC in the human brain and nervous system. Densely concentrated in the hippocampus (memory), basal ganglia (movement), cerebellum (coordination), and prefrontal cortex (decision-making). CB1 activation is responsible for cannabis's psychoactive effects." },
      { term:"CB2 Receptor", cat:"science", def:"Cannabinoid receptor found primarily in immune tissue, the spleen, gut, and peripheral nervous system. CB2 activation modulates inflammation and immune response. CBD and CBG interact strongly with CB2 — the main pathway for cannabis's anti-inflammatory effects." },
      { term:"Cannabinoid", cat:"science", def:"A class of chemical compounds that interact with the endocannabinoid system. Over 100 cannabinoids have been identified in cannabis, including THC, CBD, CBG, CBN, THCV, and Delta-8. Each has a distinct molecular shape that determines which receptors it binds to and what effects it produces." },
      { term:"Decarboxylation", cat:"science", def:"The chemical process of removing a carboxyl group from THCA (converting it to active THC) or CBDA (converting to CBD) using heat. Raw cannabis contains inactive THCA — smoking or vaporizing provides instant decarboxylation. For edibles, cannabis must be heated at 220–240°F for 30–45 minutes before infusion." },
      { term:"Endocannabinoid System", cat:"science", def:"The biological system in all mammals that regulates mood, memory, pain, appetite, sleep, and immune function using endogenous cannabinoid molecules. Discovered in 1992, it consists of CB1 and CB2 receptors, endocannabinoids (anandamide, 2-AG), and the enzymes that synthesize and break them down." },
      { term:"Entourage Effect", cat:"science", def:"The theory that cannabinoids and terpenes work synergistically — producing effects greater than any single compound alone. Proposed by Dr. Ethan Russo. Explains why whole-plant cannabis often produces a more nuanced, effective experience than isolated THC or CBD." },
      { term:"Flavonoids", cat:"science", def:"Phytonutrients found throughout the plant kingdom, including cannabis. Cannabis-specific flavonoids (cannaflavins) have been shown to have anti-inflammatory and antioxidant properties. Flavonoids contribute to the plant's color and may contribute to entourage effects." },
      { term:"Full Spectrum", cat:"science", def:"An extract retaining the complete profile of cannabinoids, terpenes, and flavonoids from the original plant — including THC. Full spectrum extracts produce the most complete entourage effect and are considered the highest-quality form of cannabis extract." },
      { term:"Terpene", cat:"science", def:"Aromatic organic compounds produced by the trichomes of the cannabis plant — and by virtually every other plant on earth. Terpenes give each strain its distinctive smell and flavor, and interact with cannabinoids to modulate the character of the high. Over 200 terpenes have been identified in cannabis." },
      { term:"THCA", cat:"science", def:"Tetrahydrocannabinolic acid — the raw, non-psychoactive precursor to THC found in living and freshly harvested cannabis. THCA converts to active THC through decarboxylation (heat). The percentage on a lab report labeled 'THC' usually reflects potential THC after decarboxylation." },
      { term:"Trichomes", cat:"science", def:"Tiny resin-producing glands that cover the flowers and leaves of female cannabis plants. Trichomes are where cannabinoids, terpenes, and flavonoids are synthesized and stored. The density and maturity of trichomes — observable with a loupe — determines optimal harvest timing." },
      { term:"2-AG", cat:"science", def:"2-Arachidonoylglycerol — the most abundant endocannabinoid in the brain, present at 170x the concentration of anandamide. 2-AG is a full agonist at both CB1 and CB2 receptors and plays a key role in appetite regulation, pain relief, and immune function." },
      // ── CULTIVATION ──
      { term:"Apical Dominance", cat:"cultivation", def:"The natural tendency of a plant to direct its growth energy into the main central stem (apex), suppressing lateral branching. Topping removes the apex to eliminate apical dominance and redirect energy into multiple equal colas." },
      { term:"Autoflower", cat:"cultivation", def:"A cannabis variety that flowers based on age rather than light cycle. Derived from Cannabis ruderalis genetics. Autoflowers flower in 8–12 weeks from seed regardless of photoperiod — making them ideal for beginners, outdoor growers, and multiple harvests per season." },
      { term:"Clone", cat:"cultivation", def:"A genetically identical cutting taken from a mother plant and rooted to create a new plant. Cloning preserves the exact genetic expression (phenotype) of a specific plant — unlike seeds, which produce genetic variation. Professional growers use clones for consistent, repeatable results." },
      { term:"Cola", cat:"cultivation", def:"The main flowering cluster of a female cannabis plant — the primary bud site that receives the most direct light. 'Main cola' refers to the topmost, largest flower cluster. Training techniques like topping and manifolding aim to maximize the number of equal colas per plant." },
      { term:"Curing", cat:"cultivation", def:"The controlled drying and aging of harvested cannabis in sealed containers to develop flavor, aroma, and smoothness. Proper cure (2–8 weeks at 60–65°F, 58–62% RH) allows chlorophyll to break down and terpenes to fully develop. The cure is what separates top-shelf cannabis from mediocre." },
      { term:"Cultivar", cat:"cultivation", def:"The scientifically accurate term for what is commonly called a 'strain.' Short for 'cultivated variety.' A cultivar is a plant variety developed through selective breeding for specific traits. Most cannabis professionals now prefer 'cultivar' over 'strain,' though both terms are in common use." },
      { term:"Flushing", cat:"cultivation", def:"Watering cannabis with plain pH-adjusted water (no nutrients) for 1–2 weeks before harvest. Intended to purge residual nutrients from the plant and growing medium to improve the taste of the final product. Effectiveness is debated — more impactful in synthetic nutrient grows than living soil." },
      { term:"Landrace", cat:"cultivation", def:"A cannabis variety that developed naturally in a specific geographic region over thousands of years, adapted to local climate and conditions. Examples: Afghani (Hindu Kush), Durban Poison (South Africa), Thai. Landrace genetics form the foundation of virtually all modern cannabis breeding." },
      { term:"Living Soil", cat:"cultivation", def:"A cultivation approach focused on building a biologically active growing medium rich in beneficial microorganisms, fungi, and diverse organic matter. Plants in living soil are fed by the soil ecosystem rather than synthetic nutrients — producing more complex terpene profiles and sustainable results." },
      { term:"LST", cat:"cultivation", def:"Low Stress Training — bending and tying branches horizontally to expose lower bud sites directly to light without cutting the plant. Creates a wide, even canopy and can increase yield by 30% by maximizing the number of bud sites receiving direct light. Zero recovery time." },
      { term:"Manifolding", cat:"cultivation", def:"An advanced training technique using sequential topping and symmetrical LST to create a precisely even 8-cola structure from a single plant. Every cola receives identical light and nutrients. Produces extremely predictable yields at the cost of additional veg time." },
      { term:"Node", cat:"cultivation", def:"The point on the stem where branches and leaves emerge. Nodes are counted when topping — 'topping at the 5th node' means cutting the main stem above the 5th branch point. Node spacing indicates internodal distance, which affects final plant structure." },
      { term:"Phenotype", cat:"cultivation", def:"The physical expression of a plant's genetics in a given environment. Two seeds from the same genetic cross can produce phenotypically different plants with different aromas, structure, and potency. 'Pheno hunting' is the process of growing multiple seeds to find the superior expression." },
      { term:"Photoperiod", cat:"cultivation", def:"A cannabis plant that requires a specific light cycle to trigger flowering — typically 12 hours of darkness to initiate the flower stage. Outdoors, photoperiod plants flower as days shorten in autumn. Indoors, the grower controls flowering by switching to 12/12 lighting." },
      { term:"SCROG", cat:"cultivation", def:"Screen of Green — a training method using a horizontal net installed above the canopy. Branches are woven through the net laterally as they grow, creating a completely flat, even canopy that maximizes the number of bud sites in the direct light zone." },
      { term:"Topping", cat:"cultivation", def:"Cutting the main apical stem cleanly at the 5th node to eliminate apical dominance and force the plant to grow two equal main colas. The most fundamental yield-increasing technique. Combined with subsequent toppings, can exponentially increase cola count." },
      { term:"VPD", cat:"cultivation", def:"Vapor Pressure Deficit — the difference between the amount of moisture in the air and how much moisture the air can hold at saturation. The most accurate way to dial in the relationship between temperature and humidity for optimal plant transpiration and growth rate." },
      // ── CONCENTRATES ──
      { term:"BHO", cat:"concentrates", def:"Butane Hash Oil — cannabis extract produced using butane as a solvent. The most versatile extraction method, producing shatter, wax, budder, live resin, and sauce depending on technique. Must be professionally purged in a closed-loop system to remove solvent residue." },
      { term:"Charas", cat:"concentrates", def:"The oldest known concentrate — made by slowly rubbing fresh, living cannabis plants between the palms to collect the resin. Originating in India and Nepal, charas captures terpene compounds lost during drying. Malana Cream from Himachal Pradesh is the most prized variety." },
      { term:"Cold Cure", cat:"concentrates", def:"A rosin finishing technique where freshly pressed rosin is sealed in a jar and cured at 32–40°F for 24–72 hours. THCA nucleates slowly as temperature drops, creating a creamy badder consistency with smoother, more integrated flavor than fresh-press rosin." },
      { term:"Distillate", cat:"concentrates", def:"Cannabis oil refined through fractional distillation to 85–95% cannabinoid purity. Nearly odorless and tasteless on its own — a blank canvas. The backbone of the commercial vape cartridge and edibles industry. Terpenes are typically added back after distillation." },
      { term:"Full Melt", cat:"concentrates", def:"A grade of ice water hash or dry sift that melts completely on a hot surface with zero residue — rated 5–6 stars on the bubble hash scale. Full melt quality requires exceptional genetics, precise technique, and optimal wash conditions." },
      { term:"Hash Rosin", cat:"concentrates", def:"The pinnacle of solventless extraction — ice water hash pressed into rosin. The starting material determines the ceiling of quality: 6-star full-melt hash produces rosin with unrivaled terpene expression and potency. The most prized concentrate in the current market." },
      { term:"HTFSE", cat:"concentrates", def:"High Terpene Full Spectrum Extract — the terpene-rich fraction of live resin that separates from THCA crystals over time. HTFSE can contain 30–50% terpenes by weight, producing an intensely aromatic concentrate. Often combined with THCA diamonds as 'terp sauce.'" },
      { term:"Ice Water Hash", cat:"concentrates", def:"Cannabis agitated in ice-cold water to break off trichome heads, then collected through stacked mesh bags of decreasing micron sizes. The 73–90 micron bags produce the finest, purest hash. Freeze-drying preserves the terpene profile that air-drying destroys." },
      { term:"Kief", cat:"concentrates", def:"The collected trichome heads that fall from cannabis through mechanical agitation or handling — the most basic form of concentration. Quality ranges from full-plant kief (grinder bottom chamber) to hyper-refined dry sift that approaches full-melt quality." },
      { term:"Live Resin", cat:"concentrates", def:"Concentrate made from fresh-frozen cannabis using hydrocarbon solvents at very low temperatures. Preserves the complete terpene profile of the living plant. Coined in Colorado in 2013, live resin created the modern terpene-obsessed concentrate culture." },
      { term:"Live Rosin", cat:"concentrates", def:"The apex of solventless extraction — fresh-frozen cannabis washed into ice water hash, freeze-dried, then pressed into rosin. Captures the terpene profile of the living plant. Fresh-frozen starting material contains 20–40% more terpenes than cured material." },
      { term:"Rosin", cat:"concentrates", def:"Concentrate produced by applying heat and pressure to cannabis flower, kief, or ice water hash — squeezing out a sap-like resin. Zero solvents, instant results, full spectrum. The most accessible solventless concentrate, achievable at home with a rosin press." },
      { term:"Shatter", cat:"concentrates", def:"BHO purged at low temperature and allowed to cool undisturbed into a translucent, glass-like slab. Once the dominant concentrate form, largely displaced by more terpene-rich live resin and rosin. Clarity indicates purity — cloudiness suggests fats or impurities." },
      { term:"Solventless", cat:"concentrates", def:"Concentrates produced without chemical solvents — using only ice, water, heat, pressure, and mechanical agitation. Includes ice water hash, rosin, dry sift, and charas. The premium end of the concentrate market has shifted almost entirely to solventless in recent years." },
      { term:"THCA Diamonds", cat:"concentrates", def:"Near-pure crystalline THCA (95–99%) formed through a controlled nucleation process in supersaturated cannabis extract. Upon dabbing, heat instantly converts THCA to THC. Odorless alone — typically consumed combined with HTFSE sauce for the 'diamonds and sauce' format." },
      // ── CONSUMPTION ──
      { term:"Combustion", cat:"consumption", def:"Burning cannabis at 1500°F+ to produce smoke for inhalation. The oldest and most common consumption method. Produces carbon monoxide, benzene, and tar alongside cannabinoids and terpenes. Bioavailability: 20–35%. Onset: 30–90 seconds." },
      { term:"Dabbing", cat:"consumption", def:"Vaporizing a small amount of concentrate on a heated surface (nail or banger) and inhaling through a water pipe. The most efficient consumption method for concentrates. Low-temperature dabbing (440–520°F) preserves terpenes; high-temperature destroys them." },
      { term:"First Pass Effect", cat:"consumption", def:"The metabolic process where orally consumed THC passes through the liver before entering the bloodstream, converting delta-9-THC to 11-hydroxy-THC. This metabolite is more potent and crosses the blood-brain barrier more readily — explaining why edibles feel stronger and last longer than smoked cannabis." },
      { term:"Microdosing", cat:"consumption", def:"Consuming sub-perceptual amounts of cannabis (typically 1–5mg THC) to obtain therapeutic benefits without significant intoxication. Used for anxiety, focus, creativity, and pain management. The practice of starting low and going slow to find the minimum effective dose." },
      { term:"Onset Time", cat:"consumption", def:"The time between consuming cannabis and feeling its effects. Smoked/vaped: 30–90 seconds. Sublingual tinctures: 15–45 minutes. Edibles: 30 minutes–2 hours. Topicals: 15–30 minutes (local only). Onset variation is the most common cause of accidental overconsumption with edibles." },
      { term:"Titration", cat:"consumption", def:"The process of precisely adjusting cannabis dosage to find the minimum effective amount. Involves starting with a very low dose and increasing incrementally until desired effects are achieved. The gold standard approach for medical patients and new consumers." },
      { term:"Vaporization", cat:"consumption", def:"Heating cannabis below the combustion point (320–450°F) to convert cannabinoids and terpenes to vapor without producing smoke. Bioavailability: 50–80%. Eliminates combustion byproducts. The most efficient and cleanest inhalation method." },
      // ── CULTURE ──
      { term:"Budtender", cat:"culture", def:"A cannabis dispensary staff member who assists customers in selecting products. A skilled budtender has deep knowledge of strain genetics, cannabinoid profiles, terpene effects, and consumption methods — functioning as a sommelier of cannabis." },
      { term:"Craft Cannabis", cat:"culture", def:"Small-batch, artisanally produced cannabis grown with attention to genetics, environment, and post-harvest technique. Analogous to craft beer or small-estate wine. Typically hand-trimmed, slow-cured, and sold in limited quantities. Prioritizes quality over yield." },
      { term:"Curing (Culture)", cat:"culture", def:"In cannabis culture, 'the cure' refers to the post-harvest drying and aging process. A proper cure is the defining difference between commercial and connoisseur-grade cannabis. Long cures (4–8 weeks) produce smoother smoke, more complex flavor, and extended shelf life." },
      { term:"Dispensary", cat:"culture", def:"A licensed retail establishment where cannabis products are legally sold. Dispensaries range from clinical medical facilities to luxury lifestyle boutiques. Product selection, staff knowledge, and compliance requirements vary significantly by market." },
      { term:"Fresh Frozen", cat:"culture", def:"Cannabis that is harvested and immediately frozen in dry ice or liquid nitrogen, preventing any drying or curing. Used as starting material for live resin and live rosin extraction. Preserves a significantly higher terpene content than cured material." },
      { term:"Nose", cat:"culture", def:"Cannabis industry slang for a strain's aroma profile — equivalent to 'bouquet' in wine. An exceptional nose is considered a primary quality indicator by connoisseurs. Terpene integrity is the primary driver of nose quality." },
      { term:"Single Source", cat:"culture", def:"A cannabis product where every component — from the plant to the extraction — comes from one farm or producer. Analogous to single-estate olive oil or single-origin coffee. Allows complete traceability and reflects a specific terroir and grow philosophy." },
      { term:"Terroir", cat:"culture", def:"Borrowed from wine culture — the combination of climate, soil, altitude, and human technique that gives cannabis grown in a specific location its distinctive character. Used to describe why Emerald Triangle outdoor cannabis tastes different from indoor-grown product despite the same genetics." }
    ];

    const catColors = { science:"#5CA0E8", cultivation:"#52B788", concentrates:"#E8A84C", consumption:"#9B72CF", culture:"#E07B6A" };
    const catLabels = { science:"Science", cultivation:"Cultivation", concentrates:"Concentrates", consumption:"Consumption", culture:"Culture" };

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cannabis Glossary — Cannascenti Encyclopedia</title>
<meta name="description" content="The definitive cannabis glossary — 60+ terms covering cannabinoids, terpenes, cultivation, concentrates, and consumption. From anandamide to THCA diamonds.">
${ENC_FONTS}
<style>
${ENC_BASE_CSS}
.gl-search-wrap{margin-bottom:32px;position:relative}
.gl-search{width:100%;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:14px 18px 14px 44px;color:#F2EAD8;font-family:Montserrat,sans-serif;font-size:.9rem;outline:none;transition:border-color .2s}
.gl-search:focus{border-color:rgba(82,183,136,0.4)}
.gl-search::placeholder{color:rgba(242,234,216,0.3)}
.gl-search-icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:rgba(242,234,216,0.3);font-size:.9rem;pointer-events:none}
.gl-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:36px}
.gl-btn{background:none;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:6px 16px;font-family:Montserrat,sans-serif;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:6px}
.gl-btn.active,.gl-btn:hover{border-color:currentColor;background:rgba(255,255,255,0.05)}
.gl-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.gl-count{font-size:.65rem;opacity:.5;margin-left:2px}
.gl-alpha-bar{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:40px;padding-bottom:24px;border-bottom:1px solid rgba(255,255,255,0.06)}
.gl-alpha-btn{width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:600;border-radius:6px;cursor:pointer;color:rgba(242,234,216,0.4);background:none;border:none;font-family:Montserrat,sans-serif;transition:all .2s}
.gl-alpha-btn:hover,.gl-alpha-btn.has-terms{color:#52B788}
.gl-alpha-btn.active{background:rgba(82,183,136,0.1);color:#52B788}
.gl-alpha-btn.empty{opacity:.2;cursor:default}
.gl-letter-group{margin-bottom:40px}
.gl-letter{font-family:'Cormorant Garamond',serif;font-size:2.5rem;font-weight:300;color:rgba(82,183,136,0.3);margin-bottom:16px;line-height:1}
.gl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:14px}
.gl-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px;transition:border-color .2s}
.gl-card:hover{border-color:rgba(255,255,255,0.14)}
.gl-card.hidden{display:none}
.gl-card-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;gap:10px}
.gl-term{font-family:'Cormorant Garamond',serif;font-size:1.2rem;font-weight:400;color:#F2EAD8}
.gl-cat{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;border-radius:12px;padding:2px 8px;font-weight:600;white-space:nowrap;flex-shrink:0}
.gl-def{font-size:.8rem;line-height:1.75;color:rgba(242,234,216,0.58)}
.gl-no-results{text-align:center;padding:60px 0;font-size:.9rem;color:rgba(242,234,216,0.3)}
</style>
</head>
<body>
${ENC_NAV}
<div class="enc-page">
  <div class="enc-page-header">
    <div class="enc-label">&#10022; Cannascenti Encyclopedia</div>
    <h1 class="enc-title">The Cannabis <em>Glossary.</em></h1>
    <p class="enc-desc">Every term you'll encounter in cannabis — from the science of the endocannabinoid system to cultivation technique to concentrate culture. Searchable, filterable, and plainly explained.</p>
  </div>

  <div class="gl-search-wrap">
    <span class="gl-search-icon">&#128269;</span>
    <input class="gl-search" id="glSearch" type="text" placeholder="Search terms..." oninput="filterGlossary()">
  </div>

  <div class="gl-filters" id="glFilters"></div>
  <div class="gl-alpha-bar" id="glAlpha"></div>
  <div id="glContent"></div>
</div>

<script>
var TERMS = ${JSON.stringify(_GL)};
var CAT_COLORS = ${JSON.stringify(catColors)};
var CAT_LABELS = ${JSON.stringify(catLabels)};
var activeCat = 'all';
var activeLetter = 'all';

function renderFilters() {
  var cats = ['all','science','cultivation','concentrates','consumption','culture'];
  document.getElementById('glFilters').innerHTML = cats.map(function(c) {
    var col = c === 'all' ? '#F2EAD8' : CAT_COLORS[c];
    var lbl = c === 'all' ? 'All' : CAT_LABELS[c];
    var count = c === 'all' ? TERMS.length : TERMS.filter(function(t){ return t.cat === c; }).length;
    return '<button class="gl-btn' + (activeCat === c ? ' active' : '') + '" style="color:' + col + '" onclick="setCat(\'' + c + '\')">' +
      (c !== 'all' ? '<div class="gl-dot" style="background:' + col + '"></div>' : '') +
      lbl + '<span class="gl-count">' + count + '</span>' +
    '</button>';
  }).join('');
}

function setCat(cat) {
  activeCat = cat;
  activeLetter = 'all';
  renderFilters();
  renderAlpha();
  renderContent();
}

function getFiltered() {
  var q = (document.getElementById('glSearch').value || '').toLowerCase().trim();
  return TERMS.filter(function(t) {
    var catOk = activeCat === 'all' || t.cat === activeCat;
    var letterOk = activeLetter === 'all' || t.term[0].toUpperCase() === activeLetter;
    var searchOk = !q || t.term.toLowerCase().indexOf(q) !== -1 || t.def.toLowerCase().indexOf(q) !== -1;
    return catOk && letterOk && searchOk;
  });
}

function renderAlpha() {
  var filtered = getFiltered();
  var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  var available = {};
  TERMS.filter(function(t){ return activeCat === 'all' || t.cat === activeCat; }).forEach(function(t) {
    available[t.term[0].toUpperCase()] = true;
  });
  document.getElementById('glAlpha').innerHTML =
    '<button class="gl-alpha-btn' + (activeLetter === 'all' ? ' active' : '') + '" onclick="setLetter(\'all\')">All</button>' +
    letters.map(function(l) {
      var has = available[l];
      var isActive = activeLetter === l;
      return '<button class="gl-alpha-btn' + (isActive ? ' active' : '') + (has ? ' has-terms' : ' empty') + '"' +
        (has ? ' onclick="setLetter(\'' + l + '\')"' : '') + '>' + l + '</button>';
    }).join('');
}

function setLetter(l) {
  activeLetter = l;
  renderAlpha();
  renderContent();
}

function renderContent() {
  var filtered = getFiltered();
  if (!filtered.length) {
    document.getElementById('glContent').innerHTML = '<div class="gl-no-results">No terms found.</div>';
    return;
  }
  var groups = {};
  filtered.forEach(function(t) {
    var l = t.term[0].toUpperCase();
    if (!groups[l]) groups[l] = [];
    groups[l].push(t);
  });
  var letters = Object.keys(groups).sort();
  document.getElementById('glContent').innerHTML = letters.map(function(l) {
    var cards = groups[l].map(function(t) {
      var col = CAT_COLORS[t.cat] || '#52B788';
      var lbl = CAT_LABELS[t.cat] || t.cat;
      return '<div class="gl-card">' +
        '<div class="gl-card-top">' +
          '<div class="gl-term">' + t.term + '</div>' +
          '<span class="gl-cat" style="background:' + col + '22;color:' + col + '">' + lbl + '</span>' +
        '</div>' +
        '<p class="gl-def">' + t.def + '</p>' +
      '</div>';
    }).join('');
    return '<div class="gl-letter-group">' +
      '<div class="gl-letter">' + l + '</div>' +
      '<div class="gl-grid">' + cards + '</div>' +
    '</div>';
  }).join('');
}

function filterGlossary() {
  activeLetter = 'all';
  renderAlpha();
  renderContent();
}

document.addEventListener('DOMContentLoaded', function() {
  renderFilters();
  renderAlpha();
  renderContent();
});
</script>
</body></html>`;
    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
    return;
  }

  // ─── /quiz ────────────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/quiz") {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Cannascenti Match — Find Your Strain</title>
<meta name="description" content="5 questions. 30 seconds. A personalized cannabis profile matched to real strains from the Cannascenti database.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Great+Vibes&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:#060d0a;color:#F2EAD8;font-family:Montserrat,sans-serif;font-weight:300;min-height:100vh;overflow-x:hidden}
a{color:#52B788;text-decoration:none}
/* Ambient glow */
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 80% 60% at 50% -10%,rgba(82,183,136,0.06) 0%,transparent 70%);pointer-events:none;z-index:0}
/* Nav */
.qnav{display:flex;align-items:center;justify-content:space-between;padding:24px 48px;position:sticky;top:0;background:rgba(6,13,10,0.9);backdrop-filter:blur(12px);z-index:100;border-bottom:1px solid rgba(255,255,255,0.05)}
.qnav-logo{font-family:'Great Vibes',cursive;font-size:26px;color:#F2EAD8}
.qnav-back{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:rgba(242,234,216,0.4);transition:color .2s}
.qnav-back:hover{color:#52B788}
@media(max-width:600px){.qnav{padding:20px 24px}}
/* Wrapper */
.qwrap{max-width:760px;margin:0 auto;padding:60px 32px 120px;position:relative;z-index:1}
@media(max-width:600px){.qwrap{padding:40px 20px 80px}}
/* Intro */
.q-intro{text-align:center;padding:40px 0}
.q-label{font-size:10px;letter-spacing:.25em;text-transform:uppercase;color:#52B788;margin-bottom:20px}
.q-intro-title{font-family:'Cormorant Garamond',serif;font-size:clamp(2.4rem,6vw,4rem);font-weight:300;line-height:1.1;color:#F2EAD8;margin-bottom:20px}
.q-intro-title em{font-style:italic;color:#52B788}
.q-intro-sub{font-size:.95rem;color:rgba(242,234,216,0.55);line-height:1.8;max-width:500px;margin:0 auto 40px}
.q-start-btn{display:inline-flex;align-items:center;gap:10px;background:#52B788;color:#060d0a;font-family:Montserrat,sans-serif;font-size:13px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;padding:16px 40px;border-radius:100px;border:none;cursor:pointer;transition:all .2s}
.q-start-btn:hover{background:#74C69D;transform:translateY(-1px)}
/* Progress */
.q-progress{margin-bottom:48px}
.q-progress-bar{height:2px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;margin-bottom:10px}
.q-progress-fill{height:100%;background:#52B788;border-radius:2px;transition:width .4s ease}
.q-progress-label{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:rgba(242,234,216,0.3)}
/* Question */
.q-question{font-family:'Cormorant Garamond',serif;font-size:clamp(1.6rem,4vw,2.4rem);font-weight:300;color:#F2EAD8;line-height:1.3;margin-bottom:36px;font-style:italic}
/* Options grid */
.q-options{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.q-option{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:20px 18px;cursor:pointer;transition:all .2s;text-align:left}
.q-option:hover{border-color:rgba(82,183,136,0.4);background:rgba(82,183,136,0.05)}
.q-option.selected{border-color:#52B788;background:rgba(82,183,136,0.1)}
.q-opt-icon{font-size:1.6rem;margin-bottom:10px}
.q-opt-label{font-size:.88rem;font-weight:500;color:#F2EAD8;margin-bottom:4px;letter-spacing:.02em}
.q-opt-sub{font-size:.75rem;color:rgba(242,234,216,0.45);line-height:1.5}
/* Fade */
.q-fade{opacity:0;transition:opacity .3s}
.q-fade.visible{opacity:1}
/* Analyzing */
.q-analyzing{text-align:center;padding:80px 0}
.q-analyzing-title{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:300;font-style:italic;color:#F2EAD8;margin-bottom:8px}
.q-analyzing-sub{font-size:.82rem;color:rgba(242,234,216,0.4);margin-bottom:32px;letter-spacing:.08em;text-transform:uppercase}
.q-dots{display:flex;justify-content:center;gap:8px}
.q-dot{width:8px;height:8px;border-radius:50%;background:#52B788;animation:qdot 1.2s ease-in-out infinite}
.q-dot:nth-child(2){animation-delay:.2s}
.q-dot:nth-child(3){animation-delay:.4s}
@keyframes qdot{0%,80%,100%{transform:scale(0.5);opacity:.3}40%{transform:scale(1);opacity:1}}
/* Results */
.q-result-header{text-align:center;margin-bottom:52px}
.q-result-label{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#52B788;margin-bottom:12px}
.q-result-profile{font-size:.78rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(242,234,216,0.4);margin-bottom:8px}
.q-result-title{font-family:'Cormorant Garamond',serif;font-size:clamp(2rem,5vw,3.2rem);font-weight:300;font-style:italic;color:#F2EAD8;line-height:1.2;margin-bottom:16px}
.q-result-desc{font-size:.9rem;line-height:1.8;color:rgba(242,234,216,0.6);max-width:560px;margin:0 auto}
/* Strain cards */
.q-strains{display:flex;flex-direction:column;gap:16px;margin-bottom:48px}
.q-strain-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px;transition:border-color .2s}
.q-strain-card:hover{border-color:rgba(82,183,136,0.25)}
.q-strain-card.best{border-color:rgba(82,183,136,0.3)}
.q-strain-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px;gap:12px}
.q-strain-badge{font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;background:rgba(82,183,136,0.1);color:#52B788;border-radius:20px;padding:3px 10px;white-space:nowrap;flex-shrink:0}
.q-strain-badge.gold{background:rgba(232,168,76,0.12);color:#E8A84C}
.q-strain-name{font-family:'Cormorant Garamond',serif;font-size:1.6rem;font-weight:400;color:#F2EAD8;margin-bottom:4px}
.q-strain-type-row{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}
.q-strain-type{font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;border-radius:20px;padding:2px 10px;font-weight:500}
.q-strain-type.sativa{background:rgba(232,168,76,0.12);color:#E8A84C}
.q-strain-type.indica{background:rgba(155,114,207,0.12);color:#9B72CF}
.q-strain-type.hybrid{background:rgba(82,183,136,0.12);color:#52B788}
.q-strain-thc{font-size:.75rem;color:rgba(242,234,216,0.5)}
.q-strain-tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.q-strain-tag{font-size:.68rem;background:rgba(255,255,255,0.05);border-radius:6px;padding:2px 8px;color:rgba(242,234,216,0.5)}
.q-strain-tag.terpene{background:rgba(82,183,136,0.07);color:#52B788}
.q-strain-desc{font-size:.82rem;line-height:1.75;color:rgba(242,234,216,0.6)}
/* CTAs */
.q-result-ctas{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.q-retake-btn{background:none;border:1px solid rgba(255,255,255,0.15);color:rgba(242,234,216,0.6);font-family:Montserrat,sans-serif;font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:12px 24px;border-radius:100px;cursor:pointer;transition:all .2s}
.q-retake-btn:hover{border-color:rgba(255,255,255,0.3);color:#F2EAD8}
.q-browse-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(82,183,136,0.3);color:#52B788;font-family:Montserrat,sans-serif;font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:12px 24px;border-radius:100px;transition:all .2s}
.q-browse-btn:hover{background:rgba(82,183,136,0.08)}
</style>
</head>
<body>
<nav class="qnav">
  <a href="/" class="qnav-logo">Cannascenti</a>
  <a href="/" class="qnav-back">&#8592; Home</a>
</nav>

<div class="qwrap">
  <!-- INTRO -->
  <div id="qIntro" class="q-intro">
    <div class="q-label">&#10022; The Cannascenti Match</div>
    <h1 class="q-intro-title">Find what <em>actually</em><br>works for you.</h1>
    <p class="q-intro-sub">5 questions. 30 seconds. A personalized cannabis profile matched to real strains from our database of 392+ cultivars.</p>
    <button class="q-start-btn" onclick="startQuiz()">Begin &#8594;</button>
  </div>

  <!-- QUIZ FLOW -->
  <div id="qFlow" style="display:none">
    <div class="q-progress">
      <div class="q-progress-bar"><div class="q-progress-fill" id="qProgressFill" style="width:20%"></div></div>
      <div class="q-progress-label" id="qProgressLabel">Question 1 of 5</div>
    </div>
    <div id="qStep" class="q-fade"></div>
  </div>

  <!-- ANALYZING -->
  <div id="qAnalyzing" style="display:none" class="q-analyzing">
    <div class="q-analyzing-title">Analyzing your profile&#8230;</div>
    <div class="q-analyzing-sub">Matching against 392+ strains</div>
    <div class="q-dots"><div class="q-dot"></div><div class="q-dot"></div><div class="q-dot"></div></div>
  </div>

  <!-- RESULTS -->
  <div id="qResult" style="display:none"></div>
</div>

<script>
var ALL_STRAINS = ${JSON.stringify(STRAINS_DB)};

var STEPS = [
  {
    q: 'How do you want to feel?',
    options: [
      {icon:'&#128524;', label:'Relaxed', sub:'Take the edge off. Shoulders down, brain quiet.', scores:{relax:3,sleep:1}},
      {icon:'&#9889;', label:'Focused', sub:'Locked in and actually getting things done.', scores:{focus:3,uplift:1}},
      {icon:'&#128564;', label:'Sleepy', sub:'Stop lying awake. Real, deep sleep.', scores:{sleep:3,relax:1}},
      {icon:'&#127912;', label:'Creative', sub:'Think sideways. Make something. See it differently.', scores:{creative:3,uplift:1}},
      {icon:'&#128516;', label:'Uplifted', sub:'Feel genuinely, fully good. Social and alive.', scores:{uplift:3,creative:1}},
      {icon:'&#9878;', label:'Balanced', sub:'Something smooth — no extremes, no surprises.', scores:{relax:2,focus:1}}
    ]
  },
  {
    q: 'When are you using it?',
    options: [
      {icon:'&#127749;', label:'Morning', sub:'Start the day with intention and energy.', scores:{focus:2,uplift:1}},
      {icon:'&#9728;', label:'Afternoon', sub:'Bridge the gap. Keep going or reset.', scores:{creative:1,relax:1}},
      {icon:'&#127750;', label:'Evening', sub:'The day is done. Time to decompress.', scores:{relax:2,sleep:1}},
      {icon:'&#127769;', label:'Bedtime', sub:"I just need to actually sleep tonight.", scores:{sleep:3,relax:1}}
    ]
  },
  {
    q: 'How much experience do you have?',
    options: [
      {icon:'&#127807;', label:'First Timer', sub:"I've never done this before — or almost never.", scores:{relax:1}, beginner:true},
      {icon:'&#127807;', label:'Occasional', sub:'A handful of times a year. Still learning.', scores:{relax:1}, beginner:true},
      {icon:'&#128168;', label:'Regular', sub:'A few times a week. I know what I like.', scores:{focus:1,creative:1}},
      {icon:'&#128293;', label:'Daily', sub:'Every day. Cannabis is part of my routine.', scores:{focus:2,creative:1}}
    ]
  },
  {
    q: "What are you actually trying to do?",
    options: [
      {icon:'&#129495;', label:'Unwind & De-stress', sub:'I need to actually turn my brain off.', scores:{relax:3}},
      {icon:'&#128161;', label:'Productivity', sub:'Work, create, focus — without the brain fog.', scores:{focus:3}},
      {icon:'&#128164;', label:'Better Sleep', sub:"I'm tired of lying awake at 2am.", scores:{sleep:3}},
      {icon:'&#127917;', label:'Boost Creativity', sub:'Art, music, writing. I want to make things.', scores:{creative:3}},
      {icon:'&#129309;', label:'Social & Fun', sub:'Be present, laugh more, feel alive.', scores:{uplift:3}},
      {icon:'&#128170;', label:'Pain & Tension', sub:'My body needs a break. Physical relief.', scores:{relax:2,sleep:1}}
    ]
  },
  {
    q: 'How do you prefer to use it?',
    options: [
      {icon:'&#127807;', label:'Flower', sub:'Classic. The full, natural experience.', scores:{}},
      {icon:'&#128168;', label:'Vape', sub:'Clean, discreet, no smoke.', scores:{}},
      {icon:'&#127851;', label:'Edibles', sub:'I want it to last longer and feel deeper.', scores:{sleep:1,relax:1}},
      {icon:'&#128167;', label:'Tincture', sub:'I want control — precise, measured dosing.', scores:{focus:1}},
      {icon:'&#129335;', label:'Open to anything', sub:'Just show me what works best for my goals.', scores:{}}
    ]
  }
];

var PROFILES = {
  relax: {
    name:'The Relaxed Unwinder',
    title:'Unwind. Release. Breathe.',
    desc:"You want to decompress — fully. Not half-asleep, not foggy. Just that feeling where your shoulders drop and the week stops mattering. Myrcene and linalool are your allies.",
    tags:['relaxing','evening','stress-relief','body-high','kush','indica-dom','nighttime','og'],
    effects:['Relaxed','Sleepy','Happy'],
    types:['Indica','Hybrid'],
    avoidTags:['daytime','morning','energetic']
  },
  focus: {
    name:'The Sharp Achiever',
    title:'Sharp. Clear. In the zone.',
    desc:"Locked in and actually getting things done. Terpinolene and pinene keep you sharp without the anxious edge — the kind of session where you sit down to work and actually do it.",
    tags:['focus','daytime','productive','morning','creative','sativa-dom','energetic','classic'],
    effects:['Focused','Creative','Energetic','Uplifted'],
    types:['Sativa','Hybrid'],
    avoidTags:['nighttime','sleep','couch-lock','heavy']
  },
  sleep: {
    name:'The Deep Rest Seeker',
    title:'Power down. Deep rest.',
    desc:"Done lying awake. These strains are built to quiet your mind, relax your muscles, and guide you into the kind of sleep you've been missing.",
    tags:['sleep','nighttime','couch-lock','heavy','indica-dom','relaxing','pain-relief'],
    effects:['Sleepy','Relaxed'],
    types:['Indica'],
    avoidTags:['daytime','morning','energetic','focus','sativa-dom']
  },
  creative: {
    name:'The Creative Explorer',
    title:'Open up. Make things.',
    desc:"Open up. Think sideways. Make something. Limonene and ocimene lift your mood and unlock lateral thinking without putting you to sleep.",
    tags:['creative','social','uplifting','daytime','fun','euphoric','citrus','tropical'],
    effects:['Creative','Uplifted','Happy','Energetic'],
    types:['Sativa','Hybrid'],
    avoidTags:['sleep','nighttime','couch-lock','heavy']
  },
  uplift: {
    name:'The Social Energy Seeker',
    title:'Light. Euphoric. Alive.',
    desc:"Limonene-dominant strains drive that bright, mood-elevated high that makes you want to call someone and actually go outside.",
    tags:['social','euphoric','uplifting','energetic','fun','citrus','tropical','lemon'],
    effects:['Uplifted','Happy','Energetic','Creative'],
    types:['Sativa','Hybrid'],
    avoidTags:['sleep','nighttime','couch-lock','heavy']
  },
  balanced: {
    name:'The Balanced Everyday',
    title:'The best of both worlds.',
    desc:"Smooth, versatile, no extremes. The best of both worlds — hybrid strains with caryophyllene and limonene give relaxation and mood lift simultaneously.",
    tags:['balanced','beginner-friendly','hybrid','sweet','fruity','berry','fun'],
    effects:['Relaxed','Happy','Creative','Euphoric'],
    types:['Hybrid'],
    avoidTags:[]
  }
};

var scores = {relax:0, focus:0, sleep:0, creative:0, uplift:0};
var step = 0;
var isBeginner = false;
var WEIGHTS = [2,1,1,2,1];

function startQuiz() {
  document.getElementById('qIntro').style.display = 'none';
  document.getElementById('qFlow').style.display = 'block';
  renderStep();
}

function renderStep() {
  var s = STEPS[step];
  var pct = ((step + 1) / STEPS.length * 100) + '%';
  document.getElementById('qProgressFill').style.width = pct;
  document.getElementById('qProgressLabel').textContent = 'Question ' + (step + 1) + ' of ' + STEPS.length;
  var opts = s.options.map(function(o, i) {
    return '<div class="q-option" onclick="pickOption(' + i + ')">' +
      '<div class="q-opt-icon">' + o.icon + '</div>' +
      '<div class="q-opt-label">' + o.label + '</div>' +
      '<div class="q-opt-sub">' + o.sub + '</div>' +
    '</div>';
  }).join('');
  var html = '<p class="q-question">' + s.q + '</p><div class="q-options">' + opts + '</div>';
  var el = document.getElementById('qStep');
  el.classList.remove('visible');
  el.innerHTML = html;
  setTimeout(function() { el.classList.add('visible'); }, 20);
}

function pickOption(idx) {
  var opt = STEPS[step].options[idx];
  var w = WEIGHTS[step] || 1;
  Object.keys(opt.scores || {}).forEach(function(k) {
    if (scores[k] !== undefined) scores[k] += (opt.scores[k] * w);
  });
  if (opt.beginner) isBeginner = true;

  // Highlight selection briefly then advance
  var cards = document.querySelectorAll('.q-option');
  if (cards[idx]) cards[idx].classList.add('selected');

  setTimeout(function() {
    step++;
    if (step >= STEPS.length) {
      showAnalyzing();
    } else {
      renderStep();
    }
  }, 280);
}

function showAnalyzing() {
  document.getElementById('qFlow').style.display = 'none';
  document.getElementById('qAnalyzing').style.display = 'block';
  setTimeout(showResults, 1600);
}

function getProfile() {
  var best = 'balanced';
  var bestScore = -1;
  var order = ['relax','focus','sleep','creative','uplift'];
  order.forEach(function(k) {
    if (scores[k] > bestScore) { bestScore = scores[k]; best = k; }
  });
  return best;
}

function scoreStrain(strain, profile) {
  var p = PROFILES[profile];
  var s = 0;
  var tags = strain.tags || [];
  var effects = strain.effects || [];

  tags.forEach(function(t) {
    if (p.tags.indexOf(t) !== -1) s += 3;
    if (p.avoidTags.indexOf(t) !== -1) s -= 4;
  });
  effects.forEach(function(e) {
    if (p.effects.indexOf(e) !== -1) s += 2;
  });
  if (p.types.indexOf(strain.type) !== -1) s += 2;

  if (isBeginner) {
    if (tags.indexOf('beginner-friendly') !== -1) s += 3;
    if ((strain.thc_max || 20) <= 18) s += 2;
    else if ((strain.thc_max || 20) >= 25) s -= 3;
  }
  s += (strain.rating || 4);
  return s;
}

function getTopStrains(profile) {
  var scored = ALL_STRAINS.map(function(s) {
    return {strain: s, score: scoreStrain(s, profile)};
  });
  scored.sort(function(a,b) { return b.score - a.score; });
  return scored.slice(0,3).map(function(x) { return x.strain; });
}

function strainCard(strain, rank) {
  var badges = ['&#11088; Best Match', isBeginner ? '&#127807; Gentle Option' : '&#128293; Step It Up', '&#127807; Start Here'];
  var badgeClass = rank === 0 ? 'gold' : '';
  var typeClass = strain.type ? strain.type.toLowerCase() : 'hybrid';
  var thc = (strain.thc_min || '?') + '\u2013' + (strain.thc_max || '?') + '%';
  var terps = (strain.terpenes || []).slice(0,3).map(function(t) {
    return '<span class="q-strain-tag terpene">' + t + '</span>';
  }).join('');
  var effs = (strain.effects || []).slice(0,3).map(function(e) {
    return '<span class="q-strain-tag">' + e + '</span>';
  }).join('');
  var flavors = (strain.flavors || []).slice(0,3).map(function(f) {
    return '<span class="q-strain-tag">' + f + '</span>';
  }).join('');
  return '<div class="q-strain-card' + (rank === 0 ? ' best' : '') + '">' +
    '<div class="q-strain-top">' +
      '<div>' +
        '<div class="q-strain-name">' + strain.name + '</div>' +
        '<div class="q-strain-type-row">' +
          '<span class="q-strain-type ' + typeClass + '">' + strain.type + '</span>' +
          '<span class="q-strain-thc">THC ' + thc + '</span>' +
        '</div>' +
      '</div>' +
      '<span class="q-strain-badge ' + badgeClass + '">' + badges[rank] + '</span>' +
    '</div>' +
    '<div class="q-strain-tags">' + terps + effs + '</div>' +
    '<p class="q-strain-desc">' + (strain.description || '') + '</p>' +
    (flavors ? '<div class="q-strain-tags" style="margin-top:10px">' + flavors + '</div>' : '') +
  '</div>';
}

function showResults() {
  document.getElementById('qAnalyzing').style.display = 'none';
  var profile = getProfile();
  var p = PROFILES[profile];
  var topStrains = getTopStrains(profile);
  var cards = topStrains.map(function(s, i) { return strainCard(s, i); }).join('');
  var html =
    '<div class="q-result-header">' +
      '<div class="q-result-label">&#10022; Your Cannascenti Match</div>' +
      '<div class="q-result-profile">' + p.name + '</div>' +
      '<div class="q-result-title">' + p.title + '</div>' +
      '<p class="q-result-desc">' + p.desc + '</p>' +
    '</div>' +
    '<div class="q-strains">' + cards + '</div>' +
    '<div class="q-result-ctas">' +
      '<button class="q-retake-btn" onclick="retakeQuiz()">Retake the quiz</button>' +
      '<a href="/strains" class="q-browse-btn">Browse all 392+ strains &#8594;</a>' +
    '</div>';
  var el = document.getElementById('qResult');
  el.innerHTML = html;
  el.style.display = 'block';
  el.style.opacity = '0';
  setTimeout(function() { el.style.transition = 'opacity .4s'; el.style.opacity = '1'; }, 20);
}

function retakeQuiz() {
  scores = {relax:0, focus:0, sleep:0, creative:0, uplift:0};
  step = 0;
  isBeginner = false;
  document.getElementById('qResult').style.display = 'none';
  document.getElementById('qIntro').style.display = 'block';
}
</script>
</body></html>`;
    res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-cache, no-store, must-revalidate"});
    res.end(html);
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
var SCRIPT_PARTS = ${JSON.stringify({
  intro: "Based on what you've told me, I'd recommend starting with ",
  mid1: " \u2014 it's a ",
  mid2: " that's great for ",
  end: "Perfect for ",
  endSuffix: " use.",
  beginner: "Since you're new, I'd suggest starting with a small amount and waiting 20\u201330 minutes before taking more."
})};

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
  var scriptLine = '"' + SCRIPT_PARTS.intro + s0.name + SCRIPT_PARTS.mid1 + s0.type + SCRIPT_PARTS.mid2 + goalsText + '. ' + (time ? SCRIPT_PARTS.end + timeText + SCRIPT_PARTS.endSuffix + ' ' : '') + (exp==='first' ? SCRIPT_PARTS.beginner + ' ' : '') + '"';
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
function bproSetCat(idx) {
  bproActiveCat = GLOSS_CATS[idx];
  document.querySelectorAll('.bpro-gloss-cat').forEach(function(c,i){c.classList.toggle('active', i===idx);});
  bproRenderGloss();
}
document.getElementById('bproGlossCats').innerHTML = GLOSS_CATS.map(function(c, i) {
  return '<button class="bpro-gloss-cat' + (i===0?' active':'') + '" onclick="bproSetCat(' + i + ')">' + c + '</button>';
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
