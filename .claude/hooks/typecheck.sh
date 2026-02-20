#!/usr/bin/env bash
# PostToolUse hook — runs tsc after TypeScript source edits.
# Claude sees any type errors immediately and can fix them before moving on.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only trigger for files inside src/ with a .ts extension
if [[ "$FILE_PATH" != */src/*.ts ]]; then
  exit 0
fi

cd "$(dirname "$0")/../../" || exit 0

RESULT=$(npx tsc --noEmit 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "TypeScript errors after editing $(basename "$FILE_PATH"):"
  echo "$RESULT"
fi

exit 0
