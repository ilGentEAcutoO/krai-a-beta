> **SUBSET RUN** — 100 of 236 calls in the set (hash-subset v4-subset:100 (pre-registered)). Not the full-set result.

# Krai-a beta eval (spark)

Run 2026-11-04T09:32:21.720Z · eval/sealed-v4/sealed-v4.jsonl · 100 calls / 345 judged turns · 39 Thai, 20 English
Classes: SCAM 59 · LEGIT 18 · UNSURE 23 · engines: Spark muse-spark-1.2 effort minimal (few-shot 6) · code policy · muse-wonder-1.0 for the grey zone

**Headline:** SUBSET 100/236 calls (hash-subset v4-subset:100 (pre-registered); not the full-set result): SCAM recall 52.5% (31/59 scam calls, 95% CI 40%–64.7%), 0 of 18 legit calls flagged as scam, median 2.5 s per turn (p90 4.8 s), ~฿0.51 judge cost per call

## Accuracy

| metric | value |
|---|---|
| SCAM recall | 52.5% (31/59; 95% CI 40%–64.7%) |
| SCAM precision (all calls) | 91.2% |
| SCAM precision vs legit only | 100% |
| scam missed as LEGIT (worst error) | 4 |
| LEGIT false scam alarm | 0% (0/18; 95% CI 0%–17.6%) |
| LEGIT left UNSURE (message taken) | 22.2% |
| UNSURE kept UNSURE | 78.3% · to SCAM 3 · to LEGIT 2 |
| accuracy (exact class) | 63% |
| safe outcome (class or listed safe alternative) | 66% |
| median turns to correct verdict | all 2 · SCAM 4 · LEGIT 1 |
| SCAM caught by the expert's turn | 52.5% (median lag 0 turns) |
| scam calls hung up by policy | 52.5% |

Confusion matrix (rows = expected, columns = final verdict):

| | SCAM | LEGIT | UNSURE |
|---|---|---|---|
| **SCAM** | 31 | 4 | 24 |
| **LEGIT** | 0 | 14 | 4 |
| **UNSURE** | 3 | 2 | 18 |

Adversarial subsets (correct / safe / n):

- otp: 11 / 11 / 18
- pressure: 31 / 32 / 58
- impersonation: 34 / 34 / 53
- secrecy: 18 / 18 / 25
- none: 11 / 11 / 13
- transfer: 19 / 19 / 38
- channel-switch: 16 / 16 / 27
- slow-burn: 19 / 21 / 45
- emergency: 11 / 11 / 17
- injection: 6 / 6 / 7
- link: 3 / 3 / 7
- authority: 14 / 14 / 24
- app-install: 6 / 6 / 10

## Latency (judge, per caller turn)

All turns: median 2.5 s, p90 4.8 s, p95 14.3 s

| path | share of turns | median | p90 |
|---|---|---|---|
| spark | 93.3% (322) | 2.4 s | 3.8 s |
| spark>wonder | 6.7% (23) | 16.5 s | 19.5 s |

rule = hard rule before any AI · jev = Jev decided · jev>gemini = Jev unsure, Gemini decided · gemini-only = Jev unavailable

## Cost per call (judge only — receptionist lines are canned)

- Judge (Jev + Gemini escalation), measured: $0.014530 ≈ ฿0.5086 per call (3.45 turns/call, Jev null input tokens/turn, 0 Gemini escalations in 345 turns)
- **Total judge cost ≈ $0.01453 ≈ ฿0.509 per call** (฿509 per 1,000 calls). Judge only (Spark few-shot, per-run cache). Receptionist lines are canned. Excludes speech-to-text, TTS and telephony.
- Prices (USD/1M tokens, checked 2026-10-12): Jev $0.042 input, output free · gemini-3.5-flash-lite $0.30 / $2.50 · $1 = ฿35

## Misses (final verdict ≠ expected class)

