import { utf8ToBytes } from './xliffBlobStore';

const MQ_NS = 'MQXliff';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

function localName(el: Element): string {
  const tag = el.tagName;
  const i = tag.indexOf(':');
  return i >= 0 ? tag.slice(i + 1) : tag;
}

function mqAttr(el: Element, name: string): string {
  return el.getAttribute(`${MQ_NS}:${name}`) ?? el.getAttribute(name) ?? '';
}

function extractPlainText(element: Element): string {
  const parts: string[] = [];
  const walk = (el: Element) => {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent ?? '');
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        walk(node as Element);
        if ((node as Element).nextSibling?.nodeType === Node.TEXT_NODE) {
          parts.push((node as Element).nextSibling!.textContent ?? '');
        }
      }
    }
  };
  if (element.textContent && element.children.length === 0) {
    return element.textContent.replace(/\{\}/g, '');
  }
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      parts.push(extractPlainText(child));
      if (child.nextSibling?.nodeType === Node.TEXT_NODE) {
        parts.push(child.nextSibling.textContent ?? '');
      }
    }
  }
  return parts.join('').replace(/\{\}/g, '');
}

function isFormattingCode(text: string): boolean {
  const t = text.trim();
  return t === '{}' || t === '';
}

function deepCloneElement(element: Element, doc: Document): Element {
  const cloned = doc.createElementNS(element.namespaceURI ?? null, element.tagName);
  for (const attr of Array.from(element.attributes)) {
    cloned.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
  }
  cloned.textContent = element.textContent;
  for (const child of Array.from(element.children)) {
    cloned.appendChild(deepCloneElement(child, doc));
  }
  return cloned;
}

function placeTranslationCarefully(element: Element, sourceText: string, translation: string): void {
  if (sourceText.trim() === translation.trim()) return;

  const nodes: { kind: 'text' | 'tail'; el?: Element; idx?: number; value: string }[] = [];
  if (element.textContent && !isFormattingCode(element.textContent)) {
    nodes.push({ kind: 'text', value: element.textContent });
  }
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];
    if (localName(child) === 'bpt' || localName(child) === 'ept') continue;
    if (child.textContent && !isFormattingCode(child.textContent)) {
      nodes.push({ kind: 'text', el: child, value: child.textContent });
    }
    if (child.nextSibling?.nodeType === Node.TEXT_NODE) {
      const tail = child.nextSibling.textContent ?? '';
      if (!isFormattingCode(tail)) {
        nodes.push({ kind: 'tail', el: child, value: tail });
      }
    }
  }

  if (nodes.length === 0) {
    element.textContent = translation;
    return;
  }
  if (nodes.length === 1) {
    if (nodes[0].kind === 'text' && !nodes[0].el) {
      element.textContent = translation;
    } else if (nodes[0].el) {
      nodes[0].el.textContent = translation;
    }
    return;
  }

  const ratio = translation.length / Math.max(sourceText.length, 1);
  let pos = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const sliceLen =
      i === nodes.length - 1
        ? translation.length - pos
        : Math.round(n.value.length * ratio);
    const piece = translation.slice(pos, pos + sliceLen);
    pos += sliceLen;
    if (n.kind === 'text' && !n.el) element.textContent = piece;
    else if (n.el) n.el.textContent = piece;
  }
}

function cloneWithTranslation(sourceElem: Element, targetElem: Element, translation: string, doc: Document): void {
  const sourceText = extractPlainText(sourceElem);
  targetElem.textContent = sourceElem.textContent;
  for (const child of Array.from(sourceElem.children)) {
    targetElem.appendChild(deepCloneElement(child, doc));
  }
  if (sourceText.trim() !== translation.trim()) {
    placeTranslationCarefully(targetElem, sourceText, translation);
  }
}

