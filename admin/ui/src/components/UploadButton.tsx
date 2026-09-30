import { useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { ApiRequestError, type Api } from "../api";
import { prepareUpload, UnreadableImageError, type Prepared } from "../prepare-upload";
import type { PhotoOut } from "../types";
import { PlusIcon } from "./icons";
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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [status, setStatus] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const [signedOut, setSignedOut] = useState<ProblemInfo>(null);
  const [over, setOver] = useState(false);
  const refocus = useRef(false);

  // A file dropped anywhere but on the box would otherwise make the browser
  // open it in place of the admin, abandoning whatever was under way.
  useEffect(() => {
    const ignore = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", ignore);
    window.addEventListener("drop", ignore);
    return () => {
      window.removeEventListener("dragover", ignore);
      window.removeEventListener("drop", ignore);
    };
  }, []);

  // The input is disabled while a batch uploads, which takes the keyboard's
  // focus from it; once it is usable again, focus is given back.
  useEffect(() => {
    if (working || !refocus.current) return;
    refocus.current = false;
    input.current?.focus();
  }, [working]);

  async function add(files: File[]) {
    if (files.length === 0 || working) return;
    refocus.current = document.activeElement === input.current;
    setWorking(true);
    setFailures([]);
    setSignedOut(null);
    const problems: string[] = [];
    let added = 0;

    for (const [index, file] of files.entries()) {
      try {
        setProgress({ done: index, total: files.length });
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
    setProgress(null);
    setWorking(false);
    if (input.current) input.current.value = "";
  }

  const choose = (event: ChangeEvent<HTMLInputElement>) => add([...(event.target.files ?? [])]);

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    void add([...event.dataTransfer.files]);
  };

  // Only a drag that carries files lights the box up; dragging a tile to
  // reorder it passes over this box too and must leave it alone.
  const dragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setOver(true);
  };

  return (
    <div className="upload" data-over={over ? "" : undefined} onDragOver={dragOver} onDragLeave={() => setOver(false)} onDrop={drop}>
      <div className="upload-row">
        {/* The input stays in the page, only visually hidden, so it keeps its
            place in the tab order and its label; the label is what looks like
            the button. */}
        <input
          ref={input}
          id={id}
          className="upload-input"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/heic,image/heif"
          disabled={working}
          onChange={choose}
        />
        <label htmlFor={id} className="upload-label" data-disabled={working ? "" : undefined}>
          <PlusIcon />
          Add photographs
        </label>
        <p className="muted upload-hint">Choose several at once, or drop them here. JPEG, PNG, or HEIC.</p>
      </div>
      {progress && <progress className="upload-progress" value={progress.done} max={progress.total} aria-label="Upload progress" />}
      <p role="status" className="upload-status">
        {status}
      </p>
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