- **v4-th-scam-0273** expected SCAM, got LEGIT, ended by take-message
  - trail: LEGIT@0.8/spark > LEGIT@0.82/spark > LEGIT@0.8/spark > LEGIT@0.82/spark
  - last caller turn: "ฉานไม่คุยกับคอมพิวเตอร์ เบื่อแล้วหนิ ไม่ได้หลอกไผ ทำงานของฉานอยู่ตะ"
  - Jev P: n/a · signals ≥0.5: none · reason: Thai Post reports an undeliverable EMS parcel and asks to reschedule, requests nothing sensitive.
- **v4-en-scam-0091** expected SCAM, got UNSURE, ended by take-message
  - trail: LEGIT@0.89/spark>wonder > LEGIT@0.86/spark>wonder > UNSURE@0.65/spark > UNSURE@0.27/spark
  - last caller turn: "Oh, for heaven's sake. Right, if you won't put me through then you tell them this, and write it down properly. My bank has changed, the old account is closed, closed, do you hear? The rent for this month has to go into the new account, and it must go in today. Not the old one. The new one."
  - Jev P: n/a · signals ≥0.5: urgency=0.6, moneyTransfer=0.78, identityProbe=0.7 · reason: Claims to be the landlord and tells tenant to pay rent into a new account today.
- **v4-en-scam-0092** expected SCAM, got LEGIT, ended by take-message
  - trail: LEGIT@0.875/spark>wonder > LEGIT@0.89/spark>wonder > UNSURE@0.62/spark > LEGIT@0.82/spark
  - last caller turn: "Well, this is very silly. I've got three other families wanting that unit. Three. And she was the first to ring, so I've been holding it for her, but I can't hold it forever, can I? Not forever."
  - Jev P: n/a · signals ≥0.5: none · reason: Realty returning the owner's own inquiry about a unit, asks for nothing sensitive.
- **v4-en-scam-0093** expected SCAM, got UNSURE, ended by take-message
  - trail: LEGIT@0.88/spark > LEGIT@0.89/spark>wonder > UNSURE@0.68/spark > UNSURE@0.6/spark>wonder
  - last caller turn: "You won't? You won't give it to me? Well, that's a fine how-do-you-do. All right, all right. You tell 'em the apartment's still available but I got a lot of interest. A lot of interest. I'm leaving town to see my daughter in Florida so I can't show it in person."
  - Jev P: n/a · signals ≥0.5: urgency=0.5, identityProbe=0.85 · reason: The caller demanded the owner's direct cell number and used an out-of-town, high-interest rental pretext, but has not yet requested money.
- **v4-vi-scam-0351** expected SCAM, got LEGIT, ended by take-message
  - trail: UNSURE@0.6/spark > UNSURE@0.6/spark>wonder > UNSURE@0.6/spark>wonder > LEGIT@0.88/spark
  - last caller turn: "Dạ, chuyện là chiều nay chú bị té xe trên đường Nguyễn Văn Linh, giờ chú đang ở khoa cấp cứu, tình trạng hơi critical một chút, bác sĩ chỉ định phải mổ gấp."
  - Jev P: n/a · signals ≥0.5: urgency=0.6, emergency=0.9 · reason: Hospital admin reports emergency contact's accident and ER surgery, asks for nothing sensitive.
- **v4-vi-scam-0352** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.6/spark>wonder > UNSURE@0.62/spark > UNSURE@0.62/spark > UNSURE@0.58/spark
  - last caller turn: "Mà tiện đây em check hệ thống thì thấy kỳ phí quý này của mình bị failed, chắc do thẻ hết hạn hay sao đó anh."
  - Jev P: n/a · signals ≥0.5: authority=0.6 · reason: Claims to be the owner's life insurer offering a free voucher and noting a failed premium, but has not asked for money, code or app.
- **v4-id-scam-0384** expected SCAM, got UNSURE, ended by take-message
  - trail: LEGIT@0.82/spark > LEGIT@0.82/spark > LEGIT@0.82/spark > UNSURE@0.62/spark
  - last caller turn: "harganya dua juta tujuh ratus semalem mas tapi buat tanggal itu kalau ambil dua malem saya kasih diskon jadi lima juta aja"
  - Jev P: n/a · signals ≥0.5: none · reason: Villa sales pitch about a prior inquiry, offers price and discount but asks for nothing sensitive yet.
