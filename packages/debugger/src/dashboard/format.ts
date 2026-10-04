/**
 * Pure formatting helpers for the dashboard (no DOM access, so they can be
 * unit-tested in Node).
 */

export interface SourceInfo {
  source?: string;
  sourceKind?: string;
  line?: number;
  column?: number;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const KIND_LABEL: Record<string, string> = { html: 'HTML', vel: 'VEL', teloce: 'TELOCE' };

/** `src/App.html:12:5`, with a small HTML / VEL badge for component files. */
export function formatSource(info: SourceInfo, withColumn: boolean): string {
  if (!info.source) return '';
  const label = info.sourceKind ? KIND_LABEL[info.sourceKind] : undefined;
  const badge = label
    ? `<span class="source-badge source-badge-${info.sourceKind}" style="display:inline-block; margin-right:6px; padding:0 6px; border-radius:3px; font-size:10px; font-weight:700; letter-spacing:.04em; background: var(--bg-secondary); color: var(--text-secondary); border:1px solid var(--border-color, #444);">${label}</span>`
    : '';
  const line = info.line ? `:${info.line}` : '';
  const column = withColumn && info.column ? `:${info.column}` : '';
  return `${badge}${escapeHtml(info.source)}${line}${column}`;
}
