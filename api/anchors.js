// Vercel/Node entrypoint shim
//
// Some deployments may surface folder functions as /api/<name>/index.
// This shim guarantees the canonical route /api/anchors works.

export { default } from "./anchors/index.js";