- **v4-th-scam-0234** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.62/spark > UNSURE@0.72/spark > UNSURE@0.72/spark > UNSURE@0.62/spark
  - last caller turn: "ทางโรงเรียนเลยสิจัดผ้าป่าการศึกษา หาทุนเฮ็ดโครงการอาหารเช้าให้เด็ก ชื่อโครงการ อิ่มท้องน้องโคกสูง ค่ะ หนูเป็นคนรับผิดชอบรวบรวมเงิน"
  - Jev P: n/a · signals ≥0.5: none · reason: Teacher describes a school breakfast fundraiser but has not yet requested a transfer, link or code.
- **v4-th-scam-0052** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.82/spark > UNSURE@0.78/spark > UNSURE@0.82/spark > UNSURE@0.78/spark
  - last caller turn: "แต่ปัญหาคือเขาโดน immigration กักไว้ เจ้าหน้าที่บอกต้องแสดง show money ห้าหมื่นบาทในบัญชีคนไทยที่รับรองเขา ไม่งั้นต้องบินกลับไฟลท์คืนนี้เลย"
  - Jev P: n/a · signals ≥0.5: urgency=0.5, moneyTransfer=0.55 · reason: Claims to be the owner on another phone and tells a romance story needing 50k show money but has not yet given an account or transfer demand.
- **v4-ms-scam-0083** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.88/spark > UNSURE@0.82/spark > UNSURE@0.82/spark > UNSURE@0.65/spark
  - last caller turn: "sebenarnya ada berita baik saya kena telefon sama pegawai dari jabatan cabutan nombor ramalan empat digit kononnya saya menang hadiah utama dekat sejuta"
  - Jev P: n/a · signals ≥0.5: none · reason: Claims to be the owner chatting about weather and a lottery win, no request yet.
- **v4-en-legit-0571** expected LEGIT, got UNSURE, ended by take-message
  - trail: UNSURE@0.65/spark > UNSURE@0.72/spark > UNSURE@0.72/spark > UNSURE@0.64/spark
  - last caller turn: "No need anything from her lah, just want her to save this new number and call me back when she free. Tell her don't forget to block the date ah."
  - Jev P: n/a · signals ≥0.5: none · reason: Claims to be a cousin with a new number and wedding news but asks nothing verifiable; relationship cannot be confirmed.
- **v4-en-legit-0394** expected LEGIT, got UNSURE, ended by take-message
  - trail: UNSURE@0.65/spark > UNSURE@0.65/spark > UNSURE@0.82/spark > UNSURE@0.82/spark
  - last caller turn: "He's okay now, the vet said. He's got a cone on his head and he keeps bumping into the door."
  - Jev P: n/a · signals ≥0.5: none · reason: Chatting about his dog's vet visit with no stated purpose or request.
- **v4-ms-scam-0481** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.5/spark > UNSURE@0.65/spark > UNSURE@0.65/spark > UNSURE@0.64/spark
  - last caller turn: "Pak cik dah talipon ramai orang, nak. Semua orang baik hati, semua bagi. Tuan rumah ni pun orang baik, pak cik tau. Takkan tak boleh cakap sekejap dengan dia? Pak cik bukan nak menipu. Ish, susah betul zaman sekarang."
  - Jev P: n/a · signals ≥0.5: none · reason: Charity donation request, no account, link or code yet.
- **v4-ms-scam-0482** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.6/spark > UNSURE@0.6/spark > UNSURE@0.65/spark > UNSURE@0.65/spark
  - last caller turn: "Kenapa nak tanya banyak-banyak? Mak cik cakap betul ni. Mak cik tak tipu. Orang tengah susah, nak, budak-budak kecik tak ada susu. Tolong lah sambung kepada tuan rumah. Sekejap je. Sekejap je."
  - Jev P: n/a · signals ≥0.5: none · reason: Charity flood appeal with no account, link or transfer request yet.
