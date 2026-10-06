#!/usr/bin/env node
// Standalone Agent Relay headless service executable wrapper.
// This script runs the bundled service entrypoint.
// It relies on the Node runtime installed on the target machine,
// or the bundled binary distribution created by service:binary.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Load the bundled service directly when available
const bundlePath = process.env.RELAY_SERVICE_BUNDLE || require.resolve("../../../dist/service/service.bundle.cjs");

try {
  await import(bundlePath);
} catch (error) {
  console.error("Failed to start Agent Relay service:", error instanceof Error ? error.message : String(error));
  process.exit(1);
}
