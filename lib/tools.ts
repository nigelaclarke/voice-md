// Voice tools the model can call. Three tools:
//   transformSelection({ primary, intent })  — Stage 1, replaces selection
//   insertAtCursor({ text })                  — empty-selection / dictation path
//   renderUI(<discriminated affordance spec>) — Stage 2, optional affordance
//
// The model emits a high-level affordance spec (dial / cards / chip); the
// surface module translates that into A2UI v0.9 messages internally. Keeping
// the tool surface terse means the model spends fewer tokens on UI scaffolding.

import { defineVoiceTool } from "realtime-voice-component";
import type { VoiceTool } from "realtime-voice-component";
import { z } from "zod";

// ---- Surface specs (model-facing) ---------------------------------------

export const dialSurfaceSpec = z.object({
  type: z.literal("dial"),
  axes: z
    .array(
      z.object({
        id: z.string().describe("Axis identifier, snake_case."),
        label: z.string().describe("Short human label, e.g. 'Length' or 'Tone'."),
        ticks: z
          .array(z.string())
          .min(2)
          .max(5)
          .describe("Tick labels in order. The middle tick is the variant already emitted in transformSelection."),
      }),
    )
    .min(1)
    .max(2)
    .describe("1-2 axes of variation."),
  values: z
    .record(z.string(), z.record(z.string(), z.string()))
    .describe(
      "values[axisId][tickLabel] = the markdown variant for that tick. Must include EVERY tick on EVERY axis.",
    ),
});

export const cardsSurfaceSpec = z.object({
  type: z.literal("cards"),
  options: z
    .array(
      z.object({
        label: z.string().describe("Short option label."),
        preview: z.string().describe("One-line preview."),
        full: z.string().describe("Full markdown the user gets when they pick this option."),
      }),
    )
    .min(2)
    .max(4),
});

export const chipSurfaceSpec = z.object({
  type: z.literal("chip"),
  label: z.string().describe("2-4 word offer text."),
  followup: z.string().describe("Instruction to execute when the user taps the chip."),
});

export const surfaceSpec = z.discriminatedUnion("type", [
  dialSurfaceSpec,
  cardsSurfaceSpec,
  chipSurfaceSpec,
]);

export type SurfaceSpec = z.infer<typeof surfaceSpec>;
export type DialSpec = z.infer<typeof dialSurfaceSpec>;
export type CardsSpec = z.infer<typeof cardsSurfaceSpec>;
export type ChipSpec = z.infer<typeof chipSurfaceSpec>;

// ---- Tool params --------------------------------------------------------

const transformSelectionParams = z.object({
  primary: z
    .string()
    .min(1)
    .describe("The markdown that will replace the user's selection."),
  intent: z
    .string()
    .max(40)
    .describe(
      "Short intent label, snake_case or hyphen. Examples: summarize, reformat-as-table, tighten, rewrite-formal.",
    ),
});

const insertAtCursorParams = z.object({
  text: z
    .string()
    .min(1)
    .describe("The markdown to insert at the cursor (no selection case)."),
});

// renderUI's parameters ARE the surface spec — discriminated by type.
const renderUIParams = surfaceSpec;

export type TransformSelectionArgs = z.infer<typeof transformSelectionParams>;
export type InsertAtCursorArgs = z.infer<typeof insertAtCursorParams>;
export type RenderUIArgs = z.infer<typeof renderUIParams>;

// ---- Adapter contract ---------------------------------------------------

export interface VoiceAdapter {
  applyTransform: (args: TransformSelectionArgs) => void;
  applyInsert: (args: InsertAtCursorArgs) => void;
  showSurface: (spec: SurfaceSpec) => void;
}

// ---- Tool factory -------------------------------------------------------

// VoiceTool is generic over its arg type; the controller's tools array is
// VoiceTool<any>[] (per the realtime-voice-component README), so we widen here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildTools(adapter: VoiceAdapter): VoiceTool<any>[] {
  const transformSelection = defineVoiceTool({
    name: "transformSelection",
    description:
      "Replace the user's currently-selected text with the rewritten markdown. ALWAYS call this when there IS a selection and the user wants to change it. Stage 1 of the two-stage flow — fast, immediate.",
    parameters: transformSelectionParams,
    execute: async (args) => {
      adapter.applyTransform(args);
      return { ok: true, intent: args.intent };
    },
  });

  const insertAtCursor = defineVoiceTool({
    name: "insertAtCursor",
    description:
      "Insert markdown at the user's cursor. Use ONLY when there is no selection (dictation, expand-at-cursor).",
    parameters: insertAtCursorParams,
    execute: async (args) => {
      adapter.applyInsert(args);
      return { ok: true };
    },
  });

  const renderUI = defineVoiceTool({
    name: "renderUI",
    description:
      "Optional Stage 2: render a follow-up affordance under the just-edited selection. Use only when the affordance genuinely helps continued iteration. Three component types: dial (axis variants), cards (ambiguous selection), chip (single follow-up offer). Omit entirely if no affordance fits.",
    parameters: renderUIParams,
    execute: async (args) => {
      adapter.showSurface(args);
      return { ok: true, surfaceType: args.type };
    },
  });

  return [transformSelection, insertAtCursor, renderUI];
}
