import { streamText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

type JsonObject = Record<string, unknown>;
type ChartSeries = { type?: string } & JsonObject;
type ChartOption = {
  title?: { text?: string } & JsonObject;
  series?: ChartSeries | ChartSeries[];
  legend?: unknown;
  tooltip?: unknown;
} & JsonObject;

const qwen = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  headers: {
    // OpenRouter recommended headers (optional but useful for analytics/limits)
    'HTTP-Referer': 'http://localhost:3000',
    'X-Title': 'AI Chart Agent',
  },
});

export async function POST(req: Request) {
  const { messages, currentOptionCode } = await req.json();

  const safeJsonParse = (raw: string) => {
    try {
      return { ok: true as const, value: JSON.parse(raw) };
    } catch (error) {
      return { ok: false as const, error: String(error) };
    }
  };

  const safeParseCsv = (csvText: string) => {
    const text = csvText.replace(/^\uFEFF/, '').trim();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { ok: false as const, error: 'CSV 为空' };

    const splitLine = (line: string) =>
      line
        .split(',')
        .map((s) => s.trim())
        .map((s) => s.replace(/^"(.*)"$/, '$1'));

    const header = splitLine(lines[0]);
    if (header.length === 0) return { ok: false as const, error: 'CSV 头部为空' };
    const rows = lines.slice(1).map(splitLine);

    const records = rows.map((cols) => {
      const rec: Record<string, string> = {};
      for (let i = 0; i < header.length; i += 1) {
        rec[header[i]] = cols[i] ?? '';
      }
      return rec;
    });

    return { ok: true as const, header, rows: records };
  };

  const safeEvalOption = (optionCode: string) => {
    try {
      // Run in server to validate syntax and obvious structure only.
      // Note: This is still code execution. Keep it minimal and do not pass untrusted code to other systems.
      const option = new Function(`return (${optionCode})`)();
      return { ok: true as const, option };
    } catch (error) {
      return { ok: false as const, error: String(error) };
    }
  };

  const stripCodeFromExplanation = (text: string) => {
    // Best-effort cleanup if model still includes option/code blocks inside explanation.
    return String(text || '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/ECharts\s*option[\s\S]*$/i, '')
      .trim();
  };

  const result = await streamText({
    model: qwen('openai/gpt-oss-120b:free'),
    messages,
    system:
      [
        '你是一个专业的数据可视化与前端图表 Agent（ECharts）。你需要理解用户需求，并通过工具输出可渲染的图表配置。',
        '',
        '# 行为准则',
        '- 当用户要“新画一张图”时：调用 `render_chart`。',
        '- 当用户要“修改上一张图”（例如：换图类型、改配色、改标题、加标注/平均线/缩放等）时：调用 `update_chart`，并且必须基于上一张图的 option 做最小必要改动。',
        '- 只要系统已提供当前图的 `currentOptionCode`，默认把用户后续需求理解为“继续修改当前图”，不要重新生成一张新图。',
        '- 只有当用户明确表达“新生成一张 / 再来一张 / 保留当前图再画一张 / 做对比”时，才调用 `render_chart` 生成新的图。',
        '- 如果用户提供 CSV/表格数据：优先调用 `read_csv_data` 解析，再根据解析结果调用 `recommend_chart_type` 和 `render_chart`。',
        '- 如果用户提到“从接口/URL取数据”：先调用 `fetch_api_data` 获取 JSON，再基于数据生成图。',
        '- 在产出 option 前后可以调用 `validate_option`，如有错误再调用 `repair_option`。',
        '- 若信息不足以生成/修改（缺少维度、指标、时间范围等），先用自然语言提出最多 3 个澄清问题，不要调用工具。',
        '',
        '# 输出约束（重要）',
        '- `optionCode` 必须是一个合法的“JS 对象代码字符串”（不是 JSON），允许包含函数（formatter 等）。',
        '- 严禁输出 Markdown 代码块、解释性大段文本到 `optionCode` 内。',
        '- `explanation` 只能写图表说明、结论或改动摘要，不要重复粘贴 `optionCode`，不要包含代码块，不要出现 “ECharts option” 章节。',
        '- 能复用上一版 option 的字段就复用，不要随意更换数据结构。',
        currentOptionCode
          ? `- 当前图的 currentOptionCode 如下，请优先基于它进行 update_chart 修改：\n${currentOptionCode}`
          : '- 当前没有历史图表配置；如果用户要求作图，请新生成一张图。',
      ].join('\n'),
    tools: {
      fetch_api_data: tool({
        description: '从 HTTP API 获取 JSON 数据（GET/POST），用于图表生成前取数。',
        parameters: z.object({
          url: z.string().describe('请求 URL（必须是 https 或 localhost）'),
          method: z.enum(['GET', 'POST']).default('GET').describe('HTTP 方法'),
          headersJson: z.string().optional().describe('可选：请求 headers 的 JSON 字符串'),
          bodyJson: z.string().optional().describe('可选：POST body 的 JSON 字符串'),
        }),
        execute: async ({
          url,
          method,
          headersJson,
          bodyJson,
        }: {
          url: string;
          method: 'GET' | 'POST';
          headersJson?: string;
          bodyJson?: string;
        }) => {
          const safeUrl = String(url);
          if (!/^https:\/\//.test(safeUrl) && !/^http:\/\/localhost(?::\d+)?\//.test(safeUrl)) {
            return { success: false, error: 'URL 仅允许 https 或 localhost（开发期限制）' };
          }
          const headers: Record<string, string> = {};
          if (headersJson) {
            const parsed = safeJsonParse(headersJson);
            if (parsed.ok && parsed.value && typeof parsed.value === 'object') {
              Object.assign(headers, parsed.value as Record<string, string>);
            }
          }
          let body: string | undefined;
          if (method === 'POST' && bodyJson) {
            const parsed = safeJsonParse(bodyJson);
            if (!parsed.ok) return { success: false, error: `bodyJson 不是合法 JSON：${parsed.error}` };
            body = JSON.stringify(parsed.value);
            headers['content-type'] = headers['content-type'] || 'application/json';
          }
          const res = await fetch(safeUrl, { method, headers, body, cache: 'no-store' });
          const text = await res.text();
          if (!res.ok) return { success: false, status: res.status, error: text.slice(0, 2000) };
          const parsed = safeJsonParse(text);
          return parsed.ok ? { success: true, data: parsed.value } : { success: true, dataText: text };
        },
      }),

      read_csv_data: tool({
        description: '解析用户提供的 CSV 文本为结构化数据（列名+行记录）。',
        parameters: z.object({
          csvText: z.string().describe('CSV 原始文本（第一行必须是表头）'),
        }),
        execute: async ({ csvText }: { csvText: string }) => {
          const parsed = safeParseCsv(csvText);
          if (!parsed.ok) return { success: false, error: parsed.error };
          return { success: true, columns: parsed.header, rows: parsed.rows };
        },
      }),

      recommend_chart_type: tool({
        description: '根据用户意图和数据概览推荐图表类型与字段映射。',
        parameters: z.object({
          userIntent: z.string().describe('用户需求/问题'),
          columns: z.array(z.string()).optional().describe('可选：数据列名'),
          sampleRowsJson: z.string().optional().describe('可选：样例行数组 JSON 字符串（最多 5 行）'),
        }),
        execute: async ({
          userIntent,
          columns,
          sampleRowsJson,
        }: {
          userIntent: string;
          columns?: string[];
          sampleRowsJson?: string;
        }) => {
          // This tool is intentionally deterministic: it returns a compact recommendation scaffold.
          // The LLM can call it to obtain a stable "plan" object to follow.
          let sampleRows: unknown = undefined;
          if (sampleRowsJson) {
            const parsed = safeJsonParse(sampleRowsJson);
            if (parsed.ok) sampleRows = parsed.value;
          }
          return {
            success: true,
            recommendation: {
              chartTypeCandidates: ['line', 'bar', 'pie', 'scatter'],
              hint: '优先选择能表达趋势/对比/占比的类型；若是时间序列偏 line，分类对比偏 bar，占比偏 pie。',
              userIntent,
              columns: columns ?? null,
              sampleRows: sampleRows ?? null,
            },
          };
        },
      }),

      analyze_chart: tool({
        description: '基于图表 option 总结趋势/对比/异常点（不输出代码）。',
        parameters: z.object({
          optionCode: z.string().describe('ECharts option（JS 对象代码字符串）'),
        }),
        execute: async ({ optionCode }: { optionCode: string }) => {
          // Keep analysis shallow and safe on server; the model will produce the narrative.
          const parsed = safeEvalOption(optionCode);
          if (!parsed.ok) return { success: false, error: parsed.error };
          const option = parsed.option as ChartOption;
          const series = Array.isArray(option?.series) ? option.series : option?.series ? [option.series] : [];
          return {
            success: true,
            summary: {
              title: option?.title?.text ?? null,
              seriesCount: series.length,
              seriesTypes: series.map((s) => s?.type).filter(Boolean),
              hasLegend: !!option?.legend,
              hasTooltip: !!option?.tooltip,
            },
          };
        },
      }),

      validate_option: tool({
        description: '校验 optionCode 是否是可执行的 JS 对象，并做一些基础结构检查。',
        parameters: z.object({
          optionCode: z.string().describe('ECharts option（JS 对象代码字符串）'),
        }),
        execute: async ({ optionCode }: { optionCode: string }) => {
          const parsed = safeEvalOption(optionCode);
          if (!parsed.ok) return { success: false, ok: false, errors: [parsed.error] };
          const option = parsed.option as ChartOption;
          const errors: string[] = [];
          if (!option || typeof option !== 'object') errors.push('option 不是对象');
          const hasSeries = !!option?.series;
          if (!hasSeries) errors.push('option.series 缺失');
          return { success: true, ok: errors.length === 0, errors };
        },
      }),

      repair_option: tool({
        description: '对明显错误的 optionCode 做保守修复（仅做语法/结构兜底，不做复杂重写）。',
        parameters: z.object({
          optionCode: z.string().describe('待修复的 optionCode'),
          errors: z.array(z.string()).optional().describe('validate_option 返回的 errors'),
        }),
        execute: async ({ optionCode, errors }: { optionCode: string; errors?: string[] }) => {
          // Conservative: if evaluation fails, return minimal empty option.
          const parsed = safeEvalOption(optionCode);
          if (parsed.ok) return { success: true, optionCode };
          const safeFallback = '{ series: [] }';
          return { success: true, optionCode: safeFallback, note: `已回退为安全配置；原错误：${parsed.error}; hints=${(errors || []).join(';')}` };
        },
      }),

      render_chart: tool({
        description: '当用户需要生成、修改或查看图表时，调用此工具。',
        parameters: z.object({
          chartType: z.string().describe('图表类型，例如 bar, line, pie, scatter 等'),
          optionCode: z
            .string()
            .describe(
              '完整的 ECharts option 配置对象代码，必须是一个合法的 JS 对象字符串，不要带上 const option = 这种赋值语句，直接返回对象',
            ),
          explanation: z
            .string()
            .describe('只输出图表说明/结论，不要重复 optionCode，不要包含代码块、Markdown 标题或 “ECharts option” 内容'),
        }),
        execute: async ({
          chartType,
          optionCode,
          explanation,
        }: {
          chartType: string;
          optionCode: string;
          explanation: string;
        }) => {
          return { success: true, chartType, optionCode, explanation: stripCodeFromExplanation(explanation) };
        },
      }),
      update_chart: tool({
        description: '当用户需要基于上一张图继续修改时，调用此工具（必须最小改动）。',
        parameters: z.object({
          instruction: z.string().describe('用户对“上一张图”的修改指令'),
          previousOptionCode: z
            .string()
            .describe('上一张图的 ECharts option（JS 对象代码字符串），从对话上下文中提取'),
          chartType: z.string().describe('修改后的图表类型（若不变则填原类型）'),
          optionCode: z
            .string()
            .describe(
              '修改后的完整 ECharts option（JS 对象代码字符串），必须基于 previousOptionCode 做最小必要改动',
            ),
          explanation: z
            .string()
            .describe('只说明做了哪些修改以及图表达什么；不要重复 optionCode，不要输出代码块或 “ECharts option” 内容'),
        }),
        execute: async ({
          chartType,
          optionCode,
          explanation,
        }: {
          chartType: string;
          optionCode: string;
          explanation: string;
        }) => {
          return { success: true, chartType, optionCode, explanation: stripCodeFromExplanation(explanation) };
        },
      }),
      summarize_chart_state: tool({
        description: '总结当前图表 option 的关键信息（类型、维度、指标、交互等）。',
        parameters: z.object({
          optionCode: z.string().describe('当前 ECharts option（JS 对象代码字符串）'),
        }),
        execute: async ({ optionCode }: { optionCode: string }) => {
          return { success: true, optionCode };
        },
      }),
    },
    maxSteps: 5,
  });
  return result.toDataStreamResponse();
}
