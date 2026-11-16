import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const env = (k: string) => Deno.env.get(k)!;
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const G = "https://graph.facebook.com/v21.0";
const WA = { Authorization: `Bearer ${env("WA_TOKEN")}` };
const TYPES = ["avance", "bloqueo", "logistica", "incidencia", "personal"];

const SYSTEM = `Eres el asistente técnico de un residente de obra en Perú. Recibes el texto (o transcripción de audio) y/o una foto de un reporte de campo.
Devuelve SOLO JSON, sin markdown: {"events":[{"type":"avance|bloqueo|logistica|incidencia|personal","front":"frente, bloque o zona; null si no se dice","summary":"una frase clara","severity":"baja|media|alta","detail":{}}],"reply":"confirmación breve para WhatsApp, español peruano, sin emojis"}.
Reglas: no inventes datos. Faltante de material, retraso, paralización o subcontratista ausente = 'bloqueo' o 'logistica'; severidad según el impacto en la siguiente actividad (alta si frena el trabajo de mañana). En 'personal' usa detail {"operarios":n,"peones":n,"oficiales":n}. En 'logistica' usa detail {"material":"","pedido":n,"recibido":n}. Si solo hay foto, describe lo que se ve como 'avance'. Si el mensaje es una duda o saludo, events=[] y responde útil. En reply repite lo entendido y, si hay bloqueo, di que quedó marcado para el gerente.`;

async function send(to: string, text: string) {
  await fetch(`${G}/${env("WA_PHONE_ID")}/messages`, {
    method: "POST", headers: { ...WA, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, text: { body: text } }),
  });
}

async function media(id: string) {
  const m = await (await fetch(`${G}/${id}`, { headers: WA })).json();
  const r = await fetch(m.url, { headers: WA });
  return { bytes: new Uint8Array(await r.arrayBuffer()), mime: m.mime_type as string };
}

async function transcribe(bytes: Uint8Array, mime: string) {
  const f = new FormData();
  f.append("file", new Blob([bytes], { type: mime }), "audio.ogg");
  f.append("model", "whisper-1");
  f.append("language", "es");
  f.append("prompt", "Obra en Perú: encofrado, vaciado, bolsas de cemento, fierro, losa, columnas, valorización, maestro de obra, operarios, peones.");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}` }, body: f });
  return (await r.json()).text as string;
}

async function extract(text: string, img?: { bytes: Uint8Array; mime: string }) {
  const content: unknown[] = [];
  if (img) content.push({ type: "image", source: { type: "base64", media_type: img.mime, data: encodeBase64(img.bytes) } });
  content.push({ type: "text", text: text || "(solo foto)" });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 1000, system: SYSTEM, messages: [{ role: "user", content }] }),
  });
  const raw = (await r.json()).content?.[0]?.text ?? "{}";
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

async function handle(m: any) {
  const from = m.from as string;
  const { data: link } = await db.from("phone_links").select("project_id").eq("phone", from).maybeSingle();
  if (!link) return send(from, "Tu número aún no está asociado a una obra. Pide a tu gerente que te registre.");
  const { data: dup } = await db.from("messages").select("id").eq("wa_id", m.id).maybeSingle();
  if (dup) return;

  let text: string = m.text?.body ?? m.image?.caption ?? "";
  let img, path: string | null = null;
  try {
    if (m.type === "audio" || m.type === "image") {
      const f = await media((m.audio ?? m.image).id);
      path = `${link.project_id}/${Date.now()}-${m.id.slice(-8)}.${m.type === "audio" ? "ogg" : "jpg"}`;
      await db.storage.from("obra").upload(path, f.bytes, { contentType: f.mime });
      if (m.type === "audio") text = await transcribe(f.bytes, f.mime); else img = f;
    }
    const { data: row } = await db.from("messages").insert(
      { project_id: link.project_id, wa_id: m.id, kind: m.type, body: text, media_path: path }).select().single();
    const out = await extract(text, img);
    const events = (out.events ?? []).filter((e: any) => TYPES.includes(e.type));
    if (events.length) await db.from("events").insert(
      events.map((e: any) => ({ ...e, project_id: link.project_id, message_id: row.id, media_path: path })));
    await send(from, out.reply ?? "Recibido.");
  } catch (e) {
    console.error(e);
    await send(from, "No pude procesar ese mensaje. Intenta de nuevo o envíalo como texto.");
  }
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (req.method === "GET") {
    return u.searchParams.get("hub.verify_token") === env("WA_VERIFY_TOKEN")
      ? new Response(u.searchParams.get("hub.challenge")) : new Response("forbidden", { status: 403 });
  }
  const msg = (await req.json()).entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (msg) EdgeRuntime.waitUntil(handle(msg));
  return new Response("ok");
});
