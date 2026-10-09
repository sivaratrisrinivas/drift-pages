| # | Case | Kind | Expected | Got | Result |
|---|---|---|---|---|---|
| 1 | 01-firecrawl-unchanged | no change | none | none | pass |
| 2 | 02-exa-unchanged | no change | none | none | pass |
| 3 | 03-apollo-unchanged | no change | none | none | pass |
| 4 | 04-firecrawl-copy-edit | no change (copy edits) | none | none | pass |
| 5 | 05-exa-row-reorder | no change (rows reordered) | none | none | pass |
| 6 | 06-apollo-copy-edit | no change (copy edits, rows reordered) | none | none | pass |
| 7 | 07-firecrawl-json-price | price change | rate firecrawl#batch/scrape<br>rate firecrawl#crawl<br>rate firecrawl#scrape<br>rate firecrawl#search | rate firecrawl#batch/scrape<br>rate firecrawl#crawl<br>rate firecrawl#scrape<br>rate firecrawl#search | pass |
| 8 | 08-exa-search-price | price change | rate exa#search | rate exa#search | pass |
| 9 | 09-apollo-org-search-price | price change | rate apollo#mixed_companies/search | rate apollo#mixed_companies/search | pass |
| 10 | 10-firecrawl-search-block | price change | rate firecrawl#search | rate firecrawl#search | pass |
| 11 | 11-apollo-news-unit | unit change | unit apollo#news_articles/search | unit apollo#news_articles/search | pass |
| 12 | 12-exa-contents-unit | unit change | unit exa#contents | coverage exa#contents<br>coverage exa/* | FAIL |
| 13 | 13-firecrawl-map-regime | regime change | regime firecrawl#map | regime firecrawl#map | pass |
| 14 | 14-apollo-person-regime | regime change | regime apollo#people/show | regime apollo#people/show | pass |
| 15 | 15-firecrawl-new-line | new billable line | coverage firecrawl/* | coverage firecrawl/* | pass |
| 16 | 16-apollo-new-line | new billable line | coverage apollo/* | none | FAIL |
| 17 | 17-exa-tier-renamed | tier renamed, same price | none | none | pass |
| 18 | 18-firecrawl-table-to-cards | table restructured to cards, same prices | none | none | pass |
| 19 | 19-exa-unreachable | page unreachable | source exa/* | source exa/* | pass |
| 20 | 20-firecrawl-promo-banner | promo banner (adversarial) | none | none | pass |

**18/20 passed.** Hallucinated quotes in findings: 0. Model rows dropped by the quote guard: 3 of 405. Model: gemini:gemini-3.5-flash, gemini:gemini-3.8-flash, groq:openai/gpt-oss-120b, gemini:gemini-3.5-flash-lite.
