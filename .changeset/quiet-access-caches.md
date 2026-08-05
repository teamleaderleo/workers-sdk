---
"@cloudflare/workers-auth": patch
---

Avoid reusing prior Cloudflare Access service-token headers after environment credentials change, and retry Access detection after transient probe failures.
