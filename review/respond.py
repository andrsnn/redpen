#!/usr/bin/env python3
"""Claude replies in a review thread.

  python3 deck-kit/review/respond.py <deck-dir> <comment-id> <open|changed|addressed> "<text>" [--change] [--slides 03,04]

--change   marks the message as a content change (shown as "Claude · changed")
--review   keep the thread open and yellow ("to review") instead of closing it. By default a thread answered
           with status "changed" closes itself (status addressed), so a large batch of comments does not pile up.
           A reply from the user reopens it.
--skip-slop  send even if the plain-words check flags a line (for deliberate quotes)
--slides   slide numbers or file names that changed, so the review page outlines them in yellow
"""
import json, sys, os, glob, datetime

deck, cid, status, text = sys.argv[1:5]
args = sys.argv[5:]

# Plain-words check: do not report a content change while the changed slides contain phrases already called slop.
if status == 'changed' and '--skip-slop' not in args and '--slides' in args:
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))
    import importlib.util
    spec = importlib.util.spec_from_file_location('slop_lint', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools', 'slop-lint.py'))
    lint = importlib.util.module_from_spec(spec); spec.loader.exec_module(lint)
    found = lint.lint_files(deck, lint.resolve(deck, [x.strip() for x in args[args.index('--slides') + 1].split(',')]))
    # reply text itself must be plain too
    if found:
        for f, line, why in found:
            print('%s: "%s"  <- %s' % (f, line[:140], why), file=sys.stderr)
        print('\nNot sent: %d line(s) on the changed slides are flagged as slop. Rewrite them (run /slop-to-english), or pass --skip-slop for a deliberate quote.' % len(found), file=sys.stderr)
        sys.exit(1)
state_file = os.path.join(deck, 'review', 'state.json')
st = json.load(open(state_file)) if os.path.exists(state_file) else {}
cur = st.get(cid, {})
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
if status == 'changed' and '--review' not in args:
    status = 'addressed'
    cur['doneAt'] = now
cur['status'] = status
msg = {'from': 'claude', 'text': text, 'at': now}
if '--change' in args:
    msg['kind'] = 'change'
cur.setdefault('thread', []).append(msg)
if '--slides' in args:
    spec = args[args.index('--slides') + 1].split(',')
    files = []
    for s in spec:
        s = s.strip()
        m = sorted(glob.glob(os.path.join(deck, 'slides', (s if s.endswith('.html') else s + '-*.html'))))
        files += [os.path.basename(x) for x in m]
    cur['slides'] = files
if status != 'addressed':
    cur.pop('doneAt', None)
st[cid] = cur
os.makedirs(os.path.dirname(state_file), exist_ok=True)
json.dump(st, open(state_file, 'w'), indent=1)
