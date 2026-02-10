import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AgentRunRequest } from "./agentProtocol";
import { runAgent, runAgentStream } from "./agentClient";

const requestFixture: AgentRunRequest = {
  session_id: "session-test",
  messages: [{ role: "user", content: "你好" }],
  board_sections: []
};

function streamFromChunks(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    }
  });
}

describe("agentClient", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("runAgentStream parses result frame even without trailing frame delimiter", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        streamFromChunks([
          'event: assistant_delta\ndata: {"delta":"你"}\n\n',
          'event: result\ndata: {"assistant_message":"你好","board_actions":[]}\n'
        ]),
        { status: 200 }
      )
    );

    const onAssistantDelta = vi.fn();
    const result = await runAgentStream(requestFixture, { onAssistantDelta });

    expect(onAssistantDelta).toHaveBeenCalledWith("你");
    expect(result).toEqual({
      assistant_message: "你好",
      board_actions: []
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/agent/stream",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("runAgentStream surfaces server stream error event", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        streamFromChunks([
          'event: error\ndata: {"message":"AI stream failed","request_id":"req_1"}\n\n'
        ]),
        { status: 200 }
      )
    );

    await expect(runAgentStream(requestFixture)).rejects.toMatchObject({
      kind: "server",
      message: expect.stringContaining("req_1")
    });
  });

  it("runAgent surfaces parsed server message and request id", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message: "配置缺失",
            request_id: "req_2"
          }
        }),
        { status: 500, statusText: "Internal Server Error" }
      )
    );

    await expect(runAgent(requestFixture)).rejects.toMatchObject({
      kind: "server",
      status: 500,
      message: expect.stringContaining("req_2")
    });
  });
});
