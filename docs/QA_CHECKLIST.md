# QA Checklist

## Web chat (browser)
- Open `/` and confirm the chat input is visible.
- Ask for recommendations (e.g., “pizza nearby”).
- Verify the response returns up to 3 recommendations with name + rating + address.
- Confirm the idle feedback prompt appears after ~10 minutes of inactivity.
- Submit feedback with a rating and optional comment/tags and confirm success.

## Feedback + aggregates
- Submit feedback via web form and confirm the response is `200`.
- Confirm `PlaceFeedback` is written in Postgres.
- Confirm `PlaceAggregate` updates `communityRatingAvg`, `communityRatingCount`, and `tagCounts`.
- Verify new recommendations reflect updated community scoring.

## Telegram
- Enable via `ENABLE_TELEGRAM=true`, set `TELEGRAM_BOT_TOKEN`.
- Send a text message without location; confirm bot requests location.
- Share location; confirm bot acknowledges and responds to a query.
- Verify the bot sends 1 primary + 2 alternatives and the inline buttons.
- Reply with `rate <place number> <1-5> optional comment`; confirm feedback is stored.

## Safety & limits
- Send a chat message over 500 chars; confirm the request is rejected.
- Submit feedback containing a URL; confirm it is rejected.
- Trigger rate limiting by sending >10 requests per minute; confirm `429`.

## Health endpoint
- Request `/api/health`; confirm `{ ok: true, version, time }`.
