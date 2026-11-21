# Odds source review

Checked 6 November 2026. Public pages and feeds change; verify every quote at the bookmaker before use.

## Betika

- A no-key request to the public football match-list URL, https://api.betika.com/v1/uo/matches?page=1&limit=3&sport_id=14, returned a JSON list with home/away names, start time, competition, and decimal Home/Draw/Away (`home_odd`, `neutral_odd`, `away_odd`) prices. The app's lookup uses a keyword query by home-team name, then validates both teams and a kickoff within three hours of the board timestamp. It shows no price when the exact event is absent. A live query for “Leeds United” returned HTTP 200 but no event rows, demonstrating that coverage is not universal. This is a public response, not a published service-level guarantee; event availability and format can change.
- Betika's official Kenya terms intro is at https://www.betika.com/en-ke/legal/general-terms-and-conditions/introduction. The page readable in this check did not state an odds-data API or developer license. Do not assume that an accessible JSON URL grants commercial republication rights.

## SportPesa

- Official homepage: https://www.sportpesa.com/ . Browser extraction displayed the public sportsbook introduction. Earlier browser visit encountered a CAPTCHA; no CAPTCHA workaround is used.
- Existing jackpot endpoint: https://jackpot-offer-api.sportpesa.com/api/jackpots/active returned HTTP 403 without credentials from this runtime. It is not used for general match odds.
- Sure Bet Africa's Kenya page, https://www.surebetafrica.com/kenya, and inspected event page, https://www.surebetafrica.com/kenya/leagues/premier-league/2026-11-07/leeds-united-vs-tottenham, display a bookmaker-attributed SportPesa row. The extracted Leeds–Tottenham prices were 2.80 / 3.40 / 2.60, with the page reporting last odds movement six hours earlier. The site's terms at https://www.surebetafrica.com/terms warn that odds may be delayed, inaccurate, or incomplete and require users to verify with bookmakers. Those terms do not promise an official live feed or explicitly grant public republication rights. The app therefore labels its result a comparison reference snapshot and only checks one exact page after the user opens that match's source panel. Robots file: https://www.surebetafrica.com/robots.txt.

## 1xBet and other feeds

- Official 1xBet football page: https://1xbet.com/en/line/football . It did not expose a safely matchable public 1X2 feed from this runtime. No login, regional gate, or CAPTCHA is bypassed.
- OddsSafari event page, https://www.oddssafari.com/matches/soccer/italy/serie-a/venezia-vs-udinese/10978543, displayed 1xBet prices in a browser. Its terms at https://www.oddssafari.com/terms-of-service prohibit monitoring/scraping, copying, downloading, display, or reproduction for public/commercial purposes without prior written consent. The app does not ingest or republish those prices.
- The Odds API documents a bookmaker-specific feed, but the GET odds endpoint requires `apiKey`; its access page says subscribing sends a key by email: https://the-odds-api.com/liveapi/guides/v4/ and https://the-odds-api.com/#get-access. It cannot be enabled under a no-key configuration. Other commercial feeds similarly require provider credentials or an authorized contract.
- BetExplorer's public event page, https://www.betexplorer.com/football/england/premier-league/everton-coventry/OUYQUF9b/, showed odds comparison but no safely verified 1xBet or SportPesa attribution in this runtime. Unattributed averages are not bookmaker quotes.

## App behavior

The match card offers four source modes: generated demo estimate; Betika if a complete exact fixture quote is returned; SportPesa third-party reference where a complete exact page row is present; or user-entered 1X2 odds for another selected bookmaker. Comparison rows show unavailable sources as blank. Choosing a missing public quote never falls back to demo prices. Wider automated book coverage requires a feed with suitable rights and credentials; manual entry is the keyless alternative. Demo-derived edges and stakes are illustrative only.

## Expanded fixture schedule source

- OpenFootball's public `football.json` repository describes its fixture datasets as public-domain data usable without restrictions. The README says its latest-season JSON files are updated daily by repository automation, while upstream Football.TXT sources are not guaranteed daily updates: https://github.com/openfootball/football.json .
- The 2026/27 season directory currently contains these supported files: `en.1.json`, `en.2.json`, `de.1.json`, `es.1.json`, `fr.1.json`, `it.1.json`, `nl.1.json`, and `pt.1.json`. They cover England's Premier League and Championship plus the top divisions of Germany, Spain, France, Italy, the Netherlands and Portugal.
- A runtime check on 6 November 2026 found 314 future/date-window schedule rows from these eight files after deduplicating against the app's 152 bundled records, for a rolling 30-day window through 6 December 2026. The source gives calendar dates, not reliable kickoff times, and does not provide bookmaker odds. The UI labels these as schedule-only, excludes full-time rows when a full-time score is present, and links back to both the source file and the public 1xBet page. This is additional fixture coverage, not a 1xBet feed or complete coverage of 1xBet Global's events.
- The public 1xBet football line page returned a country/legal availability warning in this check. No region restriction, VPN gate, CAPTCHA, or login is bypassed: https://1xbet.com/en/line/football .

## Jackpot safety and account behavior

The Jackpot uses stricter matching than the original version: Betika requires exact supported team names, a future kickoff, and a full 1X2 set; SportPesa requires a reachable official feed, explicit home/away competitor flags, an upcoming kickoff, and three valid prices. Rows use stable team/kickoff IDs. If official SportPesa data is unavailable, the tab stays blank rather than presenting a comparison-site line as the official price. Users can add a manually transcribed fixture and odds set for Betika, SportPesa, 1xBet, or another bookmaker; manual rows are labeled and are not independently verified.

Jackpot picks allow one result per fixture and are stored with the existing account-scoped desk record. Account switching clears the previous account's client-side picks before loading the next account's record. The shared per-fixture prediction lab appears only if both teams and kickoff match a Ready/Upcoming fixture. A red flag marks a 10-percentage-point-or-greater difference where the no-vig market probability is higher than the local model probability. It is a warning only, not a calibrated prediction or betting recommendation.
