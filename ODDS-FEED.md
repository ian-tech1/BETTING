# Odds source behavior

The Ready/Upcoming match card offers a demo estimate, an exact Betika public quote when available, a SportPesa third-party comparison snapshot, or manually entered 1X2 prices. The Jackpot view uses the Betika public football list and SportPesa's official public jackpot endpoint only when those feeds return matchable data. Each displayed price keeps its source label; a missing quote is never silently replaced by a demo estimate or another bookmaker's line.

Betika Jackpot rows require an exact home/away team pair, an upcoming kickoff timestamp, a complete decimal 1X2 set, and a non-esports/non-SRL fixture. The matcher rejects stale or ambiguous substring matches and keeps the official feed's home team in the 1 position and away team in the 2 position. The tracked card is fixed in project data, so it is not a complete current Betika schedule.

SportPesa Jackpot rows require a successful official public endpoint response, complete 1X2 prices, a future kickoff, and exactly one competitor explicitly marked home and one marked away. The app does not infer team order from array position or call a third-party snapshot an official SportPesa quote. The official feed returned HTTP 403 in the source review, so it may show no public prices until the endpoint is accessible. No gate or CAPTCHA is bypassed.

1xBet's public page did not expose a safely matchable 1X2 feed in the source review. The Jackpot also offers a manual entry form for Betika, SportPesa, 1xBet, and other sites. Manual prices must be typed from the bookmaker app/site, are labeled user-entered, and are not independently verified. The home/draw/away order is 1 = home, X = draw, 2 = away.

Jackpot picks and manual rows are included in the existing account-scoped desk record. A visitor using a different signed-in account on the same website link receives a separate saved selection set. Account switching clears the prior account's client-side picks before loading the next account's record.

For each Jackpot event with an exact home/away and kickoff match to Ready/Upcoming fixture data, the app reuses the same local prediction lab (19 statistical formulas, 15 diagnostic tools, stress check, model spread, sample coverage, risk flags, and public odds reference). If no exact match is found, it does not borrow statistics from another fixture. These formulas are not external AI services, do not have a calibration guarantee, and cannot ensure a correct bet.

A red flag is shown on an individual 1/X/2 price only when the no-vig market probability is at least 10 percentage points above the matched local model probability. It is a disagreement warning—not proof the price will lose or a calibrated betting signal. Auto-pick stores one outcome per match; close prices never create a double pick.

Commercial multi-bookmaker APIs can provide broader coverage but require provider credentials and appropriate rights. None are configured. The app does not claim that adding more AI services or server instances would make match outcomes certain.

## Extra fixtures are not odds

The Ready and Upcoming views can load an additional rolling 30-day fixture schedule from OpenFootball's public-domain `football.json` repository. It currently covers eight competitions: England's Premier League and Championship, and the top divisions of Germany, Spain, France, Italy, the Netherlands and Portugal. No API key is needed. The app deduplicates dated fixtures against bundled records and links to each source file.

This is not a direct 1xBet Global feed and does not include bookmaker odds. The source provides date-only schedule rows without reliable kickoff times, current status, or the team statistics required by the prediction models. Extra rows are therefore labeled **schedule only** and receive no generated prediction. Users should verify match dates and availability at the competition or bookmaker.
