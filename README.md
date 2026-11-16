# ObraControl MVP

WhatsApp (audio/foto/texto) → IA estructura el reporte → panel del gerente + informe diario.
Tres funciones: captura por WhatsApp, informe diario a las 6 p. m., y "pregunta a tus obras".

## Despliegue
1. **Base de datos:** pega `supabase/migrations/001_schema.sql` en el SQL Editor.
2. **Usuario gerente:** Authentication > Users > Add user (correo y contraseña).
3. **Obra y residente** (SQL Editor, logueado como el proyecto; usa el id del usuario gerente):
   ```sql
   insert into projects(owner_id,name) values ('<USER_ID>','Edificio Los Álamos') returning id;
   insert into phone_links(phone,project_id,person_name) values ('51987654321','<PROJECT_ID>','Residente');
   ```
4. **Secretos y funciones** (Supabase CLI):
   ```bash
   supabase secrets set WA_TOKEN=... WA_PHONE_ID=... WA_VERIFY_TOKEN=cualquier-texto \
     ANTHROPIC_API_KEY=... OPENAI_API_KEY=...
   supabase functions deploy whatsapp-webhook --no-verify-jwt
   supabase functions deploy daily-report
   supabase functions deploy ask
   ```
5. **Meta (WhatsApp Cloud API):** en el webhook usa
   `https://<REF>.supabase.co/functions/v1/whatsapp-webhook`, tu `WA_VERIFY_TOKEN` y suscríbete a `messages`.
6. **Informe diario 6 p. m. Lima** (23:00 UTC), en el SQL Editor:
   ```sql
   create extension if not exists pg_cron; create extension if not exists pg_net;
   select cron.schedule('informe-diario','0 23 * * *',$$
     select net.http_post(url:='https://<REF>.supabase.co/functions/v1/daily-report',
       headers:='{"Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb) $$);
   ```
7. **Panel:** edita `SUPABASE_URL` y `SUPABASE_ANON_KEY` en `web/index.html` y súbelo a Vercel, Netlify o Cloudflare Pages (Supabase Storage no muestra HTML).

## Límites conocidos
- El informe se abre como página en el panel (imprimir como PDF); aún no se envía como archivo por WhatsApp.
- Los mensajes de WhatsApp fuera de la ventana de 24 h requieren plantillas aprobadas por Meta.
- Una cuenta de gerente por organización. Sin roles ni multiempresa todavía.
- Revisa costos de IA por residente durante el piloto.
