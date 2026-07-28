import { useEffect, useState } from "react";
import { copyMessage, copyPath, fetchToFile, onDeviceFolder, outlet } from "@m4l-jweb/bridge";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";
import { OUT } from "./protocol";

/**
 * Fetch a URL straight to DISK, via [maxurl] in the `download` chain.
 *
 * The bytes never cross the bridge: [js] hands maxurl a request dict naming the
 * output file, and libcurl writes it. What comes back is progress and a byte
 * count. That is the rule the architecture rests on - [js] is a control plane, not
 * a data plane - and it is what makes fetching a 40 MB sample pack sane.
 *
 * A relative path lands next to the .amxd, in the device's own folder, which is
 * the one place a device can always write on both platforms. WHERE that is comes
 * from the wrapper (`onDeviceFolder`), because this device declares `files.ts` -
 * a page cannot work it out, and a file the user cannot find was not written.
 */
export default function HelloDownloads() {
  const device = useDevice();
  const [status, setStatus] = useState("Idle");
  const [folder, setFolder] = useState<string | null>(null);

  useEffect(() => onDeviceFolder(setFolder), []);

  async function testDownload() {
    setStatus("Downloading...");
    try {
      const { bytes } = await fetchToFile("https://jsonplaceholder.typicode.com/todos/1", "test_download.json", (downloaded, total) =>
        // Not every server sends a content length, so the total can legitimately
        // be 0. Never divide by it to make a percentage.
        setStatus(total > 0 ? `Downloading... ${downloaded} / ${total} bytes` : `Downloading... ${downloaded} bytes`),
      );
      setStatus(`Wrote ${bytes} bytes to test_download.json, next to the device.`);
    } catch (err) {
      setStatus(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <Frame title="HELLO DOWNLOADS" device={device}>
      <dt>Action</dt>
      <dd>
        <button onClick={testDownload} style={{ padding: "4px 8px" }}>
          Download JSON to device folder
        </button>
      </dd>
      <dt>Status</dt>
      <dd>{status}</dd>
      {/* Max cannot open a file manager, so the path itself is the deliverable: show
          it, and let the user paste it into Explorer or Finder. */}
      <dt>Folder</dt>
      <dd>
        {folder ? (
          <button onClick={async () => setStatus(copyMessage(await copyPath(folder), folder))} style={{ padding: "4px 8px" }}>
            Copy device folder path
          </button>
        ) : (
          "unknown - the patcher is not saved"
        )}
      </dd>
      {/* The conformance check (wrapper/device.ts). Its results go to the Max console,
          not here: it is asserting things about MAX, for whoever upgraded Live - it is
          not telling a user anything. Run it after a Live or Max update. */}
      <dt>Conformance</dt>
      <dd>
        <button
          onClick={() => {
            setStatus("Conformance check running - see the Max console (View -> Max Console).");
            outlet(OUT.max_conformance);
          }}
          style={{ padding: "4px 8px" }}
        >
          Check Max conformance
        </button>
      </dd>
    </Frame>
  );
}
