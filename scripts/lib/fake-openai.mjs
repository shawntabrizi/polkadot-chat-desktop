// M13: a fake OpenAI-style chat completions server for the e2e scripts. It
// streams SSE like the LLM proxy: text pieces in `delta.content`, a tool call
// in `delta.tool_calls` pieces, then [DONE]. `answer(request)` decides the
// turn: { text, toolCall?: { name, arguments } }. Every request is kept in
// `requests` so a script can check what the app offered (tools, prompt).
// Loopback only; it never sees a real key (the scripts give the app a dummy).

import { createServer } from 'node:http';

const sleep = ms => new Promise(done => setTimeout(done, ms));

export const startFakeOpenAi = async (answer, { pieceDelayMs = 150 } = {}) => {
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/v1/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    const turn = answer(request);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = delta => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
    for (const word of (turn.text ?? '').split(/(?<= )/)) {
      if (!word) continue;
      event({ content: word });
      await sleep(pieceDelayMs);
    }
    if (turn.toolCall) {
      event({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: turn.toolCall.name, arguments: '' } }] });
      // The arguments in small pieces, slowly: a client that showed tool text would show half a JSON now.
      const args = turn.toolCall.arguments;
      for (let i = 0; i < args.length; i += 12) {
        event({ tool_calls: [{ index: 0, function: { arguments: args.slice(i, i + 12) } }] });
        await sleep(pieceDelayMs / 3);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, requests, close: () => new Promise(done => server.close(done)) };
};
