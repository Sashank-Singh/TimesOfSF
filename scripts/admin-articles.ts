/**
 * Owner-only terminal admin for published articles (same DB as production).
 *
 * Requires in .env:
 *   DATABASE_URL=...
 *   OWNER_CLI_SECRET=...   (min 12 chars; anyone with this file + .env is "you")
 *
 * Usage: npm run admin:articles
 *
 * Commands: number = open article in nano, r = refresh list, q = quit
 * After editing: preview + optional diff, then y saves to Neon (live site reads this DB).
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const SECTION_RE = /^=== ([A-Z_]+) ===$/;

type PostRow = {
  id: string;
  headline: string;
  slug: string;
  dek: string;
  topic: string;
  body_markdown: string;
  short_post: string;
  image_url: string | null;
  image_credit: string | null;
  category: string | null;
  created_at: string;
};

function assertOwnerCli() {
  const secret = process.env.OWNER_CLI_SECRET?.trim();
  if (!secret || secret.length < 12) {
    console.error(
      "Missing or weak OWNER_CLI_SECRET. Add to .env a random string (12+ chars).\n" +
        "This script never starts an HTTP admin; only your machine with DATABASE_URL can change posts.",
    );
    process.exit(1);
  }
  const db = process.env.DATABASE_URL?.trim();
  if (!db) {
    console.error("DATABASE_URL is required in .env");
    process.exit(1);
  }
}

function parseSections(raw: string): Record<string, string> {
  const lines = raw.split(/\r?\n/);
  const sections: Record<string, string> = {};
  let current: string | null = null;
  const buf: string[] = [];
  const flush = () => {
    if (current) sections[current] = buf.join("\n").replace(/\s+$/, "");
    buf.length = 0;
  };
  for (const line of lines) {
    const m = line.match(SECTION_RE);
    if (m) {
      flush();
      current = m[1]!;
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

function buildTemplate(p: PostRow): string {
  const empty = (s: string | null) => (s == null || s === "" ? "" : s);
  return [
    "=== HEADLINE ===",
    p.headline,
    "=== SLUG ===",
    p.slug,
    "=== TOPIC ===",
    p.topic,
    "=== DEK ===",
    p.dek,
    "=== SHORT_POST ===",
    p.short_post,
    "=== IMAGE_URL ===",
    empty(p.image_url),
    "=== IMAGE_CREDIT ===",
    empty(p.image_credit),
    "=== CATEGORY ===",
    empty(p.category),
    "=== BODY_MARKDOWN ===",
    p.body_markdown,
    "",
  ].join("\n");
}

function previewMarkdown(body: string, maxLines = 45) {
  const lines = body.split(/\r?\n/);
  console.log("\n──────── Preview (markdown, first " + maxLines + " lines) ────────\n");
  console.log(lines.slice(0, maxLines).join("\n"));
  if (lines.length > maxLines) console.log("\n… (" + (lines.length - maxLines) + " more lines)\n");
  console.log("────────────────────────────────────────────────────────\n");
}

function openEditor(filePath: string) {
  const r = spawnSync("nano", [filePath], { stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0 && r.status !== null) {
    console.error("Editor exited with code " + r.status + " — not saving.");
    return false;
  }
  return true;
}

function tryDiff(before: string, after: string) {
  const tmpA = path.join(os.tmpdir(), "timesofsf-admin-a-" + process.pid + ".txt");
  const tmpB = path.join(os.tmpdir(), "timesofsf-admin-b-" + process.pid + ".txt");
  try {
    fs.writeFileSync(tmpA, before, "utf8");
    fs.writeFileSync(tmpB, after, "utf8");
    const d = spawnSync("diff", ["-u", tmpA, tmpB], { encoding: "utf8" });
    if (d.stdout) console.log(d.stdout);
    else if (d.status === 0) console.log("(no textual diff — files identical)\n");
  } catch {
    /* diff missing is fine */
  } finally {
    try {
      fs.unlinkSync(tmpA);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(tmpB);
    } catch {
      /* ignore */
    }
  }
}

function validateParsed(s: Record<string, string>): string | null {
  const need = ["HEADLINE", "SLUG", "TOPIC", "DEK", "SHORT_POST", "BODY_MARKDOWN"] as const;
  for (const k of need) {
    if (!(k in s) || s[k] === undefined) return "Missing section: " + k;
  }
  if (!s.HEADLINE.trim()) return "HEADLINE empty";
  if (!s.SLUG.trim()) return "SLUG empty";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(s.SLUG.trim())) {
    return "SLUG should be URL-safe (letters, numbers, hyphens)";
  }
  return null;
}

