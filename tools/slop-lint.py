#!/usr/bin/env python3
"""Flag phrases in slide text that have been called slop before.

  python3 deck-kit/tools/slop-lint.py <deck-dir> [file-or-number ...]

Checks the visible text of slides (not styles, scripts, or the page-number and flow cues).
Exit code 0 when clean, 1 when something is flagged.
Skip a line on purpose (for example a word-for-word quote) by adding its exact text to <deck-dir>/review/slop-allow.txt.
Add new phrases to deck-kit/tools/slop-phrases.txt.
"""
import glob, html, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))

def load_phrases():
    out = []
    for line in open(os.path.join(HERE, 'slop-phrases.txt'), encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        out.append(re.compile(line[3:], re.I) if line.startswith('re:') else re.compile(re.escape(line), re.I))
    return out

def visible_lines(src):
    src = re.sub(r'<(style|script|head)\b.*?</\1>', '', src, flags=re.S | re.I)
    src = re.sub(r'<div class="abs (?:flow|pageno)[^"]*"[^>]*>.*?</div>', '', src, flags=re.S)
    src = re.sub(r'<br\s*/?>', '\n', src, flags=re.I)
    src = re.sub(r'</(div|li|p|text|span|h\d)>', '\n', src, flags=re.I)
    text = html.unescape(re.sub(r'<[^>]+>', ' ', src))
    return [re.sub(r'\s+', ' ', t).strip() for t in text.split('\n') if t.strip()]

def lint_files(deck, files):
    phrases = load_phrases()
    allow_path = os.path.join(deck, 'review', 'slop-allow.txt')
    allow = set()
    if os.path.exists(allow_path):
        allow = {l.strip() for l in open(allow_path, encoding='utf-8') if l.strip() and not l.startswith('#')}
    found = []
    for f in files:
        for line in visible_lines(open(f, encoding='utf-8').read()):
            if line in allow:
                continue
            for rx in phrases:
                m = rx.search(line)
                if m:
                    found.append((os.path.basename(f), line, m.group(0)))
                    break
            else:
                if re.search(r'[—~✓✗]', line):
                    found.append((os.path.basename(f), line, 'a symbol or dash a speaker cannot say'))
    return found

def resolve(deck, specs):
    files = []
    for s in specs:
        for d in ('slides', 'options'):
            files += sorted(glob.glob(os.path.join(deck, d, s if s.endswith('.html') else s + '-*.html')))
            if d == 'options' and not s.endswith('.html'):
                files += sorted(glob.glob(os.path.join(deck, d, s + '*.html')))
    return sorted(set(files)) if specs else sorted(glob.glob(os.path.join(deck, 'slides', '*.html')) + glob.glob(os.path.join(deck, 'options', '*.html')))

if __name__ == '__main__':
    deck = sys.argv[1]
    found = lint_files(deck, resolve(deck, sys.argv[2:]))
    for f, line, why in found:
        print('%s: "%s"  <- %s' % (f, line[:140], why))
    if found:
        print('\n%d line(s) flagged. Rewrite them in literal words (run /slop-to-english), or add the exact line to %s/review/slop-allow.txt if it is a deliberate quote.' % (len(found), deck))
    sys.exit(1 if found else 0)
