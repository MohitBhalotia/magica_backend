import { schedules } from "@trigger.dev/sdk";

import { logger } from "@/lib/logger";
import { runService } from "@/modules/runs/run.service";

/** Every minute: re-dispatch lost runs and free chats whose run died (ARCHITECTURE §11). */
export const runSweeper = schedules.task({
  id: "run-sweeper",
  cron: "* * * * *",
  run: () => runService.sweep(logger),
});
