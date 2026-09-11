# Housekeeping Scripts

Run these commands from the repository root:

```bash
./housekeeping/refresh-public-kirtan-data.sh
```

For creating a full blank development database with no data, use:

```bash
sqlite3 kirtan.db < scripts/create-blank-database.sql
```

or for Cloudflare D1:

```bash
npx wrangler d1 execute kirtan --file scripts/create-blank-database.sql
```

This refresh script:

- downloads the latest production D1 database export
- removes private contributor, contribution review, revision, and migration tables
- rebuilds the backup database so only `tbl_kirtan` remains
- fails if any non-public table remains before writing the final backup
- fails if private workflow columns are found in the generated SQL backup
- keeps only the public `tbl_kirtan` corpus in `backup/kirtan.sql`
- keeps only the public `tbl_kirtan` corpus in `backup/kirtan.db`
- regenerates `public/data/kirtans-full.json`

The website Worker reads kirtan data from `public/data/kirtans-full.json` for SEO pages, public API search, homepage pagination, and filter summary routes.

If Wrangler is not logged in, run this once:

```bash
npx wrangler login
```

Then rerun:

```bash
./housekeeping/refresh-public-kirtan-data.sh
```
