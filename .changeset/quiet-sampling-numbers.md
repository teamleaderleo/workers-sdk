---
"@cloudflare/workers-utils": patch
---

Reject `NaN` observability sampling rates during Wrangler configuration validation instead of allowing them to serialize as `null` in upload metadata.
