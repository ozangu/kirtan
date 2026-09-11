# Pushti Kirtan

![Shri Vallabh](public/images/shrivallabh.png)

<p align="center">|| श्री वल्लभाधीश की जय ||</p>

Pushti Kirtan is an open source devotional archive for preserving, searching,
reading, and improving Pushtimargiya kirtans.

The website includes original Vraj Bhasha text, English meanings,
transliterations, raag metadata, occasion metadata, artwork, share previews,
and SEO-friendly pages for individual kirtans, raags, and occasions.

The project is built for Vaishnav readers, proofreaders, and developers who
want to help make kirtan literature easier to find, read, study, and preserve.

## Live Site

- Website: `https://pushtikirtan.com`
- GitHub: `https://github.com/ozangu/kirtan`
- Developers page: `https://pushtikirtan.com/contribute-code.html`
- Proofreaders page: `https://pushtikirtan.com/contribute-proofread.html`

## Project Goals

- Make Pushtimargiya kirtans easy to discover through fast search and strong
  SEO.
- Provide beautiful, readable kirtan pages with original text, English meaning,
  transliteration, raag, occasion, and artwork.
- Create indexable SEO pages for raags and occasions.
- Support a private admin/proofreader workflow for improving content safely.
- Keep private contributor, reviewer, admin, and credential data out of public
  exports and source control.
- Keep the public codebase simple enough for volunteers to understand and
  improve through pull requests.

## Tech Stack

- Cloudflare Workers for the API and server-rendered SEO routes.
- Cloudflare D1 for the SQLite-compatible database.
- Cloudflare Workers Assets for static files in `public/`.
- Plain HTML, CSS, and JavaScript for the frontend.
- Wrangler for local development and deployment.
- No frontend framework and no runtime JavaScript dependencies.

## Repository Structure

```text
.
├── backup/
│   ├── kirtan.db                  # Sanitized public corpus database
│   └── kirtan.sql                 # Sanitized public corpus SQL export
├── housekeeping/
│   ├── README.md                  # Public data refresh documentation
│   └── refresh-public-kirtan-data.sh
├── public/
│   ├── admin.html                 # Admin app shell
│   ├── admin-shell.txt            # Worker-served admin shell
│   ├── admin.js                   # Admin UI behavior
│   ├── api.js                     # Shared browser API helpers
│   ├── app.js                     # Home/search page behavior
│   ├── contact.html               # Contact page
│   ├── contribute-code.html       # Developer contribution page
│   ├── contribute-proofread.html  # Proofreader contribution page
│   ├── contribute.html            # Legacy redirect page
│   ├── contributor-shell.txt      # Worker-served proofreader shell
│   ├── contributor.js             # Proofreader UI behavior
│   ├── data/
│   │   ├── kirtans-full.json      # Public full kirtan corpus
│   │   └── kirtans-summary.json   # Smaller public list/search payload
│   ├── images/                    # Public artwork and page preview images
│   ├── index.html                 # Home/search page
│   ├── kirtan.html                # Client-rendered kirtan shell
│   ├── kirtan-template.txt        # Server-rendered kirtan HTML template
│   ├── kirtan.js                  # Kirtan page behavior
│   ├── legal.html                 # Terms, privacy policy, and disclaimer
│   ├── style.css                  # Global site styles
│   ├── svg.svg                    # Site mark
│   └── topbar.js                  # Mobile navigation menu behavior
├── scripts/
│   ├── create-blank-database.sql  # Empty schema for a new local/D1 database
│   └── export-public-kirtans.sh   # Public corpus export helper
├── worker.js                      # Worker routes, API, auth, SEO rendering
├── wrangler.jsonc                 # Cloudflare Worker configuration
├── package.json
├── package-lock.json
└── README.md
```

Local-only folders and files such as `notes/`, `.wrangler/`, `.env`, and
`.dev.vars` are ignored and should not be committed.

## How The Site Works

The public browsing experience is mostly served from static assets:

- `public/index.html` loads the home/search UI.
- `public/data/kirtans-summary.json` powers the home page card list with a
  smaller payload.
- `public/data/kirtans-full.json` powers detailed public kirtan data and
  server-rendered SEO pages.
- `public/images/` contains the public artwork used by kirtan cards, kirtan
  pages, and social previews.

The Worker in `worker.js` handles:

