import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { TOOL_LABEL } from './ToolTrace';

export type AgentProcessEvent =
  | { kind: 'agent-process'; type: 'thought'; text: string; ts?: number }
  | { kind: 'agent-process'; type: 'tool_start'; tool: string; label?: string; ts?: number }
  | { kind: 'agent-process'; type: 'tool_done'; tool: string; label?: string; summary?: string; ts?: number }
  | { kind: 'agent-process'; type: 'tool_error'; tool: string; label?: string; error?: string; ts?: number };

type Props = {
  events: AgentProcessEvent[];
};

type ToolState = {
  tool: string;
  label: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
};

export default function ProcessPanel({ events }: Props) {
  if (events.length === 0) return null;

  const uniqueEvents: AgentProcessEvent[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    const key =
      event.type === 'thought'
        ? `thought:${event.text}`
        : event.type === 'tool_start'
          ? `tool_start:${event.tool}`
          : event.type === 'tool_done'
            ? `tool_done:${event.tool}:${event.summary ?? ''}`
            : `tool_error:${event.tool}:${event.error ?? ''}`;

    if (seen.has(key)) continue;
    seen.add(key);
    uniqueEvents.push(event);
  }

  const thoughts = uniqueEvents.filter((e) => e.type === 'thought');
  const toolMap = new Map<string, ToolState>();

  for (const event of uniqueEvents) {
    if (event.type === 'tool_start') {
      toolMap.set(event.tool, {
        tool: event.tool,
        label: event.label || TOOL_LABEL[event.tool] || event.tool,
        status: 'running',
      });
    }
    if (event.type === 'tool_done') {
      toolMap.set(event.tool, {
        tool: event.tool,
        label: event.label || TOOL_LABEL[event.tool] || event.tool,
        status: 'done',
        summary: event.summary,
      });
    }
    if (event.type === 'tool_error') {
      toolMap.set(event.tool, {
        tool: event.tool,
        label: event.label || TOOL_LABEL[event.tool] || event.tool,
        status: 'error',
        summary: event.error,
      });
    }
  }

  const steps = Array.from(toolMap.values());

  return (
    <div className="mb-2 w-full max-w-[80%] rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
      {thoughts.length > 0 ? (
        <details open className="mb-3">
          <summary className="cursor-pointer select-none font-medium text-gray-800">
            {steps.some((s) => s.status === 'running') ? '思考中...' : '已完成思考'}
          </summary>
          <div className="mt-2 space-y-1 text-gray-600">
            {thoughts.map((event, index) => (
              <div key={`${event.type}:${index}`}>{event.text}</div>
            ))}
          </div>
        </details>
      ) : null}

      {steps.length > 0 ? (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{steps.length} actions taken</div>
          <div className="space-y-2">
            {steps.map((step) => (
              <div key={step.tool} className="rounded-md border border-gray-200 bg-white px-3 py-2">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                  {step.status === 'done' ? (
                    <CheckCircleOutlined className="text-emerald-600" />
                  ) : step.status === 'error' ? (
                    <CloseCircleOutlined className="text-red-600" />
                  ) : (
                    <LoadingOutlined className="text-blue-600" />
                  )}
                  <span>{step.label}</span>
                </div>
                {step.summary ? <div className="mt-1 text-xs text-gray-500">{step.summary}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
