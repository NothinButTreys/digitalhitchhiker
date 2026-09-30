import type { Prepared } from "./prepare-upload";
import type { CategoryInput, CategoryOut, CategoryPatch, PhotoOut } from "./types";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type Options = { method?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string> };

const SIGNED_OUT_MESSAGE = "You have been signed out. Reload the page to sign in again.";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// A damaged transfer (a truncated body, or bytes that don't match the
// declared hash) is worth one retry from scratch — a fresh declaration and a
// fresh send — before it is reported as a failure. Anything else (a 409
// duplicate, a network error, being signed out) is not a transfer problem and
// is never retried.
const RETRIABLE_UPLOAD_CODES = new Set(["size_mismatch", "hash_mismatch"]);

function signedOut(): never {
  throw new ApiRequestError(401, "signed_out", SIGNED_OUT_MESSAGE);
}

export function createApi(fetchImpl: typeof fetch = fetch, devEmail?: string) {
  async function request<T>(path: string, options: Options = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (devEmail) headers.set("x-dev-email", devEmail);
    let body = options.body;
    if (options.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.json);
    }

    let response: Response;
    try {
      response = await fetchImpl(path, {
        method: options.method ?? "GET",
        headers,
        body,
        redirect: "manual",
        credentials: "same-origin",
      });
    } catch {
      throw new ApiRequestError(0, "network", "Could not reach the library. Check your connection.");
    }

    // Cloudflare Access answers an expired session with a redirect to its sign-in
    // page, not with the Worker's JSON. With `redirect: "manual"` a real redirect
    // comes back as an opaque response (type "opaqueredirect", status 0, body
    // unreadable); some environments instead hand back the redirect status
    // directly, so both are treated the same way.
    if (response.type === "opaqueredirect" || REDIRECT_STATUSES.has(response.status)) {
      signedOut();
    }

    if (response.status === 204) return undefined as T;

    // Access also answers with status 200 and its own HTML sign-in page in place
    // of the API's JSON when the session has expired but the request itself
    // doesn't redirect (e.g. a same-origin GET it intercepts).
    const contentType = response.headers.get("content-type") ?? "";
    if (response.status === 200 && contentType.includes("text/html")) {
      signedOut();
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      // A 401/403 with a body that isn't JSON is Access's own denial page, not
      // the Worker's JSON error shape.
      if (response.status === 401 || response.status === 403) signedOut();
      throw new ApiRequestError(response.status, "unexpected", "The library did not answer properly. Try again.");
    }

    const { error, message, ...details } = (data ?? {}) as { error?: string; message?: string };
    if (error === "unauthorized") signedOut();

    if (!response.ok) {
      throw new ApiRequestError(
        response.status,
        error ?? "unexpected",
        message ?? "The library did not answer properly. Try again.",
        details,
      );
    }
    return data as T;
  }

  return {
    request,
    listCategories: async () => (await request<{ categories: CategoryOut[] }>("/api/categories")).categories,
    createCategory: (input: CategoryInput) => request<CategoryOut>("/api/categories", { method: "POST", json: input }),
    updateCategory: (id: string, patch: CategoryPatch) =>
      request<CategoryOut>(`/api/categories/${id}`, { method: "PATCH", json: patch }),
    orderCategories: async (ids: string[]) =>
      (await request<{ categories: CategoryOut[] }>("/api/categories/order", { method: "PUT", json: { ids } })).categories,
    deleteCategory: (id: string) => request<void>(`/api/categories/${id}`, { method: "DELETE" }),
    listPhotos: async (categoryId: string) =>
      (await request<{ photos: PhotoOut[] }>(`/api/categories/${categoryId}/photos`)).photos,
    saveText: (id: string, text: { title: string; alt: string; description: string }) =>
      request<PhotoOut>(`/api/photos/${id}/text`, { method: "PUT", json: text }),
    setSelected: (id: string, selected: boolean) =>
      request<PhotoOut>(`/api/photos/${id}/selected`, { method: "PUT", json: { selected } }),
    orderSelection: async (categoryId: string, ids: string[]) =>
      (await request<{ photos: PhotoOut[] }>(`/api/categories/${categoryId}/selection-order`, { method: "PUT", json: { ids } })).photos,
    movePhoto: (id: string, categoryId: string) =>
      request<PhotoOut>(`/api/photos/${id}/category`, { method: "PUT", json: { categoryId } }),
    deletePhoto: (id: string) => request<void>(`/api/photos/${id}`, { method: "DELETE" }),
    upload: async (categoryId: string, prepared: Prepared): Promise<PhotoOut> => {
      const attempt = async (): Promise<PhotoOut> => {
        const { id } = await request<{ id: string }>("/api/uploads", {
          method: "POST",
          json: {
            categoryId,
            originalName: prepared.file.name,
            contentType: prepared.contentType,
            contentHash: prepared.contentHash,
            size: prepared.file.size,
            width: prepared.width,
            height: prepared.height,
          },
        });
        await request<void>(`/api/uploads/${id}/original`, {
          method: "PUT",
          body: prepared.file,
          headers: { "content-type": prepared.contentType },
        });
        await request<void>(`/api/uploads/${id}/preview`, {
          method: "PUT",
          body: prepared.preview,
          headers: { "content-type": "image/jpeg" },
        });
        return request<PhotoOut>(`/api/uploads/${id}/complete`, { method: "POST" });
      };
      try {
        return await attempt();
      } catch (error) {
        if (error instanceof ApiRequestError && RETRIABLE_UPLOAD_CODES.has(error.code)) {
          return await attempt();
        }
        throw error;
      }
    },
  };
}

export type Api = ReturnType<typeof createApi>;
