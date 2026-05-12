import { execSync } from "node:child_process";

if (process.env.SKIP_NEWS_PLEASE_POSTINSTALL === "1") {
  console.log("[postinstall] SKIP_NEWS_PLEASE_POSTINSTALL=1 — skipping news-please venv.");
  process.exit(0);
}

execSync(
  "python3 -m venv venv && ./venv/bin/pip install -U pip setuptools wheel && ./venv/bin/pip install news-please",
  { stdio: "inherit", shell: true },
);
