import { z } from "zod";
import { MemoryScopeSchema } from "./enums.js";

export const MemoryCategorySchema = z.enum([
  "architecture",
  "convention",
  "preference",
  "security_triage",
  "domain_rule",
]);
export type MemoryCategory = z.infer<typeof MemoryCategorySchema>;

export const MemorySchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  scopeType: MemoryScopeSchema,
  scopeId: z.uuid(),
  category: MemoryCategorySchema,
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(16000),
  sourceDeliverableId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Memory = z.infer<typeof MemorySchema>;

export const MemoryListResponseSchema = z.object({
  items: z.array(MemorySchema),
});
export type MemoryListResponse = z.infer<typeof MemoryListResponseSchema>;

export const CreateMemorySchema = z
  .object({
    scopeType: MemoryScopeSchema,
    scopeId: z.uuid(),
    category: MemoryCategorySchema,
    title: z.string().trim().min(2).max(200),
    content: z.string().trim().min(3).max(16000),
    sourceDeliverableId: z.uuid().nullable().optional(),
  })
  .strict();
export type CreateMemoryInput = z.infer<typeof CreateMemorySchema>;

export const UpdateMemorySchema = z
  .object({
    category: MemoryCategorySchema.optional(),
    title: z.string().trim().min(2).max(200).optional(),
    content: z.string().trim().min(3).max(16000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.category !== undefined ||
      v.title !== undefined ||
      v.content !== undefined,
    { message: "Informe ao menos um campo para atualização da memória." }
  );
export type UpdateMemoryInput = z.infer<typeof UpdateMemorySchema>;
