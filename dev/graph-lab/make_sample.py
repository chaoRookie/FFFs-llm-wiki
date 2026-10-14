#!/usr/bin/env python3
"""Builds dev/graph-lab/sample.json from an LLM Wiki project's wiki/ folder.

Usage: python3 dev/graph-lab/make_sample.py /path/to/project/wiki
The output stays local (it is git-ignored) because it contains your page titles.
"""
import json
import re
import sys
from pathlib import Path

wiki = Path(sys.argv[1]).expanduser()
pages = {}
for path in wiki.rglob("*.md"):
    if path.name in ("index.md", "log.md"):
        continue
    text = path.read_text(encoding="utf-8")
    m = re.match(r"---\n(.*?)\n---", text, re.S)
    fm = m.group(1) if m else ""

    def field(key: str) -> str:
        found = re.search(rf'^{key}:\s*"?(.*?)"?\s*$', fm, re.M)
        return found.group(1) if found else ""

    pages[path.stem] = {
        "id": path.stem,
        "label": field("title") or path.stem,
        "type": (field("type") or "other").lower(),
        "trunk": field("trunk") or None,
        "titleZh": field("title_zh") or None,
        "path": path.name,
        "links": {l.split("|")[0].split("/")[-1] for l in re.findall(r"\[\[([^\]]+)\]\]", text)},
    }

edges = {tuple(sorted((p["id"], l))) for p in pages.values() for l in p["links"] if l in pages and l != p["id"]}
degree = {k: 0 for k in pages}
for a, b in edges:
    degree[a] += 1
    degree[b] += 1
nodes = [
    {k: v for k, v in {**{k: p[k] for k in ("id", "label", "type", "path", "trunk", "titleZh")}, "linkCount": degree[p["id"]], "community": 0}.items() if v is not None}
    for p in pages.values()
]
out = Path(__file__).with_name("sample.json")
out.write_text(json.dumps({"nodes": nodes, "edges": [{"source": a, "target": b, "weight": 1} for a, b in edges]}, ensure_ascii=False), encoding="utf-8")
print(f"{len(nodes)} nodes, {len(edges)} edges -> {out}")
