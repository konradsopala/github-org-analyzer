"use client";

import { useState, useRef, useCallback } from "react";
import Papa from "papaparse";
import type { CompanyInput, CompanyResult, ProgressEvent } from "@/lib/types";

export default function Home() {
  const [token, setToken] = useState("");
  const [companies, setCompanies] = useState<CompanyInput[]>([]);
  const [fileName, setFileName] = useState("");
  const [results, setResults] = useState<CompanyResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((message: string) => {
    setLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] ${message}`,
    ]);
    setTimeout(
      () => logEndRef.current?.scrollIntoView({ behavior: "smooth" }),
      50
    );
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const headers = result.meta.fields || [];
        const hasCompanyName = headers.some(
          (h) => h.toLowerCase().trim() === "company_name"
        );
        const hasGithubUrl = headers.some(
          (h) => h.toLowerCase().trim() === "github_org_url"
        );

        if (!hasCompanyName || !hasGithubUrl) {
          alert(
            `CSV must have "company_name" and "github_org_url" columns.\nFound columns: ${headers.join(", ")}`
          );
          setCompanies([]);
          setFileName("");
          e.target.value = "";
          return;
        }

        const parsed: CompanyInput[] = result.data
          .map((row) => {
            const normalized: Record<string, string> = {};
            for (const [key, value] of Object.entries(row)) {
              normalized[key.toLowerCase().trim()] = value;
            }
            return {
              company_name: normalized["company_name"]?.trim() || "",
              github_org_url: normalized["github_org_url"]?.trim() || "",
            };
          })
          .filter((c) => c.company_name && c.github_org_url);

        if (parsed.length === 0) {
          alert("No valid rows found in CSV.");
          setCompanies([]);
          setFileName("");
          e.target.value = "";
          return;
        }

        setCompanies(parsed);
        addLog(`Loaded ${parsed.length} companies from ${file.name}`);
      },
      error: (error) => {
        alert(`Error parsing CSV: ${error.message}`);
      },
    });
  };

  const startAnalysis = async () => {
    if (!token.trim()) {
      alert("Please enter your GitHub token.");
      return;
    }
    if (companies.length === 0) {
      alert("Please upload a CSV file first.");
      return;
    }

    setIsAnalyzing(true);
    setResults([]);
    setLogs([]);
    setProgress({ completed: 0, total: companies.length });
    addLog(`Starting analysis of ${companies.length} companies...`);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies, token: token.trim() }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const dataLine = line.trim();
          if (!dataLine.startsWith("data: ")) continue;

          try {
            const event: ProgressEvent = JSON.parse(dataLine.slice(6));

            if (event.message) addLog(event.message);

            if (event.completed !== undefined && event.total !== undefined) {
              setProgress({
                completed: event.completed,
                total: event.total,
              });
            }

            if (
              (event.type === "result" || event.type === "error") &&
              event.result
            ) {
              setResults((prev) => [...prev, event.result!]);
            }

            if (event.type === "done") {
              addLog("Analysis complete!");
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        addLog("Analysis cancelled by user.");
      } else {
        addLog(`Error: ${(err as Error).message}`);
        alert(`Analysis failed: ${(err as Error).message}`);
      }
    } finally {
      setIsAnalyzing(false);
      abortRef.current = null;
    }
  };

  const cancelAnalysis = () => {
    abortRef.current?.abort();
  };

  const downloadCsv = () => {
    if (results.length === 0) return;

    const csvData = results.map((r) => ({
      company_name: r.company_name,
      github_org_url: r.github_org_url,
      most_active_repo: r.most_active_repo,
      most_active_repo_url: r.most_active_repo_url,
      commit_count_last_30_days: r.commit_count,
      top_contributor: r.top_contributor,
      error: r.error || "",
    }));

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `github-analysis-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const progressPercent =
    progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">
            GitHub Organization Analyzer
          </h1>
          <p className="mt-2 text-gray-600">
            Upload a CSV of companies with GitHub org URLs to find each
            org&apos;s most active repo and top contributor.
          </p>
        </div>

        {/* Token Input */}
        <div className="bg-white rounded-lg shadow p-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            GitHub Personal Access Token
          </label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            disabled={isAnalyzing}
          />
          <p className="mt-1 text-xs text-gray-500">
            Sent directly to the GitHub API. Never stored on the server.
          </p>
        </div>

        {/* CSV Upload */}
        <div className="bg-white rounded-lg shadow p-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Upload Company CSV
          </label>
          <p className="text-xs text-gray-500 mb-3">
            CSV must have{" "}
            <code className="bg-gray-100 px-1 rounded">company_name</code> and{" "}
            <code className="bg-gray-100 px-1 rounded">
              github_org_url
            </code>{" "}
            columns.
          </p>
          <div className="flex items-center gap-3">
            <label className="cursor-pointer inline-flex items-center px-4 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50">
              Choose File
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
                disabled={isAnalyzing}
              />
            </label>
            {fileName && (
              <span className="text-sm text-gray-600">
                {fileName} ({companies.length} companies)
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={startAnalysis}
            disabled={isAnalyzing || companies.length === 0 || !token.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-md shadow-sm text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAnalyzing ? "Analyzing..." : "Analyze"}
          </button>
          {isAnalyzing && (
            <button
              onClick={cancelAnalysis}
              className="px-6 py-2 bg-red-600 text-white rounded-md shadow-sm text-sm font-medium hover:bg-red-700"
            >
              Cancel
            </button>
          )}
          {results.length > 0 && !isAnalyzing && (
            <button
              onClick={downloadCsv}
              className="px-6 py-2 bg-green-600 text-white rounded-md shadow-sm text-sm font-medium hover:bg-green-700"
            >
              Download CSV
            </button>
          )}
        </div>

        {/* Progress Bar */}
        {(isAnalyzing || progress.completed > 0) && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>Progress</span>
              <span>
                {progress.completed}/{progress.total} ({progressPercent}%)
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Log Output */}
        {logs.length > 0 && (
          <div className="bg-gray-900 rounded-lg shadow p-4 max-h-64 overflow-y-auto font-mono text-xs">
            {logs.map((log, i) => (
              <div
                key={i}
                className={`${
                  log.includes("Error") || log.includes("error")
                    ? "text-red-400"
                    : log.includes("complete")
                      ? "text-green-400"
                      : "text-gray-300"
                }`}
              >
                {log}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

        {/* Results Table */}
        {results.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Results</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Company
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Most Active Repo
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Commits (30d)
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Top Contributor
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {results.map((r, i) => (
                    <tr key={i} className={r.error ? "bg-red-50" : ""}>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {r.company_name}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {r.most_active_repo_url !== "N/A" ? (
                          <a
                            href={r.most_active_repo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {r.most_active_repo}
                          </a>
                        ) : (
                          <span className="text-gray-500">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {r.commit_count || "\u2014"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {r.top_contributor !== "N/A" ? (
                          <a
                            href={`https://github.com/${r.top_contributor}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {r.top_contributor}
                          </a>
                        ) : (
                          <span className="text-gray-500">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {r.error ? (
                          <span className="text-red-600">{r.error}</span>
                        ) : (
                          <span className="text-green-600">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