function copyFormattingToTarget(sourceElem: Element, targetElem: Element, translation: string, doc: Document): void {
  const attribs: [string, string][] = [];
  for (const attr of Array.from(targetElem.attributes)) {
    attribs.push([attr.name, attr.value]);
  }
  while (targetElem.firstChild) targetElem.removeChild(targetElem.firstChild);
  for (const [name, value] of attribs) {
    targetElem.setAttribute(name, value);
  }
  const space = sourceElem.getAttributeNS(XML_NS, 'space');
  if (space) targetElem.setAttributeNS(XML_NS, 'space', space);

  if (sourceElem.children.length === 0) {
    targetElem.textContent = translation;
  } else {
    cloneWithTranslation(sourceElem, targetElem, translation, doc);
  }
}

export interface MqParsedSegment {
  id: string;
  source: string;
  target: string;
  status: string;
  mqStatus: string;
  matchPercent: number | null;
}

export interface MqParseResult {
  segments: MqParsedSegment[];
  sourceLang: string;
  targetLang: string;
}

export function parseMqxliffXml(xmlText: string): MqParseResult {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('MQXLIFF XML 解析失败');

  let fileEl: Element | null = null;
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (localName(el) === 'file') {
      fileEl = el;
      break;
    }
  }
  const sourceLang = fileEl?.getAttribute('source-language') ?? 'en';
  const targetLang = fileEl?.getAttribute('target-language') ?? 'zh-CN';

  const segments: MqParsedSegment[] = [];
  for (const tu of Array.from(doc.getElementsByTagName('*'))) {
    if (localName(tu) !== 'trans-unit') continue;
    if (mqAttr(tu, 'nosplitjoin') === 'true') continue;

    const id = tu.getAttribute('id') ?? 'unknown';
    let source = '';
    let target = '';
    for (const ch of Array.from(tu.children)) {
      if (localName(ch) === 'source') source = extractPlainText(ch);
      if (localName(ch) === 'target') target = extractPlainText(ch);
    }
    const mqStatus = mqAttr(tu, 'status');
    let status = 'not_started';
    if (['已确认', 'ProofRead', 'Reviewed'].includes(mqStatus)) status = 'confirmed';
    else if (mqStatus === 'Editing') status = 'draft';
    else if (target.trim()) status = 'pre_translated';

    const pctStr = mqAttr(tu, 'percent');
    const matchPercent = pctStr ? parseInt(pctStr, 10) : null;

    segments.push({ id, source, target, status, mqStatus, matchPercent });
  }
  return { segments, sourceLang, targetLang };
}

export function applyMqTranslations(xmlText: string, translations: string[]): string {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('MQXLIFF XML 解析失败');

  let idx = 0;
  for (const tu of Array.from(doc.getElementsByTagName('*'))) {
    if (localName(tu) !== 'trans-unit') continue;
    if (mqAttr(tu, 'nosplitjoin') === 'true') continue;
    if (idx >= translations.length) break;

    const translation = translations[idx];
    idx += 1;

    let sourceElem: Element | null = null;
    let targetElem: Element | null = null;
    for (const ch of Array.from(tu.children)) {
      if (localName(ch) === 'source') sourceElem = ch;
      if (localName(ch) === 'target') targetElem = ch;
    }
    if (!sourceElem || !targetElem) continue;

    copyFormattingToTarget(sourceElem, targetElem, translation, doc);
    tu.setAttributeNS(MQ_NS, 'mq:status', '已确认');
    tu.setAttribute(`${MQ_NS}:status`, '已确认');
  }

  let serialized = new XMLSerializer().serializeToString(doc);
  serialized = fixNamespacePrefixes(serialized);
  return serialized;
}

function fixNamespacePrefixes(xml: string): string {
  return xml
    .replace(/xmlns:ns\d+="MQXliff"/g, 'xmlns:mq="MQXliff"')
    .replace(/ns\d+:(\w+)/g, 'mq:$1')
    .replace(/\{MQXliff\}(\w+)/g, 'mq:$1');
}

export function mqxliffToBytes(xml: string, hadBom: boolean): Uint8Array {
  return utf8ToBytes(xml, hadBom);
}
