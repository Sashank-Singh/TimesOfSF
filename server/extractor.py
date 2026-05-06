import sys
import json
import warnings
# Silence warnings from dependencies like newspaper
warnings.filterwarnings("ignore")
from newsplease import NewsPlease

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No URL provided"}))
        sys.exit(1)
        
    url = sys.argv[1]
    try:
        # NewsPlease handles many edge cases like bot protection and specific site quirks
        article = NewsPlease.from_url(url)
        
        if not article or not article.maintext:
            # Fallback for empty maintext
            print(json.dumps({"error": "No main text extracted"}))
            sys.exit(1)
            
        result = {
            "title": article.title,
            "text": article.maintext,
            "imageUrl": article.image_url,
            "authors": article.authors,
            "publishedAt": str(article.date_publish) if article.date_publish else None,
            "sourceName": article.source_domain
        }
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
