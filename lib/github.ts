import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import type { CompanyInput, CompanyResult, RepoCommitData } from "./types";

const ThrottledOctokit = Octokit.plugin(throttling);

export function extractOrgName(url: string): string | null {
  try {
    const cleaned = url.trim().replace(/\/+$/, "");
    const urlObj = new URL(
      cleaned.startsWith("http") ? cleaned : `https://${cleaned}`
    );
    if (!urlObj.hostname.includes("github.com")) return null;
    const parts = urlObj.pathname.split("/").filter(Boolean);
    return parts[0] || null;
  } catch {
    return null;
  }
}

export function createOctokit(token: string) {
  return new ThrottledOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(
          `Rate limit hit for ${options.method} ${options.url}`
        );
        if (retryCount < 2) {
          octokit.log.info(`Retrying after ${retryAfter} seconds`);
          return true;
        }
      },
      onSecondaryRateLimit: (retryAfter, options, octokit, retryCount) => {
        octokit.log.warn(
          `Secondary rate limit hit for ${options.method} ${options.url}`
        );
        if (retryCount < 1) {
          octokit.log.info(`Retrying after ${retryAfter} seconds`);
          return true;
        }
      },
    },
  });
}

type OctokitInstance = ReturnType<typeof createOctokit>;

interface RepoListItem {
  name: string;
  html_url: string;
  fork: boolean;
}

export async function listOrgRepos(
  octokit: OctokitInstance,
  orgName: string
): Promise<RepoListItem[]> {
  try {
    const { data } = await octokit.repos.listForOrg({
      org: orgName,
      sort: "pushed",
      direction: "desc",
      per_page: 30,
      type: "sources",
    });
    return data.map((r) => ({
      name: r.name,
      html_url: r.html_url,
      fork: r.fork,
    }));
  } catch (err: unknown) {
    const error = err as { status?: number };
    if (error.status === 404) {
      const { data } = await octokit.repos.listForUser({
        username: orgName,
        sort: "pushed",
        direction: "desc",
        per_page: 30,
        type: "owner",
      });
      return data
        .filter((r) => !r.fork)
        .map((r) => ({
          name: r.name,
          html_url: r.html_url,
          fork: r.fork,
        }));
    }
    throw err;
  }
}

export async function getRepoCommitCount(
  octokit: OctokitInstance,
  owner: string,
  repo: string,
  since: string
): Promise<number> {
  const MAX_COMMITS = 500;
  let count = 0;
  let page = 1;

  while (count < MAX_COMMITS) {
    const { data } = await octokit.repos.listCommits({
      owner,
      repo,
      since,
      per_page: 100,
      page,
    });

    if (data.length === 0) break;
    count += data.length;
    if (data.length < 100) break;
    page++;
  }

  return Math.min(count, MAX_COMMITS);
}

export async function getTopContributor(
  octokit: OctokitInstance,
  owner: string,
  repo: string,
  since: string
): Promise<string> {
  const authorCounts = new Map<string, number>();
  let page = 1;
  const MAX_PAGES = 5;

  while (page <= MAX_PAGES) {
    const { data } = await octokit.repos.listCommits({
      owner,
      repo,
      since,
      per_page: 100,
      page,
    });

    if (data.length === 0) break;

    for (const commit of data) {
      const login =
        commit.author?.login || commit.commit?.author?.name || "unknown";
      authorCounts.set(login, (authorCounts.get(login) || 0) + 1);
    }

    if (data.length < 100) break;
    page++;
  }

  if (authorCounts.size === 0) return "N/A";

  let topAuthor = "N/A";
  let topCount = 0;
  for (const [author, count] of authorCounts) {
    if (count > topCount) {
      topCount = count;
      topAuthor = author;
    }
  }

  return topAuthor;
}

export async function analyzeCompany(
  octokit: OctokitInstance,
  company: CompanyInput,
  since: string,
  onProgress?: (message: string) => void
): Promise<CompanyResult> {
  const orgName = extractOrgName(company.github_org_url);
  if (!orgName) {
    return {
      company_name: company.company_name,
      github_org_url: company.github_org_url,
      most_active_repo: "N/A",
      most_active_repo_url: "N/A",
      commit_count: 0,
      top_contributor: "N/A",
      error: "Invalid GitHub URL",
    };
  }

  onProgress?.(`Fetching repos for ${orgName}...`);

  const repos = await listOrgRepos(octokit, orgName);
  if (repos.length === 0) {
    return {
      company_name: company.company_name,
      github_org_url: company.github_org_url,
      most_active_repo: "N/A",
      most_active_repo_url: "N/A",
      commit_count: 0,
      top_contributor: "N/A",
      error: "No repos found",
    };
  }

  onProgress?.(
    `Found ${repos.length} repos for ${orgName}, counting commits...`
  );

  const repoResults: RepoCommitData[] = await Promise.all(
    repos.map(async (repo) => {
      try {
        const commitCount = await getRepoCommitCount(
          octokit,
          orgName,
          repo.name,
          since
        );
        return {
          repoName: repo.name,
          repoUrl: repo.html_url,
          commitCount,
        };
      } catch {
        return { repoName: repo.name, repoUrl: repo.html_url, commitCount: 0 };
      }
    })
  );

  const mostActive = repoResults.reduce((best, current) =>
    current.commitCount > best.commitCount ? current : best
  );

  if (mostActive.commitCount === 0) {
    return {
      company_name: company.company_name,
      github_org_url: company.github_org_url,
      most_active_repo: "N/A",
      most_active_repo_url: "N/A",
      commit_count: 0,
      top_contributor: "N/A",
    };
  }

  onProgress?.(
    `Most active: ${mostActive.repoName} (${mostActive.commitCount} commits). Finding top contributor...`
  );

  const topContributor = await getTopContributor(
    octokit,
    orgName,
    mostActive.repoName,
    since
  );

  return {
    company_name: company.company_name,
    github_org_url: company.github_org_url,
    most_active_repo: mostActive.repoName,
    most_active_repo_url: mostActive.repoUrl,
    commit_count: mostActive.commitCount,
    top_contributor: topContributor,
  };
}
