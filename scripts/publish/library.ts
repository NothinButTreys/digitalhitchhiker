import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { parseSnapshot, type Snapshot } from "./snapshot";

export type Target = "preview" | "production";
export type StatusUpdate = { status: "running" | "succeeded" | "failed"; message: string; url?: string };

/** Where generated images are kept between publishes, addressed by the original's hash. */
export interface DerivedStore {
  getDerived(hash: string, file: string): Promise<Buffer | null>;
  putDerived(hash: string, file: string, body: Buffer): Promise<void>;
}

/** Where an original can be fetched from, for one publish. */
export interface OriginalSource {
  downloadOriginal(hash: string, toFile: string): Promise<void>;
}

export class LibraryError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 120_000;

export type LibraryConfig = { url: string; clientId: string; clientSecret: string };

/**
 * The publish workflow's only way to the library: the admin Worker's service
 * endpoints, with an Access service token. Its errors are printed in a
 * public log, so they name the path and the status and never the library's
 * address or the token.
 */
export function createLibrary(config: LibraryConfig, fetchImpl: typeof fetch = fetch) {
  const base = config.url.replace(/\/+$/, "");

  async function request(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        body: init.body,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          "CF-Access-Client-Id": config.clientId,
          "CF-Access-Client-Secret": config.clientSecret,
          ...init.headers,
        },
      });
    } catch {
      throw new LibraryError(0, `The library could not be reached for ${method} ${path}.`);
    }
    return response;
  }

  function refused(response: Response, method: string, path: string): LibraryError {
    const hint = response.status >= 300 && response.status < 400 ? ` A ${response.status} means it did not accept the service token.` : "";
    return new LibraryError(response.status, `The library answered ${response.status} to ${method} ${path}.${hint}`);
  }

  /**
   * Reads a body. A failure is reported without the underlying error, whose
   * text or cause can carry part of the body or socket details.
   */
  async function read<T>(response: Response, method: string, path: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch {
      throw new LibraryError(response.status, `The library's answer to ${method} ${path} could not be read.`);
    }
  }

  async function getJson(path: string): Promise<unknown> {
    const response = await request("GET", path);
    if (response.status !== 200) throw refused(response, "GET", path);
    return read(response, "GET", path, () => response.json());
  }

  return {
    async getSnapshot(publishId: string): Promise<{ target: Target; snapshot: Snapshot }> {
      const body = (await getJson(`/api/service/publishes/${encodeURIComponent(publishId)}/snapshot`)) as { target?: unknown; snapshot?: unknown };
      if (body.target !== "preview" && body.target !== "production") {
        throw new Error("The library sent a publish with no target.");
      }
      return { target: body.target, snapshot: parseSnapshot(body.snapshot) };
    },

    async getPublished(): Promise<Snapshot> {
      const body = (await getJson("/api/service/published")) as { snapshot?: unknown };
      return parseSnapshot(body.snapshot);
    },

    /** True when the report was recorded; false when the publish had already finished. */
    async reportStatus(publishId: string, update: StatusUpdate): Promise<boolean> {
      const path = `/api/service/publishes/${encodeURIComponent(publishId)}/status`;
      const response = await request("POST", path, {
        body: JSON.stringify({ status: update.status, message: update.message, url: update.url ?? "" }),
        headers: { "content-type": "application/json" },
      });
      if (response.status === 409) return false;
      if (response.status !== 200) throw refused(response, "POST", path);
      return true;
    },

    async getDerived(hash: string, file: string): Promise<Buffer | null> {
      const path = `/api/service/derived/${hash}/${file}`;
      const response = await request("GET", path);
      if (response.status === 404) return null;
      if (response.status !== 200) throw refused(response, "GET", path);
      return read(response, "GET", path, async () => Buffer.from(await response.arrayBuffer()));
    },

    async putDerived(hash: string, file: string, body: Buffer): Promise<void> {
      const path = `/api/service/derived/${hash}/${file}`;
      const response = await request("PUT", path, { body: body as unknown as BodyInit, headers: { "content-length": String(body.length) } });
      if (response.status !== 204) throw refused(response, "PUT", path);
    },

    originalsFor(publishId: string): OriginalSource {
      return {
        async downloadOriginal(hash: string, toFile: string): Promise<void> {
          const path = `/api/service/publishes/${encodeURIComponent(publishId)}/originals/${hash}`;
          const response = await request("GET", path);
          if (response.status !== 200 || !response.body) throw refused(response, "GET", path);
          const body = response.body as unknown as WebReadableStream;
          await read(response, "GET", path, () => pipeline(Readable.fromWeb(body), createWriteStream(toFile)));
        },
      };
    },
  };
}

export type Library = ReturnType<typeof createLibrary>;
