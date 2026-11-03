# Edge-case caller catalog: realism notes (B25)

Research run 2026-11-03 (gathered by Muse with web search, key figures re-checked against the source by Claude). Used to ground `catalog.mjs`; nothing here is shipped to users.

## Who gets hurt, and by what

- Jan 1 - Aug 31, 2026: about 220,475 online-crime reports, damage over 8,595 million THB. People aged 60+ filed 17,895 reports (8.07%) but lost 3,152 million THB (28.55% of all damage). Re-checked. Source: Thai Government news, https://www.thaigov.go.th/th/news/170018 (2026-10-10).
- The same advisory lists four scam types aimed at older people: (1) investment groups with fake "coaches" and fake profit sites, (2) phone intimidation by fake police, bank, post, telco or government staff (mule account, money laundering, drugs, illegal parcel, arrest warrant, then "transfer to verify"), (3) like/review/task jobs that pay small sums first, then demand top-ups, (4) fake rewards or benefits: aid money, utility refunds, insurance, prizes, pensions, all needing a fee first. Personas: `scam-variant`, `debt-fake`, `ambiguous`, `handoff-redial`.
- Weekly police snapshots (Feb-Mar 2026, relayed by news sites): by count, fake online shopping dominates (about 60-70%); by money lost, investment, then job-task scams lead. Phone intimidation stays in the top losses. Sources: https://heythailandnews.com/posts/scammers-hit-nearly-8000-thais-in-early-february-but-steal-less (2026-02), https://crimeasia.com/online-fraud-losses-hit-400-million-baht-in-one-week/ (2026-03-09).
- Utility-refund + remote-control-app scams reported over 4.4 million THB lost on one day (2026-10-17); utilities say they never send app links or handle money by phone. Source: https://bangkok-times.com/news/2026-10-23-fake-electricity-water-app-scam-4-4-million/ (2026-10-23). Persona: `scam-electricity-refund-f` vs the real `electric-outage-notice-m`.
- Fake telco staff threatening money-laundering charges (AOC weekly case set, Aug 2025). Source: https://www.wealthplustoday.com/2025/08/11/aoc-3/ (2025-08-11). Personas: `amb-telco-sim-cut-scam-f` vs the real `amb-telco-sim-verify-real-m` (biometric SIM checks for new SIMs since 2025-01-17, https://www.chiangraitimes.com/tech/new-sim-card-rules-thailand/).

## What real institutions never do (hard-negative design)

- Banks: no links in SMS/email, never ask for password, PIN, CVV or OTP by phone or chat (BOT notification 4/2568, effective 2025-03-07). Summary: https://www.lexology.com/library/detail.aspx?g=71d3ee56c09c433-24b33d22c577c3a5e. The real fraud-desk personas ask only "was this you?" and point to the number on the card.
- Post/couriers do not collect fees through SMS, email or app installs; utilities do not handle money by phone. COD is paid at the door (cash or the shop QR on the label), never to a rider's personal account. Persona pair: `rider-cod-cash-f` vs `amb-courier-then-cod-transfer-m`.
- Real hospitals, courts, revenue and district offices refer to the counter, a letter or their public number; the matching legit personas say so and invite verification.

## Debt Collection Act B.E. 2558 (2015)

Act text: https://th.wikisource.org/wiki/พระราชบัญญัติการทวงถามหนี้_พ.ศ._๒๕๕๘

- Contact hours: Mon-Fri 08:00-20:00. Holidays: the Act text gives 08:00-18:00; a 2025-2026 lender explainer (https://www.puean.co.th/loan/thai-debt-collection-law/, re-checked) states 09:00-18:00. Personas avoid the edge: the night-call collector rings at 22:30.
- Frequency: no more than once per day (committee notification; re-checked on the explainer above).
- The collector must say who the creditor is and the amount, to the debtor; the debt must not be disclosed to unrelated third parties.
- Prohibited: threats or violence to body, reputation or property; insults; disclosing the debt to others (employer, relatives, village chat); posing as police, a lawyer or court; misleading about legal consequences; demanding payment to a personal account.
- Complaints: the debt-collection supervisory committee (provincial committees via the provincial governor / Dept. of Provincial Administration) or police.
- Catalog mapping: `debt-lawful` = HELP_MESSAGE (do not confirm anything about the owner, do not call it a scam); `debt-abusive` = HARASSMENT_RECORD (the debt may be real, the behaviour is unlawful: record and tell the family); `debt-fake` = SCAM_BLOCK / TRAP_OK (personal account, fake court, fake loan app).

## Phone-network cues

- NBTC: international calls must show a "+"; +697 marks VoIP-originated calls with no identifiable origin, +698 roaming numbers. Users can refuse overseas calls free with *138*1#. Sources: https://www.nbtc.go.th/tcp/th/Consumer-Protection/NewsActivities/Telecommunicationsnews/2567/1918.aspx, https://headline.co.th/nbtc-advises-blocking/ (2026-01). The arena feeds text only, so caller ID is not simulated; `amb-relative-phone-stolen-f` is the case where a familiar number must not override the content.

## Speech realism (team knowledge, not web-sourced)

- Isan: เด้อ, บ่, อีหลี, เนาะ, ไส; Northern: เจ้า, ก่อ, ละ; Southern: fast, clipped, หนิ, ม้าย, โหละ. Elderly: repetition, ว่ายังไงนะ, mixed-up names. Teens: ป่ะ, จัดไป, stretched vowels. Riders call 30 seconds before arrival with engine noise; many are migrant workers with limited Thai.

## Rules used for the catalog

- Every company, shop, bank, courier, hospital and foundation name is invented (e.g. ธนาคารฟ้าใส, ฟ้าไวเอ็กซ์เพรส, โรงพยาบาลสุขใจเวช). Phone numbers use the 555 range. The validator rejects a list of real Thai brands.
- Hard negatives are paired with their scam twins (same opening, different ask) so a pass shows the pipeline reads the request, not the topic.

Skipped: BOT and NBTC press pages that returned HTTP 403 (cited through relays above); UGC/TikTok explainers (no data); pre-2024 notices except the Act text.
