#!/usr/bin/env node
// A fake workerd that exits immediately without writing any control messages.
// Used to test that Miniflare detects early workerd exits instead of hanging.

import { arrayBuffer } from "stream/consumers";

// Consume stdin (config passed via stdin) to avoid EPIPE
await arrayBuffer(process.stdin);

// Write an error to stderr to simulate a startup failure. Wait for the write to
// flush so signal-based exits preserve the same startup diagnostic fixture.
await new Promise((resolve) =>
	process.stderr.write("error: bind(::1, 0): Address not available\n", resolve)
);

const signal = process.env.MINIFLARE_TEST_WORKERD_SIGNAL;
if (signal) {
	process.kill(process.pid, signal);
} else {
	// Exit with non-zero code without writing any listen events to FD3
	process.exit(1);
}
