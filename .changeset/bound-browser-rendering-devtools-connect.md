---
"miniflare": patch
---

Bound local Browser Rendering DevTools connection attempts during session acquisition

When Miniflare launches Chrome for a local Browser Rendering binding, the persistent DevTools health connection now has a per-attempt deadline instead of being able to wait indefinitely. Timed-out connection attempts retry within the existing retry policy, failed BrowserSession registration errors are surfaced to the acquisition caller, and Miniflare releases the launched browser session when registration fails.
