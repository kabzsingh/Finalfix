import { createServerFn } from "@tanstack/react-start";
import { getServerContext } from "./server-utils";
import * as db from "./db";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

// ── Sites ──────────────────────────────────────────────

export const getSitesAction = createServerFn({ method: "GET" }).handler(async () => {
  const { supabase } = getServerContext();
  return db.getSites(supabase);
});

export const getSiteByIdAction = createServerFn({ method: "GET" })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const { supabase } = getServerContext();
    return db.getSiteById(supabase, id);
  });

export const createSiteAction = createServerFn({ method: "POST" })
  .inputValidator((site: any) => site)
  .handler(async ({ data: site }) => {
    const { supabaseAdmin } = getServerContext();
    return db.createSite(supabaseAdmin, site);
  });

// ── Readings ───────────────────────────────────────────

export const getReadingsAction = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      siteId: z.string(),
      limit: z.number().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { supabase } = getServerContext();
    return db.getReadingsForSite(supabase, data.siteId, {
      limit: data.limit,
      from: data.from,
      to: data.to,
    });
  });

export const getLatestReadingAction = createServerFn({ method: "GET" })
  .inputValidator((siteId: string) => siteId)
  .handler(async ({ data: siteId }) => {
    const { supabase } = getServerContext();
    return db.getLatestReading(supabase, siteId);
  });

// ── Meters ─────────────────────────────────────────────

export const getMetersAction = createServerFn({ method: "GET" })
  .inputValidator((siteId: string) => siteId)
  .handler(async ({ data: siteId }) => {
    const { supabase } = getServerContext();
    return db.getMetersForSite(supabase, siteId);
  });
