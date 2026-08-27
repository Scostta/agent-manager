/**
 * Traducción del NDJSON de una run a líneas legibles.
 *
 * El stream-json del CLI trae mucho ruido de protocolo (firmas de thinking,
 * usage, uuids) que enseñado en crudo hace el log ilegible. Vive aquí y no en
 * el visor porque es lo que se rompe en silencio cuando el CLI cambia la forma
 * de un evento: no verías un error, verías un log a medias.
 */

export type LogTone = "text" | "thinking" | "tool" | "result" | "error" | "request";

export type LogEntry = { text: string; tone: LogTone };

export const MAX_TOOL_RESULT_CHARS = 500;

/** "Bash · node --test": el nombre de la herramienta y su argumento principal. */
function toolSummary(block: { name?: string; input?: Record<string, unknown> }): string {
  const input = block.input ?? {};
  const detail =
    input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.description;
  const firstLine = typeof detail === "string" ? detail.split("\n")[0].slice(0, 160) : "";
  return firstLine ? `${block.name} · ${firstLine}` : String(block.name ?? "herramienta");
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === "string" ? part : (part?.text ?? "")))
      .join("\n");
  }
  return "";
}

/** null para lo que no aporta nada: el visor lo descarta sin pintar hueco. */
export function formatLogLine(line: string): LogEntry | null {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    // stderr y cualquier salida que no sea JSON se muestran tal cual.
    return { text: line, tone: /error|failed|exception/i.test(line) ? "error" : "text" };
  }

  // La primera línea que escribe el cockpit, no el CLI: con qué se lanzó la
  // run. Es lo único que explica una salida rara sin adivinar.
  if (event.type === "cockpit" && event.subtype === "request") {
    const head = [
      `Lanzada con ${event.model}`,
      event.resumedFrom ? `retomando ${String(event.resumedFrom).slice(0, 8)}` : null,
      event.flags?.length ? event.flags.join(" ") : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return { text: `${head}\n\n${event.prompt}`, tone: "request" };
  }

  if (event.type === "assistant") {
    const parts: LogEntry[] = [];
    for (const block of event.message?.content ?? []) {
      if (block.type === "text" && block.text?.trim()) {
        parts.push({ text: block.text.trim(), tone: "text" });
      } else if (block.type === "thinking" && block.thinking?.trim()) {
        parts.push({ text: block.thinking.trim(), tone: "thinking" });
      } else if (block.type === "tool_use") {
        parts.push({ text: `→ ${toolSummary(block)}`, tone: "tool" });
      }
    }
    if (parts.length === 0) return null;
    return {
      text: parts.map((p) => p.text).join("\n"),
      tone: parts.some((p) => p.tone === "tool") ? "tool" : parts[0].tone,
    };
  }

  if (event.type === "user") {
    const block = (event.message?.content ?? []).find((b: any) => b.type === "tool_result");
    if (!block) return null;
    const text = toolResultText(block.content).trim();
    if (!text) return null;
    return {
      text: `← ${text.slice(0, MAX_TOOL_RESULT_CHARS)}${text.length > MAX_TOOL_RESULT_CHARS ? "…" : ""}`,
      tone: block.is_error ? "error" : "result",
    };
  }

  if (event.type === "result") {
    const failed = event.is_error === true || event.subtype !== "success";
    return {
      text: typeof event.result === "string" ? event.result : failed ? "La run falló" : "Fin",
      tone: failed ? "error" : "text",
    };
  }

  // `system` (init, thinking_tokens…) es puro protocolo.
  return null;
}
