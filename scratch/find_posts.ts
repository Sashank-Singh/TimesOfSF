import postgres from "postgres";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const rows = await sql`
    SELECT id, headline, image_url, category
    FROM generated_posts
    ORDER BY created_at DESC
    LIMIT 15
  `;
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

main().catch(console.error);
