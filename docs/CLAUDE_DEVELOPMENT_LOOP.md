# Claude Development Loop

This is a working-method note for Claude Code.

It is useful to reference during development, but it is **not** an authority document.
If it conflicts with the core package, the core package wins.

## Core working set
Claude should usually work from:
- `04_EXECUTION_BACKLOG.md`
- `02_RUNTIME_CONTRACT.md`
- `03_ARCHITECTURE_MAP.md`
- `05_LAUNCH_AND_INTEGRATION.md`

Use `01_PROJECT_STATE.md` when current repo shape matters.

## Working loop
1. Take one patch bucket only.
2. State the user-visible target before changing code.
3. Name the owner file before changing code.
4. Patch narrowly.
5. Leave layout alone unless the issue is the layout.
6. After patching, state what changed, what risk area was touched, and what should be runtime-tested.

## What user feedback should look like
The owner should report:
- what felt wrong as a user
- what now feels right or still wrong
- macro behavior only

Avoid micro implementation suggestions unless the docs are clearly wrong.

## When Claude should push back
Claude should say the docs and the request do not align when:
- the request would move runtime truth into shell
- the request would make the shell guess state
- the request conflicts with the runtime contract
- the request would likely regress a launch-critical fix

## What to send back for product/doc review
Send back to product/doc review only when:
- expected behavior is unclear
- two docs disagree
- the user expectation has changed
- a requested behavior is better than the current documented contract

## Patch-safety rules
- Do not remove a shell bridge until the runtime replacement exists.
- Do not rewrite shell and runtime behavior in one pass.
- Do not mark behavior fixed based on code inspection alone.
- Validate in the served app, not just under `file://`.
