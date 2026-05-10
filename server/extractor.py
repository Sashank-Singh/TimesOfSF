import sys
import json
import warnings

warnings.filterwarnings("ignore")


def emit(payload: dict) -> None:
    print(json.dumps(payload, default=str))
    sys.stdout.flush()


def main() -> None:
    if len(sys.argv) < 2:
        emit({"ok": False, "error": "No URL provided"})
        sys.exit(1)

    try:
        from newsplease import NewsPlease
    except ImportError as exc:
        emit({"ok": False, "error": f"newsplease import failed: {exc}"})
        sys.exit(0)

    url = sys.argv[1]
    try:
        article = NewsPlease.from_url(url)
        if not article:
            emit({"ok": False, "error": "NewsPlease returned no article"})
            sys.exit(0)

        maintext = (article.maintext or "").strip()
        if not maintext:
            emit(
                {
                    "ok": False,
                    "error": "No main text extracted",
                    "title": article.title or "",
                }
            )
            sys.exit(0)

        emit(
            {
                "ok": True,
                "title": article.title or "",
                "text": maintext,
                "imageUrl": article.image_url or "",
                "publishedAt": str(article.date_publish) if article.date_publish else None,
                "sourceName": getattr(article, "source_domain", None),
            }
        )
        sys.exit(0)
    except Exception as exc:
        emit({"ok": False, "error": str(exc)})
        sys.exit(0)


if __name__ == "__main__":
    main()
