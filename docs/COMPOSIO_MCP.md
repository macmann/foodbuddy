# Composio MCP Setup

## Environment Variables

Set the following when running with the Composio MCP provider:

```bash
GOOGLE_PROVIDER=MCP
COMPOSIO_MCP_URL=https://your-composio-mcp.example.com
COMPOSIO_API_KEY=your_composio_api_key
```

## Dev Tooling

In development, you can inspect the MCP tools list to confirm tool names and schemas:

```bash
curl http://localhost:3000/api/mcp-tools
```

This endpoint is only available when `NODE_ENV=development` and will return tool names and
input schemas without exposing secrets.

## Troubleshooting

- **401 Unauthorized**: The `x-api-key` header is invalid or missing. Double-check
  `COMPOSIO_API_KEY`.
- **Empty tools list**: The MCP server is not configured with Google Maps tooling.
- **Tool schema mismatch**: Update the argument mapping in
  `lib/places/composioMcpProvider.ts` after reviewing `/api/mcp-tools` output.
