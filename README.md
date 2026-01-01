# FoodBuddy

FoodBuddy is a Next.js 15+ (App Router) starter for a food recommendation platform.

## Features

- **Personalized food discovery** with chat-style recommendations and curated suggestions.
- **Location-aware results** using Google Places (API or MCP provider).
- **Flexible data layer** with Prisma migrations and type-safe access.
- **Configurable integrations** that can be enabled/disabled via environment flags.
- **Modern UI** built with React, Tailwind, and the Next.js App Router.

## Requirements

- Node.js 20+
- npm (or your preferred package manager)
- A database supported by Prisma (e.g. PostgreSQL)
- Optional: Google Places API key or Composio MCP credentials

## Installation

```bash
npm install
```

## Environment Setup

Copy `.env.example` to `.env` and update the values as needed. Feature flags allow the app to
start without Telegram or RAG configured.

### Places provider configuration

FoodBuddy auto-selects a places provider:

- If `COMPOSIO_MCP_URL` **and** `COMPOSIO_API_KEY` are set, it uses MCP.
- Otherwise, if `GOOGLE_MAPS_API_KEY` is set, it uses Google Places API.
- If neither is configured, the app returns a clear provider-unavailable error.

**Direct Google API mode**

```bash
GOOGLE_MAPS_API_KEY=your_google_maps_key
```

**Composio MCP mode (recommended)**

```bash
COMPOSIO_MCP_URL=https://your-composio-mcp.example.com
COMPOSIO_API_KEY=your_composio_api_key
```

## Database Setup

Generate Prisma client and run migrations:

```bash
npm run db:generate
npm run db:migrate
```

If you need to resolve a failed migration, set `DATABASE_URL` and run the rollback + deploy commands:

```bash
export DATABASE_URL="postgresql://user:password@host:5432/dbname"
npm run db:resolve:failed
npm run db:deploy
```

## Running Locally

Start the development server:

```bash
npm run dev
```

Then open `http://localhost:3000`.

**User URL:** `http://localhost:3000`

**Admin URL:** `http://localhost:3000/admin`

## How to Use

1. **Launch the app** and open the home page.
2. **Search or chat** for restaurants, cuisines, or meal ideas.
3. **Share a location** to receive nearby recommendations.
4. **Browse results** and iterate on preferences (price, distance, cuisine).

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — build for production
- `npm run start` — run production build
- `npm run lint` — run lint checks

## Deployment

Build and start the production server:

```bash
npm run build
npm run start
```

### Render

1. Create a new Web Service in Render and connect the repository.
2. Set the build command to `npm install --include=dev && npm run build`.
3. Set the start command to `npm run start`.
4. Add required environment variables (for example, `DATABASE_URL`, Places provider settings,
   and any feature flags from `.env.example`).
5. Provision a managed database (e.g. Render Postgres) and update `DATABASE_URL`.

**Render notes**

- Ensure `DATABASE_URL` plus any `COMPOSIO_*` variables are set in the Render environment.
- Render runs `npm start`, which applies `prisma migrate deploy` before starting the
  Next.js standalone server.

## Troubleshooting

- **Database errors**: ensure your database is running and `DATABASE_URL` is set.
- **Places data missing**: confirm your provider settings and API/MCP credentials.
- **MCP 406 Not Acceptable**: ensure the MCP gateway accepts
  `Accept: application/json, text/event-stream`.
- **MCP 400 Parse error / JSON-RPC**: verify the MCP payload is JSON-RPC 2.0
  (`jsonrpc`, `id`, `method`, `params`).
- **Provider health**: check `/api/health/places` for MCP tool availability.
- **Missing integrations**: check feature flags in `.env`.