- SEO-friendly kirtan pages such as `/kirtan/braj-bhayo-maharikai-poot-1`.
- Legacy kirtan URLs such as `/kirtan.html?id=1`.
- Raag pages such as `/raag/devagandhar`.
- Occasion pages such as `/occasion/001-janmashtami-ki-badhai`.
- Social preview image routing for platforms such as WhatsApp.
- Public API routes used by the frontend.
- Private admin and proofreader API routes.
- Sitemap and robots.txt generation.

## URL Patterns

Each kirtan can be reached by both the legacy ID URL and the SEO slug URL:

```text
https://pushtikirtan.com/kirtan.html?id=1
https://pushtikirtan.com/kirtan/braj-bhayo-maharikai-poot-1
```

Prefer slug URLs when linking publicly.

Collection pages use these patterns:

```text
https://pushtikirtan.com/raag/devagandhar
https://pushtikirtan.com/occasion/001-janmashtami-ki-badhai
```

Contribution pages use these URLs:

```text
https://pushtikirtan.com/contribute-code.html
https://pushtikirtan.com/contribute-proofread.html
```

The old `/contribute.html` page is kept only as a legacy redirect to the
proofreader page.

## Local Developer Setup

### Prerequisites

- Node.js 20 or newer.
- npm.
- Git.
- A Cloudflare account if you want to deploy or test against your own D1
  database.

Wrangler is installed through this project as a development dependency, so use
`npx wrangler ...` or the npm scripts rather than installing Wrangler globally.

### Install Dependencies

```sh
npm install
```

### Start The Local Site

```sh
npm run dev
```

Wrangler serves the Worker and static assets locally. The default URL is:

```text
http://127.0.0.1:8787/
```

Useful local routes:

```text
http://127.0.0.1:8787/
http://127.0.0.1:8787/kirtan.html?id=1
http://127.0.0.1:8787/kirtan/braj-bhayo-maharikai-poot-1
http://127.0.0.1:8787/raag/devagandhar
http://127.0.0.1:8787/occasion/001-janmashtami-ki-badhai
http://127.0.0.1:8787/contribute-code.html
http://127.0.0.1:8787/contribute-proofread.html
http://127.0.0.1:8787/admin/
http://127.0.0.1:8787/cont/
```

## Database Setup

The app uses Cloudflare D1, which is SQLite-compatible.

For a blank local database with all tables and indexes but no data:

```sh
sqlite3 kirtan.db < scripts/create-blank-database.sql
```

For a Cloudflare D1 database:

```sh
npx wrangler d1 execute kirtan --file scripts/create-blank-database.sql
```

Replace `kirtan` with your own D1 database name if you are working in a fork or
separate Cloudflare account.

The repository also includes sanitized public corpus exports:

```text
backup/kirtan.db
backup/kirtan.sql
```

These files are intended to contain only public `tbl_kirtan` data. They must
not contain contributor accounts, proofreader submissions, admin notes,
reviewer names, sessions, password hashes, or private workflow metadata.

## Wrangler Configuration

`wrangler.jsonc` defines the Worker, static asset directory, Worker-first
routes, and D1 binding.

The D1 `database_id` is a Cloudflare resource identifier. It is not a password
or API token, but contributors using forks should replace it with their own D1
database ID if they plan to deploy from their own Cloudflare account.

Do not commit personal Cloudflare account changes unless they are intended for
the shared project.

## Development Workflow

1. Fork the repository on GitHub.
2. Clone your fork.
3. Install dependencies with `npm install`.
4. Create a focused branch from `main`.

```sh
git checkout -b fix-clear-description
```

5. Make your change.
6. Run the relevant checks.
7. Review your diff.
8. Push your branch and open a pull request.

```sh
git status --short
git diff
git push origin fix-clear-description
```

## Validation Checklist

Run syntax checks for JavaScript changes:

```sh
node --check worker.js
node --check public/api.js
node --check public/app.js
node --check public/kirtan.js
node --check public/admin.js
node --check public/contributor.js
node --check public/topbar.js
```

For UI changes, manually check:

- Home/search page.
- A kirtan page by slug.
- A kirtan page by `kirtan.html?id=...`.
- A raag page.
- An occasion page.
- Mobile and desktop header behavior.
- Mobile hamburger menu behavior.
- Footer links.
- Any admin or proofreader screens touched by the change.

For SEO or social preview changes, inspect the rendered HTML for:

- `<title>`
- `meta name="description"`
- canonical URL
- Open Graph title, description, URL, and image
- Twitter card tags
- JSON-LD structured data where applicable

