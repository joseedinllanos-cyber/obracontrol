import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // El JWT del gerente se reenvía: RLS limita los datos a sus obras.
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
  const { question } = await req.json();
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const { data: ev } = await sb.from("events")
    .select("created_at,type,front,summary,severity,status,projects(name)")
    .gte("created_at", since).order("created_at", { ascending: false }).limit(300);
  const SYS = "Eres el analista de obras de un gerente de operaciones en Perú. Responde en español, claro y breve, SOLO con los eventos dados (últimos 14 días). Cita obra y fecha. Si los datos no alcanzan para responder, dilo y no inventes. Cuando haya riesgos, prioriza qué destrabar primero.";
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("OPENROUTER_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("OPENROUTER_MODEL") ?? "google/gemini-2.5-flash", max_tokens: 700,
      messages: [{ role: "system", content: SYS }, { role: "user", content: `Eventos:\n${JSON.stringify(ev)}\n\nPregunta: ${question}` }],
    }),
  });
  const answer = (await r.json()).choices?.[0]?.message?.content ?? "No pude responder ahora.";
  return new Response(JSON.stringify({ answer }), { headers: { ...cors, "Content-Type": "application/json" } });
});