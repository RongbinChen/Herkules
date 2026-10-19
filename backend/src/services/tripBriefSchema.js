// Request shape for POST /trips/plan-brief.
//
// Lives apart from the router so a test can parse a wizard payload without
// booting Express. The wizard sends `buildChatContext()` plus the pasted
// paragraph; the caps exist so a prompt cannot be stuffed with megabytes.
import { z } from 'zod';

// `time` is the original single field. Kept accepted, and read as the
// departure, so trips saved before the split still load and still plan.
export const flightSchema = z.object({
  date: z.string().optional(),
  flightNo: z.string().optional(),
  routing: z.string().optional(),
  time: z.string().optional(),
  depart: z.string().optional(),
  arrive: z.string().optional(),
  notes: z.string().optional(),
});

export const chatContextSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  assignees: z.array(z.object({ name: z.string() })).max(20).optional(),
  flights: z.array(flightSchema).max(20).optional(),
  constraints: z.string().max(4000).nullable().optional(),
  stops: z
    .array(
      z.object({
        customer: z.object({
          name: z.string(),
          address: z.string().nullable().optional(),
          latitude: z.number().nullable().optional(),
          longitude: z.number().nullable().optional(),
        }),
        priority: z.string().nullable().optional(),
        visitDuration: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .max(60)
    .default([]),
});

export const briefBodySchema = z.object({
  brief: z.string().trim().min(1).max(16000),
  context: chatContextSchema,
});
