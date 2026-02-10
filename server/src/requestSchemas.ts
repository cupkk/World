import { z } from "zod";

type Limits = {
  maxMessages: number;
  maxMessageChars: number;
  maxBoardSections: number;
  maxSectionTitleChars: number;
  maxSectionContentChars: number;
};

export function createAgentRequestSchema(limits: Limits) {
  return z
    .object({
      session_id: z.string().trim().min(1).max(128),
      messages: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(limits.maxMessageChars)
          })
        )
        .min(1)
        .max(limits.maxMessages),
      board_sections: z
        .array(
          z.object({
            id: z.string().trim().min(1).max(128),
            title: z.string().trim().min(1).max(limits.maxSectionTitleChars),
            content: z.string().max(limits.maxSectionContentChars),
            source: z.enum(["ai", "user", "pinned"]).optional()
          })
        )
        .max(limits.maxBoardSections)
    })
    .strict();
}
