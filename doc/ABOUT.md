---
title: "M4L Jweb"
---

# M4L Jweb

**Build Ableton Live devices like a web developer.**

[Source Code](https://github.com/alienmind/m4l-jweb)

![screenshot](/m4l-jweb/screenshot-midi-audio-chain.png)

M4L-JWEB lets you author Ableton Live Max for Live devices (`.amxd`) in an ordinary TypeScript repo, with the tools any developer already expects: a package manager, a typechecker, unit tests, CI. The device UI is a React app, and it can be run, simulated and tested **outside Ableton and outside Max** - against a mocked Live, in a browser.

The glue that a device needs is provided rather than rewritten each time: the message bridge between the browser and Max, the `[js]` script that talks to Live's object model, the generated patcher, and the binary `.amxd` writer. So `pnpm build` produces installable devices on a machine that has never had Max on it, which means CI can ship them.

### Features

- Write Max for Live devices as React applications.
- Build and run simulated environments entirely in the browser.
- Full TypeScript support.
- Fully unit-testable and CI/CD ready.
