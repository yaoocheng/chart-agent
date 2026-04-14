import { streamText, tool } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

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
        execute: async ({ chartType, optionCode, explanation }, _options) => {
          return { success: true, chartType, optionCode, explanation };
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
        execute: async ({ chartType, optionCode, explanation }, _options) => {
          return { success: true, chartType, optionCode, explanation };
        },
      }),
      summarize_chart_state: tool({
        description: '总结当前图表 option 的关键信息（类型、维度、指标、交互等）。',
        parameters: z.object({
          optionCode: z.string().describe('当前 ECharts option（JS 对象代码字符串）'),
        }),
        execute: async ({ optionCode }, _options) => {
          return { success: true, optionCode };
        },
      }),
    },
    maxSteps: 5,
  });
  return result.toDataStreamResponse();
}
