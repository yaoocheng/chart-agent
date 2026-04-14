import { useCallback, useMemo, useState } from 'react';
import { Button, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';

type Props = {
  title?: string;
  code: string;
  defaultExpanded?: boolean;
};

export default function ShowCode({ title = '查看 option 代码', code, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  const displayTitle = useMemo(() => {
    const suffix = expanded ? '（收起）' : '（展开）';
    return `${title}${suffix}`;
  }, [expanded, title]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore (e.g. non-secure context); user can still select manually
    }
  }, [code]);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-sm text-blue-600 hover:text-blue-700"
      >
        {displayTitle}
      </button>

      {expanded ? (
        <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <Typography.Text type="secondary" className="text-xs">
              ECharts option（可复制）
            </Typography.Text>
            <Button size="small" icon={<CopyOutlined />} onClick={onCopy}>
              {copied ? '已复制' : '复制'}
            </Button>
          </div>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre text-xs leading-5 text-gray-800">
            <code>{code}</code>
          </pre>
        </div>
      ) : null}
    </div>
  );
}

