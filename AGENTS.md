# ObraControl MVP
- `supabase/migrations/`: esquema SQL con RLS.
- `supabase/functions/`: Edge Functions en Deno (whatsapp-webhook, daily-report, ask).
- `web/index.html`: panel del gerente, un solo archivo, sin build.
- Nunca subas claves. Las claves van en `supabase secrets` y la anon key solo en `web/index.html`.
- Pasos de despliegue: ver README.md.
