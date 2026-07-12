/**
 * dev.mjs - run ONE device's UI in a browser, with the mocked-Live harness.
 *
 *   node scripts/dev.mjs hello-audio      (or: pnpm dev:hello-audio)
 *
 * Sets DEVICE for vite.config.ts, which points the `@device` alias at
 * src/app/<device>/. Node rather than an inline env var in the npm script because
 * `DEVICE=x vite` is not portable to Windows shells, and cross-env is a
 * dependency this does not need.
 */
import { createServer } from "vite";
import { devices, resolveDevice } from "./devices.mjs";

const name = resolveDevice(process.argv[2]);
process.env.DEVICE = name;

const server = await createServer({ server: { host: "127.0.0.1", port: 5175 } });
await server.listen();

console.log(`\n  device: ${name}   (others: ${devices.map((d) => d.name).filter((n) => n !== name).join(", ") || "none"})`);
server.printUrls();
