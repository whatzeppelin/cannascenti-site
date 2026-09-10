# Cannascenti: audit and first revamp phase

Audit date: September 10, 2026. Scope: the supplied `cannascenti-for-chatgpt.zip`, plus the missing founder photo from the earlier `cannascenti(1).zip` attachment. This is a source audit and local implementation, not an assessment of a live production deployment.

## Assessment

Cannascenti already has a substantial educational prototype. Keep the brand, reference collection, existing URLs, and useful interactive learning features. The next investment should be information quality, a coherent visitor experience, and safer application boundaries—not a framework rewrite.

The actual archive contains 862 files, 831 of them under Git history; there are 31 non-Git files including metadata. The earlier conversation's “1,100+ files” should not be used as a measure of the application. The working copy excludes Git history, local assistant configuration, metadata, dependency folders, and environment files. No credentials from the archive were required to run the educational experience.

The original server is roughly 818 KB / 9,066 lines, and the original homepage is roughly 407 KB / 5,799 lines. Much of the application is embedded HTML, CSS, content, and browser JavaScript inside those two files.

## Stack and architecture

| Area | Found in the archive | Implication |
| --- | --- | --- |
| Server | Node.js ES modules, native `http`, `fs`, `path`, `zlib` | No Express, React, Next.js, CMS, or build pipeline. Keep the runtime for this phase. |
| Rendering | HTML template strings in `server.js`, static HTML, extensive inline scripts | Server-rendered content is a useful SEO starting point; duplication makes changes risky. |
| Dependencies | `@anthropic-ai/sdk` ^0.55.0 and `puppeteer-core` ^24.42.0, with lockfile | AI and scraping-related dependencies; not a modern frontend framework. No dependency vulnerability audit completed. |
| Storage | `strains.json`; runtime JSON/JSONL files for leads, contacts, subscribers, analytics | No transactional database, schema migrations, multi-instance coordination, or retention jobs found. |
| Styling | Shared `public/css/main.css`, per-page inline CSS, `theme.js`, local fonts and Google Fonts | A partial design system exists, but not a single consistently applied system. |
| Tests | No test script or test suite found in original manifest | Added targeted tests for the first phase and HTTP regressions. |
| Deployment | `npm start` runs the Node server | No verified hosting configuration or deployment credentials supplied. Nothing was published. |

## Pages and features

| Surface | Current implementation and observed limitations |
| --- | --- |
| Homepage | Original “Cannabis Lore” hero, interactive encyclopedia tabs, embedded search, newsletter, and floating Mary Jane chat. Now retained at `/encyclopedia`; new `/` offers clear education and reference-library paths. |
| Strains | `/strains`, `/strains/:slug`, full-record JSON endpoint, search/lookup endpoints; lineage and strain detail content. New `/discover` browses actual records without generating missing results. |
| Learning | `/learn`, `/terpenes`, terpene profiles, `/cannabinoids`, `/consumption`, `/history`, `/glossary`, `/concentrates`, and other archive sections. Content is extensive but requires source review. |
| Other legacy education | Cooking, cultivation, extraction-related sections and redirects are present. Audited as existing code; not extended in this phase. |
| Quizzes | `/quiz`, `/quiz-2`, legacy aliases and two static quiz files. Local profile matching and browser persistence. There are two `/quiz` handlers: the earlier one wins and the later one is unreachable for that URL. |
| Mary Jane | Anthropic streaming chat via `/api/chat`; browser profile/memory support in the old client. New `/guide` is an educational chat surface. |
| Scanner | `/scan` and `/api/scan`: image input, camera UI, and model-based label interpretation. No independently verified lab-report retrieval was established. |
| Editorial | Two strain spotlight routes; two Markdown files contain parallel content rather than an established publishing pipeline. |
| Business/contact | About, contact, pricing, dispensary-facing marketing, staff/budtender material, forms and lead capture. These are not a functioning marketplace or subscription billing system. |
| Administration | Add-strain, AI autofill, analytics and a dashboard. Flat-file persistence; legacy authentication needs further replacement. |
| Accounts/reviews/search | No complete user-account system, moderated user reviews, licensed live menu integration, geospatial search, or inventory database found. Ratings stored in strain records are not evidence of a review platform. |

## Design and visitor experience

The old shared theme uses near-black surfaces, muted gray text, gold accents, green highlights, Cormorant Garamond headings, Inter body copy, and JetBrains Mono labels. Other pages use different palettes and Montserrat. Some low-emphasis text is very faint. Navigation varies by page and uses branded terms such as “The Lore” and “The Order” before explaining what visitors can do.

The email gate blocks reading, although it is not real authentication. On mobile, the volume of tabs and repeated panels makes the primary task hard to identify. The existing design has character; it needs clearer hierarchy and a consistent reusable page shell.

