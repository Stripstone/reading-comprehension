// api/tts/index.js
// Amazon Polly TTS endpoint with S3 caching.
//
// Request JSON:
//   - text (string, required)
//   - key (string, optional)         // caller-provided stable key (e.g., pageHash)
//   - voiceId (string, optional)     // defaults to POLLY_VOICE_ID or Joanna
//   - engine (string, optional)      // 'neural' or 'standard' (defaults to POLLY_ENGINE or neural)
//
// Response JSON:
//   - url (string)  // presigned URL for the mp3
//   - cacheHit (boolean)
//   - objectKey (string, debug only)

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
  // Prevent traversal-like keys
  p = p.replace(/\.+\//g, "");
  return p;
}

async function streamToBuffer(stream) {
  // AWS SDK returns a Readable stream (Node runtime).
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  const allowed = [
    "https://stripstone.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];
  if (withCors(req, res, allowed)) return;

  try {
    if (req.method !== "POST") {
      return json(res, 405, { error: "Method not allowed. Use POST." });
    }

    const body = await readJsonBody(req);
    const text = String(body?.text ?? "").trim();
    const debug = String(body?.debug ?? "").trim() === "1" || body?.debug === true;

    if (!text) {
      return json(res, 400, { error: "Missing text" });
    }

    // Keep payloads bounded to prevent abuse.
    // Polly max is higher (and depends on SSML), but we keep this conservative.
    if (text.length > 8000) {
      return json(res, 400, { error: "Text too long", detail: "Max 8000 characters." });
    }

    const region = requiredEnv("AWS_REGION") || requiredEnv("AWS_DEFAULT_REGION");
    const bucket = requiredEnv("AWS_S3_BUCKET");

    if (!region || !bucket) {
      return json(res, 500, {
        error: "Missing AWS configuration",
        detail: "Set AWS_REGION (or AWS_DEFAULT_REGION) and AWS_S3_BUCKET.",
      });
    }

    const voiceId = String(body?.voiceId || requiredEnv("POLLY_VOICE_ID") || "Joanna").trim();
    const engineRaw = String(body?.engine || requiredEnv("POLLY_ENGINE") || "neural").trim().toLowerCase();
    const engine = engineRaw === "standard" ? "standard" : "neural";

    const prefix = toSafePrefix(requiredEnv("AWS_S3_PREFIX"));
    const identity = JSON.stringify({ voiceId, engine, text });
    const hash = sha256Hex(identity);
    const objectKey = `${prefix}${hash}.mp3`;

    const s3 = new S3Client({ region });
    const polly = new PollyClient({ region });

    // Cache check
    let cacheHit = false;
    try {
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
      cacheHit = true;
    } catch (_) {
      cacheHit = false;
    }

    if (!cacheHit) {
      const cmd = new SynthesizeSpeechCommand({
        OutputFormat: "mp3",
        Text: text,
        VoiceId: voiceId,
        Engine: engine,
        TextType: "text",
      });

      const out = await polly.send(cmd);
      if (!out?.AudioStream) {
        return json(res, 502, { error: "Polly synthesis failed" });
      }
      const audioBuf = await streamToBuffer(out.AudioStream);

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: audioBuf,
          ContentType: "audio/mpeg",
          CacheControl: "public, max-age=31536000, immutable",
        })
      );
    }

    // Short-lived presigned URL (client can replay while it lasts; S3 caching still applies).
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      { expiresIn: 60 * 60 } // 1 hour
    );

    const payload = { url, cacheHit };
    if (debug) payload.debug = { voiceId, engine, objectKey, textLength: text.length };
    return json(res, 200, payload);
  } catch (err) {
    return json(res, 500, { error: "Server error", detail: String(err) });
  }
}