## Public Data Refresh

The public corpus is refreshed through:

```sh
./housekeeping/refresh-public-kirtan-data.sh
```

That flow is expected to:

- Export only public `tbl_kirtan` data.
- Exclude private contributor/proofreader/admin workflow tables.
- Exclude reviewer names and private admin notes.
- Regenerate `backup/kirtan.db`.
- Regenerate `backup/kirtan.sql`.
- Regenerate `public/data/kirtans-full.json`.
- Regenerate `public/data/kirtans-summary.json`.

See `housekeeping/README.md` for details.

## Code Style

- Prefer existing patterns over new abstractions.
- Keep the frontend dependency-free unless a dependency clearly earns its
  place.
- Keep UI changes consistent with the current visual language.
- Use semantic HTML where possible.
- Keep public pages accessible by keyboard and screen readers.
- Use root-relative asset paths for pages that can render under nested URLs.
- Keep comments short and useful.
- Avoid unrelated formatting churn.
- Do not commit generated, local, or private data unless it is an approved
  sanitized public artifact.

## Good Contribution Areas

- Search quality and filtering.
- SEO improvements for kirtan, raag, occasion, and contribution pages.
- Social preview reliability for WhatsApp, Facebook, X, and other platforms.
- Reading experience improvements for English meanings and original text.
- Accessibility and responsive UI improvements.
- Performance improvements that reduce unnecessary Worker/D1 requests.
- Admin and proofreader workflow improvements.
- Safer data export and sanitization tooling.
- Documentation improvements.

## Pull Request Guidelines

Please keep pull requests focused. A small, careful change is easier to review
and merge than a large mixed change.

In your pull request description, include:

- What changed.
- Why it changed.
- How you tested it.
- Screenshots for UI changes.
- Any risks or follow-up work.

Before opening a pull request, confirm:

```sh
git status --short
git diff
git ls-files notes
```

`git ls-files notes` should print nothing.

## Data And Privacy Rules

This repository is intended to contain public code and public kirtan content.
It must not contain private operational data.

Do not commit:

- Raw or private files in `backup/`.
- Personal notes in `notes/`.
- `.wrangler/`.
- `.env` or `.dev.vars`.
- Local SQLite databases or SQL dumps outside approved sanitized exports.
- Admin credentials.
- Contributor or proofreader usernames.
- Password hashes for real users.
- Contributor/proofreader private workflow tables.
- Contribution review history.
- Reviewer names.
- Admin notes containing private information.
- Cookies, session secrets, tokens, private keys, or API keys.

The committed `backup/kirtan.db` and `backup/kirtan.sql` files should contain
only the public `tbl_kirtan` table.

Before publishing a release or making sensitive changes, run:

```sh
git status --short --ignored
git ls-files notes
sqlite3 backup/kirtan.db ".tables"
rg -n -i "password|secret|token|api[_-]?key|private[_-]?key|authorization|cookie|session|hash|email|contributor|reviewer|admin_note" --glob '!backup/**' --glob '!notes/**' --glob '!node_modules/**' --glob '!public/images/**' --glob '!public/data/**'
```

Review any matches carefully. Some matches are expected in application code,
but private values should never be present.

## Publishing A Previously Private Repository

If this repository has ever committed private backups, notes, secrets, or
production-only files, removing them from the current branch is not enough.
GitHub can still expose old files through Git history after a repository is
made public.

Before publishing an existing private repository, either:

- Create a fresh public repository from a clean working tree with no private
  history.
- Or rewrite Git history with a trusted tool such as `git filter-repo`, then
  force-push the cleaned history after all maintainers understand the impact.

After rewriting or recreating the public repository, rotate any exposed secrets
and contributor/proofreader passwords that may have appeared in previous
commits.

## Deployment

Production deployment is handled with Wrangler:

```sh
npm run deploy
```

Only maintainers with the correct Cloudflare access should deploy production.

## Security

Please do not open a public GitHub issue for a suspected vulnerability or data
exposure. Contact the maintainers privately first.

When reporting a security issue, include:

- A concise description.
- Steps to reproduce if safe.
- The affected route, file, or workflow.
- Whether any private data may be exposed.

## Community Spirit

This project exists as seva for the Vaishnav community. Please keep discussion
kind, precise, and grounded in improving the usefulness, beauty, accessibility,
and integrity of the kirtan archive.
