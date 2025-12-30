# Next/document audit

Audit scope:
- Imports from `next/document`
- `<Html>` usage
- `<html>` / `<body>` tags inside React components

Findings:
- `pages/_document.tsx` is the only file that imports `next/document` and renders `<Html>` (expected).
- `<html>` / `<body>` appear only in `app/layout.tsx` (expected for App Router layouts).
