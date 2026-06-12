"""
PPTX extract/merge for Smart-CAT Okapi sidecar.

Uses python-pptx for structure traversal and DrawingML XML for tagged run
extract/merge (mirrors DOCX inlineRunMeta pipeline in main.py).
"""

from __future__ import annotations

import io
import re
from typing import Dict, Iterator, List, Optional, Tuple

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.oxml import parse_xml
from pptx.text.text import _Paragraph

# Reuse shared tagged-run helpers and font map from main (import at call sites
# from main to avoid circular imports at module load — duplicated minimally here).

TAG_PART_RE = re.compile(
    r"(<([A-Za-z0-9_]+)>(.*?)</\2>)|([^<]+)|(<([A-Za-z0-9_]+)/>)",
    re.S,
)

MONOLINGUAL_EXPORT_FONT_MAP: Dict[str, Dict[str, str]] = {
    "simsun": {
        "ascii": "SimSun",
        "eastAsia": "宋体",
        "cs": "SimSun",
    },
    "times-new-roman": {
        "ascii": "Times New Roman",
        "eastAsia": "Times New Roman",
        "cs": "Times New Roman",
    },
    "arial": {
        "ascii": "Arial",
        "eastAsia": "Arial",
        "cs": "Arial",
    },
}


def decode_xml(s: str) -> str:
    return (
        s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
    )


