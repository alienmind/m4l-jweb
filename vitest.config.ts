import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
	resolve: {
		alias: [{ find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) }],
	},
	// The app and the packages are compiled with tsconfig's "jsx": "react-jsx" - the
	// AUTOMATIC runtime, where a component file imports no React at all. vitest's own
	// esbuild pass defaults to the classic runtime, so a test that renders any component
	// dies on "React is not defined" inside a file that is perfectly correct. Match the
	// app.
	esbuild: { jsx: "automatic" },
	test: {
		include: ["tests/**/*.test.{ts,mjs}", "packages/*/tests/**/*.test.{ts,mjs}", "src/**/*.test.{ts,tsx}"],
		environment: "node",
	},
});
