import { extractSource } from "../server/extractor";

async function test() {
  console.log("🚀 Testing news-please extraction via Python bridge...");
  
  const testUrl = "https://techcrunch.com/2026/05/05/altara-secures-7m-to-bridge-the-data-gap-thats-slowing-down-physical-sciences/";
  
  try {
    const result = await extractSource({
      sourceName: "TechCrunch",
      articleUrl: testUrl,
      headline: "Altara secures $7M to bridge the data gap",
      publishedAt: "2026-05-05",
      summary: "Initial summary"
    });
    
    console.log("\n✅ Extraction Successful!");
    console.log("-----------------------------------");
    console.log(`Headline: ${result.headline}`);
    console.log(`Image:    ${result.imageUrl}`);
    console.log(`Date:     ${result.publishedAt}`);
    console.log(`Text:     ${result.textExcerpt.slice(0, 200)}...`);
    console.log("-----------------------------------");
    console.log("Facts Extracted:");
    result.facts.forEach((f, i) => console.log(`${i+1}. ${f}`));
    
  } catch (error) {
    console.error("\n❌ Extraction Failed!");
    console.error(error);
  }
}

test();
