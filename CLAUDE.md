# CLAUDE.md - guardrails for agents working in this repo

This repo builds Ableton Live `.amxd` devices from TypeScript, with no Max
editor in the loop. Read `README.md`, then `doc/ARCHITECTURE.md`, which explains
how the layers fit together. This file is the short list of things that will
silently break if you get them wrong.

## Where to make changes

This is a pnpm workspace: a device repo at the root, and the reusable
infrastructure carved into `packages/`.

- **`src/app/<device>/`** - ONE FOLDER PER DEVICE (`App.tsx`, `protocol.ts`,
  `surface.ts`). Most work belongs here. Each device builds into its own `.amxd`
  with its own UI bundle, so do not reintroduce a shared `App.tsx` that branches
  on `mode` - a device ships what it is, not what its siblings are.
  **`surface.ts` is the device's Live parameters** - the build imports it and
  generates the `live.*` objects and their wiring from it. It is the only place
  they are declared.
- **`src/app/shared/`** - what every device has: `useDevice()` (mode, build,
  tempo, transport, the `ui_ready` handshake), the `Frame` chrome, the worker.
- **`patcher/devices.mjs`** - the device manifest (name, type, chains). Adding a
  device here means adding `src/app/<name>/` too; a test enforces it. Parameters
  are NOT here - they are in that device's `surface.ts`.
- **`wrapper/device.ts`** - optional. Extra `[js]` message handlers for this
  device, concatenated after the packaged wrapper sources.
- **`packages/*`** - `@m4l-jweb/bridge` (the browser bridge), `@m4l-jweb/surface`
  (`defineSurface` + the dev harness), `@m4l-jweb/wrapper` (the `[js]` sources),
  `@m4l-jweb/build` (the CLI, `.amxd` writer and chain vocabulary). This is
  library code shared by every device. Change it deliberately, not incidentally,
  and never to work around something that belongs in `src/app/`.
- **`packages/build/templates/starter/`** - the `m4l-jweb init` scaffold. Most of
  it is this repo's own infrastructure, copied verbatim: `scripts/`,
  `vite.config.ts`, the tsconfigs, `src/main.tsx`, `src/index.css`,
  `src/app/shared/`. `tests/starter.test.mjs` compares those byte-for-byte, so if
  you change one at the root, **copy it into the template** - that is the intended
  fix when the test fails, not an edit to the assertion. Keep device names out of
  those shared files; the template inherits them.

## Hard rules

1. **The wrapper must compile to ES5.** Max's `[js]` is an ES5-era
   interpreter. No `let`/`const`, no arrow functions, no template literals, no
   promises, no modules, in the EMITTED output. The build parses it with acorn at
   `ecmaVersion: 5` and refuses to package on failure, so you cannot ship this
   bug - but you can waste time on it. Use `var` and `function`.
2. **No `console`, no `setTimeout` in the wrapper.** Use `post()` and Max's
   `Task`.
3. **No `[node.script]`.** Its failure modes in Live range from silently ignoring
   `script start` to crashing the host. Pure computation goes in a Web Worker
   inside jweb. A test enforces this.
4. **LiveAPI objects created during `loadbang` are DEAD.** They construct without
   error and observe nothing, forever. Create every observer from
   `live.thisdevice`'s `bang()`. Recreate them unconditionally - a guard like
   `if (obs) return` makes the bug permanent. `loadbang()` does file work only.
5. **Never hand-edit `dist/`.** It is generated.

## Facts that look like bugs

The terse rules are here; the spike that PROVED each - the numbers, what was written
and what happened - is the evidence log in [doc/MAX-FACTS.md](doc/MAX-FACTS.md). When
one of these bites, read the fact behind it there.

