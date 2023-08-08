import { z } from "zod";

export const photoSchema = z.object({
  asset_id: z.string(),
  public_id: z.string(),
  format: z.string(),
  version: z.number(),
  resource_type: z.string(),
  type: z.string(),
  created_at: z.string(),
  bytes: z.number(),
  width: z.number(),
  height: z.number(),
  url: z.string(),
  folder: z.string(),
  secure_url: z.string(),
});

export type Photo = z.infer<typeof photoSchema>;
