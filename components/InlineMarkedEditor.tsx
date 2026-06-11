import React, { useCallback, useEffect, useRef } from 'react';
import type { InlineRunStyle } from '../types';
import {
  hasInlineMarkers,
  metaById,
  parseMarkedParts,
} from '../services/inlineFormatting/markerParse';
import { runStyleToCss } from './InlineMarkedText';
import { getPlainSelectionOffsets } from '../services/inlineFormatting/selectionOffsets';

function serializeMarkedEditor(root: Node): string {
  let out = '';
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
    } else if (node instanceof HTMLElement) {
      const runId = node.getAttribute('data-run-id');
      if (runId) {
        out += `<${runId}>${serializeMarkedEditor(node)}</${runId}>`;
      } else {
        out += serializeMarkedEditor(node);
      }
    }
  });
  return out;
}

function buildEditorDom(
  container: HTMLElement,
  text: string,
  meta: Map<string, InlineRunStyle>
): void {
  container.innerHTML = '';
  if (!text) return;

  if (!hasInlineMarkers(text)) {
    container.appendChild(document.createTextNode(text));
    return;
  }

  for (const part of parseMarkedParts(text)) {
    if (part.type === 'plain') {
      if (part.text) container.appendChild(document.createTextNode(part.text));
    } else if (part.type === 'tagged') {
      const span = document.createElement('span');
      span.setAttribute('data-run-id', part.id);
      const css = runStyleToCss(meta.get(part.id));
      Object.assign(span.style, css as unknown as Record<string, string>);
      span.textContent = part.text;
      container.appendChild(span);
    } else {
      const span = document.createElement('span');
      span.setAttribute('data-run-id', part.id);
      span.setAttribute('contenteditable', 'false');
      container.appendChild(span);
    }
  }
}

export type InlineMarkedEditorProps = {
  value: string;
  inlineRunMeta?: InlineRunStyle[];
  readOnly?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onChange?: (value: string) => void;
  onSelect?: () => void;
  onSelectionChange?: (start: number, end: number) => void;
  onFocus?: () => void;
};

/** WYSIWYG contenteditable editor backed by marker tag string. */
export function InlineMarkedEditor({
  value,
  inlineRunMeta,
  readOnly = false,
  className,
  style,
  onChange,
  onSelect,
  onSelectionChange,
  onFocus,
}: InlineMarkedEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastValueRef = useRef(value);
  const meta = metaById(inlineRunMeta);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value === lastValueRef.current && el.textContent !== '') return;
    lastValueRef.current = value;
    buildEditorDom(el, value, meta);
  }, [value, meta]);

  const handleBlur = useCallback(() => {
    const el = ref.current;
    if (!el || readOnly) return;
    const serialized = serializeMarkedEditor(el);
    lastValueRef.current = serialized;
    onChange?.(serialized);
  }, [onChange, readOnly]);

  const handleInput = useCallback(() => {
    const el = ref.current;
    if (!el || readOnly) return;
    const serialized = serializeMarkedEditor(el);
    lastValueRef.current = serialized;
    onChange?.(serialized);
  }, [onChange, readOnly]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }, []);

  const reportSelection = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const offsets = getPlainSelectionOffsets(el);
    if (offsets) onSelectionChange?.(offsets.start, offsets.end);
    onSelect?.();
  }, [onSelectionChange, onSelect]);

  return (
    <div
      ref={ref}
      role="textbox"
      contentEditable={!readOnly}
      suppressContentEditableWarning
      spellCheck
      className={className}
      style={style}
      onBlur={handleBlur}
      onInput={handleInput}
      onSelect={reportSelection}
      onKeyUp={reportSelection}
      onMouseUp={reportSelection}
      onFocus={(e) => {
        reportSelection();
        onFocus?.();
      }}
      onPaste={handlePaste}
    />
  );
}
