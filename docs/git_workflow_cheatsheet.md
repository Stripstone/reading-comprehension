# Reading Trainer Git Workflow Cheat Sheet

This file is meant for the local workflow you are using with Claude Code, GitHub Desktop, and manual runtime review.

Use it as a quick reference during the patch loop.

---

## 1. Go to the repo

cd C:\Users\Triston Barker\Documents\GitHub\reading-comprehension\
 - go to folder
git diff > claude-code.diff
 - Export a diff of all uncommitted changes
## 2. Check what changed

```bat
git status
```

What it does:
- shows changed files
- shows whether files are staged or unstaged
- confirms which branch you are on

---

## 3. 
## 4. Export a diff for only specific files

```bat
git diff -- docs/js/library.js docs/js/tts.js docs/js/shell.js > claude-code.diff
```

What it does:
- writes a smaller diff file containing only the listed files
- useful when a pass is limited to a few runtime files
- easier to review than exporting the whole repo diff

---

## 5. Export as a text file instead of .diff

```bat
git diff > claude-code.txt
```

What it does:
- same diff content as above, but saved as `.txt`
- easier to open on Windows with Notepad or similar tools
- good default if you do not want to deal with `.diff` extensions

---

## 6. See the diff directly in terminal

```bat
git diff
```

What it does:
- prints the current unstaged diff in the terminal
- good for a quick check before exporting or committing

---

## 7. See the names of changed files only

```bat
git diff --name-only
```

What it does:
- lists only the file paths that changed
- useful when you only want a quick scope check

---

## 8. Stage everything for commit

```bat
git add .
```

What it does:
- stages all current changes in the repo
- useful when the whole pass is intentional and review is complete

Safer alternative:

```bat
git add docs/js/library.js docs/js/tts.js docs/js/shell.js
```

What it does:
- stages only the files you name
- better when you want tighter control

---

## 9. Commit the staged changes

```bat
git commit -m "Stabilize reading playback routing"
```

What it does:
- creates a commit from staged changes
- use a message that describes the user-facing purpose of the pass

---

## 10. Show the most recent commit

```bat
git log --oneline -1
```

What it does:
- shows the latest commit hash and message
- useful when you need the hash for cherry-pick or review

---

## 11. Export the last commit as a patch-style file

```bat
git show --stat --patch HEAD > last-commit.txt
```

What it does:
- writes the latest commit diff to a readable file
- useful after commit when you want to review exactly what got saved

---

## 12. Compare current branch against main

```bat
git diff main...HEAD > branch-vs-main.diff
```

What it does:
- shows the changes on your current branch compared to `main`
- useful when working in a Claude-created branch or worktree

---

## 13. Check which branch you are on

```bat
git branch --show-current
```

What it does:
- prints the current branch name only
- useful when you want to make sure you are not committing to the wrong branch

---

## 14. Open the exported diff file quickly in Notepad

```bat
notepad claude-code.txt
```

What it does:
- opens the exported text diff immediately
- useful for quick local inspection before sending it here

---

## 15. Simple reusable review block

This is probably the block you will reuse most often:

```bat
cd C:\Users\Triston Barker\Documents\GitHub\reading-comprehension\
git status
git diff > claude-code.txt
notepad claude-code.txt
```

What it does:
- enters the repo
- confirms current changes
- exports the diff
- opens it locally for quick review

---

## 16. Runtime-pass review block for only key playback files

```bat
cd C:\Users\Triston Barker\Documents\GitHub\reading-comprehension\
git status
git diff -- docs/js/library.js docs/js/tts.js docs/js/shell.js > claude-playback-pass.txt
notepad claude-playback-pass.txt
```

What it does:
- narrows the review to the playback pass files
- keeps the export smaller and easier to inspect

---

## 17. Safe sequence before commit

```bat
cd C:\Users\Triston Barker\Documents\GitHub\reading-comprehension\
git status
git diff > claude-code.txt
```

Then:
- review the diff in GitHub Desktop or Notepad
- test runtime
- only then run `git add ...` and `git commit -m "..."`

---

## 18. Rule of thumb

Use:
- `git status` to know the state
- `git diff` to know the actual patch
- `git add` only after review
- `git commit` only after runtime testing when the pass is important

