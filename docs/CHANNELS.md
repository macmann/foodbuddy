# Channels

This project supports multiple delivery channels. Telegram is implemented, while
Viber and Messenger are stubs that return `501` until adapters are added.

## Environment variables

### Core
- `ANON_ID_SALT`: Required to hash anonymous identifiers.

### Telegram
- `ENABLE_TELEGRAM`: Set to `true` to enable the webhook handler.
- `TELEGRAM_BOT_TOKEN`: Telegram bot API token.
- `TELEGRAM_WEBHOOK_SECRET`: Optional shared secret; if set, incoming webhook
  requests must include the `x-telegram-bot-api-secret-token` header.

### Viber (stub)
- `ENABLE_VIBER`: Set to `true` to enable the stub endpoint.
- `VIBER_AUTH_TOKEN`: Reserved for the Viber API integration.

### Messenger (stub)
- `ENABLE_MESSENGER`: Set to `true` to enable the stub endpoint.
- `MESSENGER_PAGE_ACCESS_TOKEN`: Reserved for the Messenger send API.
- `MESSENGER_VERIFY_TOKEN`: Reserved for webhook verification.
