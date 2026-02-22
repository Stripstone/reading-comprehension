// api/dev-server.js
// Local dev server that matches the repo's Vercel-style /api/* layout.
// Keeps all server logic inside /api as requested.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));

// Mount Vercel-style API handlers under /api/*
async function mount(name) {
  const mod = await import(`./${name}/index.js`);
  const handler = mod?.default;
  if (typeof handler !== "function") {
    throw new Error(`api/${name}/index.js has no default export`);
  }
  app.all(`/api/${name}`, (req, res) => handler(req, res));
}

await mount("health");
await mount("evaluate");
await mount("summary");
await mount("anchors");

// Serve static UI from ../docs
const docsDir = path.join(__dirname, "..", "docs");
app.use(express.static(docsDir));

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(docsDir, "index.html"));
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Reading Comprehension running on http://localhost:${PORT}`);
});
