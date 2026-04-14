'use client';

import { useChat, type Message } from 'ai/react';
import { Input, Button, Card, Typography } from 'antd';
import { PauseCircleOutlined, SendOutlined } from '@ant-design/icons';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ShowCode from '@/components/ShowCode';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

const { Text } = Typography;
const STORAGE_KEY = 'ai-chart-agent:chat-state';

type PersistedState = {
  messages: Message[];
  currentOptionCode: string;
};

export default function AgentPage() {
  const [hydrated, setHydrated] = useState(false);
  const [currentOptionCode, setCurrentOptionCode] = useState('');
  const [clientPending, setClientPending] = useState(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, messages.length]);

  const showAgentPending = useMemo(() => {
    const last = messages[messages.length - 1];
    return clientPending || (isLoading && (!last || last.role === 'user'));
  }, [clientPending, isLoading, messages]);

  useEffect(() => {
    if (!isLoading) setClientPending(false);
  }, [isLoading]);

  useEffect(() => {
    // Once we got an assistant message, clear the optimistic pending indicator.
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant') setClientPending(false);
  }, [messages]);

  const onSubmit = (event?: { preventDefault?: () => void }) => {
    event?.preventDefault?.();
    setClientPending(true);
    handleSubmit(event);
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4 bg-white text-gray-800">
      <div className="text-center py-6 border-b mb-4">
        <h1 className="text-3xl font-bold text-gray-800">AI Chart Agent</h1>
        <p className="text-gray-500 mt-2">一句话生成 ECharts，并可在对话里直接预览。</p>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto mb-4 px-2 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <Text type="secondary" className="block mb-1">
              {msg.role === 'user' ? '你' : 'Agent'}
            </Text>

            {msg.content && (
              <div
                className={`p-3 rounded-lg inline-block max-w-[80%] ${
                  msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800'
                }`}
              >
                {msg.role === 'user' ? (
                  msg.content
                ) : (
                  <div className="max-w-none text-sm leading-7 [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-gray-900 [&_pre]:p-3 [&_pre]:text-gray-100 [&_code]:rounded [&_code]:bg-gray-200 [&_code]:px-1 [&_code]:py-0.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            )}

            {msg.toolInvocations?.map((toolInvocation) => {
              const isChartTool = toolInvocation.toolName === 'render_chart' || toolInvocation.toolName === 'update_chart';
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
        ))}

        {showAgentPending ? (
          <div className="flex flex-col items-start">
            <Text type="secondary" className="block mb-1">
              Agent
            </Text>
            <div
              className="inline-flex items-center justify-center rounded-full border border-blue-100 bg-blue-50 p-2 text-blue-600 animate-pulse"
              aria-label="正在生成中"
            >
              <PauseCircleOutlined style={{ fontSize: 20 }} />
            </div>
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>

      <form onSubmit={onSubmit} className="flex gap-3 pt-4 border-t">
        <Input
          size="large"
          value={input}
          onChange={handleInputChange}
          placeholder="例如：帮我画一个折线图，展示过去5天的气温变化..."
          disabled={isLoading}
          className="flex-1"
        />
        <Button
          size="large"
          type="primary"
          htmlType="submit"
          icon={isLoading ? <PauseCircleOutlined /> : <SendOutlined />}
          loading={false}
          aria-label={isLoading ? '生成中' : '发送'}
          className="min-w-12"
        />
      </form>
    </div>
  );
}
