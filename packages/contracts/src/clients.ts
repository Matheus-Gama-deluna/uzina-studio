import { z } from "zod";

export const SlugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug deve conter apenas letras minúsculas, números e hifens"
  );

export const ClientSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  name: z.string().min(1).max(120),
  slug: SlugSchema,
  isDefaultInternal: z.boolean(),
  notes: z.string().max(2000).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Client = z.infer<typeof ClientSchema>;

export const CreateClientSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: SlugSchema.optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type CreateClientInput = z.infer<typeof CreateClientSchema>;

export const UpdateClientSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;

export const ClientListResponseSchema = z.object({
  items: z.array(ClientSchema),
});
export type ClientListResponse = z.infer<typeof ClientListResponseSchema>;
