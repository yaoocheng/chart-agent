'use client';

import { useChat, type Message } from 'ai/react';
import { Avatar, Button, Card, ConfigProvider, Input, Typography } from 'antd';
import { PauseCircleOutlined, SendOutlined } from '@ant-design/icons';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ShowCode from '@/components/ShowCode';
import ToolTrace, { ToolTracePending } from '@/components/ToolTrace';
import ProcessPanel, { type AgentProcessEvent } from '@/components/ProcessPanel';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

const { Text } = Typography;
const STORAGE_KEY = 'ai-chart-agent:chat-state';
type ToolInvocation = NonNullable<Message['toolInvocations']>[number];

type PersistedState = {
  messages: Message[];
  currentOptionCode: string;
};

export default function AgentPage() {
  const [hydrated, setHydrated] = useState(false);
  const [currentOptionCode, setCurrentOptionCode] = useState('');
  const [clientPending, setClientPending] = useState(false);
  const [pendingTools, setPendingTools] = useState<string[]>([]);
  const [requestStartIndex, setRequestStartIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    setMessages,
  } = useChat({
    api: '/api/chat',
    body: {
      currentOptionCode,
    },
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedState>;
        if (Array.isArray(parsed.messages)) {
          setMessages(parsed.messages);
        }
        if (typeof parsed.currentOptionCode === 'string') {
          setCurrentOptionCode(parsed.currentOptionCode);
        }
      }
    } catch {
      // Ignore invalid local state and continue with a fresh session.
    } finally {
      setHydrated(true);
    }
  }, [setMessages]);

  const latestOptionCode = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      const invocations = message.toolInvocations ?? [];
      for (let j = invocations.length - 1; j >= 0; j -= 1) {
        const toolInvocation = invocations[j];
        const isChartTool = toolInvocation.toolName === 'render_chart' || toolInvocation.toolName === 'update_chart';
        if (isChartTool && toolInvocation.state === 'result') {
          const maybeCode = toolInvocation.args?.optionCode;
          if (typeof maybeCode === 'string' && maybeCode.trim()) {
            return maybeCode;
          }
        }
      }
    }
    return '';
  }, [messages]);

  useEffect(() => {
    if (latestOptionCode && latestOptionCode !== currentOptionCode) {
      setCurrentOptionCode(latestOptionCode);
    }
  }, [currentOptionCode, latestOptionCode]);

  useEffect(() => {
    if (!hydrated) return;
    const payload: PersistedState = {
      messages: messages.slice(-20),
      currentOptionCode,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [currentOptionCode, hydrated, messages]);

  const scrollToBottom = () => {
    // Ensure DOM has painted the latest message/tool invocation before scrolling.
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    });
  };

  useEffect(() => {
    // When generating or receiving new content, keep the view pinned to the bottom.
    scrollToBottom();
  }, [isLoading, messages.length]);

  const showAgentPending = useMemo(() => {
    const last = messages[messages.length - 1];
    // Show pending as soon as user submits. Hide when the request is finished.
    return (clientPending || isLoading) && (!last || last.role === 'user');
  }, [clientPending, isLoading, messages]);

  const doneToolNames = useMemo(() => {
    const map: Record<string, boolean> = {};
    const slice = messages.slice(Math.max(0, requestStartIndex));
    for (const m of slice) {
      for (const inv of m.toolInvocations ?? []) {
        const done = inv.state === 'result' || (inv as unknown as { result?: unknown }).result != null;
        if (done) map[inv.toolName] = true;
      }
    }
    return map;
  }, [messages, requestStartIndex]);

  const toolLabel = (toolName: string) => {
    // Keep the UI Chinese-friendly.
    const map: Record<string, string> = {
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
    return map[toolName] ?? toolName;
  };

  const extractProcessEvents = (m: Message) => {
    const annotations = (m.annotations ?? []) as unknown[];
    const events: AgentProcessEvent[] = [];
    for (const a of annotations) {
      if (!a || typeof a !== 'object') continue;
      const obj = a as Record<string, unknown>;
      if (obj.kind !== 'agent-process') continue;
      const type = obj.type;
      if (type === 'thought' && typeof obj.text === 'string') {
        events.push({ kind: 'agent-process', type: 'thought', text: obj.text, ts: obj.ts as number | undefined });
      }
      if (type === 'tool_start' && typeof obj.tool === 'string') {
        events.push({
          kind: 'agent-process',
          type: 'tool_start',
          tool: obj.tool,
          label: typeof obj.label === 'string' ? obj.label : undefined,
          ts: obj.ts as number | undefined,
        });
      }
      if (type === 'tool_done' && typeof obj.tool === 'string') {
        events.push({
          kind: 'agent-process',
          type: 'tool_done',
          tool: obj.tool,
          label: typeof obj.label === 'string' ? obj.label : undefined,
          summary: typeof obj.summary === 'string' ? obj.summary : undefined,
          ts: obj.ts as number | undefined,
        });
      }
      if (type === 'tool_error' && typeof obj.tool === 'string') {
        events.push({
          kind: 'agent-process',
          type: 'tool_error',
          tool: obj.tool,
          label: typeof obj.label === 'string' ? obj.label : undefined,
          error: typeof obj.error === 'string' ? obj.error : undefined,
          ts: obj.ts as number | undefined,
        });
      }
    }
    return events;
  };

  const thinkingLabel = useMemo(() => {
    const hasAnyToolCall = Object.keys(doneToolNames).length > 0;
    return hasAnyToolCall ? '已完成思考' : '思考中';
  }, [doneToolNames]);

  const combinedTurnByAnchorId = useMemo(() => {
    const map = new Map<
      string,
      {
        invocations: ToolInvocation[];
        combinedText: string;
        chartInvocations: ToolInvocation[];
        processEvents: AgentProcessEvent[];
      }
    >();
    const suppressedAssistantIds = new Set<string>();
    const len = messages.length;
    let i = 0;

    while (i < len) {
      // Find next user message (turn boundary)
      while (i < len && messages[i].role !== 'user') i += 1;
      if (i >= len) break;

      let anchorIdx = -1;
      const invocations: ToolInvocation[] = [];
      const chartInvocations: ToolInvocation[] = [];
      const texts: string[] = [];
      const processEvents: AgentProcessEvent[] = [];

      let j = i + 1;
      while (j < len && messages[j].role !== 'user') {
        const m = messages[j];
        if (m.role === 'assistant') {
          if (anchorIdx === -1) anchorIdx = j;
          if (anchorIdx !== -1 && j !== anchorIdx) {
            suppressedAssistantIds.add(m.id);
          }

          const content = typeof m.content === 'string' ? m.content.trim() : '';
          if (content) texts.push(content);
          processEvents.push(...extractProcessEvents(m));

          for (const inv of m.toolInvocations ?? []) {
            const typed = inv as ToolInvocation;
            invocations.push(typed);
            const isChartTool = typed.toolName === 'render_chart' || typed.toolName === 'update_chart';
            if (isChartTool) chartInvocations.push(typed);
          }
        }
        j += 1;
      }

      if (anchorIdx !== -1) {
        map.set(messages[anchorIdx].id, {
          invocations,
          combinedText: texts.join('\n\n'),
          chartInvocations,
          processEvents,
        });
      }

      i = j;
    }

    return { map, suppressedAssistantIds };
  }, [messages]);

  useEffect(() => {
    if (!isLoading) {
      setClientPending(false);
      setPendingTools([]);
    }
  }, [isLoading]);

  useEffect(() => {
    // Once we got an assistant message, clear the optimistic pending indicator.
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant') setClientPending(false);
  }, [messages]);

  const inferPendingTools = (text: string) => {
    const t = String(text || '');
    const hasUrl = /https?:\/\/\S+/i.test(t);
    const hasCsvLike =
      t.includes('\n') &&
      t.split('\n').slice(0, 5).some((line) => line.includes(',') && !/https?:\/\//i.test(line));
    const isLikelyEdit =
      currentOptionCode.trim().length > 0 &&
      /(改|修改|换|变成|替换|调整|加上|增加|删除|去掉|改成|优化)/.test(t);
    const wantsAnalysis = /(分析|结论|趋势|异常|洞察)/.test(t);

    if (hasCsvLike) return ['read_csv_data', 'recommend_chart_type', 'render_chart', 'validate_option', 'analyze_chart'];
    if (hasUrl) return ['fetch_api_data', 'recommend_chart_type', 'render_chart', 'validate_option'];
    if (isLikelyEdit) return ['update_chart', 'validate_option'];
    if (wantsAnalysis && currentOptionCode.trim()) return ['analyze_chart'];
    return ['render_chart', 'validate_option'];
  };

  const onSubmit = (event?: { preventDefault?: () => void }) => {
    event?.preventDefault?.();
    setPendingTools(inferPendingTools(input));
    setRequestStartIndex(messages.length);
    setClientPending(true);
    handleSubmit(event);
  };

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 16,
          colorBgLayout: '#f5f7fa',
          colorBgContainer: '#ffffff',
          colorBorderSecondary: '#f0f0f0',
          boxShadowSecondary: '0 8px 24px rgba(31, 35, 41, 0.06)',
        },
      }}
    >
      <div className="min-h-screen bg-[#f5f7fa] p-4 text-gray-800 md:p-6">
        <div className="mx-auto flex h-[calc(100vh-32px)] max-w-5xl flex-col gap-4 md:h-[calc(100vh-48px)]">
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-slate-800">AI Chart Studio</h1>
                <p className="mt-2 text-sm text-slate-500">从一句需求到图表配置、分析结论与持续修改，都可以在这里完成。</p>
              </div>
              <div className="hidden rounded-xl bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-500 md:block">
                <div>支持生成、改图、校验、分析与本地会话记忆</div>
                <div>更适合做报表草稿、数据说明和图表调优</div>
              </div>
            </div>
          </div>

          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto rounded-2xl border border-gray-200 bg-white px-5 py-5 shadow-sm md:px-6"
          >
            <div className="space-y-5">
        {messages.map((msg: Message) => {
          const hasText = typeof msg.content === 'string' && msg.content.trim().length > 0;
          const combined = combinedTurnByAnchorId.map.get(msg.id);
          const hasAnyTool = (msg.toolInvocations ?? []).length > 0 || (combined?.invocations.length ?? 0) > 0;

          if (msg.role === 'assistant' && combinedTurnByAnchorId.suppressedAssistantIds.has(msg.id)) return null;
          if (!hasText && !hasAnyTool && !combined) return null;

          return (
            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className="mb-2 flex items-center gap-2">
                <Avatar
                  size={28}
                  className={msg.role === 'user' ? 'bg-blue-500' : 'bg-slate-800'}
                  style={{ fontSize: 12 }}
                >
                  {msg.role === 'user' ? '你' : 'AI'}
                </Avatar>
                <Text type="secondary">{msg.role === 'user' ? '你' : '图表助手'}</Text>
              </div>

              {msg.role === 'assistant' && combined ? <ProcessPanel events={combined.processEvents} /> : null}

              {msg.role === 'assistant' && combined ? (
                <ToolTrace message={{ ...msg, toolInvocations: combined.invocations } as Message} />
              ) : null}

              {msg.role === 'assistant' && combined?.combinedText ? (
                <div
                  className="p-3 mb-2 rounded-lg inline-block max-w-[80%] bg-gray-100 text-gray-800"
                >
                  <div className="max-w-none text-sm leading-7 [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-gray-900 [&_pre]:p-3 [&_pre]:text-gray-100 [&_code]:rounded [&_code]:bg-gray-200 [&_code]:px-1 [&_code]:py-0.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{combined.combinedText}</ReactMarkdown>
                  </div>
                </div>
              ) : hasText ? (
                <div
                  className={`p-3 rounded-lg inline-block max-w-[80%] ${
                    msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {msg.content}
                </div>
              ) : null}

              {(combined?.chartInvocations ?? msg.toolInvocations ?? []).map((toolInvocation: ToolInvocation) => {
                const isChartTool =
                  toolInvocation.toolName === 'render_chart' || toolInvocation.toolName === 'update_chart';
                if (!isChartTool) return null;

                if (toolInvocation.state === 'result') {
                  const { optionCode, explanation } = toolInvocation.args;
                  let option = {};
                  try {
                    // 解析大模型返回的 ECharts 纯对象代码
                    option = new Function(`return ${optionCode}`)();
                  } catch (e) {
                    console.error('Failed to parse chart config', e);
                    return <div className="text-red-500 mt-2">代码解析失败，请让 Agent 重试</div>;
                  }

                  return (
                    <Card key={toolInvocation.toolCallId} className="mt-4 w-full shadow-md max-w-[100%]">
                      <Text strong className="mb-4 block text-gray-700 text-lg">
                        {explanation}
                      </Text>
                      <ReactECharts option={option} style={{ height: '400px', width: '100%' }} />
                      <ShowCode code={String(optionCode ?? '')} />
                    </Card>
                  );
                }

                return (
                  <div
                    key={toolInvocation.toolCallId}
                    className="mt-2 inline-flex items-center justify-center rounded-full border border-blue-100 bg-blue-50 p-2 text-blue-600 animate-pulse"
                    aria-label="正在生成中"
                  >
                    <PauseCircleOutlined style={{ fontSize: 20 }} />
                  </div>
                );
              })}
            </div>
          );
        })}

            {showAgentPending ? (
              <div className="flex flex-col items-start">
                <div className="mb-2 flex items-center gap-2">
                  <Avatar size={28} className="bg-slate-800" style={{ fontSize: 12 }}>
                    AI
                  </Avatar>
                  <Text type="secondary">图表助手</Text>
                </div>
                <details className="mb-2 w-full max-w-[80%] rounded-xl border border-gray-200 bg-slate-50 px-4 py-3 text-xs text-gray-700">
                  <summary className="cursor-pointer select-none font-medium">{thinkingLabel}</summary>
                  <div className="mt-2 text-gray-600">计划：{pendingTools.map(toolLabel).join(' → ')}</div>
                </details>
                <ToolTracePending toolNames={pendingTools} doneToolNames={doneToolNames} />
              </div>
            ) : null}

            <div ref={bottomRef} />
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
            <form onSubmit={onSubmit} className="flex items-center gap-3">
              <Input
                size="large"
                value={input}
                onChange={handleInputChange}
                placeholder="例如：帮我画一个折线图，展示过去5天的气温变化..."
                disabled={isLoading}
                variant="borderless"
                className="flex-1"
              />
              <Button
                size="large"
                type="primary"
                htmlType="submit"
                icon={isLoading ? <PauseCircleOutlined /> : <SendOutlined />}
                loading={false}
                aria-label={isLoading ? '生成中' : '发送'}
                className="min-w-12 shadow-none"
              />
            </form>
          </div>
        </div>
      </div>
    </ConfigProvider>
  );
}
