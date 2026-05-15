import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

/** POST JSON — για στατικό index.html στο GitHub Pages (fetch, χωρίς Railway) */
http.route({
  path: "/entries",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
    }

    const sessionId = body.sessionId ?? body.session_id;
    if (!sessionId || typeof sessionId !== "string") {
      return jsonResponse({ ok: false, error: "missing sessionId" }, 400);
    }

    const rawCondition =
      body.condition !== undefined
        ? body.condition
        : body.experimental_condition;

    let condition: number | null = null;
    if (rawCondition !== undefined && rawCondition !== null && rawCondition !== "") {
      const n = Number(rawCondition);
      condition = Number.isFinite(n) ? n : null;
    }

    try {
      await ctx.runMutation(api.entries.insert, {
        sessionId,
        condition,
        error_timing:
          body.error_timing != null ? String(body.error_timing) : null,
        show_conf: !!body.show_conf,
        category: String(body.category ?? ""),
        field: String(body.field ?? ""),
        value: body.value === undefined ? null : body.value,
        detail: body.detail === undefined ? null : body.detail,
      });
      return jsonResponse({ ok: true }, 201);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return jsonResponse({ ok: false, error: message }, 400);
    }
  }),
});

http.route({
  path: "/entries",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: corsHeaders });
  }),
});

export default http;
