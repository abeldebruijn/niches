import { gateway, Output, streamText } from "ai";
import { NextResponse } from "next/server";
import {
  generatedQuestionSchema,
  type QuestionGenerationInput,
  questionGenerationInputSchema,
} from "@/lib/question-generation";

export const maxDuration = 30;

const difficultyGuidance: Record<
  QuestionGenerationInput["difficulty"],
  string
> = {
  easy: "Answerable by most players with basic knowledge.",
  medium: "Requires some recall or light reasoning, but should stay fair.",
  hard: "Challenging and specific, but still solvable with one exact answer.",
};

function buildPrompt(input: QuestionGenerationInput): string {
  return [
    "Generate exactly one trivia-style question with its exact answer.",
    `Topic: ${input.topic}`,
    `Difficulty: ${input.difficulty}`,
    `Difficulty guidance: ${difficultyGuidance[input.difficulty]}`,
    "The question must be one sentence and end with a question mark.",
    "The answer must be short and specific (1 to 8 words).",
    "Avoid open-ended questions and avoid requiring multiple possible answers.",
    "Do not include explanations.",
  ].join("\n");
}

export async function POST(request: Request) {
  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsedInput = questionGenerationInputSchema.safeParse(rawBody);

  if (!parsedInput.success) {
    return NextResponse.json(
      {
        error: parsedInput.error.issues[0]?.message ?? "Invalid request body.",
      },
      { status: 400 },
    );
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    return NextResponse.json(
      { error: "Missing AI_GATEWAY_API_KEY environment variable." },
      { status: 500 },
    );
  }

  const result = streamText({
    model: gateway("openai/gpt-5-mini"),
    output: Output.object({ schema: generatedQuestionSchema }),
    system:
      "You generate concise trivia items for a party game. Always produce high-quality factual questions with unambiguous short answers.",
    prompt: buildPrompt(parsedInput.data),
  });

  return result.toTextStreamResponse();
}
