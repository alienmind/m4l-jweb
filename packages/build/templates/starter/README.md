# {{name}}

A Max for Live device, scaffolded with `m4l-jweb init`. See the
[M4L-JWEB docs](https://github.com/alienmind/m4l-jweb) for the architecture
this repo builds on.

```bash
pnpm install
pnpm dev              # browser dev with the Max bridge simulated
pnpm build            # emits dist/{{name}}/<device>.amxd + release zip
pnpm test             # ES5 gate + protocol lint
pnpm install:device    # copy the built device into Ableton's User Library
```

You edit two places:

- `src/app/` - the web app (UI, optional worker, `protocol.ts`).
- `patcher/devices.mjs` - the device manifest (name, type, chains, parameters).

Everything else (`@m4l-jweb/wrapper`, `@m4l-jweb/build`) is packaged
infrastructure you should rarely need to touch.
