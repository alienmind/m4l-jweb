# FEAT-STRUDEL-003: Declarative Device Persistence

## What
A declarative API in `m4l-jweb` to define state that survives device reloads and travels with the Ableton Live set.

## Why
Currently, complex app state (like a custom drum map, or an FX chain's text expression) only lives in `localStorage` or memory. This means it survives a device reload locally but **does not travel with the Live set** or survive moving the project to another machine. Moreover, two instances of a device on two tracks share the same `localStorage`, leading to state bleeding across tracks. Per-device persistence requires the wrapper to own the state and store it inside the Live set file (`.als`).

## Suggested Design: `definePersistence` (or similar)

### 1. Declaration in `surface.ts`
Just as Live parameters are declared in `surface.ts`, persistent state chunks should be declared here so the build can generate the appropriate Max persistence objects (like `[dict]` or hidden `[pattr]` nodes) that Live knows to save with the project.

```typescript
// src/app/midi-drums/surface.ts
import { defineSurface, state } from "@m4l-jweb/surface";

export default defineSurface({
	params: {
		// normal automatable Live parameters
	},
	state: {
		drumMap: state({ default: {} }),
		expression: state({ default: "s(\"bd hh sd hh\")" })
	}
});
```

### 2. The Build Step (`@m4l-jweb/build`)
When `m4l-jweb patchers` runs, it reads `surface.state`. For each declared state key:
1. It creates an internal Max storage mechanism (like `[dict]` combined with `[pattr]` or `[dict.view]`) that Live natively persists when saving the set.
2. It wires communication channels between the `[jweb]` object and this internal storage.

### 3. The React API (`@m4l-jweb/surface/react`)
The developer gets a typed React hook to read/write this persistent state exactly like `useState` or `useParam`, but with the guarantee that the data is saved in the Live set.

```tsx
// src/app/midi-drums/App.tsx
import { useStateSync } from "@m4l-jweb/surface/react";
import surface from "./surface";

export default function App() {
	const [drumMap, setDrumMap] = useStateSync(surface, "drumMap");
	
	// Updating drumMap here will automatically sync the data back to Max, 
    // where it is saved in the Live set permanently.
}
```
