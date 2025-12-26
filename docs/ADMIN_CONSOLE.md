# Admin Console

## Required environment variables

Set these in your Render environment (or local `.env`) and redeploy:

```
ADMIN_PASSCODE=replace_with_strong_secret
ADMIN_JWT_SECRET=replace_with_strong_secret
ADMIN_SESSION_DAYS=7
```

## Accessing the console

1. Visit `/admin/login`.
2. Enter the admin passcode.
3. You will be redirected to `/admin` and can navigate via the sidebar.

## Troubleshooting

- **401 responses on admin APIs**: Ensure the admin cookie is present and your passcode is correct.
- **Redirect loop to `/admin/login`**: Check that `ADMIN_JWT_SECRET` is set and consistent across deployments.
- **MCP tools show unavailable**: Verify `COMPOSIO_MCP_URL` and `COMPOSIO_API_KEY` are set.
- **Database panels show unavailable**: Confirm `DATABASE_URL` is configured and the database is reachable.
