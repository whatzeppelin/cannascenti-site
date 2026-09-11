# Cannascenti — deep compliance/legal research (Claude track)

This runs in parallel to the ChatGPT/Codex work on the actual codebase, and to the ChatGPT prompt on competitive positioning. This track is research only — no repo changes — so it's safe to run at the same time as the others without conflicts.

## Why this matters

`scripts/scrape-leafly.js` pulls strain data from Leafly's internal consumer endpoint, and the plan is to expand the 394-strain database further, backed by real COA (Certificate of Analysis) data pulled from Michael's shifts at ERBA Sawtelle. Before that scales into a paid B2B product (Budtender Pro, $149–299/mo), the legal footing under all of that needs to be solid, not just noted as a risk.

## What's already established (first pass, September 2026)

- **General scraping law:** *hiQ Labs v. LinkedIn* (9th Cir., 2022) held the CFAA's "without authorization" language doesn't cover scraping logged-out/public pages — but hiQ still lost on a separate breach-of-contract claim (its agents used fake accounts to bypass authentication) and ended up under a $500K judgment plus a permanent injunction. *Meta v. Bright Data* (2024) went the other way: scraping public, logged-out data was found not to violate Meta's terms, and Meta dropped its case. The pattern: **logged-out, non-authenticated scraping of public data is far more defensible than anything requiring login/session bypass; ToS-based contract claims survive even when CFAA claims fail.**
- Applied to `scrape-leafly.js`: worth confirming exactly what endpoint it hits, whether it requires any authentication/session token, whether it respects `robots.txt`, and what Leafly's current ToS actually says about automated access — the risk profile is very different depending on those specifics, and I haven't yet confirmed them against the live script.
- **Open question, not yet resolved:** whether California requires cannabis testing labs or the DCC (Department of Cannabis Control) to make COA/lab test results publicly accessible. I found DCC rulemaking pages but nothing yet confirming a public COA database or disclosure mandate — this materially affects whether COA data can be legally aggregated and republished, or whether it requires direct permission from the testing lab / dispensary for each record.
- **Not yet researched:** the copyright status of strain descriptions and lab data. Raw facts (a strain's measured THC%, terpene content) are very likely not copyrightable on their own (per *Feist v. Rural Telephone*'s facts-are-not-copyrightable doctrine) — but Leafly's *written descriptions* of a strain could be, since those involve editorial/creative choices. Needs confirming, not assuming.

## What I need from this research track

1. **Resolve the California COA disclosure question** — does the DCC or any CA statute (check SB 544 and the current DCC regulations text, not just DCC blog posts) require public access to lab test results, or is COA data something that legally belongs to the lab/licensee and requires permission to redistribute?
2. **A specific risk assessment of `scrape-leafly.js` as currently written** — read the actual script, identify the endpoint it hits, whether auth is involved, and what Leafly's current terms of service say about automated access — then give a clear verdict: keep as-is, modify, or replace.
3. **A compliant path to scale COA sourcing** — realistic options for getting real, legally clean lab data at volume (direct lab partnerships, dispensary consent/data-sharing agreements, manual photograph-and-transcribe from Michael's own shifts, any CA public-disclosure route if one exists) with a recommendation on which to pursue first.
4. **Confirm the copyright question** on strain descriptions/facts, so future data-expansion work (`expand-strains.mjs`, `add-strains.mjs`) has a clear line on what can be freely used versus what needs to be independently written.

Flag anything uncertain rather than guessing — this is the kind of thing worth being conservative about before it's generating subscription revenue.
