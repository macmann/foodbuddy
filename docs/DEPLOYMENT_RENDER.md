# Render Deployment Guide

## Build Command

```
npm install --include=dev && npx prisma generate && npx prisma migrate deploy && npm run build
```

## Start Command

```
npm run start
```

## Environment Variables

Required:

- `DATABASE_URL`
- `NODE_ENV`
- `OPENAI_API_KEY`
- `ANON_ID_SALT`
- `GOOGLE_PROVIDER`

Places providers:

- Direct API mode: set `GOOGLE_PROVIDER=API` and `GOOGLE_MAPS_API_KEY`
- Composio MCP mode: set `GOOGLE_PROVIDER=MCP`, `COMPOSIO_MCP_URL`, and `COMPOSIO_API_KEY`
  - Google API key is not needed in FoodBuddy env for MCP mode

Optional (feature flags and integrations):

- `TELEGRAM_BOT_TOKEN`
- `ENABLE_TELEGRAM`
- `ENABLE_RAG`
