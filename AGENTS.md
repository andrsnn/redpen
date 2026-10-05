# How the agent works in this repo

A project is a folder of pages (`projects/<name>/slides/NN-slug.html`, each a 1280×720 page). A person edits and comments on them in the browser. You, the agent, make the changes and answer in the comment thread. The pages can be slides, study notes, diagrams, a one-pager or a design mock.

## The loop

1. **Kickoff.** Go through `NEW-DECK.md` with the user and fill in `projects/<name>/OUTLINE.md`. Do not build pages before the goal and the shape are agreed.
2. **Scaffold.** `node tools/new-deck.js projects/<name> "<Title>"`.
3. **Build one page at a time** from `template/slide.html`. Write each page by hand. Scripts are fine for mechanical work such as renumbering.
4. **Render and look.** `node tools/render.js projects/<name> "" NN-slug.html`, then open the PNG. Fix anything flagged (off-page, clipped, orphan word). Do not report a page as done without looking at it.
5. **Open the editor.** `node editor/editor-server.js projects/<name>` and give the user http://127.0.0.1:8137/.
6. **Listen.** In a second process, run `python3 tools/watch-comments.py projects/<name>`. Each new comment prints one line.
7. **Answer every comment** after you make the change:
   `python3 review/respond.py projects/<name> <comment-id> changed "<what you changed>" --change --slides 03,04`
   A thread answered with `changed` closes itself. Add `--review` to keep it open for the user to check. A user reply reopens it. If you did not change anything, say why with status `open`.
8. **Commit after each accepted round** with a small message.

## Variants

The editor has a **+ Variant** button (key V). It sends a comment that starts with `[VARIANT REQUEST]`. When you see one:

- Create a new file `projects/<name>/options/<slide-name>--<short-tag>.html`, where `<slide-name>` is the main page's file name without its number and `.html` (for `slides/02-intro.html` it is `intro`). Example: `options/intro--before-after.html`.
- Start from the main page's file so the style matches, and change what the request asks for.
- Answer the comment, naming the new file.

The user then flips between the main page and its variants with the arrow keys, comments on whichever is shown, and presses **Use this version** to swap one in. The old main page is kept as a variant, so nothing is lost. Alt+arrows move between pages.

## Canvas projects

When the user wants one large diagram instead of pages, make a canvas: `node tools/new-canvas.js projects/<name> "<Title>"`, then write the scene with `tools/canvas-dsl.js` (see its header for the calls). Run your script again to regenerate. If the user has moved things in the browser, edit the `.excalidraw` JSON instead of regenerating, so their layout stays. Fix every problem `save()` prints (overlaps, text that does not fit). Comments on a canvas arrive with `canvas/<name>` as the page and an `elements:` list from `watch-comments.py`. Answer them with `respond.py ... --canvas <name> --elements <ids>`. Do not report a canvas as done from the script output alone: ask the user to look, or render it if they allow it.

## Rules

- **Facts come only from the user.** Never invent numbers, names, outcomes or quotes. If a page needs a fact you do not have, ask one short question. If you propose something, say it is a guess.
- **Plain words.** `review/respond.py` runs `tools/slop-lint.py` and blocks a "changed" reply while a changed page has a flagged phrase. Name who did what. Avoid slogans, staccato fragments and lines that sound deep but claim nothing. If a listener could not repeat a line back as a fact, rewrite it.
- **Less text.** Aim for 50 characters or fewer per line. Prefer a diagram when it shows how something works.
- **Speaker notes** go inside the page file as `<script type="text/x-notes">`. The editor has a notes box under the page.
- **Keep the user's edits.** If they changed something in the editor, keep it unless it is broken.

## Mechanics

- Keep `<title>NN — …</title>`, `.pageno` and the flow cue (`NN · Previous → NN · Next`) in sync. Moving pages in the editor does this for you.
- Layout habits: `text-wrap:balance` on headings, `white-space:nowrap` on chips, set `font-family` on `body`, keep the last row about 90px above the bottom.
- Export from the editor: PNG, All PNGs, PPTX, PDF (needs `npm install`).
- Dictation in the comment box uses an OpenAI key from `OPENAI_API_KEY` in `.env.local`. It is read on the server and never sent to the page.
