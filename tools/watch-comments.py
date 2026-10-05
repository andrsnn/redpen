#!/usr/bin/env python3
"""Print each new comment for a project as it arrives. Run it where your agent can read its output.

  python3 tools/watch-comments.py projects/my-project

Prints one line per new comment (and per new reply). Comments that already exist are skipped.
Use it as the agent's "listener": when a line appears, make the edit, then answer with review/respond.py.
"""
import json, os, sys, time

project = sys.argv[1] if len(sys.argv) > 1 else '.'
path = os.path.join(project, 'review', 'comments.jsonl')

def read():
    out = {}
    try:
        for line in open(path):
            line = line.strip()
            if not line:
                continue
            try:
                c = json.loads(line)
                out[c['id']] = c
            except Exception:
                pass
    except FileNotFoundError:
        pass
    return out

seen = set(read())
print('watching', path, flush=True)
while True:
    for cid, c in read().items():
        if cid not in seen:
            seen.add(cid)
            print('NEW COMMENT', cid, '|', c.get('slide', ''), '| quote:', c.get('quote', '')[:200].replace('\n', ' '), '| elements:', ','.join((c.get('anchor') or {}).get('ids', [])), '| comment:', c['comment'], flush=True)
    time.sleep(1)
