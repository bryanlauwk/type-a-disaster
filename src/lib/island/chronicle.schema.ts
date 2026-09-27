import { z } from "zod";

/** What the storyteller is told about an act (shared by page and server). */
export const chronicleInputSchema = z.object({
  /** What was done, in plain words. */
  act: z.string().min(3).max(200),
  /** What came of it. */
  facts: z.array(z.string().max(200)).max(12),
  island: z.object({
    day: z.number().int().min(0),
    season: z.enum(["wet", "dry"]),
    tribe: z.string().max(200),
    animals: z.string().max(400),
    recent: z.array(z.string().max(120)).max(5),
  }),
});
export type ChronicleInput = z.infer<typeof chronicleInputSchema>;
