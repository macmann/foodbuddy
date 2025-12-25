# FoodBuddy

FoodBuddy is a Next.js 15+ (App Router) starter for a food recommendation platform.

## Getting Started

```bash
npm install
npm run dev
```

## Database

```bash
npm run db:generate
npm run db:migrate
```

## Environment

Copy `.env.example` to `.env` and update the values as needed. Feature flags allow the app to
start without Telegram or RAG configured.

### Places provider configuration

**Direct Google API mode**

```bash
GOOGLE_PROVIDER=API
GOOGLE_MAPS_API_KEY=your_google_maps_key
```

**Composio MCP mode (recommended)**

```bash
GOOGLE_PROVIDER=MCP
COMPOSIO_MCP_URL=https://your-composio-mcp.example.com
COMPOSIO_API_KEY=your_composio_api_key
```
