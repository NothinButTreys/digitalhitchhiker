import { z } from "zod";

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be lowercase words joined by hyphens");
const text = z.string().trim().min(1, "must not be empty");
const positiveInt = z.number().int().positive();

// `source` is optional here because the bundler strips it from the content
// files the site imports; `npm run photos` requires it (see requireSource).
const photoContentSchema = z
  .object({ slug, source: text.optional(), title: text, alt: text, description: text })
  .strict();

const setContentSchema = z
  .object({
    slug,
    title: text,
    place: text,
    description: text,
    photos: z.array(photoContentSchema).min(1, "must list at least one photo"),
  })
  .strict();

const manifestEntrySchema = z
  .object({
    width: positiveInt,
    height: positiveInt,
    widths: z.array(positiveInt).min(1),
    color: z.string().regex(/^#[0-9a-f]{6}$/, "must be a lowercase hex colour"),
  })
  .strict();

const manifestSchema = z.record(z.string(), manifestEntrySchema);

export type PhotoContent = z.infer<typeof photoContentSchema>;
export type SetContent = z.infer<typeof setContentSchema>;
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;
export type Manifest = z.infer<typeof manifestSchema>;

function describe(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export function parseSetContent(raw: unknown, file: string): SetContent {
  const result = setContentSchema.safeParse(raw);
  if (!result.success) throw new Error(`${file}: ${describe(result.error)}`);
  return result.data;
}

export function parseManifest(raw: unknown): Manifest {
  const result = manifestSchema.safeParse(raw);
  if (!result.success) throw new Error(`manifest.json: ${describe(result.error)}`);
  return result.data;
}
