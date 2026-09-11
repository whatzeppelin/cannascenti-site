# Cannascenti — next phase brief for ChatGPT/Codex

I'm Michael, founder of Cannascenti (cannascenti.com), an AI-powered cannabis education/intelligence platform for the LA market. You (a prior ChatGPT/Codex session) did a revamp phase on this project earlier today — new security layer (`security.js`), new pages (`/discover`, `/guide`, `/learn`), removed hardcoded admin/dashboard credentials, added a test suite. That work is already merged to `main` and live in production on Render. `AUDIT-AND-ROADMAP.md` and `README.md` in the repo root have the full history — read those first for context before doing anything else.

This brief is the next round. I had another AI assistant (Claude) do a fresh pass against the live site and the current code to ground this in verified facts rather than guesses. Use what's below as confirmed starting context, not things you need to rediscover.

## Verified findings to start from

**Live bug — broken quiz funnel (fix this first):** `/quiz-2` returns a 404 on production right now. `budtender-quiz.html` (line 579) links `"Continue to Part 2"` to `/quiz-2`, but `server.js` only has a handler for the legacy URL `/budtender-quiz-2` (around line 6166). Compare to `/quiz`, which *does* have its own short-URL handler (around line 5692) alongside legacy `/budtender-quiz`. Mirror that pattern for quiz-2. This is caught by your own test suite (`tests/http.test.js` — 1 of 6 tests currently fails on exactly this).

**Design is not uniform across pages yet.** `index.html` (homepage) and `learn.html` use a modern dark system: near-black backgrounds (`#0e0e0e`, `#111`), a mint-green accent (`#52B788`), and CSS custom properties (`var(--sans)`, etc). But `about.html`, `contact.html`, `pricing.html`, `for-dispensaries.html`, `budtender-quiz.html`, and `budtender-quiz-2.html` are still on the older system: `'Cormorant Garamond'` serif headings, `'Montserrat'` body text, and a teal/purple/gold palette (`#4ECDC4`, `#7B9CCC`, `#E8A84C`, `#74C69D`). Nav markup (`<nav class="nav" id="mainNav">`) is at least consistently named across pages even though the visual system diverges — so this is a styling/token problem, not a structural rebuild.

**Design direction (my call, final for this round):** Standardize every page on the *current homepage aesthetic* — near-black, mint-green accent, generous whitespace, restrained typography. I want it to feel Apple-level polish: clean, "flush," purposeful, nothing cluttered — while still reading as advanced/futuristic cannabis-tech, not a soft apothecary brand. Think: huge whitespace, one confident accent color, tight consistent nav/footer on every single page, subtle/purposeful motion only, no duplicate route handlers, fully responsive on mobile. I'm open to you proposing specific treatments (glass panels, hairline borders, micro-interactions, etc.) as long as it stays restrained rather than loud — nothing here is permanent, I just want to get this to market looking and working like a real product.

**From your own audit — two items you flagged as release blockers, still open:**
- Security/privacy: admin key is still passed via query string, there's no server-side session lifecycle yet (dashboard token is shared/rotates on restart), and legacy page renderers still need a full output-escaping pass.
- Data provenance: all 394 strain records are still labeled "sources pending review"; only 105 of 394 have genetics data populated; no record has a source URL, reviewer, or review date yet.

## What I need from you

1. **Top 5 most important things to change**, ranked by priority/impact — pull from the above plus anything else you find, but the quiz-2 bug and page-uniformity gap should weigh heavily since they're live and user-facing right now.
2. **Top 5 things to explicitly keep / not touch** — the parts of the current site and codebase that are already working and shouldn't get regressed while you do the above (e.g., the security hardening from today, the strain data honesty labeling, whatever else holds up).
3. **A prioritized do-next list** — concrete, ordered steps, not just a wishlist.
4. Then **go ahead and implement the top priorities directly** in the codebase (not just a plan) — same as your last pass, with tests where it makes sense, and update `AUDIT-AND-ROADMAP.md` with what changed.

Ask me anything you need before starting — I'd rather answer a question now than have you guess.
