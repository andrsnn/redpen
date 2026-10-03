---
name: redpen
description: Iterate on pages (slides, study notes, diagrams, one-pagers) with a person who edits and comments in a browser editor. Use when the user wants to build or revise something page by page and review it with comments, or to answer comments and variant requests in an redpen project.
---

# redpen

1. Read `AGENTS.md` in the repo root and follow it.
2. New project: run the `NEW-DECK.md` kickoff, then `node tools/new-deck.js projects/<name> "<Title>"`.
3. Start the editor (`node editor/editor-server.js projects/<name>`) and a listener (`python3 tools/watch-comments.py projects/<name>`).
4. For each comment: make the change, then `python3 review/respond.py projects/<name> <id> changed "<what changed>" --change --slides NN`.
5. For `[VARIANT REQUEST]` comments: create `options/<slide-name>--<tag>.html` as described in `AGENTS.md`.
6. Render and look at a page before reporting it done.

Install as a Claude Code skill by copying this folder to `~/.claude/skills/redpen/`.
