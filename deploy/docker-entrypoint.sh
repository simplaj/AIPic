#!/bin/sh
set -eu

# Preserve legacy API_URL overrides while using AIPic's default service.
if [ "${DEFAULT_API_URL+x}" != x ]; then
    DEFAULT_API_URL=${API_URL:-https://2api.dev/v1}
fi
API_PROXY_URL=${API_PROXY_URL:-${API_URL:-https://2api.dev/v1}}
export DEFAULT_API_URL API_PROXY_URL

node /app/deploy/inject-runtime-config.mjs
exec "$@"
