import dotenv from "dotenv";
dotenv.config();

const models = [
  "accounts/fireworks/models/llama-v3p1-8b-instruct",
  "accounts/fireworks/models/llama-v3p1-70b-instruct",
  "accounts/fireworks/models/llama-v3-8b-instruct",
  "accounts/fireworks/models/mixtral-8x7b-instruct",
  "accounts/fireworks/models/deepseek-v3"
];

async function testModel(model: string) {
  console.log(`Testing ${model}...`);
  try {
    const res = await fetch("https://api.fireworks.ai/inference/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.FIREWORKS_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5
      })
    });
    const data = await res.json();
    if (res.ok) {
      console.log(`✅ ${model} works!`);
      return true;
    } else {
      console.log(`❌ ${model} failed:`, data.error?.message || "Unknown error");
      return false;
    }
  } catch (err) {
    console.log(`❌ ${model} error:`, err);
    return false;
  }
}

async function run() {
  for (const m of models) {
    if (await testModel(m)) {
      console.log(`\nFound working model: ${m}`);
      process.exit(0);
    }
  }
  process.exit(1);
}

run();
