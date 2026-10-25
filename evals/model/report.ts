export type RowStatus = "pass" | "fail" | "skipped";

export type Row = {
  tool: string;
  scenario: string;
  repeat: number;
  status: RowStatus;
  matched: number;
  required: number;
  ms: number;
  reason: string;
};

export type Rate = { passed: number; ran: number; skipped: number };

export type Report = {
  schema: 1;
  date: string;
  rows: Row[];
  rate: Record<string, Rate>;
};

// A skipped row did not run, so it counts toward `skipped` and never toward `ran`.
export function buildReport(rows: Row[], date: string): Report {
  const rate: Record<string, Rate> = {};
  for (const row of rows) {
    const entry = (rate[row.tool] ??= { passed: 0, ran: 0, skipped: 0 });
    if (row.status === "skipped") entry.skipped += 1;
    else {
      entry.ran += 1;
      if (row.status === "pass") entry.passed += 1;
    }
  }
  return { schema: 1, date, rows, rate };
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function toMarkdown(report: Report): string {
  const lines = [
    `# Model eval ${report.date}`,
    "",
    "| Tool | Scenario | Run | Status | Matched | Seconds | Reason |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of report.rows) {
    lines.push(
      `| ${row.tool} | ${row.scenario} | ${row.repeat} | ${row.status} | ${row.matched}/${row.required} | ${
        (row.ms / 1000).toFixed(1)
      } | ${cell(row.reason)} |`,
    );
  }
  lines.push("");
  for (const [tool, rate] of Object.entries(report.rate)) {
    const share = rate.ran === 0 ? "n/a" : `${Math.round((rate.passed / rate.ran) * 100)}%`;
    lines.push(
      `- ${tool}: ${rate.passed}/${rate.ran} scenarios passed (${share}), ${rate.skipped} skipped`,
    );
  }
  return `${lines.join("\n")}\n`;
}
