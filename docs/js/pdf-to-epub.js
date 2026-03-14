// api/pdf-to-epub.js
// Proxies PDF → EPUB conversion through the FreeConvert API.
// Keeping the API key server-side is the only reason this exists —
// all heavy lifting (upload, convert, export) is done by FreeConvert.
//
// Three lightweight steps called sequentially from the client:
//
//   POST ?step=upload   → create an upload task, return { importTaskId, uploadUrl, signature }
//   POST ?step=convert  → body: { importTaskId } → return { exportTaskId }
//   POST ?step=status   → body: { exportTaskId } → return { status, url? }
//
// The client uploads the PDF directly to FreeConvert (step 2 happens
// client-side between the upload and convert calls) and polls step=status
// until conversion is done, avoiding any Vercel function timeout.

const FC_API = 'https://api.freeconvert.com/v1';

// Required on every response: the site is served from GitHub Pages and calls
// this Vercel function cross-origin. Without these headers the browser blocks
// the request before it reaches the function body (CORS preflight fails).
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function fcHeaders() {
  const key = process.env.FREECONVERT_API_KEY;
  if (!key) throw new Error('FREECONVERT_API_KEY env var is not set');
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${key}`,
  };
}

export default async function handler(req, res) {
  setCors(res);

  // Handle CORS preflight — browser sends OPTIONS before every cross-origin POST.
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const step = req.query.step;

  try {
    // ── step=upload ─────────────────────────────────────────────────────────
    // Create a FreeConvert upload task. Returns the upload URL and signature
    // so the client can POST the PDF directly to FreeConvert's servers,
    // bypassing Vercel's request body size limit entirely.
    if (step === 'upload') {
      const r = await fetch(`${FC_API}/process/import/upload`, {
        method: 'POST',
        headers: fcHeaders(),
      });
      const data = await r.json();
      if (!r.ok) {
        return res.status(r.status).json({ error: 'Upload task failed', detail: data });
      }
      return res.status(200).json({
        importTaskId: data.id,
        uploadUrl:    data.result.form.url,
        signature:    data.result.form.parameters.signature,
      });
    }

    // ── step=convert ─────────────────────────────────────────────────────────
    // Takes the importTaskId from step=upload (after the client has finished
    // uploading the file). Creates a convert task (pdf→epub) and an export
    // task, then returns the exportTaskId for the client to poll.
    if (step === 'convert') {
      const { importTaskId } = req.body || {};
      if (!importTaskId) return res.status(400).json({ error: 'importTaskId required' });

      // Convert: pdf → epub
      const convertRes = await fetch(`${FC_API}/process/convert`, {
        method: 'POST',
        headers: fcHeaders(),
        body: JSON.stringify({
          input:         importTaskId,
          input_format:  'pdf',
          output_format: 'epub',
        }),
      });
      const convertData = await convertRes.json();
      if (!convertRes.ok) {
        return res.status(convertRes.status).json({ error: 'Convert failed', detail: convertData });
      }

      // Export: generate a download URL for the converted EPUB
      const exportRes = await fetch(`${FC_API}/process/export/url`, {
        method: 'POST',
        headers: fcHeaders(),
        body: JSON.stringify({ input: [convertData.id] }),
      });
      const exportData = await exportRes.json();
      if (!exportRes.ok) {
        return res.status(exportRes.status).json({ error: 'Export task failed', detail: exportData });
      }

      return res.status(200).json({ exportTaskId: exportData.id });
    }

    // ── step=status ──────────────────────────────────────────────────────────
    // Called repeatedly by the client (every 2s) until status === 'completed'.
    // Returns { status, url } where url is the EPUB download link when done.
    if (step === 'status') {
      const { exportTaskId } = req.body || {};
      if (!exportTaskId) return res.status(400).json({ error: 'exportTaskId required' });

      const r = await fetch(`${FC_API}/process/tasks/${exportTaskId}`, {
        headers: fcHeaders(),
      });
      const data = await r.json();
      if (!r.ok) {
        return res.status(r.status).json({ error: 'Status check failed', detail: data });
      }

      // Possible statuses: created | processing | completed | failed | canceled | deleted
      return res.status(200).json({
        status: data.status,
        url:    data.status === 'completed' ? (data.result?.url ?? null) : null,
      });
    }

    return res.status(400).json({ error: `Unknown step: ${step}` });

  } catch (err) {
    console.error('[pdf-to-epub]', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
