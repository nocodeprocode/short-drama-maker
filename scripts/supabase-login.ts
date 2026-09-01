import { spawnSync } from "node:child_process";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  throw new Error(
    [
      "SUPABASE_ACCESS_TOKEN is missing from .env.local.",
      "Create a personal access token at https://supabase.com/dashboard/account/tokens",
      "Name it short-drama-maker-cli, then add SUPABASE_ACCESS_TOKEN=sbp_... to .env.local.",
      "Do not paste the token into chat.",
    ].join(" "),
  );
}

if (!token.startsWith("sbp_")) {
  throw new Error(
    "SUPABASE_ACCESS_TOKEN should be a personal access token (sbp_...), not a project API key.",
  );
}

const login = spawnSync(
  "npx",
  ["supabase", "login", "--token", token, "--yes", "--name", "short-drama-maker-cli"],
  { stdio: ["ignore", "inherit", "inherit"] },
);
if (login.status !== 0) {
  process.exit(login.status ?? 1);
}

const link = spawnSync(
  "npx",
  [
    "supabase",
    "link",
    "--project-ref",
    "zdhbmvdprdyqzrmuxwiy",
    "--yes",
  ],
  { stdio: ["ignore", "inherit", "inherit"], env: process.env },
);
if (link.status !== 0) {
  process.exit(link.status ?? 1);
}

console.log("Supabase CLI is logged in and linked to short-drama-maker.");
