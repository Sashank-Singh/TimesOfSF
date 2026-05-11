/**
 * Plain-English fallback definitions for frequent acronyms / niche terms.
 * Used only when the article's own `entities[]` does not provide a definition.
 * Keep definitions short, neutral, and reader-friendly (avoid jargon).
 */
const GLOSSARY: Record<string, string> = {
  uap: "Unidentified Anomalous Phenomena — the U.S. government term for what used to be called UFOs; aerial objects whose origin is not yet identified.",
  ufo: "Unidentified Flying Object — an aerial object that has not been identified; often used interchangeably with UAP.",
  ai: "Artificial Intelligence — software that can perform tasks (writing, analysis, recognition) typically associated with human reasoning.",
  llm: "Large Language Model — an AI system trained on large amounts of text to generate or analyze language (e.g. ChatGPT, Gemini).",
  gpu: "Graphics Processing Unit — specialized chips used to train and run modern AI models at scale.",
  gpus: "Graphics Processing Units — specialized chips used to train and run modern AI models at scale.",
  ipo: "Initial Public Offering — when a private company first sells shares to the public on a stock exchange.",
  spac: "Special Purpose Acquisition Company — a shell company that lists publicly to later merge with a private company, taking it public.",
  arr: "Annual Recurring Revenue — yearly subscription revenue a software business can expect to keep, used to value SaaS companies.",
  mrr: "Monthly Recurring Revenue — monthly subscription revenue a software business can expect to keep.",
  saas: "Software as a Service — software delivered over the internet on a subscription basis.",
  yc: "Y Combinator — a San Francisco startup accelerator that funds and mentors early-stage companies.",
  vc: "Venture Capital — investors who fund early-stage and growth-stage startups in exchange for equity.",
  fda: "U.S. Food and Drug Administration — federal agency that approves drugs, devices, and food products.",
  sec: "U.S. Securities and Exchange Commission — federal regulator of public companies and securities markets.",
  ftc: "U.S. Federal Trade Commission — federal antitrust and consumer protection regulator.",
  doj: "U.S. Department of Justice — federal agency that prosecutes federal crimes and brings antitrust cases.",
  ag: "Attorney General — the chief lawyer for a state or the federal government; can bring civil and criminal cases.",
  scotus: "Supreme Court of the United States — the highest U.S. court; its rulings are final and binding nationwide.",
  fed: "Federal Reserve — the U.S. central bank; it sets short-term interest rates and oversees the banking system.",
  bart: "Bay Area Rapid Transit — the San Francisco Bay Area's regional commuter rail system.",
  muni: "San Francisco Municipal Railway — the city's bus, light-rail, and cable car operator.",
  caltrain: "Caltrain — the commuter rail line connecting San Francisco to the Peninsula and San Jose.",
};

/** Return a fallback plain-English definition for `name`, or empty string when none is known. */
export function lookupGlossaryDefinition(name: string): string {
  if (!name) return "";
  const key = name.trim().toLowerCase().replace(/[.\s]+$/g, "");
  return GLOSSARY[key] ?? "";
}