First-phase direction: a botanical field-guide aesthetic with warm ivory, forest green, restrained serif headings, generous spacing, readable copy, and a code-native leaf illustration. New pages share navigation, footer, focus states, responsive rules, and a reduced-motion preference. Existing legacy pages retain their styling to avoid a broad regression-prone redesign.

## Data sources and trust

`strains.json` contains **394 unique strain names**. All 394 records have type, THC minimum/maximum, CBD, terpene names, effects, flavors, description, tags, and rating. Only **105** include genetics. None has a record-level source URL, review date, reviewer, or attached COA field in this snapshot.

The scripts show several origins:

- `scrape-leafly.js` calls Leafly's internal consumer endpoint.
- `build-strains-db.js` merges imported data and existing material; its potency helper can derive a range around a midpoint rather than preserving a supplied measured range.
- `expand-strains.mjs` uses Anthropic to populate additional records.
- `add-strains.mjs` contains a large manually assembled expansion set.
- Admin addition/autofill provides another path into the same JSON collection.

This identifies possible sources and transformations, not the provenance of any individual record. Raw source data and rights documentation are absent. No scraping or data-expansion script was run. Confirm permission, attribution, licensing, and source traceability before expanding the collection.

The old homepage describes lineage and potency as verified/lab-tested. The snapshot does not substantiate that across the database. New pages remove these claims and mark every reference entry “Sources pending review.” New cards omit potency, rating, and therapeutic-effect fields. They expose inherited names, aromas, terpenes and available lineage with explicit limitations.

