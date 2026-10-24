#!/bin/sh
# Start the editor in solo mode for a project and open it.
#   ./solo.sh projects/my-project
# Solo mode: comments are private notes. Start one with @claude to ask the agent.
# Creates <project>/review/solo if missing. Stop with: pkill -f "editor-server.js <project>"
cd "$(dirname "$0")" || exit 1
P=${1:?usage: ./solo.sh <project-dir>}
[ -d "$P" ] || { echo "no such project: $P"; exit 1; }
mkdir -p "$P/review"; touch "$P/review/solo"
URL=http://127.0.0.1:8137/
if curl -s -o /dev/null "$URL"; then echo "Already running: $URL"; else
  node editor/editor-server.js "$P" >"$P/review/server.log" 2>&1 &
  sleep 1; echo "Started editor (log: $P/review/server.log)"
fi
[ "$2" = "--no-open" ] || open "$URL"
echo "Export your notes: python3 tools/export-comments.py $P | pbcopy"
