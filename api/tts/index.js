// api/tts/index.js
// TTS endpoint with S3 caching.
// Provider selection: Deepgram (preferred, if DEEPGRAM_SECRET_KEY is set) or Amazon Polly (fallback).
//
// Request JSON:
//   - text (string, required)
//   - voiceId (string, optional)      // Deepgram model id or Polly voice id
//   - voiceVariant (string, optional) // 'male' | 'female' — maps to env var defaults
//   - engine (string, optional)       // Polly only: 'neural' | 'standard'
//   - speechMarks (string, optional)  // Polly only: 'sentence' to request timing marks
//   - nocache (bool, optional)        // bypass S3 cache (dev use)
//   - debug (bool, optional)          // return extra metadata
//
// Response JSON:
//   - url (string)        // presigned S3 URL for the mp3
//   - cacheHit (boolean)
//   - provider (string)   // 'deepgram' | 'polly'

import crypto from "node:crypto";
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { json, withCors, readJsonBody } from "../_lib/http.js";

function requiredEnv(name) {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s || ""), "utf8").digest("hex");
}

function toSafePrefix(prefix) {
  let p = String(prefix || "").trim();
  if (!p) return "tts/";
  if (!p.endsWith("/")) p += "/";
  p = p.replace(/\.+\//g, "");
  return p;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function parseSpeechMarksLines(buf) {
  const text = buf.toString("utf8").trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  const marks = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && obj.type === "sentence") {
        marks.push({
          time: Number(obj.time) || 0,
          start: Number(obj.start) || 0,
          end: Number(obj.end) || 0,
          value: String(obj.value || ""),
        });
      }
    } catch (_) {}
  }
  marks.sort((a, b) => a.time - b.time);
  return marks;
}

// ── Deepgram synthesis ────────────────────────────────────────────────────────
// Deepgram TTS REST API: POST https://api.deepgram.com/v1/speak?model=<model>
// Returns raw audio/mpeg. No speech marks equivalent — sentence highlighting
// uses the browser boundary-event approach on the client side.
//
// Default voice model env vars:
//   DEEPGRAM_MODEL_FEMALE  (e.g. "aura-asteria-en")
//   DEEPGRAM_MODEL_MALE    (e.g. "aura-orion-en")
//   DEEPGRAM_MODEL         (fallback for both)
//
// Full Deepgram Aura voice list (English):
//   Female: aura-asteria-en, aura-luna-en, aura-stella-en, aura-athena-en,
//           aura-hera-en, aura-nova-en, aura-zeus-en (neutral)
//   Male:   aura-orion-en, aura-arcas-en, aura-perseus-en, aura-angus-en,
//           aura-orpheus-en, aura-helios-en

