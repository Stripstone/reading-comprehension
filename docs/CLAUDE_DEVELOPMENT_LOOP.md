# Claude Development Loop

This is a working-method note for Claude Code.

It is useful to reference during development, but it is **not** an authority document.
If it conflicts with the core package, the core package wins.

## Before a Claude pass
Before a large Claude pass is requested:
1. runtime-test enough to identify the real user failure
2. describe the failure in user terms
3. define the pass using runtime success and failure conditions

Do not send Claude a large pass based only on code suspicion or architectural preference.

## Core working set
Claude should usually work from:
- `04_EXECUTION_BACKLOG.md`
- `02_RUNTIME_CONTRACT.md`
- `03_ARCHITECTURE_MAP.md`
- `05_LAUNCH_AND_INTEGRATION.md`

Use `01_PROJECT_STATE.md` when current repo shape matters.

## Required pre-patch contract
Before coding, Claude should state:
1. objective
2. files in scope
3. files out of scope
4. runtime behaviors this pass must satisfy
5. behaviors assumed already correct
6. exact runtime checks that would prove those assumptions wrong
7. what outcomes would count as pass failure

A pass should not start without this contract.

## Working loop
1. Take one high-yield vertical system only.
2. State the user-visible target before changing code.
3. Name the owner file before changing code.
4. Patch narrowly within that system.
5. Leave layout alone unless the issue is the layout.
6. After patching, state what changed, what risk area was touched, and what should be runtime-tested.


## Authority-first pass design
For launch-critical issues, use this order:
1. identify the upstream runtime authority or truth model first
2. scan nearby regression paths that read, write, mirror, or infer that same truth
3. patch downstream only after the authority model and nearby regression surface are explicit

This is meant to prevent narrow local fixes from landing on the wrong layer.
A pass should not solve one downstream symptom while leaving adjacent authority paths untouched.

### What counts as nearby regression scan
Before coding, Claude should name the adjacent paths that could regress if the authority model is incomplete, especially:
- other entry paths that choose the same runtime target
- restore, restart, autoplay, skip, or resume paths touching the same truth
- source or chapter replacement paths touching the same truth
- shell bridges or inference helpers that still mirror or guess that truth

This is not a license for broad cleanup.
It is a bounded scan to keep a high-yield pass from fixing one path while missing an adjacent regression path.

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
- Do not rewrite shell and runtime behavior in one pass unless the objective itself spans both.
- Do not mark behavior fixed based on code inspection alone.
- Validate in the served app, not just under `file://`.
