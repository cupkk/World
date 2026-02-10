import { z } from "zod";

const BoardActionSchema = z
  .object({
    action: z.enum(["create_structure", "update_section", "append_section", "clear_section", "set_template"]),
    section_id: z.string().min(1).optional(),
    section_title: z.string().min(1).optional(),
    content: z.string().optional(),
    template_type: z.enum(["document", "table", "code"]).optional()
  })
  .superRefine((value, ctx) => {
    const hasTarget = Boolean(value.section_id || value.section_title);

    if (value.action === "create_structure" && !value.section_title) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "create_structure requires section_title"
      });
    }

    if ((value.action === "update_section" || value.action === "append_section" || value.action === "clear_section") && !hasTarget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.action} requires section_id or section_title`
      });
    }

    if (value.action === "append_section" && !value.content?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "append_section requires non-empty content"
      });
    }

    if (value.action === "set_template" && !value.template_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "set_template requires template_type"
      });
    }
  });

const NextQuestionSchema = z.object({
  id: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  question: z.string().min(1),
  options: z.array(z.string().min(1)).max(6).optional()
});

const MarginNoteSchema = z
  .object({
    anchor: z.string().min(1).optional(),
    comment: z.string().min(1),
    suggestion: z.string().min(1).optional(),
    dimension: z.string().min(1).optional()
  })
  .strict();

export const AgentRunResponseSchema = z.object({
  assistant_message: z.string().min(1),
  board_actions: z.array(BoardActionSchema).default([]),
  next_questions: z.array(NextQuestionSchema).max(6).default([]),
  margin_notes: z.array(MarginNoteSchema).max(20).default([])
});

export type AgentRunResponseSchemaType = z.infer<typeof AgentRunResponseSchema>;
