# node-db-app

Node + MySQL test app for cPanel deploy.

- Build command: `npm install`
- Startup command: `npm run start`
- Creates the `entries` table automatically

DB settings (env vars), either:
- `DATABASE_URL=mysql://user:pass@localhost:3306/dbname`
- or `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (`DB_PORT` optional)

Routes: `/` UI, `/health` status + DB check, `/api/entries` GET list / POST add