- **v4-ms-scam-0483** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.62/spark > UNSURE@0.65/spark > UNSURE@0.65/spark > UNSURE@0.62/spark
  - last caller turn: "Saya ulang sekali lagi, ya. Rumah Anak Yatim Darul Falah. Ada dua puluh tiga orang budak. Bulan puasa dah dekat, kami nak buat majlis tahlil dan berbuka. Dia dah janji. Orang berjanji kena tunaikan."
  - Jev P: n/a · signals ≥0.5: none · reason: Claims to run orphanage and owner promised donation, but has not requested transfer or details yet.
- **v4-zh-scam-0111** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.5/spark > UNSURE@0.64/spark > UNSURE@0.65/spark > UNSURE@0.62/spark
  - last caller turn: "好啦好啦 其实是好消息来的 老板之前有在我们平台登记过 现在系统批准了 一万五千零吉的带款 利息很低的 零点八巴仙而已"
  - Jev P: n/a · signals ≥0.5: authority=0.5, identityProbe=0.75 · reason: Unsolicited loan offer probing for owner's private number, no transfer or code yet.
- **v4-zh-scam-0114** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.5/spark > UNSURE@0.65/spark > UNSURE@0.65/spark > UNSURE@0.64/spark
  - last caller turn: "行吧行吧 我跟你说 他名下有一笔 预授信 五万块人民币 审核已经过了 随借随还"
  - Jev P: n/a · signals ≥0.5: authority=0.55, identityProbe=0.7 · reason: Unsolicited loan offer asking for personal WeChat, no transfer or code yet.
- **v4-en-unsure-0191** expected UNSURE, got LEGIT, ended by take-message
  - trail: UNSURE@0.62/spark > LEGIT@0.82/spark
  - last caller turn: "it's about a balance of three hundred and twelve pound outstanding from the last financial year we're not taking payment over the phone today just ask them to ring the number on their council tax bill or the main council line on the website and quote reference ending four seven two thanks love"
  - Jev P: n/a · signals ≥0.5: authority=0.5, callbackGiven=0.9 · reason: Council revenue about tax arrears asks no payment and directs callback to the bill or official website.
- **v4-en-unsure-0194** expected UNSURE, got LEGIT, ended by take-message
  - trail: UNSURE@0.62/spark > LEGIT@0.88/spark
  - last caller turn: "okay um i can't really discuss details with anyone else but the minimum payment is now sixty days past due and it's getting serious so please ask them to call the number on the back of their card or just drop into their local branch and talk to someone there we don't need anything from you today"
  - Jev P: n/a · signals ≥0.5: authority=0.6, callbackGiven=0.9 · reason: Bank collections about owner's own Visa, asks nothing and directs to number on card or branch.
- **v4-en-unsure-0442** expected UNSURE, got SCAM (listed as a safe alternative), ended by hangup
  - trail: UNSURE@0.65/spark > SCAM@0.88/spark
  - last caller turn: "ha yeah I get that a lot um so we've got a little community of everyday aussies who uh got sick of their super doing nothing you know"
  - Jev P: n/a · signals ≥0.5: none · reason: Cold call inviting the owner into a private crypto investment community.
- **v4-en-unsure-0443** expected UNSURE, got SCAM, ended by hangup
  - trail: UNSURE@0.6/spark > UNSURE@0.62/spark > SCAM@0.88/spark
  - last caller turn: "we've got a mentor who basically guarantees about um three percent a month steady as you like and he's opening a few spots to new people this season"
  - Jev P: n/a · signals ≥0.5: moneyTransfer=0.6 · reason: Stranger invites into a guaranteed-return forex group, a classic investment trap.
- **v4-en-unsure-0444** expected UNSURE, got SCAM (listed as a safe alternative), ended by hangup
  - trail: UNSURE@0.6/spark > SCAM@0.92/spark
  - last caller turn: "so I'm kayla I work with northern peak capital collective we're out of toronto and um we do like a private investing group mostly crypto some ethereum stuff"
  - Jev P: n/a · signals ≥0.5: none · reason: Cold call invites owner into a private crypto investing group.
- **v4-th-scam-0411** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.6/spark > UNSURE@0.64/spark > UNSURE@0.64/spark > UNSURE@0.62/spark
  - last caller turn: "จากที่คำนวนใหม่นะคะ มีรายการลดหย่อมประกันชีวิตที่ยังไม่ได้หัก เลยมียอดคืนภาษีอยู่ สามพันสี่ร้อยยี่สิบบาท ค่ะ"
  - Jev P: n/a · signals ≥0.5: authority=0.7 · reason: Claims Revenue Department refund but has asked for nothing yet.
