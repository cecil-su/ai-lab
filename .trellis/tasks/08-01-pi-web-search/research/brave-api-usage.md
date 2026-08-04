# Brave Search API Usage and Attribution Check

Checked: 2026-08-01

## Official sources

- Brave Search API Terms of Service: https://api-dashboard.search.brave.com/documentation/resources/terms-of-service
- Brave Web Search getting started: https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
- Brave Web Search endpoint reference: https://api-dashboard.search.brave.com/api-reference/web/search/get
- Brave authentication guide: https://api-dashboard.search.brave.com/documentation/guides/authentication

## Findings relevant to the MVP

OpenAI web search over the official Brave pages reported the following current terms behavior:

- General Brave attribution is optional: an application *may* provide attribution.
- If Brave attribution is shown, it must be conspicuous and use `POWERED BY BRAVE` with Brave's logo or another Brave-approved treatment; it must not imply sponsorship or endorsement.
- Some Rich Search third-party data providers require their own attribution when those rich data panels are displayed. Examples surfaced by the official documentation include Wordnik, FMP, Fixer, CoinGecko, and OpenWeatherMap.
- Authentication uses `X-Subscription-Token`; the key must stay out of URLs, browser/client code, logs, and public repositories.
- The ordinary web-search endpoint is `GET https://api.search.brave.com/res/v1/web/search`.

Direct content extraction of the JavaScript-backed official terms page failed in this environment, so implementation should re-open the official terms before release if the response shape or usage changes. The official-domain search results were consistent across repeated queries.

## MVP closure decision

The package will consume and display only ordinary `web.results` source entries. It will not consume or render Rich Search panels or their third-party payloads. Therefore:

- no mandatory Brave branding is added to the source-only Pi tool;
- provider attribution remains visible as plain diagnostic text such as `Provider: brave`, without using Brave logos or implying partnership;
- if implementation later consumes Rich Search, adds a branded UI, stores API data beyond transient tool/session output, or publishes the package, terms/attribution must return to product planning.

README must document that Brave queries are subject to the user's Brave Search API account, quota, privacy, and current terms.

This is an engineering scope check, not legal advice.
