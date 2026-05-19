import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";
dotenv.config();

const sql = neon(process.env.DATABASE_URL!);

async function testRealExpand() {
  const posts = await sql`SELECT headline, body_markdown FROM generated_posts WHERE id = 12`;
  if (!posts.length) {
    console.error("Post 12 not found in DB!");
    return;
  }
  const post = posts[0];
  
  const prompt = `
    You are the Times of SF senior editor. 
    A junior writer has provided a short dispatch. Please expand this into a full feature-length report.
    Do not change the existing facts, but add analytical depth, historical context of San Francisco, and explore the long-term implications.
    Maintain the existing professional, grounded editorial tone.
    Return ONLY the new body content in Markdown. No headline, no titles.
    
    Current Dispatch:
    ${post.body_markdown}
    
    Expand this story:
  `;

  console.log("Requesting expansion for post 12...");
  const response = await fetch(`${process.env.FIREWORKS_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.FIREWORKS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.FIREWORKS_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    }),
  });
  
  const data = await response.json();
  if (response.ok) {
    console.log("Success!");
    console.log("Content preview:", data.choices[0].message.content.substring(0, 200));
  } else {
    console.error("Failed:", JSON.stringify(data, null, 2));
  }
}

testRealExpand().catch(console.error);
