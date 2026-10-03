#!/usr/bin/env python3
"""Claude replies in a review thread.

  python3 review/respond.py <deck-dir> <comment-id> <open|changed|addressed> "<text>" [--change] [--slides 03,04]

--change   marks the message as a content change (shown as "Claude · changed")
--review   keep the thread open and yellow ("to review") instead of closing it. By default a thread answered
           with status "changed" closes itself (status addressed), so a large batch of comments does not pile up.
           A reply from the user reopens it.
--slides   slide numbers or file names that changed, so the review page outlines them in yellow
"""
import json, sys, os, glob, datetime

deck, cid, status, text = sys.argv[1:5]
args = sys.argv[5:]
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
