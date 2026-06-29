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

RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/upcf-response-$$.json \
  -X POST "$SERVER/upload" \
  -H "Authorization: Bearer $UPLOAD_API_KEY" \
  -F "file=@$FILE")
HTTP_CODE="${RESPONSE: -3}"
BODY=$(cat /tmp/upcf-response-$$.json 2>/dev/null)
rm -f /tmp/upcf-response-$$.json

# Extract the key from JSON response using grep/cut (no jq dependency)
KEY=$(echo "$BODY" | grep -o '"key":"[^"]*"' | cut -d'"' -f4)

if [ -z "$KEY" ]; then
  ERROR_MSG=$(echo "$BODY" | grep -o '"error":"[^"]*"' | cut -d'"' -f4 || echo "Unknown error")
  case "$HTTP_CODE" in
    400) DESC="Bad request（请求格式错误）" ;;
    401) DESC="Unauthorized - check UPLOAD_API_KEY（认证失败，检查 API Key）" ;;
    413) DESC="File too large（文件过大）" ;;
    429) DESC="Upload limit reached（上传次数已达上限）" ;;
    500) DESC="Server error（服务器错误）" ;;
    *)   DESC="Unexpected error（未知错误）" ;;
  esac
  echo "Upload failed ($HTTP_CODE): $DESC — $ERROR_MSG" >&2
  exit 1
fi

echo "$KEY"