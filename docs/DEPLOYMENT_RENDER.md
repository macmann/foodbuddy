# Render Deployment Guide

## Build Command

```
npm install && npx prisma generate && npx prisma migrate deploy && npm run build
```

## Start Command

```
npm run start
```

## Environment Variables

Required:

- `DATABASE_URL`
- `NODE_ENV`
- `APP_ENV`
- `APP_NAME`
- `JWT_SECRET`

Optional (feature flags and integrations):

- `FEATURE_TELEGRAM`
- `FEATURE_RAG`
- `TELEGRAM_BOT_TOKEN`
- `OPENAI_API_KEY`
- `RAG_SERVICE_URL`
