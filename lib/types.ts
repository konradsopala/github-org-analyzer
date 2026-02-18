export interface CompanyInput {
  company_name: string;
  github_org_url: string;
}

export interface RepoCommitData {
  repoName: string;
  repoUrl: string;
  commitCount: number;
}

export interface CompanyResult {
  company_name: string;
  github_org_url: string;
  most_active_repo: string;
  most_active_repo_url: string;
  commit_count: number;
  top_contributor: string;
  error?: string;
}

export type ProgressEventType = "progress" | "result" | "error" | "done";

export interface ProgressEvent {
  type: ProgressEventType;
  company?: string;
  message: string;
  result?: CompanyResult;
  completed?: number;
  total?: number;
}
