// server.js
// Minimal local dev/prod server so /api/* routes work when testing outside serverless hosts.
// Serves ./docs and mounts handlers from ./api/*/index.js.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies for API routes.
app.use(express.json({ limit: "2mb" }));

// Mount API handlers (Vercel-style) under /api/*
async function mount(name) {
  const mod = await import(`./api/${name}/index.js`);
  const handler = mod?.default;
  if (typeof handler !== "function") throw new Error(`api/${name}/index.js has no default export`);
  app.all(`/api/${name}`, (req, res) => handler(req, res));
}

await mount("health");
await mount("evaluate");
await mount("summary");
await mount("anchors");

// Static docs
app.use(express.static(path.join(__dirname, "docs")));

// SPA fallback (serve index.html for unknown routes)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "docs", "index.html"));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Reading Comprehension running on http://localhost:${PORT}`);
});
