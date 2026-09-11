# Cannascenti — competitive positioning vs. Weedmaps/Leafly, and a compliance flag

Follow-up to the brief I sent earlier this session. This one is about how Cannascenti should position against Weedmaps and Leafly, and a real compliance issue in the current data pipeline that should get resolved before the strain database grows further.

## The competitive picture (verified, September 2026)

- **Weedmaps** is marketplace-first: it's built for people ready to buy right now, comparing prices/deals across nearby dispensaries. That's a capital-heavy business — POS integrations, order fulfillment, dispensary licensing deals. Not the lane to compete in directly.
- **Leafly** is content-first: its strain database and education library rank well organically and catch people earlier, in the research phase. That's Cannascenti's actual lane. But neither platform runs on verified lab data — both are large, crowdsourced, broadly-descriptive libraries that state effects/flavors with more confidence than the underlying data supports.
- **Cannascenti's actual differentiator** is honesty plus verification: labeling unverified fields instead of asserting them, backed by real COA data pulled from actual shifts. That's real once the strain database has real sourcing behind it — right now most of it doesn't yet (see the data-provenance item from the last audit: all 394 records still "sources pending review," only 105 have genetics populated).
- **Emerging opportunity:** both Weedmaps and Leafly are now being cited directly inside ChatGPT and Google AI Overviews when people ask cannabis questions — they've become "AI-citation surfaces." A site with genuinely sourced, schema-marked, dated content can compete for that same citation slot, which is a different (and currently less contested) distribution channel than search-click competition with either incumbent.

## Compliance flag — needs a real fix, not just awareness

`scripts/scrape-leafly.js` pulls from Leafly's internal consumer endpoint. Leafly shut down its *public developer API* back in 2016 specifically to stop third-party data pulls — so this script is scraping an undocumented endpoint outside their terms of service, not using a sanctioned data source. That was fine for early prototyping. It is a real legal exposure point (ToS violation, possible claims on their strain description text) as Cannascenti starts generating actual subscription revenue from Budtender Pro. This needs a resolution before the strain library is expanded further using this script.

Separately: Weedmaps does have a real developer API (`developer.weedmaps.com`), but it's a retailer/POS integration for pushing a dispensary's own menu data *into* Weedmaps — not a source of data to pull *from* them either. Worth knowing about as a possible future partner-integration angle for Budtender Pro (syncing a dispensary's real inventory with cannabinoid/terpene taxonomy), not as a workaround for the Leafly scraping problem.

## What I need from you

1. **A concrete plan to reduce/eliminate reliance on `scrape-leafly.js`** for the strain database going forward — options might include: switching future expansion to `expand-strains.mjs`/`add-strains.mjs` (Anthropic-assisted generation + manual curation) with real source citation per record, licensing or partnering for lab data directly from dispensaries/testing labs, or another approach you'd recommend. I want the risk gone, not just documented.
2. **A messaging pass** on `pricing.html`, `for-dispensaries.html`, and `about.html` that leans harder into "verified sourcing, not just descriptions" as the explicit differentiator versus Leafly/Weedmaps — right now the site doesn't make this comparison directly anywhere, and it's the actual argument for why a dispensary should pay for Budtender Pro instead of just pointing staff at Leafly.
3. **Concrete next steps on the AI-citation-surface opportunity** — what's needed on top of the schema markup already in place (source URL, reviewer, review date fields per strain record; anything else that makes a record legitimately citable by an AI answer engine) to start capturing that channel.

Ask me anything you need before starting.