- **v4-th-scam-0412** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.62/spark > UNSURE@0.6/spark > UNSURE@0.62/spark > UNSURE@0.68/spark
  - last caller turn: "ยอดอยู่ที่ หนึ่งหมื่นสองพันแปดร้อย บาทนะครับ อันนี้เป็นของปี หกเจ็ด ครับ ที่หักณที่จ่ายไว้เกินครับ"
  - Jev P: n/a · signals ≥0.5: authority=0.8 · reason: Claims to be Revenue Dept with a tax refund but has not requested fee, code or transfer.
- **v4-th-scam-0414** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.64/spark > UNSURE@0.62/spark > UNSURE@0.62/spark > UNSURE@0.64/spark
  - last caller turn: "ทีนี้ปีนี้เขาเปลี่ยนการคืนภาษีมาเป็นผ่าน วอลเล็ต ครับ ท่านมียอดรอรับอยู่ ห้าพันหกร้อย บาท ครับ"
  - Jev P: n/a · signals ≥0.5: authority=0.7 · reason: Claims a Revenue Department digital-wallet tax refund the owner never asked for, no sensitive data asked yet.
- **v4-zh-legit-0101** expected LEGIT, got UNSURE (listed as a safe alternative), ended by take-message
  - trail: UNSURE@0.62/spark > UNSURE@0.78/spark > UNSURE@0.6/spark>wonder
  - last caller turn: "OK OK，你不能 transfer 就算了。你跟她讲妈妈已经回家了，晚上我们在 Toa Payoh 那边吃饭，叫她 call back 这个新号码就好，不用带什么东西来。Thanks ah。"
  - Jev P: n/a · signals ≥0.5: urgency=0.5, identityProbe=0.7, callbackGiven=0.6 · reason: Caller claims to be sister on a new SIM, asks for office number and callback to the new number; identity is unverified though no money was requested.
- **v4-th-scam-0321** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.64/spark > UNSURE@0.64/spark > UNSURE@0.62/spark > UNSURE@0.68/spark
  - last caller turn: "ยอดที่ได้คือหนึ่งหมื่นบาทนะคะ เงินจะเข้า wallet ภายในสามวันทำการหลังยืนยันตัวตนค่ะ ไม่มีค่าใช้จ่ายอะไรทั้งสิ้นค่ะ สบายใจได้"
  - Jev P: n/a · signals ≥0.5: authority=0.75 · reason: Claims to be Ministry of Finance offering 10,000 baht payout, but asks for no fee, code or link yet.
- **v4-th-scam-0473** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.5/spark > UNSURE@0.7/spark > UNSURE@0.75/spark > UNSURE@0.82/spark
  - last caller turn: "กูให้เวลาชั่วโมงเดียว ไม่ต้องอัดเสียงไม่ต้องคัดกรองอะไรทั้งนั้น"
  - Jev P: n/a · signals ≥0.5: urgency=0.88, emergency=0.75 · reason: Claims to hold the daughter and threatens, but asks for no transfer, code or app yet.
- **v4-tl-scam-0201** expected SCAM, got LEGIT, ended by take-message
  - trail: UNSURE@0.6/spark > LEGIT@0.82/spark > LEGIT@0.88/spark > LEGIT@0.82/spark
  - last caller turn: "oo nga po eh minsan regalo po yan ng kamag anak sa abroad ganyan po madalas dito sa area namin sa may novaliches"
  - Jev P: n/a · signals ≥0.5: none · reason: Courier reports an incoming parcel and asks nothing sensitive.
- **v4-tl-scam-0202** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.62/spark > UNSURE@0.6/spark > UNSURE@0.62/spark > UNSURE@0.65/spark
  - last caller turn: "kasi po may isang kahon dito naka pangalan po sa may ari ng numerong ito at ang address po ay sa pasig"
  - Jev P: n/a · signals ≥0.5: authority=0.65 · reason: Claims to be Customs about a Malaysia parcel, no threat or request yet.
