# Cannascenti — first revamp phase

This is an edited copy of the supplied project, not a deployment. The original attachment remains unchanged. See `AUDIT-AND-ROADMAP.md` for findings, priorities, and remaining release blockers.

## Run

Use Node.js 22 or later. Install the locked dependencies with `npm ci`, then run `npm start`. The server defaults to http://localhost:3000. `PORT` can select another port. There is no bundler or build step; the project uses native Node HTTP and server-rendered HTML.

Configuration is read from the process environment; the server does not automatically load .env files. Never place real credentials in source control.

- `ANTHROPIC_API_KEY`: optional for browsing; required for live AI tools.
- `DASH_PASSWORD`: required to enable the owner dashboard. No fallback password.
- `ADMIN_KEY`: required to enable legacy strain administration. No fallback key. The remaining legacy query-string key flow needs replacement before production.
- `PUBLIC_ORIGIN`: optional override for the confirmed production origin. Defaults to https://cannascenti.com and enables canonical links and the sitemap.
- `NODE_ENV=production`: adds Secure to the dashboard cookie. Deploy behind HTTPS.

## New experience

- `/`: redesigned education and discovery homepage.
- `/discover`: server-rendered reference search, classification filter, pagination, source status, and expandable record notes. Does not call AI.
- `/learn/start`: introductory guide, label literacy, and information standards.
- `/guide`: educational Mary Jane interface, plain-text streaming, and meaningful failure states.
- `/encyclopedia`: original interactive homepage. Old root fragment links are forwarded here; `/?ask=...` continues to open the original chat experience.
- Existing profile, learning, quiz, scanner, about, contact, and other server routes remain in place.

`revamp.js` contains the new server-rendered surfaces. `public/css/revamp.css` and `public/revamp.js` hold their styling and browser interactions. `security.js` applies request limits, route normalization, and a public-file allowlist.

The legacy email gate now has a “Continue without email” option. The new pages never require an email. The missing founder image was restored from `cannascenti(1).zip` attached to the same earlier conversation.

## Verification

Run `node --test tests/*.test.js`. Tests require no provider credentials. The HTTP smoke test starts its own isolated server and removes all credential variables from its child process.

The package manifest and lockfile are preserved. There is no automatic production deployment or database migration. To revert this phase, use the unchanged original ZIP; do not overwrite production data with this archive.
