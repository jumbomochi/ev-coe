# TODOS

## Parse the LTA car-cost PDF for next-car presets and prices
- **What:** a script in `scripts/` that reads LTA's monthly "Cost for New Cars Registered" PDF into presets (OMV, ARF, VES/EEAI, authorised-distributor selling price).
- **Why:** v1 presets and financing prices are typed in by hand from one edition, so they go stale a month after each new edition.
- **Pros:** always-current prices; covers every model, not just 2-3 presets per powertrain.
- **Cons:** PDF layouts change; needs the same validate-or-fail guard as the COE fetch (eng review D12), or a bad parse reaches the public site.
- **Context:** decided in /plan-eng-review 2026-10-31 (D21). The PDF lives at onemotoring.lta.gov.sg (Buying › Car Cost Update). Start next to `scripts/fetch-data.ts` and reuse its guard.
- **Depends on / blocked by:** v1 launch; the D12 guard pattern.

## Radar: count renewed-COE and early-deregistration returns
- **What:** add COEs returning at year 15 (5-year renewals), at year 20 (10-year renewals) and from early deregistrations to the supply radar.
- **Why:** v1 counts only cars reaching 10 years and states the exclusion; these flows add supply the bars miss.
- **Pros:** a more accurate radar and a smaller published hindcast error.
- **Cons:** monthly deregistrations aren't split by cause, so early deregistrations have to be inferred (total deregistrations minus cohort expiries).
- **Context:** design doc line 91 (stated exclusion); eng review D23.
- **Depends on / blocked by:** unblocked (T1, 2026-10-31): DataMall publishes monthly deregistrations and 5-/10-year COE revalidations by category, both already in `data/`.
