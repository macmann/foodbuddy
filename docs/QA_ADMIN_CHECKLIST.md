# Admin Console QA Checklist

## Login/logout
- [ ] Log in at `/admin/login` using `ADMIN_PASSCODE`.
- [ ] Verify logout clears the session and redirects back to `/admin/login`.

## Queries feed
- [ ] Validate filters (date range, channel, status, text search) update results.
- [ ] Open a query detail view and confirm parsed constraints and recommendations render.

## Feedback moderation
- [ ] Hide a feedback item and confirm its status updates in the list.
- [ ] Unhide a feedback item and confirm community aggregates exclude hidden feedback.

## Health page
- [ ] Confirm MCP tools list renders when `COMPOSIO_MCP_URL` and `COMPOSIO_API_KEY` are set.
- [ ] Confirm database status shows connectivity and latency.
