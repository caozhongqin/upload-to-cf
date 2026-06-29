#!/bin/bash
# dlcf.sh — Download a file from Cloudflare Worker by its key
# Usage: dlcf.sh <key> [custom-filename]

set -e

: "${UPLOAD_SERVER:?Error: UPLOAD_SERVER environment variable is not set}"
SERVER="$UPLOAD_SERVER"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <key> [custom-filename]" >&2
  exit 1
fi

KEY="$1"
CUSTOM_NAME="$2"

if [ -z "$UPLOAD_API_KEY" ]; then
  echo "Error: UPLOAD_API_KEY environment variable is not set" >&2
  exit 1
fi

# Download with headers, save to temp file
TMPFILE=$(mktemp /tmp/dlcf-XXXXXX)
HEADERS=$(mktemp /tmp/dlcf-headers-XXXXXX)

HTTP_CODE=$(curl -s -D "$HEADERS" -o "$TMPFILE" -w "%{http_code}" \
  -H "Authorization: Bearer $UPLOAD_API_KEY" \
  "$SERVER/download/$KEY")

if [ "$HTTP_CODE" != "200" ]; then
  rm -f "$TMPFILE" "$HEADERS"
  # Print the error message from response body
  ERROR_MSG=$(cat "$TMPFILE" 2>/dev/null | grep -o '"error":"[^"]*"' | cut -d'"' -f4 || echo "HTTP $HTTP_CODE")
  echo "Download failed: $ERROR_MSG" >&2
  exit 1
fi

if [ -n "$CUSTOM_NAME" ]; then
  mv "$TMPFILE" "$CUSTOM_NAME"
  echo "Saved as: $CUSTOM_NAME"
else
  # Extract original filename from Content-Disposition header
  ORIG_NAME=$(grep -i 'content-disposition:' "$HEADERS" | sed 's/.*filename="\([^"]*\)".*/\1/')
  if [ -n "$ORIG_NAME" ]; then
    mv "$TMPFILE" "$ORIG_NAME"
    echo "Saved as: $ORIG_NAME"
  else
    # Fallback: use key as filename
    mv "$TMPFILE" "$KEY"
    echo "Saved as: $KEY"
  fi
fi

rm -f "$HEADERS"