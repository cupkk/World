import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { useEffect, useRef, useState, useCallback } from "react";
import mermaid from "mermaid";
import { Loader2, Maximize2, AlertTriangle, Play } from "lucide-react";

mermaid.initialize({
  startOnLoad: false,
  theme: "default",
  securityLevel: "strict",
});

const MermaidComponent = ({ node, updateAttributes, extension }: any) => {
  const code = node.attrs.code || "";
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);
  const [draftCode, setDraftCode] = useState(code);

  const renderChart = useCallback(async (sourceCode: string) => {
    if (!sourceCode.trim()) {
      setSvg("");
      setError("");
      return;
    }
    try {
      if (await mermaid.parse(sourceCode)) {
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        const { svg: generatedSvg } = await mermaid.render(id, sourceCode);
        setSvg(generatedSvg);
        setError("");
      }
    } catch (err: any) {
      setError(err?.message || "Invalid Mermaid syntax");
    }
  }, []);

  useEffect(() => {
    if (!isEditing) {
      renderChart(code);
    }
  }, [code, isEditing, renderChart]);

  const handleApply = () => {
    updateAttributes({ code: draftCode });
    setIsEditing(false);
  };

  return (
    <NodeViewWrapper className="mermaid-node my-4 rounded-xl border border-subtle bg-[var(--bg-surface)] overflow-hidden shadow-sm">
      <div className="flex items-center justify-between border-b border-subtle bg-[var(--bg-muted)] px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-blue-100 text-blue-600">
            <Maximize2 className="h-3 w-3" />
          </div>
          <span className="text-[12px] font-semibold text-primary">Mermaid 流程图</span>
        </div>
        <button
          onClick={() => {
            if (isEditing) handleApply();
            else {
              setDraftCode(code);
              setIsEditing(true);
            }
          }}
          className="flex items-center gap-1 rounded bg-[var(--accent-strong)] px-3 py-1 text-[12px] font-medium text-white transition hover:opacity-90"
        >
          {isEditing ? <Play className="h-3 w-3" /> : "编辑代码"}
          {isEditing ? "渲染图表" : ""}
        </button>
      </div>

      <div className="p-4">
        {isEditing ? (
          <textarea
            value={draftCode}
            onChange={(e) => setDraftCode(e.target.value)}
            className="h-[200px] w-full resize-y font-mono text-[13px] bg-[var(--bg-base)] text-primary border border-subtle rounded p-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
            placeholder={"graph TD;\n  A-->B;\n  A-->C;\n  B-->D;\n  C-->D;"}
            style={{ whiteSpace: "pre" }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[120px] bg-white rounded-lg p-4">
            {error ? (
              <div className="flex items-center gap-2 text-red-500 text-[13px]">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-mono text-[11px] whitespace-pre-wrap">{error}</span>
              </div>
            ) : svg ? (
              <div
                ref={containerRef}
                className="mermaid-render-container max-w-full overflow-auto"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : (
              <span className="text-secondary text-[13px]">点击编辑以编写 Mermaid 图表</span>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
};

export const MermaidExtension = Node.create({
  name: "mermaid",

  group: "block",

  atom: true,

  addAttributes() {
    return {
      code: {
        default: "",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mermaid"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "mermaid" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidComponent);
  },
});
