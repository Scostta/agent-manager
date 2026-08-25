/**
 * Detección del "se acabó el plan". El CLI no expone esto de forma estructurada
 * en stream-json: en el evento `result` llegan `api_error_status` (429) y un
 * `result` con el mensaje humano. Miramos ambos y toleramos que cualquiera de
 * los dos cambie de forma.
 */

export type RateLimitHit = {
  /** "session" | "weekly" | el nombre del modelo (Opus, Sonnet…). */
  scope: string;
  /** Texto tal cual lo dio el CLI: "3:45pm", "Mon 12:00am". */
  resetsAtText: string | null;
  resetsAt: Date | null;
};

const LIMIT_MESSAGE =
  /You've hit your (session|weekly|[A-Za-z][\w.-]*) limit(?:\s*[·|-]\s*resets\s+([^\n"]+))?/i;

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * "3:45pm" → hoy a esa hora (mañana si ya pasó). "Mon 12:00am" → el próximo
 * lunes. Devuelve null si el formato no encaja: preferimos no saber la hora a
 * inventarla, porque de ella depende cuándo se reintenta sola una run.
 */
export function parseResetTime(text: string, now = new Date()): Date | null {
  const cleaned = text.trim().replace(/\.$/, "");
  const match = cleaned.match(/^(?:([A-Za-z]{3})[a-z]*\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;

  const [, weekday, rawHour, rawMinute, meridiem] = match;
  let hour = Number(rawHour);
  if (Number.isNaN(hour) || hour > 23) return null;

  if (meridiem) {
    const isPm = meridiem.toLowerCase() === "pm";
    if (hour === 12) hour = isPm ? 12 : 0;
    else if (isPm) hour += 12;
  }

  const target = new Date(now);
  target.setSeconds(0, 0);
  target.setHours(hour, rawMinute ? Number(rawMinute) : 0);

  if (weekday) {
    const wanted = WEEKDAYS.indexOf(weekday.toLowerCase());
    if (wanted === -1) return null;
    let days = (wanted - target.getDay() + 7) % 7;
    if (days === 0 && target <= now) days = 7;
    target.setDate(target.getDate() + days);
    return target;
  }

  if (target <= now) target.setDate(target.getDate() + 1);
  return target;
}

/** `event` es el objeto `result` del stream-json. */
export function detectRateLimit(event: any, stderr: string, now = new Date()): RateLimitHit | null {
  const haystack = [
    typeof event?.result === "string" ? event.result : "",
    typeof event?.error === "string" ? event.error : "",
    stderr,
  ].join("\n");

  const match = haystack.match(LIMIT_MESSAGE);
  if (!match) {
    // 429 sin mensaje reconocible: sabemos que es cuota, no cuándo vuelve.
    if (event?.api_error_status === 429) {
      return { scope: "plan", resetsAtText: null, resetsAt: null };
    }
    return null;
  }

  const resetsAtText = match[2]?.trim() ?? null;
  return {
    scope: match[1].toLowerCase(),
    resetsAtText,
    resetsAt: resetsAtText ? parseResetTime(resetsAtText, now) : null,
  };
}

export function describeRateLimit(hit: RateLimitHit): string {
  const scope =
    hit.scope === "session"
      ? "límite de sesión"
      : hit.scope === "weekly"
        ? "límite semanal"
        : hit.scope === "plan"
          ? "límite del plan"
          : `límite de ${hit.scope}`;
  return hit.resetsAtText
    ? `Se agotó tu ${scope} de Claude Code · vuelve a haber cuota a las ${hit.resetsAtText}.`
    : `Se agotó tu ${scope} de Claude Code.`;
}
