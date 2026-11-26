"""Refresh or verify the local asset fingerprints in the GitHub Pages HTML."""

import argparse
from hashlib import sha256
from pathlib import Path
import re
from urllib.parse import urlsplit


ASSET_TAG = re.compile(r"<(?:script|link)\b[^>]*>", re.IGNORECASE)
ASSET_URL = re.compile(r"""\b(src|href)=(["'])([^"']+)\2""", re.IGNORECASE)
ASSET_TYPES = {".js", ".css", ".svg", ".ico", ".png"}


def fingerprint(page, docs):
    def update_tag(tag):
        def update_url(match):
            attribute, quote, url = match.groups()
            parsed = urlsplit(url)
            if parsed.scheme or parsed.netloc or Path(parsed.path).suffix not in ASSET_TYPES:
                return match.group()
            asset = (page.parent / parsed.path).resolve()
            if not asset.is_relative_to(docs) or not asset.is_file():
                raise ValueError(f"{page.name} references a missing or non-local asset: {url}")
            token = sha256(asset.read_bytes()).hexdigest()[:16]
            return f"{attribute}={quote}{parsed.path}?v={token}{quote}"

        return ASSET_URL.sub(update_url, tag.group())

    return ASSET_TAG.sub(update_tag, page.read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Report stale HTML without writing files")
    args = parser.parse_args()
    docs = Path(__file__).resolve().parents[1] / "docs"
    stale = []
    for page in sorted(docs.glob("*.html")):
        updated = fingerprint(page, docs)
        if updated == page.read_text(encoding="utf-8"):
            continue
        if args.check:
            stale.append(page.name)
        else:
            page.write_text(updated, encoding="utf-8")
    if stale:
        parser.exit(1, "Stale asset fingerprints: " + ", ".join(stale) + "\n")


if __name__ == "__main__":
    main()
