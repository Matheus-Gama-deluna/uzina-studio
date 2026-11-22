import { z } from "zod";

export const MAX_PROTOTYPE_HTML_BYTES_CONTRACT = 2 * 1024 * 1024;

export const PrototypeLevelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type PrototypeLevel = z.infer<typeof PrototypeLevelSchema>;

export const PrototypeSourceSchema = z.enum([
  "native",
  "stitch_mcp",
  "stitch_import",
]);
export type PrototypeSource = z.infer<typeof PrototypeSourceSchema>;

export const W3CTokenEntrySchema = z
  .object({
    $value: z.string().min(1),
    $type: z.enum(["color", "fontFamily", "dimension", "number"]),
  })
  .strict();
export type W3CTokenEntry = z.infer<typeof W3CTokenEntrySchema>;

export const DesignTokensW3CSchema = z
  .object({
    color: z.record(z.string(), W3CTokenEntrySchema),
    typography: z.record(z.string(), W3CTokenEntrySchema),
    spacing: z.record(z.string(), W3CTokenEntrySchema),
    radius: z.record(z.string(), W3CTokenEntrySchema),
  })
  .strict();
export type DesignTokensW3C = z.infer<typeof DesignTokensW3CSchema>;

export const CreatePrototypeRequestSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    level: PrototypeLevelSchema.default(3),
    source: PrototypeSourceSchema.default("stitch_import"),
    deliverableId: z.uuid().nullable().optional(),
    specSummary: z.string().trim().max(4000).optional(),
    html: z.string().max(MAX_PROTOTYPE_HTML_BYTES_CONTRACT).optional(),
    stitchScreenId: z.string().trim().max(120).optional(),
  })
  .strict();
export type CreatePrototypeRequest = z.infer<
  typeof CreatePrototypeRequestSchema
>;

export const UpdatePrototypeApprovalSchema = z
  .object({
    approved: z.boolean(),
    syncDesignMd: z.boolean().default(false),
  })
  .strict();
export type UpdatePrototypeApproval = z.infer<
  typeof UpdatePrototypeApprovalSchema
>;

export const DesignPrototypeSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    deliverableId: z.uuid().nullable(),
    level: PrototypeLevelSchema,
    source: PrototypeSourceSchema,
    title: z.string().min(1),
    previewUrl: z.string().min(1),
    tokensJson: DesignTokensW3CSchema,
    wireframeMermaid: z.string().nullable(),
    approved: z.boolean(),
    handoffPath: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DesignPrototype = z.infer<typeof DesignPrototypeSchema>;

export const DesignPrototypeListResponseSchema = z
  .object({
    items: z.array(DesignPrototypeSchema),
  })
  .strict();
export type DesignPrototypeListResponse = z.infer<
  typeof DesignPrototypeListResponseSchema
>;

export const StitchMcpScreenSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    html: z.string().max(MAX_PROTOTYPE_HTML_BYTES_CONTRACT),
    viewport: z.enum(["desktop", "mobile", "responsive"]).default("responsive"),
  })
  .strict();
export type StitchMcpScreen = z.infer<typeof StitchMcpScreenSchema>;

export const StitchMcpSyncRequestSchema = z
  .object({
    action: z.enum(["list_screens", "import_screen"]).default("list_screens"),
    screenId: z.string().trim().max(120).optional(),
    title: z.string().trim().min(2).max(160).optional(),
  })
  .strict();
export type StitchMcpSyncRequest = z.infer<typeof StitchMcpSyncRequestSchema>;

export const StitchMcpSyncResponseSchema = z
  .object({
    status: z.enum(["ok", "unavailable"]),
    detail: z.string().min(1),
    screens: z.array(StitchMcpScreenSchema),
    importedPrototype: DesignPrototypeSchema.nullable().optional(),
  })
  .strict();
export type StitchMcpSyncResponse = z.infer<typeof StitchMcpSyncResponseSchema>;
