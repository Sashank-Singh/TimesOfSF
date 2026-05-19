import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL not found");
  process.exit(1);
}

const sql = neon(databaseUrl);

async function cleanup() {
  console.log("🔍 Fetching posts for duplicate analysis...");
  
  const posts = await sql`
    SELECT id, run_id, topic, headline, created_at 
    FROM generated_posts 
    ORDER BY created_at DESC
  `;

  const toDelete: string[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < posts.length; i++) {
    const current = posts[i];
    if (toDelete.includes(current.id)) continue;

    for (let j = i + 1; j < posts.length; j++) {
      const compare = posts[j];
      if (toDelete.includes(compare.id)) continue;

      // Check for similarity in topic or headline
      const s1 = current.topic.toLowerCase();
      const s2 = compare.topic.toLowerCase();
      
      // Basic keyword overlap check
      const tokens1 = s1.split(/\s+/).filter(t => t.length > 3);
      const tokens2 = s2.split(/\s+/).filter(t => t.length > 3);
      
      const overlap = tokens1.filter(t => tokens2.includes(t));
      const overlapRatio = overlap.length / Math.min(tokens1.length, tokens2.length);

      // If more than 60% of keywords overlap, consider it a duplicate
      if (overlapRatio > 0.6) {
        console.log(`🗑️ Found Duplicate:\n   Keep: "${current.headline}"\n   Drop: "${compare.headline}" (Overlap: ${(overlapRatio * 100).toFixed(0)}%)`);
        toDelete.push(compare.id);
      }
    }
  }

  if (toDelete.length === 0) {
    console.log("✨ No duplicates found.");
    return;
  }

  console.log(`\n🚀 Deleting ${toDelete.length} duplicate runs...`);
  
  const runIdsToDelete = posts
    .filter(p => toDelete.includes(p.id))
    .map(p => p.run_id);

  if (runIdsToDelete.length > 0) {
    // Delete from pipeline_runs; cascade will clean up generated_posts and source_attempts
    for (const runId of runIdsToDelete) {
      await sql`DELETE FROM pipeline_runs WHERE id = ${runId}`;
    }
  }

  console.log("✅ Cleanup complete.");
}

cleanup().catch(console.error);
