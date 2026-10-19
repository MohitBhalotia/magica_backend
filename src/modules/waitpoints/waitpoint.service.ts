import { wait } from "@trigger.dev/sdk";

import { WAITPOINTS } from "@mohitbhalotia/magica-contracts";

import { AppError } from "@/lib/errors";
import { toWaitpoint, waitpointRepository } from "@/modules/waitpoints/waitpoint.repository";

export const waitpointService = {
  /**
   * The user's answer (PRD §5.8): checked against the waitpoint's type, then recorded and handed to
   * the paused run exactly once. A repeated answer gets the recorded result back.
   */
  async respond(id: string, userId: string, response: unknown) {
    const waitpoint = await waitpointRepository.findOwned(id, userId);
    // Missing and not-yours look the same.
    if (!waitpoint) throw new AppError("NOT_FOUND", "Question not found.");

    const answer = WAITPOINTS[waitpoint.type].response.parse(response);
    const won = await waitpointRepository.answer(id, answer);
    const now = await waitpointRepository.get(id);
    if (won) {
      // Wakes the run; it reads the answer back from Postgres, not from the token.
      await wait.completeToken(now.tokenId, answer);
    } else if (now.status !== "answered") {
      throw new AppError("WAITPOINT_CLOSED", "This question was already closed.");
    }
    return toWaitpoint(now);
  },
};
