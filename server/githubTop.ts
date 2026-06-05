import crypto from "node:crypto";
import { config } from "./config";
import type { GeneratedPost } from "./types";

type GitHubRepo = {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics?: string[];
  created_at: string;
  updated_at: string;
  owner?: { login?: string };
};

export type GitHubTopRepo = {
  name: string;
  owner: string;
  url: string;
  description: string;
  stars: number;
  forks: number;
  openIssues: number;
  language: string;
  topics: string[];
  createdAt: string;
  updatedAt: string;
  problemSolved: string;
  whyTop: string;
};

function isoDateDaysAgo(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function inferProblemSolved(repo: GitHubRepo): string {
  const text = [repo.description, repo.full_name, ...(repo.topics ?? [])].filter(Boolean).join(" ").toLowerCase();
  if (/agent|workflow|automation|orchestrat/.test(text)) return "Automates developer or AI-agent workflows so teams can move repetitive work out of manual loops.";
  if (/llm|ai|model|rag|inference|prompt/.test(text)) return "Helps developers build, run, or evaluate AI systems with less infrastructure glue.";
  if (/ui|component|design|css|tailwind|react|vue/.test(text)) return "Speeds up product UI work by giving teams reusable interface building blocks or tooling.";
  if (/database|postgres|sql|vector|storage|cache/.test(text)) return "Solves data storage, retrieval, or performance problems that usually slow application backends.";
  if (/security|auth|secret|scan|vulnerab/.test(text)) return "Improves software security by reducing exposure, access, or vulnerability risks.";
  if (/cli|terminal|shell|devtool|debug/.test(text)) return "Makes developer operations faster from the command line or local development environment.";
  return repo.description?.trim() || "Addresses a developer workflow problem that attracted unusually high GitHub attention.";
}

function whyRepoIsTop(repo: GitHubRepo): string {
  const parts = [
    `${repo.stargazers_count.toLocaleString()} stars`,
    `${repo.forks_count.toLocaleString()} forks`,
  ];
  if (repo.language) parts.push(`${repo.language} codebase`);
  const topics = (repo.topics ?? []).slice(0, 4);
  return `It ranked near the top of new GitHub repositories because it combined ${parts.join(", ")}${topics.length ? ` and strong topic signals around ${topics.join(", ")}` : ""}.`;
}

function normalizeRepo(repo: GitHubRepo): GitHubTopRepo {
  const [owner, name] = repo.full_name.split("/");
  return {
    name: name || repo.full_name,
    owner: repo.owner?.login || owner || "GitHub",
    url: repo.html_url,
    description: repo.description?.trim() || "No public description provided.",
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    openIssues: repo.open_issues_count,
    language: repo.language || "Unknown",
    topics: (repo.topics ?? []).slice(0, 8),
    createdAt: repo.created_at,
    updatedAt: repo.updated_at,
    problemSolved: inferProblemSolved(repo),
    whyTop: whyRepoIsTop(repo),
  };
}

export async function fetchGitHubTopRepos(limit = 5): Promise<GitHubTopRepo[]> {
  const createdAfter = isoDateDaysAgo(7);
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `created:>${createdAfter} stars:>25`);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(Math.min(Math.max(limit, 1), 10)));

  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": `TimesOfSFBot/1.1 (+${config.appUrl})`,
    "x-github-api-version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN?.trim()) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN.trim()}`;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(config.sourceTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`GitHub top repos fetch failed: ${response.status}`);
  }

  const data = (await response.json()) as { items?: GitHubRepo[] };
  return (data.items ?? []).slice(0, limit).map(normalizeRepo);
}

export function buildGitHubTopPost(repos: GitHubTopRepo[]): GeneratedPost {
  const dayStamp = new Date().toISOString().slice(0, 10);
  const headline = `GitHub Top 5 — ${dayStamp}`;
  const slug = `github-top-${dayStamp}-${crypto.randomUUID().slice(0, 8)}`;
  const bodyMarkdown = [
    "### Why these repos are moving",
    "",
    "Times of SF tracks fast-rising public GitHub repositories as an early signal for developer demand, AI tooling shifts, and infrastructure pain points.",
    "",
    "### Today’s top five",
    "",
    ...repos.flatMap((repo, index) => [
      `#### ${index + 1}. [${repo.owner}/${repo.name}](${repo.url})`,
      `- **What it is:** ${repo.description}`,
      `- **Problem it solves:** ${repo.problemSolved}`,
      `- **Why it is top:** ${repo.whyTop}`,
      `- **Signals:** ${repo.stars.toLocaleString()} stars, ${repo.forks.toLocaleString()} forks, ${repo.openIssues.toLocaleString()} open issues, primary language ${repo.language}.`,
      repo.topics.length ? `- **Topics:** ${repo.topics.join(", ")}` : "",
      "",
    ].filter(Boolean)),
    "### Source notes",
    "Rankings use GitHub’s public repository search API for recently created repositories sorted by stars. Stars are attention signals, not endorsements or security reviews.",
  ].join("\n");

  return {
    headline,
    slug,
    dek: "A daily look at five fast-rising GitHub repositories, what they do, and why developers are paying attention.",
    bodyMarkdown,
    shortPost: `Today’s GitHub Top 5 highlights ${repos.map((repo) => `${repo.owner}/${repo.name}`).join(", ")}.`,
    topic: headline,
    editorialCategory: "GitHub Top",
    credits: repos.map((repo) => ({
      sourceName: "GitHub",
      articleUrl: repo.url,
      factBullets: [
        `${repo.owner}/${repo.name} has ${repo.stars.toLocaleString()} stars and ${repo.forks.toLocaleString()} forks.`,
        `Primary language: ${repo.language}.`,
      ],
      sourceType: "data_source",
      confidence: "high" as const,
    })),
    citations: repos.map((repo) => ({
      claim: `${repo.owner}/${repo.name} is one of today’s top GitHub repositories in this digest.`,
      sourceName: "GitHub",
      sourceUrl: repo.url,
      quoteOrFact: `${repo.stars.toLocaleString()} stars; ${repo.forks.toLocaleString()} forks; language ${repo.language}.`,
    })),
    sourceUrls: repos.map((repo) => repo.url),
    tldr: {
      whyItMatters: "Fast-rising repositories are early signals of developer demand and tooling gaps.",
      whoIsAffected: "Engineers, founders, investors, and technical teams tracking emerging open-source infrastructure.",
      whatIsNext: "Watch whether stars convert into sustained commits, adoption, releases, and community maintenance.",
    },
    entities: repos.map((repo) => ({
      name: `${repo.owner}/${repo.name}`,
      definition: repo.description,
    })),
    dataBlocks: [
      {
        type: "bar",
        title: "GitHub stars by repository",
        xAxisLabel: "Repository",
        yAxisLabel: "Stars",
        data: repos.map((repo) => ({ label: `${repo.owner}/${repo.name}`, value: repo.stars })),
      },
    ],
  };
}
