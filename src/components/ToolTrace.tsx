import type { Message } from 'ai/react';
import { CheckCircleOutlined, LoadingOutlined } from '@ant-design/icons';

type ToolInvocation = NonNullable<Message['toolInvocations']>[number];

type Props = {
  message: Message;
};

export const TOOL_LABEL: Record<string, string> = {
  read_csv_data: '解析 CSV',
  fetch_api_data: '请求数据',
  recommend_chart_type: '推荐图表',
  validate_option: '校验配置',
  repair_option: '修复配置',
  analyze_chart: '分析图表',
  render_chart: '生成图表',
  update_chart: '修改图表',
  summarize_chart_state: '总结状态',
};

const TOOL_ORDER = [
  'read_csv_data',
  'fetch_api_data',
  'recommend_chart_type',
  'render_chart',
  'update_chart',
  'validate_option',
  'repair_option',
  'analyze_chart',
  'summarize_chart_state',
];

function isDone(inv: ToolInvocation) {
  // Some versions represent the completed state via `state === 'result'`,
  // others may attach `result` while keeping state-like fields.
  return inv.state === 'result' || (inv as unknown as { result?: unknown }).result != null;
}

function stableKey(inv: ToolInvocation) {
  return inv.toolCallId ?? `${inv.toolName}:${JSON.stringify(inv.args ?? {})}`;
}

export function ToolTracePending({
  toolNames,
  doneToolNames,
}: {
  toolNames: string[];
  doneToolNames?: Record<string, boolean>;
}) {
  const names = toolNames.filter((n) => TOOL_LABEL[n]);
  if (names.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {names.map((toolName) => (
        <span
          key={`pending:${toolName}`}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${
            doneToolNames?.[toolName]
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-blue-100 bg-blue-50 text-blue-700'
          }`}
          title={toolName}
        >
          {doneToolNames?.[toolName] ? <CheckCircleOutlined /> : <LoadingOutlined />}
          {TOOL_LABEL[toolName] ?? toolName}
        </span>
      ))}
    </div>
  );
}

export default function ToolTrace({ message }: Props) {
  // Do NOT memoize based on `message.toolInvocations` reference:
  // some SDK implementations update invocation state in-place, and the array reference may remain stable.
  // We want the UI to immediately reflect `loading -> done`.
  const inv = message.toolInvocations ?? [];
  const steps = inv.filter((x: ToolInvocation) => TOOL_LABEL[x.toolName]);

  // Sort to make the trace look intentional, but keep stable order among same tool.
  steps.sort((a: ToolInvocation, b: ToolInvocation) => {
    const ia = TOOL_ORDER.indexOf(a.toolName);
    const ib = TOOL_ORDER.indexOf(b.toolName);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  if (steps.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {steps.map((inv: ToolInvocation) => {
        const done = isDone(inv);
        const label = TOOL_LABEL[inv.toolName] ?? inv.toolName;
        return (
          <span
            key={stableKey(inv)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${
              done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-blue-100 bg-blue-50 text-blue-700'
            }`}
            title={inv.toolName}
          >
            {done ? <CheckCircleOutlined /> : <LoadingOutlined />}
            {label}
          </span>
        );
      })}
    </div>
  );
}