def escape_xml_text(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def parse_marked_parts(text: str) -> List[dict]:
    parts: List[dict] = []
    if not text:
        return parts
    last = 0
    for m in TAG_PART_RE.finditer(text):
        if m.start() > last:
            parts.append({"type": "plain", "text": text[last : m.start()]})
        if m.group(2) is not None:
            parts.append({"type": "tagged", "id": m.group(2), "text": m.group(3) or ""})
        elif m.group(4) is not None:
            parts.append({"type": "plain", "text": m.group(4)})
        elif m.group(5) is not None:
            parts.append({"type": "standalone", "id": m.group(5)})
        last = m.end()
    if last < len(text):
        parts.append({"type": "plain", "text": text[last:]})
    return parts


def strip_inline_markers(text: str) -> str:
    if not text:
        return ""
    t = re.sub(r"<([A-Za-z0-9_]+)>(.*?)</\1>", r"\2", text, flags=re.S)
    t = re.sub(r"<([A-Za-z0-9_]+)/>", "", t)
    return t


def proportional_split(text: str, weights: List[int]) -> List[str]:
    if not weights:
        return []
    if len(weights) == 1:
        return [text]
    total = sum(weights) or 1
    slices: List[str] = []
    pos = 0
    for i, w in enumerate(weights):
        if i == len(weights) - 1:
            slices.append(text[pos:])
        else:
            ln = round(len(text) * w / total)
            slices.append(text[pos : pos + ln])
            pos += ln
    return slices


def _drawingml_attr_val(block: str, tag: str) -> Optional[str]:
    m = re.search(rf"<a:{tag}(?:\s[^>]*)?/?>", block, re.I)
    if not m:
        return None
    vm = re.search(r'\bval="([^"]*)"', m.group(0), re.I)
    return vm.group(1) if vm else ""


def _drawingml_attr_on_tag(attrs: str, name: str) -> Optional[str]:
    m = re.search(rf'\b{name}="([^"]*)"', attrs, re.I)
    return m.group(1) if m else None


def _is_truthy(val: Optional[str]) -> bool:
    if val is None:
        return True
    v = val.lower()
    return v not in ("0", "false", "none", "off")


def _drawingml_srgb_color(rpr_inner: str) -> Optional[str]:
    m = re.search(
        r"<a:solidFill[^>]*>\s*<a:srgbClr\s+val=\"([0-9A-Fa-f]{6})\"",
        rpr_inner,
        re.I,
    )
    if m:
        return m.group(1).upper()
    m = re.search(r"<a:srgbClr\s+val=\"([0-9A-Fa-f]{6})\"", rpr_inner, re.I)
    return m.group(1).upper() if m else None


def parse_drawingml_run_style(rpr_inner: str, rpr_tag_attrs: str = "") -> Optional[dict]:
    if not rpr_inner.strip() and not rpr_tag_attrs.strip():
        return None
    style: dict = {}

    def flag(name: str) -> bool:
        child_val = _drawingml_attr_val(rpr_inner, name)
        if child_val is not None:
            return _is_truthy(child_val)
        attr_val = _drawingml_attr_on_tag(rpr_tag_attrs, name)
        if attr_val is not None:
            return _is_truthy(attr_val)
        if re.search(rf"<a:{name}[\s/>]", rpr_inner, re.I):
            return _is_truthy(child_val)
        return False

    if flag("b"):
        style["bold"] = True
    if flag("i"):
        style["italic"] = True
    if flag("u"):
        style["underline"] = True
    if flag("strike"):
        style["strike"] = True
    color = _drawingml_srgb_color(rpr_inner)
    if color:
        style["color"] = color
    baseline = _drawingml_attr_val(rpr_inner, "baseline") or _drawingml_attr_on_tag(
        rpr_tag_attrs, "baseline"
    )
    if baseline:
        try:
            v = int(baseline)
            if v > 0:
                style["vertAlign"] = "superscript"
            elif v < 0:
                style["vertAlign"] = "subscript"
        except ValueError:
            pass
    return style if style else None


def _paragraph_default_drawingml_rpr(p_block: str) -> str:
    ppr_m = re.search(r"<a:pPr[^>]*>([\s\S]*?)</a:pPr>", p_block, re.I)
    if not ppr_m:
        return ""
    defrpr_m = re.search(r"<a:defRPr[^>]*>([\s\S]*?)</a:defRPr>", ppr_m.group(1), re.I)
    if defrpr_m:
        return defrpr_m.group(1)
    sc_m = re.search(r"<a:defRPr\b[^>]*/>", ppr_m.group(1), re.I)
    return ""


def _drawingml_run_rpr_parts(r_block: str, default_rpr: str) -> Tuple[str, str]:
    """Return (inner_xml, opening_tag_attrs) for effective run rPr."""
    rpr_m = re.search(r"<a:rPr([^>/]*)(?:>([\s\S]*?)</a:rPr>|/>)", r_block, re.I)
    if not rpr_m:
        return default_rpr, ""
    attrs = rpr_m.group(1) or ""
    inner = rpr_m.group(2) or ""
    if not inner.strip() and not attrs.strip() and default_rpr:
        return default_rpr, ""
    return inner, attrs


def extract_drawingml_run_texts(r_block: str) -> str:
    t_re = re.compile(r"<a:t(?:\s[^>]*)?>([\s\S]*?)</a:t>", re.I)
    return "".join(decode_xml(m.group(1)) for m in t_re.finditer(r_block))


def extract_tagged_from_drawingml_paragraph(p_block: str) -> Optional[dict]:
    default_rpr = _paragraph_default_drawingml_rpr(p_block)
    r_re = re.compile(r"<a:r\b[\s\S]*?</a:r>", re.I)
    runs: List[dict] = []
    for rm in r_re.finditer(p_block):
        text = extract_drawingml_run_texts(rm.group(0))
        if not text:
            continue
        inner, attrs = _drawingml_run_rpr_parts(rm.group(0), default_rpr)
        style = parse_drawingml_run_style(inner, attrs)
        runs.append({"text": text, "style": style})

    if not runs:
        return None

    next_id = 1
    meta: List[dict] = []
    out = ""
    for run in runs:
        if run["style"]:
            rid = str(next_id)
            next_id += 1
            entry = dict(run["style"])
            entry["id"] = rid
            meta.append(entry)
            out += f"<{rid}>{run['text']}</{rid}>"
        else:
            out += run["text"]
    trimmed = out.strip()
    if not trimmed:
        return None
    return {"text": trimmed, "inlineRunMeta": meta}


def analyze_drawingml_paragraph_runs(p_block: str) -> List[dict]:
    default_rpr = _paragraph_default_drawingml_rpr(p_block)
    r_re = re.compile(r"<a:r\b[\s\S]*?</a:r>", re.I)
    infos: List[dict] = []
    next_id = 1
    for rm in r_re.finditer(p_block):
        text = extract_drawingml_run_texts(rm.group(0))
        if not text:
            continue
        inner, attrs = _drawingml_run_rpr_parts(rm.group(0), default_rpr)
        style = parse_drawingml_run_style(inner, attrs)
        tag_id = None
        if style:
            tag_id = str(next_id)
            next_id += 1
        infos.append(
            {
                "tag_id": tag_id,
                "weight": len(text),
                "block": rm.group(0),
                "style": style,
            }
        )
    return infos


def set_drawingml_run_text(r_block: str, new_text: str) -> str:
    t_re = re.compile(r"(<a:t(?:\s[^>]*)?>)([\s\S]*?)(</a:t>)", re.I)
    seen = False

    def repl(m: re.Match[str]) -> str:
        nonlocal seen
        if not seen:
            seen = True
            return m.group(1) + escape_xml_text(new_text) + m.group(3)
        return m.group(1) + m.group(3)

    out = t_re.sub(repl, r_block)
    if not seen:
        insert = f"<a:t>{escape_xml_text(new_text)}</a:t>"
        out = re.sub(r"</a:r>\s*$", insert + "</a:r>", out, count=1, flags=re.I)
    return out


def _plain_run_slot(run_infos: List[dict], idx: int) -> str:
    has_prev_tag = any(r["tag_id"] for r in run_infos[:idx])
    has_next_tag = any(r["tag_id"] for r in run_infos[idx + 1 :])
    if has_prev_tag and has_next_tag:
        return "middle"
    if has_prev_tag:
        return "trailing"
    if has_next_tag:
        return "leading"
    return "only"


def _split_across_plain_runs_only(run_infos: List[dict], plain_target: str) -> List[str]:
    plain_indices = [i for i, r in enumerate(run_infos) if not r["tag_id"]]
    texts: List[str] = [""] * len(run_infos)
    if not plain_indices:
        texts[0] = plain_target
        return texts
    if len(plain_indices) == 1:
        texts[plain_indices[0]] = plain_target
        return texts
    weights = [run_infos[i]["weight"] or 1 for i in plain_indices]
    for idx, chunk in zip(plain_indices, proportional_split(plain_target, weights)):
        texts[idx] = chunk
    return texts


def _assign_tagged_parts_to_runs(run_infos: List[dict], parts: List[dict]) -> List[str]:
    texts: List[str] = [""] * len(run_infos)
    tagged_parts = [p for p in parts if p["type"] == "tagged"]
    tagged_run_indices = [i for i, r in enumerate(run_infos) if r["tag_id"]]
    if not tagged_parts or not tagged_run_indices:
        return texts

    if len(tagged_parts) < len(tagged_run_indices):
        assign_to = tagged_run_indices[-len(tagged_parts) :]
        for p, ri in zip(tagged_parts, assign_to):
            texts[ri] = p["text"]
        return texts

    used_parts: set[int] = set()
    for i, r in enumerate(run_infos):
        tid = r["tag_id"]
        if not tid:
            continue
        for pi, p in enumerate(tagged_parts):
            if pi in used_parts or p["id"] != tid:
                continue
            texts[i] = p["text"]
            used_parts.add(pi)
            break

    remaining_parts = [p for pi, p in enumerate(tagged_parts) if pi not in used_parts]
    empty_tagged = [i for i in tagged_run_indices if not texts[i]]
    for p, ri in zip(remaining_parts, empty_tagged):
        texts[ri] = p["text"]
    return texts


def compute_drawingml_run_target_texts(run_infos: List[dict], new_text: str) -> List[str]:
    parts = parse_marked_parts(new_text)
    has_tags = any(p["type"] == "tagged" for p in parts)
    plain_target = strip_inline_markers(new_text)

    if not run_infos:
        return [plain_target]

    if not has_tags:
        return _split_across_plain_runs_only(run_infos, plain_target)

    texts = _assign_tagged_parts_to_runs(run_infos, parts)

    if plain_target and not any(texts):
        return _split_across_plain_runs_only(run_infos, plain_target)

    plain_parts = [p["text"] for p in parts if p["type"] == "plain"]
    plain_run_indices = [i for i, r in enumerate(run_infos) if not r["tag_id"]]
    if not plain_run_indices or not plain_parts:
        return texts

    if len(plain_parts) == len(plain_run_indices):
        for idx, part in zip(plain_run_indices, plain_parts):
            texts[idx] = part
        return texts

    slot_order = {"middle": 0, "trailing": 1, "leading": 2, "only": 3}
    ordered = sorted(
        plain_run_indices,
        key=lambda i: (slot_order[_plain_run_slot(run_infos, i)], i),
    )
    for idx, part in zip(ordered, plain_parts):
        texts[idx] = part

    if len(plain_parts) > len(plain_run_indices):
        extra = "".join(plain_parts[len(plain_run_indices) :])
        for i in reversed(ordered):
            texts[i] += extra
            break

    return texts


def apply_run_texts_to_drawingml_paragraph(
    p_block: str, run_infos: List[dict], texts: List[str]
) -> str:
    if len(run_infos) != len(texts):
        weights = [r["weight"] or 1 for r in run_infos]
        texts = proportional_split(strip_inline_markers("".join(texts)), weights)

    r_re = re.compile(r"(<a:r\b[\s\S]*?</a:r>)", re.I)
    info_iter = iter(run_infos)
    text_iter = iter(texts)
    current_info = next(info_iter, None)
    current_text = next(text_iter, None)

    def repl(m: re.Match[str]) -> str:
        nonlocal current_info, current_text
        block = m.group(1)
        if not re.search(r"<a:t", block, re.I):
            return block
        if current_info is None:
            return block
        new_block = set_drawingml_run_text(block, current_text or "")
        current_info = next(info_iter, None)
        current_text = next(text_iter, None)
        return new_block

    return r_re.sub(repl, p_block)


def replace_drawingml_paragraph_with_tagged_target(p_block: str, new_text: str) -> str:
    if new_text is None:
        return p_block
    run_infos = analyze_drawingml_paragraph_runs(p_block)
    if not run_infos:
        return p_block
    texts = compute_drawingml_run_target_texts(run_infos, new_text)
    return apply_run_texts_to_drawingml_paragraph(p_block, run_infos, texts)


def drawingml_typefaces(spec: Dict[str, str]) -> Dict[str, str]:
    return {
        "latin": spec["ascii"],
        "ea": spec["eastAsia"],
        "cs": spec["cs"],
    }


def apply_font_to_drawingml_run(a_r_block: str, font_key: str) -> str:
    spec = MONOLINGUAL_EXPORT_FONT_MAP.get(font_key)
    if not spec or not re.search(r"<a:t[\s>]", a_r_block, re.I):
        return a_r_block
    faces = drawingml_typefaces(spec)
    face_xml = "".join(
        f'<a:{tag} typeface="{faces[tag]}"/>' for tag in ("latin", "ea", "cs")
    )
    sc_m = re.search(r"<a:rPr([^>]*)/>", a_r_block, re.I)
    if sc_m:
        attrs = sc_m.group(1) or ""
        new_rpr = f"<a:rPr{attrs}>{face_xml}</a:rPr>"
        return a_r_block[: sc_m.start()] + new_rpr + a_r_block[sc_m.end() :]
    rpr_m = re.search(r"(<a:rPr[^>]*>)([\s\S]*?)(</a:rPr>)", a_r_block, re.I)
    if rpr_m:
        inner = rpr_m.group(2)
        inner = re.sub(r"<a:(?:latin|ea|cs)\b[^>]*/>", "", inner, flags=re.I)
        new_rpr = rpr_m.group(1) + face_xml + inner + rpr_m.group(3)
        return a_r_block[: rpr_m.start()] + new_rpr + a_r_block[rpr_m.end() :]
    open_m = re.match(r"(<a:r\b[^>]*>)", a_r_block, re.I)
    if not open_m:
        return a_r_block
    return open_m.group(1) + f"<a:rPr>{face_xml}</a:rPr>" + a_r_block[open_m.end() :]


PPTX_FONT_SCALE_MIN = 0.1
PPTX_FONT_SCALE_MAX = 1.0


def normalize_pptx_font_scale(scale: Optional[float]) -> Optional[float]:
    if scale is None:
        return None
    try:
        s = float(scale)
    except (TypeError, ValueError):
        return None
    if s < PPTX_FONT_SCALE_MIN or s > PPTX_FONT_SCALE_MAX:
        return None
    return s


def _scaled_sz_int(sz: int, scale: float) -> int:
    return max(100, int(round(sz * scale)))


def _parse_sz_hundredths(val: Optional[str]) -> Optional[int]:
    if val is None or val == "":
        return None
    try:
        n = int(val)
        return n if n > 0 else None
    except ValueError:
        return None


def _sz_from_rpr_parts(inner: str, attrs: str) -> Optional[int]:
    sz_attr = _drawingml_attr_on_tag(attrs, "sz")
    parsed = _parse_sz_hundredths(sz_attr)
    if parsed is not None:
        return parsed
    sz_elem = _drawingml_attr_val(inner, "sz")
    return _parse_sz_hundredths(sz_elem)


def _paragraph_level(p_block: str) -> int:
    ppr_open = re.search(r"<a:pPr([^>]*)>", p_block, re.I)
    if not ppr_open:
        return 0
    lm = re.search(r'\blevel="(\d+)"', ppr_open.group(1), re.I)
    return int(lm.group(1)) if lm else 0


def _defrpr_sz_from_block(attrs: str, inner: str) -> Optional[int]:
    return _sz_from_rpr_parts(inner, attrs)


def _paragraph_default_sz(p_block: str) -> Optional[int]:
    ppr_m = re.search(r"<a:pPr[^>]*>([\s\S]*?)</a:pPr>", p_block, re.I)
    if not ppr_m:
        return None
    ppr_inner = ppr_m.group(1)
    defrpr_m = re.search(
        r"<a:defRPr([^>/]*)(?:>([\s\S]*?)</a:defRPr>|/>)", ppr_inner, re.I
    )
    if not defrpr_m:
        return None
    def_attrs = defrpr_m.group(1) or ""
    def_inner = defrpr_m.group(2) or ""
    return _defrpr_sz_from_block(def_attrs, def_inner)


def _defrpr_sz_from_xml(block: str) -> Optional[int]:
    defrpr_m = re.search(
        r"<a:defRPr([^>/]*)(?:>([\s\S]*?)</a:defRPr>|/>)", block, re.I
    )
    if not defrpr_m:
        return None
    return _defrpr_sz_from_block(defrpr_m.group(1) or "", defrpr_m.group(2) or "")


def _lst_style_sz_from_tx_body(tx_body_xml: str, paragraph_level: int = 0) -> Optional[int]:
    """Read defRPr sz from a:lstStyle lvlNpPr (common for title/body placeholders)."""
    if not tx_body_xml:
        return None
    start_lvl = max(1, paragraph_level + 1)
    for lvl in range(start_lvl, 0, -1):
        m = re.search(
            rf"<a:lvl{lvl}pPr([^>/]*)(?:>([\s\S]*?)</a:lvl{lvl}pPr>|/>)",
            tx_body_xml,
            re.I,
        )
        if not m:
            continue
        inner = m.group(2) or ""
        sz = _defrpr_sz_from_xml(inner) or _defrpr_sz_from_block(m.group(1) or "", inner)
        if sz is not None:
            return sz
    return None


def _tx_body_xml(paragraph: _Paragraph) -> str:
    parent = paragraph._element.getparent()
    if parent is None:
        return ""
    return parent.xml


def _run_sz_hundredths(run) -> Optional[int]:
    try:
        if run.font.size is not None:
            return int(round(run.font.size.pt * 100))
    except Exception:
        return None
    return None


def _paragraph_run_sz_hints(paragraph: _Paragraph) -> List[Optional[int]]:
    return [_run_sz_hundredths(run) for run in paragraph.runs]


def _effective_run_sz(r_block: str, default_sz: Optional[int]) -> Optional[int]:
    default_rpr = ""
    inner, attrs = _drawingml_run_rpr_parts(r_block, default_rpr)
    sz = _sz_from_rpr_parts(inner, attrs)
    return sz if sz is not None else default_sz


def _upsert_rpr_sz_on_attrs(attrs: str, sz: int) -> str:
    sz_attr = f' sz="{sz}"'
    if re.search(r'\bsz="', attrs, re.I):
        return re.sub(r'\bsz="\d+"', f'sz="{sz}"', attrs, count=1, flags=re.I)
    return sz_attr + attrs


def _set_drawingml_run_sz(r_block: str, sz: int) -> str:
    """Write explicit sz onto a run's rPr (attribute or child element)."""
    sc_m = re.search(r"(<a:rPr)([^>]*)(/>)", r_block, re.I)
    if sc_m:
        attrs = _upsert_rpr_sz_on_attrs(sc_m.group(2) or "", sz)
        new_rpr = f"{sc_m.group(1)}{attrs}{sc_m.group(3)}"
        return r_block[: sc_m.start()] + new_rpr + r_block[sc_m.end() :]

    rpr_m = re.search(r"(<a:rPr)([^>]*)(>)([\s\S]*?)(</a:rPr>)", r_block, re.I)
    if rpr_m:
        attrs = _upsert_rpr_sz_on_attrs(rpr_m.group(2) or "", sz)
        inner = rpr_m.group(4)
        inner = re.sub(
            r"<a:sz\b[^>]*\bval=\"\d+\"[^>]*/>",
            f'<a:sz val="{sz}"/>',
            inner,
            count=1,
            flags=re.I,
        )
        if not re.search(r"<a:sz\b", inner, re.I):
            inner = f'<a:sz val="{sz}"/>' + inner
        new_rpr = f"{rpr_m.group(1)}{attrs}{rpr_m.group(3)}{inner}{rpr_m.group(5)}"
        return r_block[: rpr_m.start()] + new_rpr + r_block[rpr_m.end() :]

    open_m = re.match(r"(<a:r\b[^>]*>)", r_block, re.I)
    if not open_m:
        return r_block
    return (
        open_m.group(1)
        + f'<a:rPr sz="{sz}"><a:sz val="{sz}"/></a:rPr>'
        + r_block[open_m.end() :]
    )


def apply_font_scale_to_drawingml_paragraph(
    a_p_block: str,
    scale: float,
    fallback_sz: Optional[int] = None,
    run_sz_hints: Optional[List[Optional[int]]] = None,
) -> str:
    """Scale each run's effective font size; inject sz when inherited from lstStyle/layout."""
    if not scale or abs(scale - 1.0) < 1e-9:
        return a_p_block

    default_sz = _paragraph_default_sz(a_p_block) or fallback_sz
    r_re = re.compile(r"(<a:r\b[\s\S]*?</a:r>)", re.I)
    run_idx = 0

    def repl(m: re.Match[str]) -> str:
        nonlocal run_idx
        block = m.group(1)
        if not re.search(r"<a:t[\s>]", block, re.I):
            return block
        hint: Optional[int] = None
        if run_sz_hints and run_idx < len(run_sz_hints):
            hint = run_sz_hints[run_idx]
        run_idx += 1
        eff = _effective_run_sz(block, hint if hint is not None else default_sz)
        if eff is None:
            return block
        return _set_drawingml_run_sz(block, _scaled_sz_int(eff, scale))

    return r_re.sub(repl, a_p_block)


def apply_font_to_drawingml_paragraph(a_p_block: str, font_key: str) -> str:
    if not font_key or font_key not in MONOLINGUAL_EXPORT_FONT_MAP:
        return a_p_block
    r_re = re.compile(r"(<a:r\b[\s\S]*?</a:r>)", re.I)

    def repl(m: re.Match[str]) -> str:
        return apply_font_to_drawingml_run(m.group(1), font_key)

    return r_re.sub(repl, a_p_block)


def paragraph_xml(paragraph: _Paragraph) -> str:
    return paragraph._element.xml


def replace_paragraph_element(paragraph: _Paragraph, new_p_xml: str) -> None:
    elem = paragraph._element
    parent = elem.getparent()
    if parent is None:
        return
    new_elem = parse_xml(new_p_xml)
    parent.replace(elem, new_elem)


def iter_group_shapes(shapes) -> Iterator:
    for shape in shapes:
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from iter_group_shapes(shape.shapes)
        else:
            yield shape


def iter_paragraphs_from_shape(shape) -> Iterator[_Paragraph]:
    if shape.has_table:
        for row in shape.table.rows:
            for cell in row.cells:
                if cell.text_frame:
                    for para in cell.text_frame.paragraphs:
                        yield para
        return
    if shape.has_text_frame:
        for para in shape.text_frame.paragraphs:
            yield para


def iter_pptx_paragraphs(prs: Presentation) -> Iterator[_Paragraph]:
    for slide in prs.slides:
        for shape in iter_group_shapes(slide.shapes):
            yield from iter_paragraphs_from_shape(shape)
        if slide.has_notes_slide:
            notes_tf = slide.notes_slide.notes_text_frame
            if notes_tf:
                for para in notes_tf.paragraphs:
                    yield para


def paragraph_is_exportable(paragraph: _Paragraph) -> bool:
    p_xml = paragraph_xml(paragraph)
    tagged = extract_tagged_from_drawingml_paragraph(p_xml)
    return bool(tagged and tagged.get("text"))


def build_ordered_translation_targets(units: List[dict]) -> List[str]:
    targets: List[str] = []
    for u in units:
        target = u.get("target")
        if target is None:
            target = u.get("source") or ""
        elif not str(target).strip():
            target = u.get("source") or ""
        targets.append(str(target))
    return targets


def extract_pptx(data: bytes) -> List[dict]:
    prs = Presentation(io.BytesIO(data))
    segments: List[dict] = []
    idx = 0
    for paragraph in iter_pptx_paragraphs(prs):
        if not paragraph_is_exportable(paragraph):
            continue
        p_xml = paragraph_xml(paragraph)
        tagged = extract_tagged_from_drawingml_paragraph(p_xml)
        if not tagged:
            continue
        segments.append(
            {
                "id": f"seg-{idx}",
                "source": tagged["text"],
                "target": "",
                "okapiTuId": f"p-{idx}",
                "inlineRunMeta": tagged.get("inlineRunMeta", []),
            }
        )
        idx += 1
    return segments


def merge_pptx(
    original: bytes,
    units: List[dict],
    font_key: Optional[str] = None,
    font_scale: Optional[float] = None,
) -> bytes:
    ordered_targets = build_ordered_translation_targets(units)
    prs = Presentation(io.BytesIO(original))
    target_idx = 0

    for paragraph in iter_pptx_paragraphs(prs):
        if not paragraph_is_exportable(paragraph):
            continue
        if target_idx >= len(ordered_targets):
            break
        target = ordered_targets[target_idx]
        target_idx += 1
        p_xml = paragraph_xml(paragraph)
        tx_xml = _tx_body_xml(paragraph)
        run_sz_hints = _paragraph_run_sz_hints(paragraph)
        lst_sz = _lst_style_sz_from_tx_body(tx_xml, _paragraph_level(p_xml))
        fallback_sz = next((h for h in run_sz_hints if h is not None), None) or lst_sz

        new_xml = replace_drawingml_paragraph_with_tagged_target(p_xml, target)
        if font_key:
            new_xml = apply_font_to_drawingml_paragraph(new_xml, font_key)
        if font_scale:
            new_xml = apply_font_scale_to_drawingml_paragraph(
                new_xml,
                font_scale,
                fallback_sz=fallback_sz,
                run_sz_hints=run_sz_hints,
            )
        if new_xml != p_xml:
            replace_paragraph_element(paragraph, new_xml)

    out = io.BytesIO()
    prs.save(out)
    return out.getvalue()
