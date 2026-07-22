import postgres from "postgres";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  console.log("Updating article images in the database...");

  const updates = [
    {
      pattern: "%From Down Under to a Hacker House%",
      imageUrl: "/images/hacker_house.png",
      credit: "AI Generated"
    },
    {
      pattern: "%Surprising New Champion%",
      imageUrl: "/images/croissant.png",
      credit: "AI Generated"
    },
    {
      pattern: "%San Francisco Coffee Plants Flag%",
      imageUrl: "/images/sf_coffee.png",
      credit: "AI Generated"
    },
    {
      pattern: "%AI-Run Café%",
      imageUrl: "/images/ai_barista.png",
      credit: "AI Generated"
    }
  ];

  for (const update of updates) {
    const result = await sql`
      UPDATE generated_posts
      SET image_url = ${update.imageUrl}, image_credit = ${update.credit}
      WHERE headline LIKE ${update.pattern}
    `;
    console.log(`Updated posts matching "${update.pattern}": ${result.count} rows modified.`);
  }

  console.log("Database update finished!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to update database:", err);
  process.exit(1);
});
