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
  # Read error message from response body before cleanup
  ERROR_MSG=$(grep -o '"error":"[^"]*"' "$TMPFILE" 2>/dev/null | cut -d'"' -f4 || echo "Unknown error")
  rm -f "$TMPFILE" "$HEADERS"

  # Map HTTP status code to a human-readable message
  case "$HTTP_CODE" in
    400) DESC="Bad request（请求格式错误）" ;;
    401) DESC="Unauthorized - check UPLOAD_API_KEY（认证失败，检查 API Key）" ;;
    404) DESC="File not found or already expired（文件未找到或已过期）" ;;
    413) DESC="File too large（文件过大）" ;;
    429) DESC="Download limit reached（下载次数已达上限）" ;;
    500) DESC="Server error（服务器错误）" ;;
    *)   DESC="Unexpected error（未知错误）" ;;
  esac

  echo "Download failed ($HTTP_CODE): $DESC — $ERROR_MSG" >&2
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