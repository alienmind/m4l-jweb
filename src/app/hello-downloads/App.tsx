import { useState } from "react";
import { fetchToFile } from "@m4l-jweb/bridge";
import { useDevice } from "../shared/device";
import { Frame } from "../shared/Frame";

export default function HelloDownloads() {
  const device = useDevice();
  const [status, setStatus] = useState("Idle");

  async function testDownload() {
    const destPath = "~/Desktop/test_download.json";
    const url = "https://jsonplaceholder.typicode.com/todos/1";
    
    setStatus("Downloading...");
    try {
      const { bytes } = await fetchToFile(url, destPath, (downloaded, total) => {
         setStatus(`Progress: ${downloaded} / ${total}`);
      });
      setStatus(`Success! Wrote ${bytes} bytes to Desktop.`);
    } catch (err: any) {
      setStatus(`Download failed: ${err.message}`);
    }
  }

  return (
    <Frame title="HELLO DOWNLOADS" device={device}>
       <dt>Action</dt>
       <dd>
         <button onClick={testDownload}>Download JSON to Desktop</button>
       </dd>
       <dt>Status</dt>
       <dd>{status}</dd>
    </Frame>
  );
}
