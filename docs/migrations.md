# Migrations runbook

## Recovering from failed migrations (P3009/P3018)

If Prisma reports a failed migration such as:

- `P3018` with a failed migration (for example `20250115000100_add_recommendation_metadata`), and
- `P3009` blocking future migrations,

follow these steps:

1. Inspect the migration error output and confirm which migration failed.
2. Decide whether the failed migration **did not apply** or **partially applied**:
   - If it did **not** apply, mark it rolled back:
     ```bash
     npx prisma migrate resolve --rolled-back 20250115000100_add_recommendation_metadata
     ```
   - If it **did** apply successfully and only the migration table is out of sync, mark it applied:
     ```bash
     npx prisma migrate resolve --applied 20250115000100_add_recommendation_metadata
     ```
3. Re-run deploy migrations:
   ```bash
   npx prisma migrate deploy
   ```

> Tip: do **not** delete rows from `_prisma_migrations` unless you intend to reset the database.

## When to reset vs. resolve

- **Resolve** when you need to preserve production data and only the migration history is blocked.
- **Reset** (drop/recreate) only for non-production environments or when data can be safely discarded.