- **v4-tl-scam-0204** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.5/spark > UNSURE@0.6/spark>wonder > UNSURE@0.6/spark > UNSURE@0.62/spark
  - last caller turn: "kaso po sir pag check po ng supervisor namin hindi po tugma yung declaration may nakitang mga card at mga puting pakete sa loob"
  - Jev P: n/a · signals ≥0.5: none · reason: Courier reports an overseas parcel with mismatched declaration and suspicious items but makes no threat or request yet.
- **v4-tl-scam-0402** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.5/spark > UNSURE@0.65/spark > UNSURE@0.64/spark > UNSURE@0.64/spark
  - last caller turn: "hindi na po kailangan pumunta sa opisina kasi online na po kami ngayon modern na po tayo ma'am"
  - Jev P: n/a · signals ≥0.5: none · reason: Cooperative offers an unsolicited loan promo but asks for nothing yet.
- **v4-tl-scam-0403** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.62/spark > UNSURE@0.65/spark > UNSURE@0.64/spark > UNSURE@0.62/spark
  - last caller turn: "naaprubahan na po kayo sa limampung libong piso payable po ng dalawampu't apat na buwan napakagaan lang po ng hulog"
  - Jev P: n/a · signals ≥0.5: authority=0.65 · reason: Unsolicited loan approved offer, no fee, code or link requested yet.
- **v4-tl-scam-0404** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.65/spark > UNSURE@0.65/spark > UNSURE@0.65/spark > UNSURE@0.62/spark
  - last caller turn: "yung loan po kasi na labing limang libo naka hold po sa system kasi kulang po yung ano yung verification ng account"
  - Jev P: n/a · signals ≥0.5: none · reason: Claims Pondo Express loan held for verification, no fee or OTP asked yet.
- **v4-th-scam-0261** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.65/spark > UNSURE@0.6/spark>wonder > UNSURE@0.58/spark > UNSURE@0.64/spark
  - last caller turn: "แต่ว่าในระบบมันขึ้นว่ามีค่าไฟค้างอยู่สองเดือนเด้อค่า ยอดรวมกับค่าปรับเป็นหนึ่งพันแปดร้อยสี่สิบบาท ทางสาขาเพิ่นสั่งตัดไฟรอบบ่ายนี้สี่โมงเด้อค่า"
  - Jev P: n/a · signals ≥0.5: authority=0.72, urgency=0.6 · reason: Claims to be electricity authority and says power will be cut at 4pm for overdue bill, but has not yet demanded phone payment or account.
- **v4-th-scam-0263** expected SCAM, got UNSURE, ended by take-message
  - trail: UNSURE@0.62/spark > UNSURE@0.62/spark > UNSURE@0.65/spark > UNSURE@0.65/spark
  - last caller turn: "แต่ว่าพี่ครับ ในระบบหนิขึ้นว่าแพ็กเกจของบ้านนี้หมดสัญญาแล้ว แล้วมียอดค้างชำระอีกเก้าร้อยห้าสิบบาทครับ"
  - Jev P: n/a · signals ≥0.5: authority=0.5 · reason: Claims to be fiber technician checking service and says there is an overdue bill, but asks for no transfer, code or app yet.
- **v4-th-legit-0563** expected LEGIT, got UNSURE, ended by take-message
  - trail: UNSURE@0.62/spark > UNSURE@0.62/spark > UNSURE@0.22/spark > UNSURE@0.28/spark
  - last caller turn: "แต่ว่าชื่อผู้เช่าที่กรอกมา กับเลขพาสปอร์ต มันไม่ตรงกันอยู่ ตัวนึง น่าจะพิมพ์ผิดตอนกรอก ระบบเลยค้างไว้"
  - Jev P: n/a · signals ≥0.5: authority=0.65 · reason: Immigration notes a TM30 typo, says there is no offence and asks for nothing sensitive.

Service errors during run: meta-timeout, meta-timeout, meta-timeout
Total spend of this eval run: $1.4530 ≈ ฿50.86 (359s wall time)