async function deepgramSynthesize(text, modelId) {
  const key = requiredEnv("DEEPGRAM_SECRET_KEY");
  if (!key) throw new Error("DEEPGRAM_SECRET_KEY not set");

  const model = modelId || requiredEnv("DEEPGRAM_MODEL") || "aura-asteria-en";
  const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Token ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Deepgram API error ${res.status}: ${detail}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

export default async function handler(req, res) {
  const allowed = [
    "https://stripstone.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "null", // local file access (some browsers send 'null' as origin)
  ];
  if (withCors(req, res, allowed)) return;

  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Method not allowed. Use POST." });
    }

    const body = await readJsonBody(req);
    const text = String(body?.text ?? "").trim();
    const debug = String(body?.debug ?? "").trim() === "1" || body?.debug === true;
    const nocache = body?.nocache === true || String(body?.nocache ?? "").trim() === "1";
    const speechMarks = String(body?.speechMarks ?? "").trim().toLowerCase();
    const wantSentenceMarks = speechMarks === "sentence" || speechMarks === "1" || body?.speechMarks === true;

    if (!text) return json(res, 400, { error: "Missing text" });
    if (text.length > 8000) return json(res, 400, { error: "Text too long", detail: "Max 8000 characters." });

    const region = requiredEnv("AWS_REGION") || requiredEnv("AWS_DEFAULT_REGION");
    const bucket = requiredEnv("AWS_S3_BUCKET");
    if (!region || !bucket) {
      return json(res, 500, { error: "Missing AWS S3 configuration", detail: "Set AWS_REGION and AWS_S3_BUCKET." });
    }

    // ── Provider selection ────────────────────────────────────────────────────
    // Use Deepgram if DEEPGRAM_SECRET_KEY is set, otherwise fall back to Polly.
    const useDeepgram = Boolean(requiredEnv("DEEPGRAM_SECRET_KEY"));

    const voiceVariant = String(body?.voiceVariant ?? "").trim().toLowerCase();

    // Resolve voice/model id
    let resolvedVoiceId;
    let provider;
    if (useDeepgram) {
      provider = "deepgram";
      const envFemale = requiredEnv("DEEPGRAM_MODEL_FEMALE") || requiredEnv("DEEPGRAM_MODEL") || "aura-asteria-en";
      const envMale   = requiredEnv("DEEPGRAM_MODEL_MALE")   || requiredEnv("DEEPGRAM_MODEL") || "aura-orion-en";
      resolvedVoiceId = String(body?.voiceId || (voiceVariant === "male" ? envMale : envFemale)).trim();
    } else {
      provider = "polly";
      const envStandard   = requiredEnv("POLLY_ENGINE_STANDARD") || requiredEnv("POLLY_ENGINE") || "standard";
      const envPremium    = requiredEnv("POLLY_ENGINE_PREMIUM")  || requiredEnv("POLLY_ENGINE") || "neural";
      const engine        = (debug ? envPremium : envStandard) === "standard" ? "standard" : "neural";
      const envFemale     = requiredEnv("POLLY_VOICE_ID_FEMALE") || requiredEnv("POLLY_VOICE_ID");
      const envMaleStd    = requiredEnv("POLLY_VOICE_ID_MALE")   || requiredEnv("POLLY_VOICE_ID");
      const envMaleNeural = requiredEnv("POLLY_VOICE_ID_MALE_2") || envMaleStd;
      resolvedVoiceId = String(body?.voiceId || (voiceVariant === "male"
        ? (engine === "standard" ? envMaleStd : envMaleNeural)
        : envFemale
      ) || "Joanna").trim();
    }

    // ── S3 caching ────────────────────────────────────────────────────────────
    const prefix    = toSafePrefix(requiredEnv("AWS_S3_PREFIX"));
    const identity  = JSON.stringify({ provider, voiceId: resolvedVoiceId, text });
    const hash      = sha256Hex(identity);
    const objectKey = `${prefix}${hash}.mp3`;
    const marksKey  = `${prefix}${hash}.sentence.json`;

    const s3 = new S3Client({ region });

    let cacheHit = false;
    if (!nocache) {
      try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey })); cacheHit = true; }
      catch (_) { cacheHit = false; }
    }

    // ── Synthesis ─────────────────────────────────────────────────────────────
    if (!cacheHit) {
      let audioBuf;
      if (useDeepgram) {
        try {
          audioBuf = await deepgramSynthesize(text, resolvedVoiceId);
        } catch (dgErr) {
          // Deepgram failed — fall back to Polly if configured, else surface the error
          const pollyVoice = requiredEnv("POLLY_VOICE_ID_FEMALE") || requiredEnv("POLLY_VOICE_ID");
          if (!pollyVoice) {
            console.error("[tts] Deepgram failed, no Polly fallback configured:", dgErr);
            throw dgErr;
          }
          console.warn("[tts] Deepgram failed, falling back to Polly:", dgErr.message);
          provider = "polly";
          resolvedVoiceId = voiceVariant === "male"
            ? (requiredEnv("POLLY_VOICE_ID_MALE") || pollyVoice)
            : pollyVoice;
          const engine = "neural";
          const cmd = new SynthesizeSpeechCommand({
            OutputFormat: "mp3", Text: text, VoiceId: resolvedVoiceId,
            Engine: engine, TextType: "text",
          });
          const out = await (new PollyClient({ region })).send(cmd);
          if (!out?.AudioStream) return json(res, 502, { error: "Polly synthesis failed (Deepgram fallback)" });
          audioBuf = await streamToBuffer(out.AudioStream);
        }
      } else {
        // Polly path
        const engineRaw = String(body?.engine || (debug ? "neural" : "standard")).trim().toLowerCase();
        const engine = engineRaw === "standard" ? "standard" : "neural";
        const cmd = new SynthesizeSpeechCommand({
          OutputFormat: "mp3", Text: text, VoiceId: resolvedVoiceId,
          Engine: engine, TextType: "text",
        });
        const out = await (new PollyClient({ region })).send(cmd);
        if (!out?.AudioStream) return json(res, 502, { error: "Polly synthesis failed" });
        audioBuf = await streamToBuffer(out.AudioStream);
      }

      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: objectKey, Body: audioBuf,
        ContentType: "audio/mpeg",
        CacheControl: "public, max-age=31536000, immutable",
      }));
    }

    // ── Polly sentence marks (Polly only — Deepgram has no equivalent) ────────
    let sentenceMarks = null;
    if (wantSentenceMarks && !useDeepgram) {
      let marksCacheHit = false;
      if (!nocache) {
        try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: marksKey })); marksCacheHit = true; }
        catch (_) {}
      }
      try {
        if (!marksCacheHit) {
          const polly = new PollyClient({ region });
          const engineRaw = String(body?.engine || (debug ? "neural" : "standard")).trim().toLowerCase();
          const engine = engineRaw === "standard" ? "standard" : "neural";
          const marksCmd = new SynthesizeSpeechCommand({
            OutputFormat: "json", Text: text, VoiceId: resolvedVoiceId,
            Engine: engine, TextType: "text", SpeechMarkTypes: ["sentence"],
          });
          const marksOut = await polly.send(marksCmd);
          if (marksOut?.AudioStream) {
            const marksBuf = await streamToBuffer(marksOut.AudioStream);
            sentenceMarks = parseSpeechMarksLines(marksBuf);
            await s3.send(new PutObjectCommand({
              Bucket: bucket, Key: marksKey,
              Body: Buffer.from(JSON.stringify(sentenceMarks), "utf8"),
              ContentType: "application/json; charset=utf-8",
              CacheControl: "public, max-age=31536000, immutable",
            }));
          } else { sentenceMarks = []; }
        } else {
          const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: marksKey }));
          const buf = got?.Body ? await streamToBuffer(got.Body) : Buffer.from("[]");
          try { sentenceMarks = JSON.parse(buf.toString("utf8")); } catch(_) { sentenceMarks = []; }
        }
      } catch(_) { sentenceMarks = null; }
    }

    // ── Response ──────────────────────────────────────────────────────────────
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      { expiresIn: 60 * 60 }
    );

    const payload = { url, cacheHit, provider };
    if (wantSentenceMarks && Array.isArray(sentenceMarks)) payload.sentenceMarks = sentenceMarks;
    if (debug) payload.debug = { provider, voiceId: resolvedVoiceId, objectKey, textLength: text.length };
    return json(res, 200, payload);

  } catch (err) {
    return json(res, 500, { error: "Server error", detail: String(err) });
  }
}
