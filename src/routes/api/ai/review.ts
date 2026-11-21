import { createFileRoute } from "@tanstack/react-router";
import { reviewPredictionWithManus } from "@/lib/ai/manus.server";

export const Route = createFileRoute("/api/ai/review")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const review = await reviewPredictionWithManus(body);
          if (!review) return Response.json({ available: false, message: "Manus AI is not configured or returned no review." }, { status: 503 });
          return Response.json({ available: true, review }, { headers: { "Cache-Control": "no-store" } });
        } catch {
          return Response.json({ available: false, message: "AI review could not be completed." }, { status: 400 });
        }
      },
    },
  },
});
