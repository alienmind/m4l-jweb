/**
 * shared/Frame.tsx - the chrome every device wears: a title, a where-am-I badge,
 * and the two build stamps.
 *
 * The stamps are not decoration. Live embeds a COPY of a device into the set, so
 * reinstalling does not update instances already on tracks - and a stale device
 * behaves like a bug in code you have already fixed. The stamps make that
 * visible instead of mysterious.
 *
 * They live in the HEADER, top right, and that placement is load-bearing: the
 * device view is a fixed ~169 px and overgrown UI clips silently at the BOTTOM.
 * A stamp in a footer is a staleness check that disappears exactly when the
 * device has grown enough to be worth checking. Anchored to the header, it
 * survives whatever the device does below it.
 */
import type { ReactNode } from "react";
import { inJweb } from "@m4l-jweb/bridge";
import type { DeviceState } from "./device";

declare const __APP_VERSION__: string;

export function Frame({ title, device, children }: { title: string; device: DeviceState; children: ReactNode }) {
  return (
    <main className="device">
      <header>
        <h1>{title}</h1>
        <span className={`badge ${inJweb ? "live" : "dev"}`}>{inJweb ? "in Max" : "browser dev"}</span>
        <span className="stamp" title={`ui ${__APP_VERSION__} / wrapper ${device.build ?? "-"}`}>
          {device.stale ? (
            <span className="warn">stale - delete and re-drag the device</span>
          ) : (
            <>
              <span>ui {__APP_VERSION__}</span>
              <span>wrapper {device.build ?? "-"}</span>
            </>
          )}
        </span>
      </header>

      <dl>{children}</dl>
    </main>
  );
}

/** The transport line. Shared because every device wants it and it has a trap in it. */
export function Transport({ device }: { device: DeviceState }) {
  return (
    <>
      <dt>transport</dt>
      <dd className="row">
        <span>
          <span className={device.playing ? "dot on" : "dot"} /> {device.playing ? "playing" : "stopped"} @ {device.beats.toFixed(2)} beats
          {device.tempo !== null && `, ${device.tempo.toFixed(1)} BPM`}
        </span>
        {/* The transport is LIVE's, and nothing inside the device starts it. Not
            obvious from in here, and it looks like the device is broken. */}
        {!device.playing && <em className="hint">press play in Live to start the transport</em>}
      </dd>
    </>
  );
}
