import dotenv from "dotenv";
dotenv.config();

async function testExpand() {
  const prompt = "Expand this story about SF tech.";
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
  console.log("Status:", response.status);
  console.log("Response:", JSON.stringify(data, null, 2));
}

testExpand().catch(console.error);
