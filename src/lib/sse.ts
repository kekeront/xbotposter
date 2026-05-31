/**
 * Shared SSE utilities.
 *
 * Pattern extracted from src/app/api/compose/route.ts — do not modify
 * compose/route.ts to use this; that file is out of scope.
 */

const encoder = new TextEncoder();

/**
 * Encode a single SSE frame.
 *
 * Format: `event: <event>\ndata: <JSON>\n\n`
 */
export function sseEncode(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Build an SSE Response from an async handler.
 *
 * The handler receives an `emit` function it can call to push events to the
 * client. On unhandled throws the stream emits an `error` event with `{ message }`
 * before closing. The controller is always closed in `finally`.
 *
 * @param handler - Async function that calls `emit` zero or more times.
 * @returns A `Response` with the standard SSE headers.
 */
export function sseStream(
  handler: (emit: (event: string, data: unknown) => void) => Promise<void>,
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      // Flush a 2KB padding comment to push past HTTP/gzip buffering, matching
      // the pattern used in compose/route.ts.
      try {
        controller.enqueue(encoder.encode(`: ${" ".repeat(2048)}\n\n`));
      } catch {
        // client already disconnected before the stream started
      }

      const emit = (event: string, data: unknown): void => {
        try {
          controller.enqueue(sseEncode(event, data));
        } catch {
          // enqueue throws when the reader has closed — swallow it so the
          // handler can finish its own cleanup without an unhandled rejection.
        }
      };

      try {
        await handler(emit);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        emit("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
