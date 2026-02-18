import { NextRequest } from "next/server";
import { createOctokit, analyzeCompany } from "@/lib/github";
import type { CompanyInput, ProgressEvent } from "@/lib/types";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  let body: { companies: CompanyInput[]; token: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
    });
  }

  const { companies, token } = body;

  if (!token || typeof token !== "string") {
    return new Response(JSON.stringify({ error: "GitHub token is required" }), {
      status: 400,
    });
  }

  if (!Array.isArray(companies) || companies.length === 0) {
    return new Response(
      JSON.stringify({ error: "Companies array is required" }),
      { status: 400 }
    );
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const sendEvent = async (event: ProgressEvent) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      // Client disconnected
    }
  };

  const processCompanies = async () => {
    const octokit = createOctokit(token);
    const since = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();
    const total = companies.length;
    let completed = 0;

    const BATCH_SIZE = 5;
    for (let i = 0; i < companies.length; i += BATCH_SIZE) {
      const batch = companies.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (company) => {
          await sendEvent({
            type: "progress",
            company: company.company_name,
            message: `Analyzing ${company.company_name}...`,
            completed,
            total,
          });

          const result = await analyzeCompany(
            octokit,
            company,
            since,
            (message) => {
              sendEvent({
                type: "progress",
                company: company.company_name,
                message: `[${company.company_name}] ${message}`,
                completed,
                total,
              });
            }
          );

          return result;
        })
      );

      for (const result of results) {
        completed++;
        if (result.status === "fulfilled") {
          await sendEvent({
            type: result.value.error ? "error" : "result",
            company: result.value.company_name,
            message: result.value.error
              ? `${result.value.company_name}: ${result.value.error}`
              : `${result.value.company_name}: ${result.value.most_active_repo} (${result.value.commit_count} commits)`,
            result: result.value,
            completed,
            total,
          });
        } else {
          const errorMessage =
            result.reason instanceof Error
              ? result.reason.message
              : "Unknown error";
          const companyName = batch[results.indexOf(result)]?.company_name ?? "Unknown";
          await sendEvent({
            type: "error",
            company: companyName,
            message: `${companyName}: ${errorMessage}`,
            result: {
              company_name: companyName,
              github_org_url:
                batch[results.indexOf(result)]?.github_org_url ?? "",
              most_active_repo: "N/A",
              most_active_repo_url: "N/A",
              commit_count: 0,
              top_contributor: "N/A",
              error: errorMessage,
            },
            completed,
            total,
          });
        }
      }
    }

    await sendEvent({
      type: "done",
      message: `Finished analyzing ${total} companies`,
      completed: total,
      total,
    });

    try {
      await writer.close();
    } catch {
      // Already closed
    }
  };

  processCompanies();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
