#!/bin/bash
# upcf.sh — Upload a file to Cloudflare Worker and print the file key
# Usage: upcf.sh <filename>

set -e

: "${UPLOAD_SERVER:?Error: UPLOAD_SERVER environment variable is not set}"
SERVER="$UPLOAD_SERVER"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <filename>" >&2
  exit 1
fi

FILE="$1"

if [ ! -f "$FILE" ]; then
  echo "Error: File not found: $FILE" >&2
  exit 1
fi

if [ -z "$UPLOAD_API_KEY" ]; then
  echo "Error: UPLOAD_API_KEY environment variable is not set" >&2
  exit 1
fi

RESPONSE=$(curl -s -X POST "$SERVER/upload" \
  -H "Authorization: Bearer $UPLOAD_API_KEY" \
  -F "file=@$FILE")

# Extract the key from JSON response using grep/cut (no jq dependency)
KEY=$(echo "$RESPONSE" | grep -o '"key":"[^"]*"' | cut -d'"' -f4)

if [ -z "$KEY" ]; then
  echo "Upload failed: $RESPONSE" >&2
  exit 1
fi

echo "$KEY"