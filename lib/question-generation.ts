import { z } from "zod";

export const questionGenerationTopicOptions = [
  "General",
  "Science",
  "Geography",
  "Sport",
] as const;

export const questionGenerationInputSchema = z.object({
  difficulty: z.enum(["easy", "medium", "hard"]),
  topic: z.string().trim().min(1, "Topic is required.").max(80),
});

export const generatedQuestionSchema = z.object({
  query: z.string().describe("The question to ask."),
  answer: z.string().describe("The answer to the question."),
});

export type QuestionGenerationInput = z.infer<
  typeof questionGenerationInputSchema
>;
export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
