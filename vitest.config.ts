import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
	resolve: {
		alias: [{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }],
	},
	test: {
		include: ["tests/**/*.test.{ts,mjs}", "packages/*/tests/**/*.test.{ts,mjs}", "src/**/*.test.{ts,tsx}"],
		environment: "node",
	},
});
