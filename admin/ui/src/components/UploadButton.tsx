import { useId, useRef, useState, type ChangeEvent } from "react";
import { ApiRequestError, type Api } from "../api";
import { prepareUpload, UnreadableImageError, type Prepared } from "../prepare-upload";
import type { PhotoOut } from "../types";
import { Problem, type ProblemInfo } from "./Problem";

type Props = {
  api: Api;
  categoryId: string;
  onUploaded: (photo: PhotoOut) => void;
  prepare?: (file: File) => Promise<Prepared>;
};

function failureText(name: string, error: unknown): string {
  if (error instanceof UnreadableImageError) return error.message;
  if (error instanceof ApiRequestError && error.code === "duplicate") {
    const title = typeof error.details.title === "string" ? error.details.title : "";
    return title ? `${name}: already in the library as “${title}”` : `${name}: already in the library`;
  }
  return `${name}: ${error instanceof Error ? error.message : "could not be added"}`;
}

export function UploadButton({ api, categoryId, onUploaded, prepare = prepareUpload }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const [signedOut, setSignedOut] = useState<ProblemInfo>(null);

  async function handle(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    if (files.length === 0) return;
    setWorking(true);
    setFailures([]);
    setSignedOut(null);
    const problems: string[] = [];
    let added = 0;

    for (const [index, file] of files.entries()) {
      try {
        setStatus(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
        const uploaded = await api.upload(categoryId, await prepare(file));
        added += 1;
        onUploaded(uploaded);
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === "signed_out") {
          // A signed-out failure means every remaining file would fail the
          // same way, so the batch stops here rather than attempting them.
          setSignedOut({ code: error.code, message: error.message });
          break;
        }
        problems.push(failureText(file.name, error));
      }
    }

    setStatus(problems.length === 0 ? `${added} added.` : `${added} added, ${problems.length} not added.`);
    setFailures(problems);
    setWorking(false);
    if (input.current) input.current.value = "";
  }

  return (
    <div className="upload">
      <label htmlFor={id} className="upload-label">
        Add photographs
      </label>
      <input
        ref={input}
        id={id}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/heic,image/heif"
        disabled={working}
        onChange={handle}
      />
      <p role="status">{status}</p>
      {failures.length > 0 && (
        <div role="alert" className="problem">
          <ul>
            {failures.map((failure, index) => (
              <li key={`${index}:${failure}`}>{failure}</li>
            ))}
          </ul>
        </div>
      )}
      <Problem error={signedOut} />
    </div>
  );
}
