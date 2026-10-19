import { NextResponse } from "next/server";

import { RespondWaitpointRequestSchema, type Waitpoint } from "@mohitbhalotia/magica-contracts";

import { withHandler } from "@/lib/withHandler";
import { waitpointService } from "@/modules/waitpoints/waitpoint.service";

export const respondWaitpoint = withHandler<{ waitpointId: string }>(
  async (req, { userId, params }) => {
    const { response } = RespondWaitpointRequestSchema.parse(await req.json());
    const waitpoint = await waitpointService.respond((await params).waitpointId, userId, response);
    return NextResponse.json<Waitpoint>(waitpoint);
  },
);
