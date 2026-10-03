#!/usr/bin/env python3
"""PreToolUse hook for Bash. Blocks `git commit` and deck review replies (respond.py) when slide files
have changed and the slop-to-english skill has not been run in this session since the last change.
Exit 2 makes Claude Code show the stderr message to Claude. Any doubt: allow (never block on a parsing problem)."""
import datetime, json, os, re, subprocess, sys

def allow(): sys.exit(0)
try:
    data = json.load(sys.stdin)
except Exception:
    allow()
cmd = (data.get('tool_input') or {}).get('command', '') or ''
if not re.search(r'(^|[\s;&|])git\s+commit\b|respond\.py', cmd):
    allow()
cwd = data.get('cwd') or os.getcwd()
try:
    root = subprocess.check_output(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], text=True, stderr=subprocess.DEVNULL).strip()
    status = subprocess.check_output(['git', '-C', root, 'status', '--porcelain'], text=True, stderr=subprocess.DEVNULL)
except Exception:
    allow()
files = []
for line in status.splitlines():
    path = line[3:].split(' -> ')[-1].strip().strip('"')
    if re.search(r'(^|/)(slides|options)/[^/]+\.html$', path) and os.path.exists(os.path.join(root, path)):
        files.append(os.path.join(root, path))
if not files:
    allow()
newest = max(os.path.getmtime(f) for f in files)
tp = data.get('transcript_path')
last_skill = None
try:
    for line in open(tp, encoding='utf-8'):
        if 'slop-to-english' not in line:
            continue
        try:
            e = json.loads(line)
        except Exception:
            continue
        content = (e.get('message') or {}).get('content')
        if not isinstance(content, list):
            continue
        for b in content:
            if isinstance(b, dict) and b.get('type') == 'tool_use' and b.get('name') == 'Skill' and 'slop-to-english' in json.dumps(b.get('input', {})):
                ts = e.get('timestamp')
                if ts:
                    last_skill = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()
except Exception:
    allow()
if last_skill is not None and last_skill >= newest:
    allow()
names = ', '.join(sorted({os.path.basename(f) for f in files})[:6])
print('Blocked: slide text changed (%s) and /slop-to-english has not been run since. Run the skill on the changed text, rewrite any flagged line, then repeat this command.' % names, file=sys.stderr)
sys.exit(2)
