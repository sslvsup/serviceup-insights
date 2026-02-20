#!/usr/bin/env bash
# PostToolUse hook — validates and auto-formats schema.prisma after edits.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only trigger for Prisma schema changes
if [[ "$FILE_PATH" != *schema.prisma ]]; then
  exit 0
fi

cd "$(dirname "$0")/../../" || exit 0

# Validate first
VALIDATE=$(npx prisma validate 2>&1)
if [ $? -ne 0 ]; then
  echo "Prisma schema validation failed:"
  echo "$VALIDATE"
  exit 0
fi

# Auto-format (modifies the file in place — cosmetic only)
npx prisma format --quiet 2>/dev/null

echo "Prisma schema valid. Run 'npm run db:migrate:dev -- --name <name>' to create a migration."

exit 0