- **NEVER INVENT A NAME MAX WILL LOOK UP** - not a `maxclass`, not a dictionary
  key, not an attribute. Max does not validate them, it IGNORES what it does not
  recognise, so a wrong name is not an error: it is a feature that silently does
  nothing, in a patcher that loads and keeps every cord. This cost two features
  weeks each ([doc/MAX-FACTS.md](doc/MAX-FACTS.md), "Never invent a name Max is going
  to look up"):
  - `maxclass: "pcontrol"` is not a box class. `pcontrol` is an OBJECT:
    `maxclass: "newobj"`, `text: "pcontrol"`. Same for `dict`. A box with an
    unknown maxclass, or an object box whose text names no object (`[open]`), does
    not instantiate - and nothing reports it. A message box is
    `maxclass: "message"` with the message in `text`.
  - `[pcontrol]`'s messages are `open` and `close`. `wclose` is `[thispatcher]`'s.
  - `[maxurl]`'s output-file key is **`filename_out`**, not `downloadfilename`, and
    **`overwrite_output_file` defaults to 0** so it will not overwrite an existing
    file. With the wrong key, every request returned HTTP 200 and wrote nothing.
  - A `[pattr]` in a device saves into the Live set only with
    **`parameter_enable`** (type 3 = blob, `parameter_invisible 1`). `@save` is not
    a pattr attribute; `@autorestore` restores from the patcher, which is not where
    a device's state lives.
  - The names are ON DISK, inside Live. Read the refpage, and grep the factory
    patchers for a key before you use it:
    `C:\ProgramData\Ableton\Resources\Max\resources\docs\refpages\` and `...\help\`.
- **Max dispatches a message on its FIRST WORD.** So an id belongs in the
  ARGUMENTS, not baked into the selector: `sync_state <id> <json>`, never
  `sync_state_<id>` - which looks up a handler no device has, lands in the
  wrapper's `anything()` (whose whole job is to swallow other people's messages)
  and is gone without a word. The BRIDGE dispatches on the selector too, which is
  why the reply is `state_<id>`: the id sits on whichever side is doing the
  looking-up. `[route]`'s per-id selectors (`set_<id>`, `window_<id>_open`) are
  fine - a route matches the whole word.
- **`jsarguments[0]` is the script name**, not the first argument. The device
  mode is at index 1.
- **NEVER call a Max host function (`outlet`, `messnamed`) via `.apply`.** It does
  not just fail - it CRASHES LIVE. Spreading a variadic message with
  `(outlet as Function).apply(this, args)` corrupts the `[js]` engine: Live logs
  `jsliveapi: bad outlet index 0` and then dies with an access violation
  (`0xc0000005`) inside `js.mxe64` - confirmed from the crash minidump's faulting
  module, and it reproduced on every load. Send fixed-arity
  (`outlet(0, selector, value)`), or, for a genuinely variadic list, pass the whole
  message as ONE array (`outlet(0, ["notes", ...])`) - Max outputs an array argument
  as a list, first atom the selector. `.apply` on your OWN functions is fine; the
  hazard is the host functions alone. (The reply() note in `core.ts` had warned this
  fails *silently*; it is worse than that.)
- **`route` strips the selector.** A bare selector arrives as a `bang`. If the
  consumer needs the word, re-materialize it with a message box.
- **`File.writebytes` truncates silently** around 16 KB. Write in 4 KB slices and
  verify the byte count.
- **The device view is a fixed ~169 px tall.** Overgrown UI clips silently; it
  does not scroll.
- **Live embeds a copy of the device in the set.** Reinstalling does not update
  instances already on tracks. If behavior does not match the code, check the
  build stamp in the UI header (top right, from `Frame`) and the Max console,
  then delete and re-drag the device. Keep the stamps in the header, not a
  footer: the view clips at the bottom, so a footer stamp disappears exactly when
  the UI has grown enough for staleness to be worth checking.
- **Use LiveAPI, not MSP, for transport.** A `plugsync~` -> `snapshot~` chain
  reads zero in a MIDI-effect device: those devices do not reliably run a DSP
  graph. Poll `live_set is_playing` + `current_song_time` instead. It works in
  every device type. Likewise, tempo comes from a LiveAPI observer - the
  signal-domain alternative reports samples-per-beat, not BPM.
- **Never trust an object's outlet order from memory.** Check the reference page
  and log the raw values before you wire anything to them.
- **`unpack` fires right-to-left.** That is why the MIDI chain unpacks
  explicitly: the delay must reach `pipe`'s cold inlet before the pitch hits the
  hot one.
- **`set` on a `live.*` object silences it for EVERYONE.** `set <value>` updates
  the parameter without producing outlet output - which is what stops an app
  writing a parameter from feeding itself back. But it also cuts every cord that
  object drives *inside the patcher*. Never chain a parameter's consumers behind
  the parameter object: fan the value out (to the object AND to what it controls)
  or the app's writes reach the dial and nothing else. A chain does this with
  `fanParamInto()`, which wires both sources or neither; the compiler is
  `packages/build/src/surface.mjs`, and `tests/surface-codegen.test.mjs` pins
  both halves.
- **A parameter's range is `parameter_mmin`/`parameter_mmax`, not
  `parameter_range`.** `parameter_range` is not a key Max writes - it appears in
  zero of the patchers Ableton ships - so a range set there is silently ignored
  and the object keeps its default. An enum's options are `parameter_enum`, with
  the highest index in `parameter_mmax`.
- **No `parameter_unitstyle` means Live prints a float as an INTEGER.** The value
  is fine, the readout is not: a 0-1 cutoff sweeps smoothly and reads "0" or "1"
  on Push. Declare the parameter's `unit` (`Hz` = unit style 3, confirmed against
  Live's factory devices). Ranges belong in REAL units - `[40, 18000]` with an
  `exponent`, not `[0, 1]` with the curve hidden in a chain, which lies to the
  automation lane, to Push and to the app at once.
- **The attribute names are on disk, so never guess them.** Max's own reference
  ships inside Live:
  `C:\ProgramData\Ableton\Resources\Max\resources\docs\refpages\m4l-ref\` -
  `parameters.maxref.xml` is every parameter attribute, and the factory `.maxpat`
  files under that tree are worked examples to grep.
- **A `live.*` object with no `default` loads at the BOTTOM of its range**, and
  for many parameters that is a broken device (a cutoff of 0 eats the signal).
  Every parameter declares `default` in `surface.ts`. Note `parameter_initial` is
  inert without `parameter_initial_enable`.
- **An audio chain claims a STAGE; it must not create `plugin~`/`plugout~`.** The
  build creates the endpoints once, for any `audio` or `instrument` device. A chain
  takes what the previous stage left (`ctx.audioIn(ch)`) and says what it leaves
  (`ctx.setAudioOut(ch, id, outlet)`), so `chains: ["lowpass", "gain"]` is a series.
  Chains that each conjured their own endpoints produced duplicate box ids and
  *summed* their outputs in parallel - the dry signal mixed back over the filtered
  one, silently. `assertUniqueBoxIds()` now fails the build on a duplicate id.
  A chain also takes a parameter in REAL units and does no arithmetic on it: the
  range, the unit and the curve live on the parameter, not in an `[expr]`.
- **Only one thing may route `[jweb]`'s output.** Routes are chained in SERIES,
  each passing its unmatched outlet to the next (`claimAppMessages()`); two in
  parallel means the wrapper sees every unrouted message twice. And do not find
  the cord to cut by searching for what feeds `[js]`: `live.thisdevice` feeds it
  too, and cutting *that* kills every LiveAPI observer (hard rule 4) in a way
  nothing reports.

## Closing a TODO item

**A finished item does not just get deleted, and it never stays on the list as "done".**
An item leaves `doc/TODO.md` exactly one of two ways:

1. **It is parked.** It goes to the `# Parked` section at the END of `doc/TODO.md`, with
   one paragraph saying what it was and why it is not work any more. Park anything that
   was dropped, answered in the negative, or turned out never to have had a consumer -
   the point is that nobody rediscovers it and starts over.
2. **It is consolidated.** What was learned goes to `doc/MAX-FACTS.md` if it is a
   MEASUREMENT (what the hardware, Max or Live actually does), and to
   `doc/ARCHITECTURE.md` if it is a MECHANISM (how the layers fit, what a device
   declares, which seam owns what). Both, if it is both.

`doc/TODO.md` holds open work only. If an item is finished and nothing was learned worth
writing down, park it in one line rather than leaving it there marked done.

When you consolidate, go back and fix what the new fact contradicts. A file that states a
conclusion and then re-argues the claim it overturned is worse than one that never
recorded either, and this repo has produced exactly that.

## The contract between the two sides

`src/app/<device>/protocol.ts` is the single source of truth for every selector
crossing that device's bridge. If you add a message:

1. Add the selector to `IN` or `OUT` in that device's `protocol.ts`. If the name
   belongs to the library (the wrapper, or a chain), spread it in from
   `@m4l-jweb/bridge` (`DEVICE_IN`, `CHAIN_IN`, `CHAIN_OUT`) rather than retyping
   it.
2. Bind or emit it in the app, via `@m4l-jweb/bridge`.
3. Handle it on the Max side: a `function <selector>()` in the wrapper
   (`packages/wrapper/src/`, or this device's `wrapper/device.ts`), or a `route`
   in a chain (`packages/build/src/chains.mjs`, or `patcher/chains.mjs`).

`tests/protocol.test.mjs` fails if you skip step 3, and it lints each device
against its own Max side. That is deliberate: an unrouted selector is a message
falling on the floor, and it produces no error at runtime.

## Writing

One section, and it is the same in `m4l-jweb` and `m4l-gugelhupf`. If you change it in
one, copy it to the other.

**The goal is text that reads as though a person wrote it after doing the work.** Not
text that reads as though it was generated from a diff. The rules below are what that
difference turned out to be, each one learned by having the alternative rewritten by
hand.

### Punctuation

Plain ASCII in documentation, commit messages and code comments. No em dashes, en
dashes, middle dots or typographic ellipses - use `-`, `...`, `,`. Signal-flow arrows
(`->`) and glyphs standing for real UI buttons are fine.

### Plain language

Every `.md` file here - `README.md`, everything in `doc/`, `CHANGELOG.md`, a README
beside an asset folder - is written in **plain language**. This is the rule, and it
applies to new files and to edits of old ones:

> You rewrite Markdown prose into much simpler, plain language. Write the rewrite in the
> same language as the file you are rewriting. Keep every fact, name, number, link, and
> file path. Keep all Markdown structure - headings, lists, tables, and links. Do NOT
> change fenced code blocks or any YAML frontmatter; reproduce them exactly. Use short
> sentences and everyday words. Output ONLY the rewritten Markdown, with no preamble,
> labels, or commentary.

What that rules out, since this repo has produced all of it: long sentences held
together by dashes, a clause of drama after every fact, and the same point made twice in
different words. Say the thing once, in the shortest words that are still exact.

**A heading says what the section is about. Nothing else.** This repo grew a habit of
headings that are a mood instead of a subject, and you cannot scan a document written
that way - you have to read each section to find out what is in it. All of these were
real, and all of them are wrong:

| Was | Should be |
|---|---|
| "The one constraint every use case here is shaped by" | "Claiming the matrix stops the pads playing notes" |
| "The API these are written against" | "The API" |
| "The things that will bite" | "Common mistakes" |
| "The verdict, up front" | "Verdict" |
| "The overlap, stated without flinching" | "What overlaps" |
| "What ports, and why it is more than it looks" | "What ports" |

Rules of thumb: no "the one thing that", no "stated without", no "and why", no
"up front", no "honestly", no promise about how the section will make the reader feel. If
a heading needs a comma to hold two ideas, it is two sections or one shorter heading.

The same goes for sentences. Prefer "Claiming the matrix takes the pads off the note
path" over "The one constraint every use case here is shaped by is that claiming the
matrix takes the pads off the note path." Start with the subject.

### No riddles

**A title is not a puzzle to be solved by reading the section.** This repo wrote a whole
CHANGELOG that way, and a reader could not tell from any release name what was in it:

| Was | Means | Should have said |
|---|---|---|
| "a release can carry docs" | a maintenance release | "maintenance" |
| "a rendered file goes straight into a Live clip" | you can now bounce audio into a clip slot | "put a rendered file straight into a Live clip" |
| "two dials that were not what they seemed" | two bug fixes about parameter ranges | "where files went, and two dials that were not what they seemed" |
| "declarations that persist" | windows and saved state | "declarations that persist, and samples" |

Rules:

- **Say what the thing IS before you say anything clever about it.** A release note opens
  with what the release is FOR, in one line, in the words a user would use. "Two features
  and one example" beats any metaphor.
- **A maintenance release says "maintenance".** Do not dress up a version bump.
- **Name the feature, not the insight behind it.** The reader wants "you can now program
  the Push's 64 pads", not "the pads as a surface you program".
- **No teasing.** Nothing that only makes sense after the reader has read the thing it is
  labelling.

This applies to release names, headings, the first sentence of a section, and PR titles.

**Keep every technical word that is a name.** `parameter_enable`, `[live.observer]`,
`decodeAudioData`, `canonical_parent` and `ctx.appIn` are not jargon to be simplified -
they are what the thing is called, and a reader who cannot search for them cannot use
the document. Simplify the sentence around them.

**Facts and numbers do not get softened.** "2.6 ms per full frame", "176 control names",
"y counts from the TOP" - the whole value of `doc/MAX-FACTS.md` is that it is exact.
Plain language means saying it in fewer, simpler words, not saying less.

Code comments follow the same spirit but are not covered by this rule: they explain
mechanism to somebody reading the code, and they may be as long as the mechanism needs.


### Say why, not only what

**Every entry says what it is FOR.** What changed is in the diff. Why it was worth doing
is not, and that is the half a reader cannot reconstruct. This applies to PR summaries,
to every `.md` in the repo, and to code comments.

A heading names the payoff, not the plumbing. These were all real, and all rewritten by
hand afterwards because the first version said what moved rather than what it bought:

| Was | Should be |
|---|---|
| "the library comes from npm, not from a path on one machine" | "built from latest m4l-jweb v1.6.1 so we have options to map Strudel sliders and actions to the Push control surface" |
| "`open_url` was defined twice, and the build stopped" | "`open_url` moved upstream so we drop it" |
| "the installer in the ZIP said 'No .amxd found' on a good download" | "fixed the installer included in the ZIP - 'No .amxd found'" |
| "1.4.0, and the release zip is named after its version" | "release zips are now named after their version" |

The rules behind those:

- **Lead with the reason where the reason is the point.** "This was needed during
  investigation on macOS where the device view was not fitting, so each device now posts a
  diagnostics block" beats the same sentence with the reason moved to the end or dropped.
- **Write as the team. "We" is correct**, not a lapse: "so we drop it", "so we can try to
  explain the layout issues". The impersonal voice reads like a changelog generator.
- **Ordinary verbs are fine.** "Fixed the installer" needs no improving. Reaching for a
  crafted phrase is how a summary starts sounding written rather than reported.
- **A purpose clause beats a second sentence of mechanism.** "to easily identify what's
  what" earns its words; a paragraph on how the zip is named does not.
- **Say it as honestly as you know it.** If a change is an investigation aid and not a
  fix, say so - "so we can try to explain the layout issues", not "which makes the layout
  question answerable". Do not promote a lead into a conclusion.
- **One dense paragraph beats two tidy ones.** Two paragraphs on the same subject are one
  paragraph and a paragraph break.

Also cut, beyond the list above: **error codes and internal proof.** `TS2393`, which
packages the lockfile resolved and at what version, "CI proves it from a clean checkout".
The reviewer has the diff and the checks. Naming an error code is only useful when the
reader would search for it.


### Comments

Comments say what the code cannot: the constraint, the trap, the thing that was measured
in Live and cost a day. Not what the next line does. They may be as long as the mechanism
needs.

Never use a cliche formula like "this is the trap that cost us a day". State the point and
stop.

### Commit messages

**Commit messages are not for literature. For that we have the markdown.**

ONE LINE. `type: what changed`, stated plainly. No body.

    feat: open external links in default browser
    fix: release a dial when its slider is deleted
    docs: clarify launchbrowser URL behavior
    chore: remove orphaned Studio windows and update TODO

No scope suffix by default (`feat:`, not `feat(strudel):`). The subject STATES, it does
not argue: "remove orphaned Studio windows", not "drop the orphaned Studio windows,
because nothing could open them any more".

Everything you were about to put in the body already has a home: the constraint goes in a
comment at that line, the measurement in `doc/MAX-FACTS.md` or `doc/ARCHITECTURE.md`, the
dead end in the drawer of failed ideas, the remaining work in `doc/TODO.md`, and the case
for the change in the PR summary. A commit says what changed; the repo says why.

## Pull request summaries

Title: `<version> - <the areas that changed>`, plainly. "1.1.0 - better external windows
and declarative controls", not a metaphor and not personification.

CLASSIFY EVERY ENTRY, and lead with the fixes. Three headings, numbered within each
kind, in this order:

    ## Fix 1 - <the symptom, in the reviewer's terms>
    ## Enhancement 1 - <what it now does>
    ## Cleanup

A reviewer's first question is what was broken, so a release that repairs something
opens on that, not on its nicest new API. `## Fix` for something that was wrong,
`## Enhancement` for something that was merely absent, `## Cleanup` once at the end for
deletions - no number, they do not need ranking.

The heading names the EFFECT, not the symbol: "the device page's `[jweb~]` can carry a
`latency` - no more hiccups in the mini window playing a tune", not "add latency to
obj-jweb". A reviewer who has never opened the file should recognise the problem from
the heading alone.

ONE TO THREE SENTENCES under each. State what it now does; add the mechanism only where
it is what makes the change make sense. Then stop - the diff is attached, and anything
further is being read instead of the code.

LEAVE OUT:

- The opening paragraph saying what the release is for. The headings already say it.
- Proof of work. No "measured in Live", no "verified", no "confirmed in both
  directions", no "byte for byte", no test counts, no Review notes section. The diff and
  the CI say that.
- The evidence that isolated a cause. Which dial was dead while its sibling worked, what
  the before/after was - that is what makes the finding TRUE, and it belongs in the
  evidence log (`doc/MAX-FACTS.md`, `../m4l-gugelhupf/doc/DRAWER_OF_FAILED_IDEAS.md`), not in a review
  request.
- The story of getting there. What an earlier attempt got wrong, what was believed for
  months, which spike was decisive.
- A "limits that survive" section. A limit goes in the entry it belongs to, in a clause,
  or it goes in the docs.
- Emphasis for its own sake. No bold shouting, no "the non-obvious part is", no framing a
  change as a discovery.

Keep concrete numbers when they carry the argument (17 MB will not fit in a payload),
and drop them when they are just credentials.

**And the whole of "Say why, not only what" in Writing above applies here first.** A PR
summary is where the reason for a change is most likely to be the only place it is ever
written down.

## Verifying your work

```bash
pnpm build             # must emit every .amxd with no Max installed
pnpm test              # container round-trip, ES5 gate, protocol lint, bundle separation
pnpm dev:hello-midi    # one device in a browser, with a mocked Live beside it
```

`pnpm dev:<device>` gives you a mock transport and a log of every message
crossing the bridge, so a sequencer is debuggable without Live.
`window.maxSimulate(sel, ...args)` still fakes an inbound message from the
console.

You can verify almost everything without Live: the build proves the container is
well-formed, the tests prove the bytes round-trip, and the harness drives the UI
through its real message handlers. Reserve "load it in Live" for what genuinely
needs Live: timing, audio, and LiveAPI behavior.

Do not claim a device works in Live unless you have actually seen it there. Say
what you verified and how.
