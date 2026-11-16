import { createClient } from "npm:@supabase/supabase-js@2";
const env = (k: string) => Deno.env.get(k)!;
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const LABEL: Record<string, string> = { avance: "Avance del día", personal: "Personal", bloqueo: "Bloqueos", logistica: "Logística", incidencia: "Incidencias" };

async function claude(prompt: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
  });
  return ((await r.json()).content?.[0]?.text ?? "") as string;
}
async function send(to: string, text: string) {
  await fetch(`https://graph.facebook.com/v21.0/${env("WA_PHONE_ID")}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${env("WA_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, text: { body: text } }) });
}

Deno.serve(async () => {
  const day = new Date(Date.now() - 5 * 36e5).toISOString().slice(0, 10); // hora de Lima
  const start = new Date(`${day}T05:00:00Z`), end = new Date(start.getTime() + 864e5);
  const { data: projects } = await db.from("projects").select("id,name");
  let n = 0;
  for (const p of projects ?? []) {
    const { data: ev } = await db.from("events").select("*").eq("project_id", p.id)
      .gte("created_at", start.toISOString()).lt("created_at", end.toISOString()).order("created_at");
    if (!ev?.length) continue;
    const resumen = (await claude(`Redacta en 3 a 5 líneas el resumen ejecutivo del día para el informe de la obra "${p.name}". Usa solo estos eventos, no inventes nada, tono profesional:\n${JSON.stringify(ev.map((e) => ({ tipo: e.type, frente: e.front, texto: e.summary, severidad: e.severity })))}`)).trim();
    let body = "";
    for (const t of Object.keys(LABEL)) {
      const items = ev.filter((e) => e.type === t);
      if (items.length) body += `<h2>${LABEL[t]}</h2><ul>${items.map((e) => `<li>${e.front ? `<b>${esc(e.front)}:</b> ` : ""}${esc(e.summary)}</li>`).join("")}</ul>`;
    }
    let fotos = "";
    for (const e of ev.filter((e) => e.media_path?.endsWith(".jpg"))) {
      const { data } = await db.storage.from("obra").createSignedUrl(e.media_path, 31536000);
      fotos += `<figure><img src="${data?.signedUrl}"><figcaption>${esc(e.front ?? "")} · ${new Date(e.created_at).toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit" })} · ${esc(e.summary)}</figcaption></figure>`;
    }
    const html = `<!doctype html><meta charset="utf-8"><title>Informe ${day}</title><style>body{font:14px/1.5 system-ui;max-width:780px;margin:32px auto;color:#1b1f23}h1{border-bottom:3px solid #17302b;padding-bottom:8px}h2{font-size:16px;margin-top:22px}figure{display:inline-block;width:48%;margin:0 1% 12px 0;vertical-align:top}img{width:100%}figcaption{font-size:11px;color:#4a5158}</style><h1>Informe diario · ${esc(p.name)}</h1><p>${day}</p><p>${esc(resumen)}</p>${body}${fotos ? `<h2>Registro fotográfico</h2>${fotos}` : ""}`;
    await db.from("daily_reports").upsert({ project_id: p.id, report_date: day, html }, { onConflict: "project_id,report_date" });
    const { data: phones } = await db.from("phone_links").select("phone").eq("project_id", p.id);
    for (const ph of phones ?? []) await send(ph.phone, `Informe de hoy listo (${ev.length} registros).\n\n${resumen}\n\nYa está disponible para tu gerente en el panel.`);
    n++;
  }
  return new Response(JSON.stringify({ reports: n }));
});
