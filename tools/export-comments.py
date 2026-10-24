#!/usr/bin/env python3
"""Print your comments as markdown, grouped by page, ready to copy into another doc.

  python3 tools/export-comments.py projects/my-project                 # your notes (type "note")
  python3 tools/export-comments.py projects/my-project --type comment  # comments (the ones for Claude)
  python3 tools/export-comments.py projects/my-project --type all      # every type
  python3 tools/export-comments.py projects/my-project --all           # also archived and seeded "orig-" comments

Writes to stdout. Add `| pbcopy` to put it on the clipboard.
"""
import json, os, sys, re

args = sys.argv[1:]
project = next((a for a in args if not a.startswith('--') and (args.index(a) == 0 or args[args.index(a) - 1] != '--type')), '.')
show_all = '--all' in args
want = args[args.index('--type') + 1] if '--type' in args and args.index('--type') + 1 < len(args) else 'note'
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
def ctype(c): return 'note' if (state.get(c['id'], {}).get('ctype') or c.get('ctype')) == 'note' else 'comment'
mine = [c for c in rows if c.get('type') != 'reply'
        and (show_all or (not c['id'].startswith('orig-') and state.get(c['id'], {}).get('status') != 'archived'))
        and (want == 'all' or ctype(c) == want)]
by = {}
for c in mine: by.setdefault(c.get('slide', ''), []).append(c)
if not mine: print('No %s comments.' % want)
for slide in sorted(by):
    title = slide
    try:
        m = re.search(r'<title>(.*?)</title>', open(os.path.join(project, 'slides', slide)).read())
        if m: title = m.group(1)
    except Exception: pass
    print('## ' + title + '\n')
    for c in by[slide]:
        tag = ' [%s]' % ctype(c) if want == 'all' else ''
        print('- On "%s":%s' % (c.get('quote', '').replace('\n', ' ')[:140], tag) if c.get('quote') else '- On this page:' + tag)
        print('  ' + c['comment'].replace('\n', '\n  '))
        for t in state.get(c['id'], {}).get('thread', []):
            who = 'Claude' if t.get('from') == 'claude' else 'You'
            print('  - %s: %s' % (who, t['text'].replace('\n', ' ')))
    print()
