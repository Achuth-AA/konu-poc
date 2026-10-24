"""Command line: ``python -m konu_crawlers --help``."""

from __future__ import annotations

import argparse
import logging
import sys
import time

from . import REGISTRY, BlockedError, CaptchaRequired, FetchError, Fetcher, get_crawler
from .output import Writer, out_path


def _options(pairs: list[str]) -> dict[str, str]:
    out = {}
    for p in pairs:
        if "=" not in p:
            raise SystemExit(f"--opt expects key=value, got {p!r}")
        k, v = p.split("=", 1)
        out[k.strip().replace("-", "_")] = v
    return out


def cmd_list(_: argparse.Namespace) -> int:
    print(f"{'source':<14} {'types':<38} notes")
    for name in sorted(REGISTRY):
        c = REGISTRY[name]
        notes = []
        if c.interactive:
            notes.append("captcha typed by operator")
        if c.needs_browser:
            notes.append("uses headless Chromium")
        print(f"{name:<14} {', '.join(c.transactions):<38} {c.title}{' – ' + '; '.join(notes) if notes else ''}")
    return 0


def cmd_crawl(a: argparse.Namespace) -> int:
    names = sorted(REGISTRY) if a.source == ["all"] else a.source
    for n in names:
        if n not in REGISTRY:
            raise SystemExit(f"unknown source {n!r}; run `python -m konu_crawlers list`")
    if len(names) > 1 and a.out and "{source}" not in a.out:
        raise SystemExit("with several sources, --out must contain {source}, e.g. data/{source}.jsonl")
    opts = _options(a.opt or [])
    if a.captcha:
        opts["captcha"] = a.captcha
    fetcher = Fetcher(delay=a.delay, proxy=a.proxy, respect_robots=not a.ignore_robots, retries=a.retries)
    summary = []
    try:
        for n in names:
            crawler = get_crawler(n, fetcher=fetcher, render=a.render)
            ttype = a.type if a.type in crawler.transactions else None
            if a.type and ttype is None and len(names) == 1:
                raise SystemExit(f"{n}: --type must be one of {', '.join(crawler.transactions)}")
            w = Writer(out_path(a.out, n), include_raw=not a.no_raw)
            t0 = time.time()
            status = "ok"
            try:
                for rec in crawler.crawl(city=a.city, transaction=ttype, max_pages=a.max_pages, **opts):
                    w.write(rec)
                    if a.limit and w.count >= a.limit:
                        break
            except BlockedError as e:
                status = f"BLOCKED: {e}"
            except CaptchaRequired as e:
                status = f"CAPTCHA: {e}"
            except (FetchError, ValueError) as e:
                status = f"ERROR: {e}"
            except Exception as e:  # noqa: BLE001 - keep going with other sources
                logging.exception("%s crashed", n)
                status = f"ERROR: {type(e).__name__}: {e}"
            finally:
                w.close()
            summary.append((n, ttype or crawler.transactions[0], w.count, time.time() - t0, status))
            print(f"[{n}] {w.count} records in {time.time() - t0:.1f}s – {status}", file=sys.stderr)
    finally:
        fetcher.close()
    if len(summary) > 1:
        print("\nsummary:", file=sys.stderr)
        for n, t, c, dt, st in summary:
            print(f"  {n:<14} {t:<14} {c:>6}  {dt:6.1f}s  {st[:160]}", file=sys.stderr)
    return 0 if any(c for _, _, c, _, _ in summary) else 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="konu_crawlers", description="Crawl Hyderabad real-estate sources into JSONL/CSV.")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="list sources and the --type values each supports").set_defaults(func=cmd_list)
    c = sub.add_parser("crawl", help="crawl one or more sources")
    c.add_argument("source", nargs="+", help="source name(s) or 'all'")
    c.add_argument("--city", default="hyderabad")
    c.add_argument("--type", help="sale | rent | projects | agents | layouts | permissions | ... (see `list`)")
    c.add_argument("--max-pages", type=int, default=1, help="result pages per source (default 1)")
    c.add_argument("--limit", type=int, help="stop after N records per source")
    c.add_argument("--out", help="output file (.jsonl or .csv); may contain {source}. Default: stdout JSONL")
    c.add_argument("--no-raw", action="store_true", help="omit the raw source payload")
    c.add_argument("--delay", type=float, default=1.5, help="seconds between requests to one host (default 1.5)")
    c.add_argument("--retries", type=int, default=3)
    c.add_argument("--proxy", help="HTTP(S) proxy URL, e.g. one in India for geo-restricted sites (or KONU_PROXY)")
    c.add_argument("--render", action=argparse.BooleanOptionalAction, default=None, help="force/disable headless-browser fetching")
    c.add_argument("--ignore-robots", action="store_true", help="do not consult robots.txt")
    c.add_argument("--captcha", help="captcha text for interactive sources (if you read the image yourself)")
    c.add_argument("--opt", action="append", metavar="KEY=VALUE", help="source-specific option (repeatable), e.g. --opt district=Hyderabad")
    c.set_defaults(func=cmd_crawl)
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    return a.func(a)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
