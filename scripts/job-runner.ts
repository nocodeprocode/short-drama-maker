import { loadLocalEnv } from "./load-env.ts";
import { runLoop } from "../src/engine/jobs/runner.ts";

loadLocalEnv();

await runLoop(Number(process.env.JOB_RUNNER_INTERVAL_MS ?? 2000));
