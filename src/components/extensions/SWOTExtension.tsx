import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { Maximize2 } from "lucide-react";

/**
 * Interface representing SWOT data.
 */
interface SWOTData {
  strengths: string;
  weaknesses: string;
  opportunities: string;
  threats: string;
}

const DEFAULT_SWOT_DATA: SWOTData = {
  strengths: "",
  weaknesses: "",
  opportunities: "",
  threats: "",
};

const SWOTComponent = ({ node, updateAttributes, extension }: any) => {
  const data: SWOTData = node.attrs.data || DEFAULT_SWOT_DATA;

  const handleChange = (key: keyof SWOTData, value: string) => {
    updateAttributes({
      data: {
        ...data,
        [key]: value,
      },
    });
  };

  return (
    <NodeViewWrapper className="swot-node my-4 rounded-xl border border-subtle bg-[var(--bg-surface)] overflow-hidden shadow-sm">
      <div className="flex items-center justify-between border-b border-subtle bg-[var(--bg-muted)] px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-purple-100 text-purple-600">
            <Maximize2 className="h-3 w-3" />
          </div>
          <span className="text-[12px] font-semibold text-primary">SWOT 四象限分析</span>
        </div>
      </div>

      <div className="p-4 bg-[var(--bg-base)]">
        <div className="grid grid-cols-2 gap-4">
          {/* S - 优势 */}
          <div className="flex flex-col gap-2 rounded-lg border border-subtle bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2 border-b border-subtle pb-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">S</div>
              <span className="text-sm font-semibold text-primary">Strengths (优势)</span>
            </div>
            <textarea
              className="min-h-[100px] w-full resize-none bg-transparent text-[13px] text-secondary outline-none placeholder:text-muted"
              placeholder="列出内部优势（例如：核心技术、品牌声誉、独特资源...）"
              value={data.strengths}
              onChange={(e) => handleChange("strengths", e.target.value)}
            />
          </div>

           {/* W - 劣势 */}
           <div className="flex flex-col gap-2 rounded-lg border border-subtle bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2 border-b border-subtle pb-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-sm font-bold text-red-700">W</div>
              <span className="text-sm font-semibold text-primary">Weaknesses (劣势)</span>
            </div>
            <textarea
              className="min-h-[100px] w-full resize-none bg-transparent text-[13px] text-secondary outline-none placeholder:text-muted"
              placeholder="列出内部劣势（例如：资源瓶颈、技术短板、市场缺乏认知...）"
              value={data.weaknesses}
              onChange={(e) => handleChange("weaknesses", e.target.value)}
            />
          </div>

          {/* O - 机会 */}
          <div className="flex flex-col gap-2 rounded-lg border border-subtle bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2 border-b border-subtle pb-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-700">O</div>
              <span className="text-sm font-semibold text-primary">Opportunities (机会)</span>
            </div>
            <textarea
              className="min-h-[100px] w-full resize-none bg-transparent text-[13px] text-secondary outline-none placeholder:text-muted"
              placeholder="列出外部机会（例如：新兴市场、竞争对手失误、政策红利...）"
              value={data.opportunities}
              onChange={(e) => handleChange("opportunities", e.target.value)}
            />
          </div>

           {/* T - 威胁 */}
           <div className="flex flex-col gap-2 rounded-lg border border-subtle bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2 border-b border-subtle pb-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-700">T</div>
              <span className="text-sm font-semibold text-primary">Threats (威胁)</span>
            </div>
            <textarea
              className="min-h-[100px] w-full resize-none bg-transparent text-[13px] text-secondary outline-none placeholder:text-muted"
              placeholder="列出外部威胁（例如：新的竞争者、经济衰退、替代产品...）"
              value={data.threats}
              onChange={(e) => handleChange("threats", e.target.value)}
            />
          </div>
        </div>
      </div>
    </NodeViewWrapper>
  );
};

export const SWOTExtension = Node.create({
  name: "swot",

  group: "block",

  atom: true,

  addAttributes() {
    return {
      data: {
        default: DEFAULT_SWOT_DATA,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="swot"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "swot" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SWOTComponent);
  },
});
