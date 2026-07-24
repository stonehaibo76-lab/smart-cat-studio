"""
Smart-CAT Okapi-style extract sidecar (lightweight Python fallback).

When Supervertaler okapi-sidecar JAR is available at OKAPI_JAR_PATH, forwards to it.
Otherwise provides basic DOCX/HTML/TXT extraction + in-place merge for format preservation.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import zipfile
from typing import Dict, List, Optional
from urllib.parse import quote

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
import uvicorn

app = FastAPI(title="Smart-CAT Okapi Sidecar", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OKAPI_JAR = os.environ.get("OKAPI_JAR_PATH", "").strip()
PORT = int(os.environ.get("OKAPI_PORT", "8090"))


def build_download_name(original_name: str) -> str:
    out_name = original_name or "merged.docx"
    lower = out_name.lower()
    if not lower.endswith((".docx", ".txt", ".html", ".htm", ".pptx")):
        out_name += ".docx"
    if "." in out_name:
        base, ext = out_name.rsplit(".", 1)
    else:
        base, ext = out_name, "docx"
    return f"{base}_译文.{ext}"


def ascii_fallback_filename(name: str) -> str:
    base = name.rsplit(".", 1)[0] if "." in name else name
    ext = name.rsplit(".", 1)[-1] if "." in name else "docx"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._") or "export"
    return f"{safe}_translated.{ext}"


def merge_response_headers(download_name: str) -> dict:
    ascii_name = ascii_fallback_filename(download_name)
    encoded = quote(download_name, safe="")
    name_b64 = base64.b64encode(download_name.encode("utf-8")).decode("ascii")
    return {
        "X-Smartcat-Merge-Ok": "1",
        "X-Smartcat-File-Name-B64": name_b64,
        "X-Smartcat-File-Name": ascii_name,
        "Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}",
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


def looks_like_word_xml(text: str) -> bool:
    t = text.strip()
    if not t:
        return False
    if re.match(r"^<w:[a-z]", t, re.I):
        return True
    return "<w:tc" in t or "<w:p " in t or "<w:rPr" in t


def extract_word_text(block: str, t_re: re.Pattern[str]) -> str:
    return "".join(decode_xml(m.group(1)) for m in t_re.finditer(block)).strip()


# --- Run-level inline formatting (mirror services/inlineFormatting/docxRunExtract.ts) ---

def _attr_val(block: str, tag: str) -> Optional[str]:
    m = re.search(rf"<w:{tag}(?:\s[^>]*)?/?>", block, re.I)
    if not m:
        return None
    vm = re.search(r'\bw:val="([^"]*)"', m.group(0), re.I)
    return vm.group(1) if vm else ""


def _is_truthy(val: Optional[str]) -> bool:
    if val is None:
        return True
    v = val.lower()
    return v not in ("0", "false", "none", "off")


def parse_run_style(rpr_inner: str) -> Optional[dict]:
    if not rpr_inner.strip():
        return None
    style: dict = {}
    if re.search(r"<w:b[\s/>]", rpr_inner, re.I) and _is_truthy(_attr_val(rpr_inner, "b")):
        style["bold"] = True
    if re.search(r"<w:i[\s/>]", rpr_inner, re.I) and _is_truthy(_attr_val(rpr_inner, "i")):
        style["italic"] = True
    if re.search(r"<w:u[\s/>]", rpr_inner, re.I) and _is_truthy(_attr_val(rpr_inner, "u")):
        style["underline"] = True
    if (re.search(r"<w:strike[\s/>]", rpr_inner, re.I) or re.search(r"<w:dstrike[\s/>]", rpr_inner, re.I)) and _is_truthy(
        _attr_val(rpr_inner, "strike") or _attr_val(rpr_inner, "dstrike")
    ):
        style["strike"] = True
    color = _attr_val(rpr_inner, "color")
    if color and color.lower() != "auto":
        style["color"] = color.upper()
    hl = _attr_val(rpr_inner, "highlight")
    if hl and hl.lower() != "none":
        style["highlight"] = hl
    vert = _attr_val(rpr_inner, "vertAlign")
    if vert in ("superscript", "subscript"):
        style["vertAlign"] = vert
    return style if style else None


def style_signature(style: Optional[dict]) -> str:
    if not style:
        return ""
    parts: List[str] = []
    if style.get("bold"):
        parts.append("b")
    if style.get("italic"):
        parts.append("i")
    if style.get("underline"):
        parts.append("u")
    if style.get("strike"):
        parts.append("s")
    if style.get("color"):
        parts.append(f"c:{style['color']}")
    if style.get("highlight"):
        parts.append(f"h:{style['highlight']}")
    if style.get("vertAlign"):
        parts.append(f"v:{style['vertAlign']}")
    return "|".join(parts)


def _paragraph_default_rpr(p_block: str) -> str:
    ppr_m = re.search(r"<w:pPr[^>]*>([\s\S]*?)</w:pPr>", p_block, re.I)
    if not ppr_m:
        return ""
    rpr_m = re.search(r"<w:rPr[^>]*>([\s\S]*?)</w:rPr>", ppr_m.group(1), re.I)
    return rpr_m.group(1) if rpr_m else ""


def _effective_run_rpr(r_block: str, default_rpr: str) -> str:
    rpr_m = re.search(r"<w:rPr[^>]*>([\s\S]*?)</w:rPr>", r_block, re.I)
    if not rpr_m:
        return default_rpr
    inner = rpr_m.group(1)
    if not inner.strip() and default_rpr:
        return default_rpr
    return inner


def extract_run_texts(r_block: str) -> str:
    t_re = re.compile(r"<w:t(?:\s[^>]*)?>([\s\S]*?)</w:t>", re.I)
    return "".join(decode_xml(m.group(1)) for m in t_re.finditer(r_block))


def extract_tagged_from_paragraph(p_block: str) -> Optional[dict]:
    default_rpr = _paragraph_default_rpr(p_block)
    r_re = re.compile(r"<w:r[\s>][\s\S]*?</w:r>", re.I)
    runs: List[dict] = []
    for rm in r_re.finditer(p_block):
        text = extract_run_texts(rm.group(0))
        if not text:
            continue
        style = parse_run_style(_effective_run_rpr(rm.group(0), default_rpr))
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


TAG_PART_RE = re.compile(
    r"(<([A-Za-z0-9_]+)>(.*?)</\2>)|([^<]+)|(<([A-Za-z0-9_]+)/>)",
    re.S,
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


def has_inline_markers(text: str) -> bool:
    return bool(re.search(r"<[A-Za-z0-9_]+[>/]", text or ""))


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


def analyze_paragraph_runs(p_block: str) -> List[dict]:
    default_rpr = _paragraph_default_rpr(p_block)
    r_re = re.compile(r"<w:r[\s>][\s\S]*?</w:r>", re.I)
    infos: List[dict] = []
    next_id = 1
    for rm in r_re.finditer(p_block):
        text = extract_run_texts(rm.group(0))
        if not text:
            continue
        style = parse_run_style(_effective_run_rpr(rm.group(0), default_rpr))
        tag_id = None
        # Match import: any run with explicit w:rPr formatting gets a tag id.
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


def set_run_text(r_block: str, new_text: str) -> str:
    t_re = re.compile(r"(<w:t(?:\s[^>]*)?>)([\s\S]*?)(</w:t>)", re.I)
    seen = False

    def repl(m: re.Match[str]) -> str:
        nonlocal seen
        if not seen:
            seen = True
            open_tag = m.group(1)
            preserve = (
                ' xml:space="preserve"'
                if (new_text.startswith(" ") or new_text.endswith(" ") or "  " in new_text)
                else ""
            )
            if preserve and 'xml:space="preserve"' not in open_tag:
                open_tag = open_tag.replace("<w:t", '<w:t xml:space="preserve"', 1)
            return open_tag + escape_xml_text(new_text) + m.group(3)
        return m.group(1) + m.group(3)

    out = t_re.sub(repl, r_block)
    if not seen:
        insert = f'<w:t xml:space="preserve">{escape_xml_text(new_text)}</w:t>'
        out = re.sub(r"</w:r>\s*$", insert + "</w:r>", out, count=1, flags=re.I)
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
    """When target has no inline tags, never put text into formatted runs."""
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
    """Map tagged target parts onto formatted Word runs."""
    texts: List[str] = [""] * len(run_infos)
    tagged_parts = [p for p in parts if p["type"] == "tagged"]
    tagged_run_indices = [i for i, r in enumerate(run_infos) if r["tag_id"]]
    if not tagged_parts or not tagged_run_indices:
        return texts

    if len(tagged_parts) < len(tagged_run_indices):
        # Partial formatting (e.g. only sub/sup digits): align to trailing styled runs.
        assign_to = tagged_run_indices[-len(tagged_parts) :]
        for p, ri in zip(tagged_parts, assign_to):
            texts[ri] = p["text"]
        return texts

    # Same count: prefer exact tag-id matches, then fill leftovers in order.
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


def compute_run_target_texts(run_infos: List[dict], new_text: str) -> List[str]:
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
    if not plain_run_indices:
        return texts

    if not plain_parts:
        return texts

    if len(plain_parts) == len(plain_run_indices):
        for idx, part in zip(plain_run_indices, plain_parts):
            texts[idx] = part
        return texts

    # Prefer filling plain runs sandwiched between formatted runs (e.g. "和" / " and "),
    # then trailing, then leading — so targets without a translated prefix still align.
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


def apply_run_texts_to_paragraph(p_block: str, run_infos: List[dict], texts: List[str]) -> str:
    if len(run_infos) != len(texts):
        weights = [r["weight"] or 1 for r in run_infos]
        texts = proportional_split(strip_inline_markers("".join(texts)), weights)

    r_re = re.compile(r"(<w:r[\s>][\s\S]*?</w:r>)", re.I)
    info_iter = iter(run_infos)
    text_iter = iter(texts)
    current_info = next(info_iter, None)
    current_text = next(text_iter, None)

    def repl(m: re.Match[str]) -> str:
        nonlocal current_info, current_text
        block = m.group(1)
        if not re.search(r"<w:t", block, re.I):
            return block
        if current_info is None:
            return block
        new_block = set_run_text(block, current_text or "")
        current_info = next(info_iter, None)
        current_text = next(text_iter, None)
        return new_block

    return r_re.sub(repl, p_block)


def replace_paragraph_with_tagged_target(p_block: str, new_text: str) -> str:
    if new_text is None:
        return p_block
    run_infos = analyze_paragraph_runs(p_block)
    if not run_infos:
        return p_block
    texts = compute_run_target_texts(run_infos, new_text)
    return apply_run_texts_to_paragraph(p_block, run_infos, texts)


def replace_paragraph_translations(p_block: str, new_text: str) -> str:
    """Replace visible text in a paragraph while keeping run/paragraph properties."""
    return replace_paragraph_with_tagged_target(p_block, new_text)


MONOLINGUAL_EXPORT_FONT_MAP: Dict[str, Dict[str, str]] = {
    "simsun": {
        "ascii": "SimSun",
        "hAnsi": "SimSun",
        "eastAsia": "宋体",
        "cs": "SimSun",
        "css": "SimSun, 宋体, serif",
    },
    "times-new-roman": {
        "ascii": "Times New Roman",
        "hAnsi": "Times New Roman",
        "eastAsia": "Times New Roman",
        "cs": "Times New Roman",
        "css": "'Times New Roman', Times, serif",
    },
    "arial": {
        "ascii": "Arial",
        "hAnsi": "Arial",
        "eastAsia": "Arial",
        "cs": "Arial",
        "css": "Arial, sans-serif",
    },
}


def build_rfonts_xml(spec: Dict[str, str]) -> str:
    return (
        f'<w:rFonts w:ascii="{spec["ascii"]}" w:hAnsi="{spec["hAnsi"]}" '
        f'w:eastAsia="{spec["eastAsia"]}" w:cs="{spec["cs"]}"/>'
    )


def strip_existing_rfonts(inner: str) -> str:
    inner = re.sub(r"<w:rFonts\b[^>]*/>", "", inner, flags=re.I)
    inner = re.sub(r"<w:rFonts\b[^>]*>[\s\S]*?</w:rFonts>", "", inner, flags=re.I)
    return inner


def inject_font_into_rpr_inner(inner: str, rfonts: str) -> str:
    return rfonts + strip_existing_rfonts(inner)


def apply_font_to_rpr_block(rpr_block: str, rfonts: str) -> str:
    sc_m = re.match(r"<w:rPr\b[^>]*/>", rpr_block, re.I)
    if sc_m:
        return f"<w:rPr>{rfonts}</w:rPr>"
    rpr_m = re.search(r"(<w:rPr[^>]*>)([\s\S]*?)(</w:rPr>)", rpr_block, re.I)
    if not rpr_m:
        return f"<w:rPr>{rfonts}</w:rPr>"
    inner = inject_font_into_rpr_inner(rpr_m.group(2), rfonts)
    return rpr_m.group(1) + inner + rpr_m.group(3)


def apply_font_to_run(r_block: str, font_key: str) -> str:
    spec = MONOLINGUAL_EXPORT_FONT_MAP.get(font_key)
    if not spec or not re.search(r"<w:t", r_block, re.I):
        return r_block
    rfonts = build_rfonts_xml(spec)

    sc_m = re.search(r"<w:rPr\b[^>]*/>", r_block, re.I)
    if sc_m:
        new_rpr = f"<w:rPr>{rfonts}</w:rPr>"
        return r_block[: sc_m.start()] + new_rpr + r_block[sc_m.end() :]

    rpr_m = re.search(r"(<w:rPr[^>]*>)([\s\S]*?)(</w:rPr>)", r_block, re.I)
    if rpr_m:
        inner = inject_font_into_rpr_inner(rpr_m.group(2), rfonts)
        new_rpr = rpr_m.group(1) + inner + rpr_m.group(3)
        return r_block[: rpr_m.start()] + new_rpr + r_block[rpr_m.end() :]

    open_m = re.match(r"(<w:r(?:\s[^>]*)?>)", r_block, re.I)
    if not open_m:
        return r_block
    return open_m.group(1) + f"<w:rPr>{rfonts}</w:rPr>" + r_block[open_m.end() :]


def apply_font_to_ppr(p_block: str, font_key: str) -> str:
    spec = MONOLINGUAL_EXPORT_FONT_MAP.get(font_key)
    if not spec:
        return p_block
    rfonts = build_rfonts_xml(spec)
    ppr_m = re.search(r"(<w:pPr[^>]*>)([\s\S]*?)(</w:pPr>)", p_block, re.I)
    if ppr_m:
        inner = ppr_m.group(2)
        sc_rpr = re.search(r"<w:rPr\b[^>]*/>", inner, re.I)
        rpr_m = re.search(r"(<w:rPr[^>]*>)([\s\S]*?)(</w:rPr>)", inner, re.I)
        if sc_rpr:
            new_rpr = f"<w:rPr>{rfonts}</w:rPr>"
            new_inner = inner[: sc_rpr.start()] + new_rpr + inner[sc_rpr.end() :]
        elif rpr_m:
            rpr_inner = inject_font_into_rpr_inner(rpr_m.group(2), rfonts)
            new_rpr = rpr_m.group(1) + rpr_inner + rpr_m.group(3)
            new_inner = inner[: rpr_m.start()] + new_rpr + inner[rpr_m.end() :]
        else:
            new_inner = inner + f"<w:rPr>{rfonts}</w:rPr>"
        return p_block[: ppr_m.start()] + ppr_m.group(1) + new_inner + ppr_m.group(3) + p_block[ppr_m.end() :]

    open_m = re.match(r"(<w:p(?:\s[^>]*)?>)", p_block, re.I)
    if not open_m:
        return p_block
    insert = open_m.group(1) + f"<w:pPr><w:rPr>{rfonts}</w:rPr></w:pPr>"
    return insert + p_block[open_m.end() :]


def apply_font_to_paragraph(p_block: str, font_key: str) -> str:
    if not font_key or font_key not in MONOLINGUAL_EXPORT_FONT_MAP:
        return p_block
    p_block = apply_font_to_ppr(p_block, font_key)
    r_re = re.compile(r"(<w:r[\s>][\s\S]*?</w:r>)", re.I)

    def repl(m: re.Match[str]) -> str:
        return apply_font_to_run(m.group(1), font_key)

    return r_re.sub(repl, p_block)


def paragraph_is_exportable(p_block: str) -> bool:
    tagged = extract_tagged_from_paragraph(p_block)
    return bool(tagged and tagged.get("text"))


def drop_strictly_nested_spans(spans: List[tuple[int, int]]) -> List[tuple[int, int]]:
    """Drop w:p spans wholly contained in another (keep outer host incl. text boxes)."""
    kept: List[tuple[int, int]] = []
    for s, e in spans:
        if any(
            s2 <= s and e <= e2 and (s2 < s or e < e2)
            for s2, e2 in spans
            if (s2, e2) != (s, e)
        ):
            continue
        kept.append((s, e))
    return kept


def find_all_wp_block_spans(xml: str) -> List[tuple[int, int]]:
    """Return (start, end) of each w:p block, handling nested paragraphs (text boxes)."""
    spans: List[tuple[int, int]] = []
    n = len(xml)
    open_re = re.compile(r"<w:p[\s>]", re.I)
    close_re = re.compile(r"</w:p>", re.I)
    i = 0
    while i < n:
        om = open_re.search(xml, i)
        if not om:
            break
        start = om.start()
        depth = 1
        pos = om.end()
        while pos < n and depth > 0:
            om2 = open_re.search(xml, pos)
            cm = close_re.search(xml, pos)
            if not cm:
                break
            if om2 and om2.start() < cm.start():
                depth += 1
                pos = om2.end()
            else:
                depth -= 1
                pos = cm.end()
                if depth == 0:
                    spans.append((start, pos))
        i = start + 1
    return drop_strictly_nested_spans(spans)


def apply_xml_replacements_from_end(xml: str, replacements: List[tuple[int, int, str]]) -> str:
    for start, end, new in sorted(replacements, key=lambda x: x[0], reverse=True):
        xml = xml[:start] + new + xml[end:]
    return xml


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
    rpr_m = re.search(r"(<a:rPr\b[^>]*>)([\s\S]*?)(</a:rPr>)", a_r_block, re.I)
    if rpr_m:
        inner = rpr_m.group(2)
        inner = re.sub(r"<a:(?:latin|ea|cs)\b[^>]*/>", "", inner, flags=re.I)
        new_rpr = rpr_m.group(1) + face_xml + inner + rpr_m.group(3)
        return a_r_block[: rpr_m.start()] + new_rpr + a_r_block[rpr_m.end() :]
    sc_m = re.search(r"<a:rPr\b[^>]*/>", a_r_block, re.I)
    if sc_m:
        new_rpr = f"<a:rPr>{face_xml}</a:rPr>"
        return a_r_block[: sc_m.start()] + new_rpr + a_r_block[sc_m.end() :]
    open_m = re.match(r"(<a:r\b[^>]*>)", a_r_block, re.I)
    if not open_m:
        return a_r_block
    return open_m.group(1) + f"<a:rPr>{face_xml}</a:rPr>" + a_r_block[open_m.end() :]


def apply_font_to_drawingml_paragraph(a_p_block: str, font_key: str) -> str:
    if not font_key or font_key not in MONOLINGUAL_EXPORT_FONT_MAP:
        return a_p_block
    r_re = re.compile(r"(<a:r\b[\s\S]*?</a:r>)", re.I)

    def repl(m: re.Match[str]) -> str:
        return apply_font_to_drawingml_run(m.group(1), font_key)

    return r_re.sub(repl, a_p_block)


def extract_drawingml_paragraph_text(a_p_block: str) -> Optional[str]:
    t_re = re.compile(r"<a:t(?:\s[^>]*)?>([\s\S]*?)</a:t>", re.I)
    parts = [decode_xml(m.group(1)) for m in t_re.finditer(a_p_block)]
    text = "".join(parts).strip()
    return text or None


def replace_drawingml_paragraph_text(a_p_block: str, new_text: str) -> str:
    t_re = re.compile(r"(<a:t(?:\s[^>]*)?>)([\s\S]*?)(</a:t>)", re.I)
    seen = False

    def repl(m: re.Match[str]) -> str:
        nonlocal seen
        if not seen:
            seen = True
            return m.group(1) + escape_xml_text(new_text) + m.group(3)
        return m.group(1) + m.group(3)

    return t_re.sub(repl, a_p_block)


def find_all_drawingml_paragraph_spans(xml: str) -> List[tuple[int, int]]:
    """a:p blocks inside a:txBody (shape / text-box DrawingML text)."""
    spans: List[tuple[int, int]] = []
    n = len(xml)
    open_re = re.compile(r"<a:p\b[\s>]", re.I)
    close_re = re.compile(r"</a:p>", re.I)
    i = 0
    while i < n:
        om = open_re.search(xml, i)
        if not om:
            break
        start = om.start()
        depth = 1
        pos = om.end()
        while pos < n and depth > 0:
            om2 = open_re.search(xml, pos)
            cm = close_re.search(xml, pos)
            if not cm:
                break
            if om2 and om2.start() < cm.start():
                depth += 1
                pos = om2.end()
            else:
                depth -= 1
                pos = cm.end()
                if depth == 0:
                    spans.append((start, pos))
        i = start + 1
    return drop_strictly_nested_spans(spans)


def collect_docx_text_unit_spans(xml: str) -> List[tuple[str, int, int]]:
    """Document-order exportable units: Word paragraphs and DrawingML shape text."""
    units: List[tuple[str, int, int, int]] = []
    for start, end in find_all_wp_block_spans(xml):
        units.append(("wp", start, end, start))
    for start, end in find_all_drawingml_paragraph_spans(xml):
        units.append(("drawingml", start, end, start))
    units.sort(key=lambda item: item[3])
    return [(kind, start, end) for kind, start, end, _ in units]


def paragraph_is_exportable_block(block: str, kind: str) -> bool:
    if kind == "wp":
        return paragraph_is_exportable(block)
    return extract_drawingml_paragraph_text(block) is not None


def apply_text_to_unit_block(block: str, kind: str, target: str, font_key: Optional[str]) -> str:
    if kind == "wp":
        block = replace_paragraph_translations(block, target)
        if font_key:
            block = apply_font_to_paragraph(block, font_key)
        return block
    block = replace_drawingml_paragraph_text(block, target)
    if font_key:
        block = apply_font_to_drawingml_paragraph(block, font_key)
    return block


def apply_font_to_drawingml_paragraph_defrpr(a_p_block: str, font_key: str) -> str:
    spec = MONOLINGUAL_EXPORT_FONT_MAP.get(font_key)
    if not spec:
        return a_p_block
    faces = drawingml_typefaces(spec)
    face_xml = "".join(
        f'<a:{tag} typeface="{faces[tag]}"/>' for tag in ("latin", "ea", "cs")
    )
    ppr_m = re.search(r"(<a:pPr\b[^>]*>)([\s\S]*?)(</a:pPr>)", a_p_block, re.I)
    if ppr_m:
        inner = ppr_m.group(2)
        defrpr_m = re.search(r"(<a:defRPr\b[^>]*>)([\s\S]*?)(</a:defRPr>)", inner, re.I)
        if defrpr_m:
            d_inner = defrpr_m.group(2)
            d_inner = re.sub(r"<a:(?:latin|ea|cs)\b[^>]*/>", "", d_inner, flags=re.I)
            new_def = defrpr_m.group(1) + face_xml + d_inner + defrpr_m.group(3)
            inner = inner[: defrpr_m.start()] + new_def + inner[defrpr_m.end() :]
        else:
            inner = inner + f"<a:defRPr>{face_xml}</a:defRPr>"
        return a_p_block[: ppr_m.start()] + ppr_m.group(1) + inner + ppr_m.group(3) + a_p_block[ppr_m.end() :]
    open_m = re.match(r"(<a:p\b[^>]*>)", a_p_block, re.I)
    if not open_m:
        return a_p_block
    insert = open_m.group(1) + f"<a:pPr><a:defRPr>{face_xml}</a:defRPr></a:pPr>"
    return insert + a_p_block[open_m.end() :]


def rewrite_drawingml_typeface_attrs(xml: str, font_key: str) -> str:
    """Replace theme typefaces (+mn-lt, Calibri, …) in all a:latin/a:ea/a:cs."""
    spec = MONOLINGUAL_EXPORT_FONT_MAP.get(font_key)
    if not spec:
        return xml
    faces = drawingml_typefaces(spec)
    for tag in ("latin", "ea", "cs"):
        val = faces[tag]
        xml = re.sub(
            rf'(<a:{tag}\b typeface=")[^"]*(")',
            rf"\1{val}\2",
            xml,
            flags=re.I,
        )
    return xml


def rewrite_all_word_rfonts(xml: str, font_key: str) -> str:
    spec = MONOLINGUAL_EXPORT_FONT_MAP.get(font_key)
    if not spec:
        return xml
    rfonts = build_rfonts_xml(spec)
    return re.sub(r"<w:rFonts\b[^>]*/>", rfonts, xml, flags=re.I)


def rewrite_drawingml_defrpr_in_txbody(xml: str, font_key: str) -> str:
    """Shape text boxes often inherit font from a:txBody/a:lstStyle/a:defRPr."""
    spec = MONOLINGUAL_EXPORT_FONT_MAP.get(font_key)
    if not spec:
        return xml
    faces = drawingml_typefaces(spec)
    face_xml = "".join(
        f'<a:{tag} typeface="{faces[tag]}"/>' for tag in ("latin", "ea", "cs")
    )

    def patch_defrpr(m: re.Match[str]) -> str:
        inner = m.group(2)
        inner = re.sub(r"<a:(?:latin|ea|cs)\b[^>]*/>", "", inner, flags=re.I)
        return m.group(1) + face_xml + inner + m.group(3)

    def patch_txbody(m: re.Match[str]) -> str:
        body = m.group(0)
        body = re.sub(
            r"(<a:defRPr\b[^>]*>)([\s\S]*?)(</a:defRPr>)",
            patch_defrpr,
            body,
            flags=re.I,
        )
        return body

    return re.sub(r"<a:txBody\b[\s\S]*?</a:txBody>", patch_txbody, xml, flags=re.I)


def apply_font_globally_to_docx_xml(xml: str, font_key: Optional[str]) -> str:
    """Ensure every visible text run (body, tables, text boxes) uses the export font."""
    if not font_key or font_key not in MONOLINGUAL_EXPORT_FONT_MAP:
        return xml

    xml = rewrite_all_word_rfonts(xml, font_key)
    xml = rewrite_drawingml_typeface_attrs(xml, font_key)
    xml = rewrite_drawingml_defrpr_in_txbody(xml, font_key)

    wr_re = re.compile(r"(<w:r[\s>][\s\S]*?</w:r>)", re.I)
    xml = wr_re.sub(lambda m: apply_font_to_run(m.group(1), font_key), xml)

    ar_re = re.compile(r"(<a:r\b[\s\S]*?</a:r>)", re.I)
    xml = ar_re.sub(lambda m: apply_font_to_drawingml_run(m.group(1), font_key), xml)

    p_replacements: List[tuple[int, int, str]] = []
    for start, end in find_all_wp_block_spans(xml):
        block = xml[start:end]
        if re.search(r"<w:t[\s>]", block, re.I):
            new_block = apply_font_to_ppr(block, font_key)
            if new_block != block:
                p_replacements.append((start, end, new_block))
    xml = apply_xml_replacements_from_end(xml, p_replacements)

    a_replacements: List[tuple[int, int, str]] = []
    for start, end in find_all_drawingml_paragraph_spans(xml):
        block = xml[start:end]
        if extract_drawingml_paragraph_text(block):
            new_block = apply_font_to_drawingml_paragraph_defrpr(block, font_key)
            new_block = apply_font_to_drawingml_paragraph(new_block, font_key)
            if new_block != block:
                a_replacements.append((start, end, new_block))
    xml = apply_xml_replacements_from_end(xml, a_replacements)
    return xml


def build_translation_map(units: List[dict]) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    for u in units:
        target = (u.get("target") or u.get("source") or "").strip()
        if not target and u.get("target") is None:
            target = u.get("source") or ""
        for key in ("okapiTuId", "id"):
            val = u.get(key)
            if val is not None and str(val).strip():
                mapping[str(val).strip()] = target
    return mapping


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


def apply_docx_translations(
    xml: str,
    ordered_targets: List[str],
    font_key: Optional[str] = None,
) -> str:
    """Apply translations in document order (Word body, tables, text boxes, shape text)."""
    replacements: List[tuple[int, int, str]] = []
    target_idx = 0

    for kind, start, end in collect_docx_text_unit_spans(xml):
        block = xml[start:end]
        if not paragraph_is_exportable_block(block, kind):
            continue
        if target_idx >= len(ordered_targets):
            continue
        target = ordered_targets[target_idx]
        target_idx += 1
        new_block = apply_text_to_unit_block(block, kind, target, font_key)
        if new_block != block:
            replacements.append((start, end, new_block))

    if not replacements:
        return xml
    return apply_xml_replacements_from_end(xml, replacements)


def merge_docx(original: bytes, units: List[dict], font_key: Optional[str] = None) -> bytes:
    ordered_targets = build_ordered_translation_targets(units)
    buf_in = io.BytesIO(original)
    buf_out = io.BytesIO()
    with zipfile.ZipFile(buf_in, "r") as zin:
        xml = zin.read("word/document.xml").decode("utf-8", errors="replace")
        new_xml = apply_docx_translations(xml, ordered_targets, font_key)
        if font_key:
            new_xml = apply_font_globally_to_docx_xml(new_xml, font_key)
        with zipfile.ZipFile(buf_out, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename == "word/document.xml":
                    data = new_xml.encode("utf-8")
                zout.writestr(item, data)
    return buf_out.getvalue()


def merge_txt(original: bytes, units: List[dict]) -> bytes:
    ordered_targets = build_ordered_translation_targets(units)
    text = original.decode("utf-8", errors="replace")
    lines = text.splitlines(keepends=True)
    seg_idx = 0
    out: List[str] = []
    for line in lines:
        stripped = line.rstrip("\r\n")
        if not stripped.strip():
            out.append(line)
            continue
        if seg_idx < len(ordered_targets):
            ending = line[len(stripped) :]
            out.append(ordered_targets[seg_idx] + ending)
        else:
            out.append(line)
        seg_idx += 1
    return "".join(out).encode("utf-8")


def merge_html(original: bytes, units: List[dict], font_key: Optional[str] = None) -> bytes:
    ordered_targets = build_ordered_translation_targets(units)
    text = original.decode("utf-8", errors="replace")
    seg_idx = 0
    font_css = MONOLINGUAL_EXPORT_FONT_MAP.get(font_key or "", {}).get("css")

    def repl(m: re.Match[str]) -> str:
        nonlocal seg_idx
        inner = m.group(1)
        if not inner.strip() or inner.strip().startswith("<"):
            return m.group(0)
        if seg_idx >= len(ordered_targets):
            seg_idx += 1
            return m.group(0)
        body = escape_xml_text(ordered_targets[seg_idx])
        seg_idx += 1
        if font_css:
            return f'><span style="font-family:{font_css}">' + body + "</span><"
        return ">" + body + "<"

    merged = re.sub(r">([^<>]+)<", repl, text)
    return merged.encode("utf-8")


def extract_tagged_from_cell(cell_block: str) -> Optional[dict]:
    p_m = re.search(r"<w:p[\s>][\s\S]*?</w:p>", cell_block, re.I)
    if not p_m:
        return None
    return extract_tagged_from_paragraph(p_m.group(0))


def extract_docx_pairs(data: bytes) -> List[dict]:
    segments: List[dict] = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        xml = zf.read("word/document.xml").decode("utf-8", errors="replace")

    row_re = re.compile(r"<w:tr[\s>][\s\S]*?</w:tr>", re.I)
    cell_re = re.compile(r"<w:tc[\s>][\s\S]*?</w:tc>", re.I)
    t_re = re.compile(r"<w:t[^>]*>([\s\S]*?)</w:t>", re.I)

    idx = 0
    for row in row_re.finditer(xml):
        cell_blocks = [cm.group(0) for cm in cell_re.finditer(row.group(0))]
        if len(cell_blocks) != 2:
            continue
        src_tagged = extract_tagged_from_cell(cell_blocks[0])
        tgt_tagged = extract_tagged_from_cell(cell_blocks[1])
        cells = [
            src_tagged["text"] if src_tagged else extract_word_text(cell_blocks[0], t_re),
            tgt_tagged["text"] if tgt_tagged else extract_word_text(cell_blocks[1], t_re),
        ]
        if not cells[0] or not cells[1]:
            continue
        if looks_like_word_xml(cells[0]) or looks_like_word_xml(cells[1]):
            continue
        if idx == 0 and cells[0].lower() in ("source", "原文") and cells[1].lower() in ("target", "译文"):
            continue
        segments.append(
            {
                "id": f"seg-{idx}",
                "source": cells[0],
                "target": cells[1],
                "okapiTuId": f"p-{idx}",
                "inlineRunMeta": src_tagged.get("inlineRunMeta", []) if src_tagged else [],
            }
        )
        idx += 1

    if len(segments) >= 2:
        return segments

    return extract_monolingual_docx(data)


def extract_monolingual_docx(data: bytes) -> List[dict]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        xml = zf.read("word/document.xml").decode("utf-8", errors="replace")
    paras: List[dict] = []
    for kind, start, end in collect_docx_text_unit_spans(xml):
        block = xml[start:end]
        if kind == "wp":
            tagged = extract_tagged_from_paragraph(block)
            if tagged and tagged.get("text") and not looks_like_word_xml(tagged["text"]):
                paras.append(tagged)
        else:
            text = extract_drawingml_paragraph_text(block)
            if text and not looks_like_word_xml(text):
                paras.append({"text": text, "inlineRunMeta": []})
    return [
        {
            "id": f"seg-{i}",
            "source": t["text"],
            "target": "",
            "okapiTuId": f"p-{i}",
            "inlineRunMeta": t.get("inlineRunMeta", []),
        }
        for i, t in enumerate(paras)
    ]


def extract_html(data: bytes) -> List[dict]:
    text = data.decode("utf-8", errors="replace")
    blocks = re.findall(r">([^<>]+)<", text)
    cleaned = [b.strip() for b in blocks if b.strip()]
    return [
        {"id": f"seg-{i}", "source": t, "target": "", "okapiTuId": f"p-{i}"}
        for i, t in enumerate(cleaned)
        if t
    ]


def extract_txt(data: bytes) -> List[dict]:
    lines = [ln.strip() for ln in data.decode("utf-8", errors="replace").splitlines() if ln.strip()]
    return [
        {"id": f"seg-{i}", "source": ln, "target": "", "okapiTuId": f"p-{i}"}
        for i, ln in enumerate(lines)
    ]


@app.get("/health")
def health():
    try:
        from pptx_handler import extract_pptx  # noqa: F401

        pptx_supported = True
    except ImportError:
        pptx_supported = False
    return {
        "ok": True,
        "version": "0.2.0-smartcat",
        "okapiJarConfigured": bool(OKAPI_JAR and os.path.isfile(OKAPI_JAR)),
        "mergeSupported": True,
        "pptxSupported": pptx_supported,
    }


@app.post("/extract")
async def extract(file: UploadFile = File(...)):
    name = (file.filename or "file").lower()
    data = await file.read()
    if not data:
        return JSONResponse({"ok": False, "error": "empty file"}, status_code=400)

    try:
        if name.endswith(".docx"):
            segments = extract_docx_pairs(data)
        elif name.endswith((".html", ".htm")):
            segments = extract_html(data)
        elif name.endswith(".txt"):
            segments = extract_txt(data)
        elif name.endswith(".pptx"):
            from pptx_handler import extract_pptx

            segments = extract_pptx(data)
        else:
            return JSONResponse(
                {
                    "ok": False,
                    "error": f"Unsupported format in lightweight sidecar: {name}. Install Okapi JAR for IDML/XLIFF.",
                },
                status_code=400,
            )
        if not segments:
            return JSONResponse({"ok": False, "error": "No segments extracted"}, status_code=422)
        return {"ok": True, "segments": segments, "fileName": file.filename}
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.post("/merge")
async def merge(
    file: UploadFile = File(...),
    segments_json: str = Form(...),
    export_font: Optional[str] = Form(None),
    pptx_font_scale: Optional[str] = Form(None),
):
    name = (file.filename or "file").lower()
    data = await file.read()
    if not data:
        return JSONResponse({"ok": False, "error": "empty file"}, status_code=400)
    try:
        units = json.loads(segments_json)
        if not isinstance(units, list):
            raise ValueError("segments_json must be a JSON array")
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"invalid segments_json: {e}"}, status_code=400)

    font_key = (export_font or "").strip() or None
    if font_key and font_key not in MONOLINGUAL_EXPORT_FONT_MAP:
        return JSONResponse({"ok": False, "error": f"unsupported export_font: {font_key}"}, status_code=400)

    pptx_scale = None
    if (pptx_font_scale or "").strip():
        from pptx_handler import normalize_pptx_font_scale

        pptx_scale = normalize_pptx_font_scale(pptx_font_scale)
        if pptx_scale is None:
            return JSONResponse(
                {"ok": False, "error": "pptx_font_scale must be between 0.1 and 1"},
                status_code=400,
            )

    try:
        if name.endswith(".docx"):
            merged = merge_docx(data, units, font_key)
            mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif name.endswith(".txt"):
            merged = merge_txt(data, units)
            mime = "text/plain; charset=utf-8"
        elif name.endswith((".html", ".htm")):
            merged = merge_html(data, units, font_key)
            mime = "text/html; charset=utf-8"
        elif name.endswith(".pptx"):
            from pptx_handler import merge_pptx

            merged = merge_pptx(data, units, font_key, pptx_scale)
            mime = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        else:
            return JSONResponse({"ok": False, "error": f"merge not supported for {name}"}, status_code=400)

        download_name = build_download_name(file.filename or "merged.docx")

        return Response(
            content=merged,
            media_type=mime,
            headers=merge_response_headers(download_name),
        )
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.post("/postprocess/pptx-font-scale")
async def postprocess_pptx_font_scale(
    file: UploadFile = File(...),
    pptx_font_scale: str = Form(...),
):
    name = (file.filename or "merged.pptx").lower()
    if not name.endswith(".pptx"):
        return JSONResponse(
            {"ok": False, "error": "postprocess/pptx-font-scale requires a .pptx file"},
            status_code=400,
        )
    data = await file.read()
    if not data:
        return JSONResponse({"ok": False, "error": "empty file"}, status_code=400)

    from pptx_handler import normalize_pptx_font_scale, scale_pptx_fonts

    scale = normalize_pptx_font_scale(pptx_font_scale)
    if scale is None:
        return JSONResponse(
            {"ok": False, "error": "pptx_font_scale must be between 0.1 and 1"},
            status_code=400,
        )

    try:
        merged = scale_pptx_fonts(data, scale)
        download_name = build_download_name(file.filename or "merged.pptx")
        mime = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        return Response(
            content=merged,
            media_type=mime,
            headers=merge_response_headers(download_name),
        )
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
