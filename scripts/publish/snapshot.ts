import { z } from "zod";

// The same shape the admin Worker builds (admin/src/db/snapshot.ts). The two
// packages share no code, so the shape is checked again here, on arrival:
// slugs and hashes become file paths, and must be exactly what they claim.
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase words joined by hyphens");
const text = z.string().trim().min(1, "must not be empty");

const photoSchema = z
  .object({
    slug,
    title: text,
    alt: text,
    description: text,
    contentHash: z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hexadecimal characters"),
    contentType: text,
    originalName: text,
  })
  .strict();

const categorySchema = z
  .object({
    slug,
    title: text,
    place: text,
    description: text,
    photos: z.array(photoSchema).min(1, "must show at least one photograph").max(8, "must show at most 8 photographs"),
  })
  .strict();

const snapshotSchema = z
  .object({ version: z.literal(1), categories: z.array(categorySchema).min(1, "must list at least one category") })
  .strict();

export type SnapshotPhoto = z.infer<typeof photoSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;

export function parseSnapshot(raw: unknown): Snapshot {
  const result = snapshotSchema.safeParse(raw);
  if (result.success) return result.data;
  const reason = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
  throw new Error(`The library sent a snapshot this build cannot use: ${reason}`);
}
