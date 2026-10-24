#!/usr/bin/env python3
"""Print your comments as markdown, grouped by page, ready to copy into another doc.

  python3 tools/export-comments.py projects/my-project          # your notes (skips seeded originals and archived)
  python3 tools/export-comments.py projects/my-project --all    # include everything

Writes to stdout. Add `| pbcopy` to put it on the clipboard.
"""
import json, os, sys, re

project = sys.argv[1] if len(sys.argv) > 1 else '.'
show_all = '--all' in sys.argv
rev = os.path.join(project, 'review')
state = {}
try: state = json.load(open(os.path.join(rev, 'state.json')))
except Exception: pass
rows = []
try:
    for line in open(os.path.join(rev, 'comments.jsonl')):
        try: rows.append(json.loads(line))
        except Exception: pass
except FileNotFoundError:
    pass
mine = [c for c in rows if c.get('type') != 'reply' and (show_all or (not c['id'].startswith('orig-') and state.get(c['id'], {}).get('status') != 'archived'))]
by = {}
for c in mine: by.setdefault(c.get('slide', ''), []).append(c)
if not mine: print('No comments yet.')
for slide in sorted(by):
    title = slide
    try:
        m = re.search(r'<title>(.*?)</title>', open(os.path.join(project, 'slides', slide)).read())
        if m: title = m.group(1)
    except Exception: pass
    print('## ' + title + '\n')
    for c in by[slide]:
        print('- On "%s":' % c.get('quote', '').replace('\n', ' ')[:140] if c.get('quote') else '- On this page:')
        print('  ' + c['comment'].replace('\n', '\n  '))
        for t in state.get(c['id'], {}).get('thread', []):
            who = 'Claude' if t.get('from') == 'claude' else 'You'
            print('  - %s: %s' % (who, t['text'].replace('\n', ' ')))
    print()