async function main() {
  assertOwnerCli();
  const sql = neon(process.env.DATABASE_URL!);

  const rl = readline.createInterface({ input, output });

  const listPosts = async (): Promise<PostRow[]> => {
    const rows = await sql`
      SELECT
        id::text AS id,
        headline,
        slug,
        dek,
        topic,
        body_markdown,
        short_post,
        image_url,
        image_credit,
        category,
        created_at::text AS created_at
      FROM generated_posts
      ORDER BY created_at DESC
      LIMIT 60
    `;
    return rows as unknown as PostRow[];
  };

  let posts = await listPosts();

  const printList = () => {
    console.log("\n── Articles (newest first) ──\n");
    if (!posts.length) {
      console.log("(no posts)\n");
      return;
    }
    posts.forEach((p, i) => {
      const d = p.created_at?.slice(0, 10) ?? "?";
      const line = (i + 1).toString().padStart(2, " ") + "  id=" + p.id + "  " + d + "  " + p.headline.slice(0, 72);
      console.log(line.length > 120 ? line.slice(0, 117) + "…" : line);
    });
    console.log("\nCommands: 1–" + posts.length + " = edit in nano  |  d3 = delete #3  |  r = refresh  |  q = quit\n");
  };

  printList();

  while (true) {
    const raw = (await rl.question("admin> ")).trim().toLowerCase();
    if (raw === "q" || raw === "quit" || raw === "exit") break;
    if (raw === "r" || raw === "refresh") {
      posts = await listPosts();
      printList();
      continue;
    }

    const delM = raw.match(/^d(?:el)?\s*(\d+)$/);
    if (delM) {
      const n = parseInt(delM[1]!, 10);
      if (n < 1 || n > posts.length) {
        console.error("No article at index " + n);
        continue;
      }
      const p = posts[n - 1]!;
      const confirm = (await rl.question('Type DELETE and article slug "' + p.slug + '" to confirm: ')).trim();
      const want = "DELETE " + p.slug;
      if (confirm !== want) {
        console.log("Cancelled.");
        continue;
      }
      await sql`DELETE FROM generated_posts WHERE id = ${p.id}`;
      console.log("Deleted id=" + p.id);
      posts = await listPosts();
      printList();
      continue;
    }

    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > posts.length) {
      console.log("Unknown command. Use a number, d<number>, r, or q.");
      continue;
    }

    const post = posts[n - 1]!;
    const tmp = path.join(os.tmpdir(), "timesofsf-edit-" + post.id + "-" + Date.now() + ".txt");
    const original = buildTemplate(post);
    fs.writeFileSync(tmp, original, "utf8");

    console.error(
      "\nOpening editor. Keep lines like === HEADLINE === exactly.\n" +
        "Save and exit the editor to continue (Ctrl+O, Enter, Ctrl+X in nano).\n",
    );
    if (!openEditor(tmp)) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      continue;
    }

    const edited = fs.readFileSync(tmp, "utf8");
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }

    const sections = parseSections(edited);
    const err = validateParsed(sections);
    if (err) {
      console.error("Parse error: " + err);
      const retry = (await rl.question("Save broken file to Desktop for manual fix? [y/N]: ")).trim().toLowerCase();
      if (retry === "y") {
        const dump = path.join(os.homedir(), "Desktop", "timesofsf-broken-edit-" + post.id + ".txt");
        fs.writeFileSync(dump, edited, "utf8");
        console.log("Wrote " + dump);
      }
      continue;
    }

    const imageUrl = sections.IMAGE_URL?.trim() || null;
    const imageCredit = sections.IMAGE_CREDIT?.trim() || null;
    const category = sections.CATEGORY?.trim() || null;

    previewMarkdown(sections.BODY_MARKDOWN!);
    console.log("Headline: " + sections.HEADLINE!.split("\n")[0]?.slice(0, 100));
    console.log("Slug:     " + sections.SLUG!.trim());

    const dup = await sql`
      SELECT id::text AS id FROM generated_posts
      WHERE slug = ${sections.SLUG!.trim()} AND id::text <> ${post.id}
      LIMIT 1
    `;
    if (dup.length) {
      console.error("Slug already used by id=" + (dup[0] as { id: string }).id + " — not saving.");
      continue;
    }

    tryDiff(original, edited);
    const go = (await rl.question("Save these changes to the database? [y/N]: ")).trim().toLowerCase();
    if (go !== "y" && go !== "yes") {
      console.log("Discarded.");
      continue;
    }

    await sql`
      UPDATE generated_posts SET
        headline = ${sections.HEADLINE!.trim()},
        slug = ${sections.SLUG!.trim().toLowerCase()},
        topic = ${sections.TOPIC!.trim()},
        dek = ${sections.DEK!.trim()},
        short_post = ${sections.SHORT_POST!.trim()},
        body_markdown = ${sections.BODY_MARKDOWN!},
        image_url = ${imageUrl},
        image_credit = ${imageCredit},
        category = ${category}
      WHERE id = ${post.id}
    `;

    console.log("Saved. Site will show updates on next load (same Neon DB).\n");
    posts = await listPosts();
    printList();
  }

  rl.close();
  console.log("Bye.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