Several older educational passages make strong medical/mechanistic claims, including predictable terpene effects and the “mango trick.” These require expert editorial review; the current archive should not be described as medically validated. New basic health copy links to the [NCCIH cannabis overview](https://www.nccih.nih.gov/health/cannabis-marijuana-and-cannabinoids-what-you-need-to-know), which discusses cannabinoids, evidence limitations, and risks. That overview does not validate the inherited strain records.

## AI and budtender implementation

Code-configured model IDs are `claude-opus-4-6` for chat, scanning and admin autofill, and `claude-haiku-4-5-20251001` for several lookup/generation calls. Their live availability was not verified.

The old system prompt asserted personal floor experience, certainty, and specific health effects. Chat is prompt-based: it does not implement retrieval from a vetted source index. Quiz context and local memory were appended to the system prompt. Lookup can fall back to generated strain records, and the product endpoint asks the model to invent product/category descriptions and price ranges. Those results are not live inventory or verified product data.

Changes made:

- Mary Jane now identifies as an AI educational guide and does not claim personal experience or professional credentials.
- Removed quiz-profile/memory injection from the active chat system prompt. Existing quiz UI and stored profiles remain; personalized chat behavior is intentionally no longer applied.
- Added `/guide` with plain-text rendering, streaming, disabled duplicate submissions, timeout handling, and visible unavailable/interrupted states.
- Explicit unavailable responses for configured AI routes when no provider key exists; the reference experience works without AI or even the installed SDK.
- No live model requests were made. Prompt instructions are not a substitute for adversarial tests or server-enforced safety controls.

Remaining: retrieval with citations, output schemas, content-review workflow, provider-cost and concurrency controls, privacy documentation, and model evaluation. Legacy lookup/product/scanner generation remains outside the new reference search and must be addressed before a public launch.

## Security findings

| Priority | Finding | First-phase action / remaining work |
| --- | --- | --- |
| Critical | Original fallback file handler could serve project source and runtime personal-data files; directory traversal had no proper containment boundary. | Added explicit public-file allowlist, decoded-path checks, and symlink containment for fallback assets. Tested source, environment, Git, contacts, leads, and subscriber paths as denied. |
| Critical | Hardcoded fallback admin credentials and a dashboard token derived reversibly from the password. | Removed fallback values. Admin/dashboard fail closed when unconfigured. Dashboard token is now cryptographically random, with exact cookie comparison and Secure in production. Previously used credentials should be replaced before reuse. |
| High | Unbounded POST bodies and unrestricted cross-origin headers. | Added request-size limits, request/header timeouts, same-origin browser POST checks, and basic per-IP rate limiting; removed wildcard CORS. |
| High | User/model/imported values interpolated into legacy HTML and `innerHTML`. Analytics can also render untrusted event data. | New pages escape all imported/query data; new chat uses `textContent`. Legacy renderers still need a comprehensive output-encoding pass. |
| High | Admin keys in query-string flows; primitive session management. | Existing configured admin flow retained, not redesigned. Replace with expiring server-side sessions and audited authorization before production. Current dashboard token is shared across sessions and rotates on restart, with cookie expiry rather than a full server-side session lifecycle. |
| High | Email/contact data written to local JSON files; console output includes personal data. | File serving is blocked and sensitive runtime files are ignored. Retention, deletion, consent, delivery/unsubscribe, log redaction and robust storage remain. |
| Medium | Rate limiting is in-memory and IP-based. | Useful local baseline only; not a distributed limiter, concurrency budget, or protection against a determined attacker. Proxy configuration requires deliberate deployment design. |
| Medium | Numerous legacy inline scripts make a strict CSP difficult. | Basic security headers added. CSP and legacy script extraction remain. |

This is not a penetration test or a security certification. Do not treat the retained legacy application as production-ready because the first-phase checks pass.

## SEO and technical debt

Strengths: server-rendered pages, descriptive route names, some page metadata, and some existing structured data.

Weaknesses: inconsistent metadata, unsupported “verified” language, JavaScript-only encyclopedia content, fragmented topic navigation, duplicate content, no original sitemap/robots implementation found, and unclear publishing/source-review workflow. The supplied archive also omitted `michael.jpg`; it was recovered from the earlier attachment. `/strain-labels` requested `/css/main.css` even though the asset lives under `/public/css`; an alias now resolves it.

New pages include titles, descriptions, social text metadata and canonical support. `PUBLIC_ORIGIN` must be set to the confirmed production origin. Without it, robots disallows indexing and the sitemap is unavailable, avoiding publication of invented domain metadata. The initial sitemap covers a small curated route set. No fake aggregate ratings, laboratory verification schema, or generated social image was added.

The new modules isolate the first phase without a framework migration. Next, extract reusable page layouts/content from the 9,000-line server, resolve duplicate and dead handlers, and separate data access from page rendering. Keep native server rendering unless real requirements justify a stack change.

## Prioritized next phases

| Order | Work | Completion criteria |
| --- | --- | --- |
| 1 — completed locally | Homepage, clear navigation, introductory learning guide, real-record discovery, educational AI UI, immediate security boundaries | New routes work; inherited reference records remain accessible; targeted tests pass. |
| 2 — release blocker | Finish security and privacy cleanup | No unescaped untrusted legacy renderers; expiring authenticated sessions; protected admin writes; storage/log retention rules; explicit consent behavior; abuse/cost controls. |
| 3 — release blocker | Editorial and data provenance | Review the most visited entries first; store source URL, usage rights, captured date, reviewer, review status and record version; distinguish batch lab observations from general descriptions; remove unsupported claims. |
| 4 | Apply the shared design to existing educational routes | Consistent mobile navigation, breadcrumbs, accessible interactions, readable typography, and no duplicate route handlers. Include explicit browser/keyboard/accessibility testing. |
| 5 | Turn Mary Jane into a source-grounded learning assistant | Retrieve only approved material, cite sources, disclose uncertainty, reject invented facts, and pass an evaluation set for medical, sourcing and prompt-injection cases. |
| 6 | Establish an editorial publishing pipeline | Structured articles with author, sources, review dates, redirects, topic links, sitemap inclusion and revision history. |
| 7 | Reliable persistence and operations | Transactional storage, backups, migrations, validated imports, operational monitoring, and a reproducible deployment process. |
| 8 | Expand informational discovery | Stable record IDs, aliases, normalized classifications, provenance-aware filtering and readable source histories. Add capabilities only when trustworthy data supports them. |

A Leafly/Weedmaps-scale service depends on trustworthy data and operations, not just interface polish. No seller locator, live menu, purchase path, or retail inventory integration was implemented. This phase establishes informational education/discovery only.

## Verification and limits

Six automated tests passed, including an HTTP smoke test across 18 primary/legacy routes and assets, private-file denials, disabled admin/AI states, cross-origin rejection, oversized/invalid request handling, all 394 records across pagination, empty/filter results, and escaping. JavaScript syntax checks passed during implementation.

The local homepage returned HTTP 200 and was handed to the Codex preview panel. No browser screenshots, click testing, mobile-device testing, live AI calls, production deployment, or dependency vulnerability audit was performed. Responsive and keyboard behavior are implemented but still need interactive QA.

The dependency installer encountered an existing cache ownership/permission problem even after cache write permission was granted. The cache was not deleted or ownership-modified. Browsing now loads the SDK only when a provider key is configured, so the site and tests run using Node alone. A successful dependency install is still required before enabling live AI. The dependency manifest and lockfile are unchanged.

The original ZIP remains untouched. This edited source copy and its ZIP exclude dependency folders, environment files, Git history, and runtime personal-data files. Read `README.md` for local startup and configuration.

## Deployment preparation follow-up

The current GitHub main branch was checked against the uploaded archive and matches its source. Live response headers identify Render as the application host. The production domain is confirmed as https://cannascenti.com; canonical and sitemap defaults now use that origin. The original smaller founder photo from GitHub is retained instead of the earlier attachment restoration. No production deployment is implied by this preparation note.
