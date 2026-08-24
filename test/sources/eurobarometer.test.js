import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  pickLatestSurvey, openDataUrlOf, datasetIdFromOpenDataUrl, volumeADownloadUrl,
  resolveVolumeA, unzipXlsx, sheetFileMap, parseWorksheet, findCountryColumn, columnLetter,
  parseFieldwork, questionLabelsEN, parseQuestionSheet, isSubstantiveQuestion,
  validateQuestion, questionToItem, fetchNew, shortenQuestion,
} from "../../src/sources/eurobarometer.js";

// VALÓS fixture-ök: a ma (2026-08-17) lakossági IP-ről lekért eurobarometer-lánc élő válaszai,
// bájtazonosak a 08-16-i Actions-ASN-próbával. A lánc: survey/get/latest → get/one →
// openDataPublicationUrl → data.europa.eu (Piveau) dataset → volumeA.xlsx (webgate).
const fx = (name) => readFileSync(fileURLToPath(new URL(`../fixtures/eurobarometer/${name}`, import.meta.url)));
const json = (name) => JSON.parse(fx(name).toString("utf8"));
const LATEST = json("survey_latest.json");
const ONE = json("survey_one_3752.json");
const DATASET = json("odp_dataset.json");
const XLSX = fx("volumeA.xlsx");

// --- 1. lánc-feloldás (tiszta függvények a JSON-fixture-ökön) ---

test("pickLatestSurvey: a legfrissebb survey id+reference (EB050EP, 3752)", () => {
  const s = pickLatestSurvey(LATEST);
  assert.equal(s.id, 3752);
  assert.equal(s.reference, "EB050EP");
});

test("openDataUrlOf: a survey/get/one openDataPublicationUrl-je", () => {
  assert.equal(openDataUrlOf(ONE), "http://data.europa.eu/euodp/en/data/dataset/S3752_105_3_EB050EP_ENG");
});

test("datasetIdFromOpenDataUrl: az utolsó path-szegmens kisbetűsítve (Piveau dataset-id)", () => {
  assert.equal(
    datasetIdFromOpenDataUrl("http://data.europa.eu/euodp/en/data/dataset/S3752_105_3_EB050EP_ENG"),
    "s3752_105_3_eb050ep_eng",
  );
});

test("volumeADownloadUrl: a 'volumeA.xlsx' disztribúció webgate access_url-je (nem a többi kötet)", () => {
  const url = volumeADownloadUrl(DATASET);
  assert.match(url, /^https:\/\/webgate\.ec\.europa\.eu\/ebsm\/api\/public\/odp\/download\?key=/);
  // NEM a volumeAA / volumeAP / volumeBP kötet
  assert.ok(!/volume(AA|AP|AAP|BP|B|C)\b/i.test(url));
});

// --- 2. orchesztrátor: a teljes lánc injektált fetchImpl-lel (offline) ---

test("resolveVolumeA: végigjárja a láncot és a volumeA.xlsx bufferét adja", async () => {
  const stub = async (url) => {
    let body, ct = "application/json";
    if (url.includes("survey/get/latest")) body = fx("survey_latest.json");
    else if (url.includes("survey/get/one")) { assert.match(url, /id=3752/, "a get/one a legfrissebb id-ra hív"); body = fx("survey_one_3752.json"); }
    else if (url.includes("api/hub/search/datasets/")) { assert.match(url, /s3752_105_3_eb050ep_eng/, "a Piveau dataset-id kisbetűs"); body = fx("odp_dataset.json"); }
    else if (url.includes("webgate.ec.europa.eu")) { body = XLSX; ct = "application/octet-stream"; }
    else throw new Error(`váratlan URL: ${url}`);
    return { ok: true, status: 200, headers: { get: () => ct }, text: async () => body.toString("utf8"),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  };
  const r = await resolveVolumeA({ fetchImpl: stub });
  assert.equal(r.survey.reference, "EB050EP");
  assert.equal(r.datasetId, "s3752_105_3_eb050ep_eng");
  assert.ok(Buffer.isBuffer(r.buffer) && r.buffer.length === XLSX.length, "a volumeA.xlsx teljes bufferét adja");
});

// --- 3. XLSX-parser (valós volumeA.xlsx, saját ZIP/inflate — nincs xlsx-lib) ---

test("unzipXlsx: a valós volumeA.xlsx kibontása (deflate + stored), a kulcs-entryk megvannak", () => {
  const files = unzipXlsx(XLSX);
  assert.ok(files.has("xl/workbook.xml"), "workbook.xml");
  assert.ok(files.has("xl/worksheets/sheet3.xml"), "sheet3.xml");
  assert.ok(files.get("xl/workbook.xml").length > 0, "a kibontott tartalom nem üres");
});

test("sheetFileMap: a munkalap-név → fájl leképezés (QA1 → sheet3.xml)", () => {
  const files = unzipXlsx(XLSX);
  const map = sheetFileMap(files.get("xl/workbook.xml").toString("utf8"), files.get("xl/_rels/workbook.xml.rels").toString("utf8"));
  assert.equal(map.get("QA1"), "xl/worksheets/sheet3.xml");
  assert.equal(map.get("Content"), "xl/worksheets/sheet1.xml");
});

test("parseWorksheet: inline-string és numerikus cellák (V9='HU', V10=1020, V13=0.78)", () => {
  const files = unzipXlsx(XLSX);
  const cells = parseWorksheet(files.get("xl/worksheets/sheet3.xml").toString("utf8"));
  assert.equal(cells.get("V9"), "HU");
  assert.equal(cells.get("V10"), 1020);
  assert.equal(cells.get("V13"), 0.78);
  assert.equal(cells.get("C9"), "UE27\nEU27", "többsoros inline-string megőrizve");
});

test("findCountryColumn: a HU-oszlop a V (a magyar bontás kiválasztása)", () => {
  const files = unzipXlsx(XLSX);
  const cells = parseWorksheet(files.get("xl/worksheets/sheet3.xml").toString("utf8"));
  assert.equal(findCountryColumn(cells, "HU"), "V");
  // és a V-oszlop tényleg a HU magyar értékeket hordozza
  assert.equal(cells.get("V10"), 1020, "HU mintaméret (N)");
});

test("columnLetter: cellahivatkozásból oszlopbetű", () => {
  assert.equal(columnLetter("V13"), "V");
  assert.equal(columnLetter("AA10"), "AA");
});

// ============================================================================
// B2 — item-shape + fetchNew (a forrás MÉG NEM aktív, registry-be NEM regisztrált).
// Döntés (2026-08-20, mérés a valós volumeA.xlsx-en): egy TÉTEL = egy tartalmi
// attitűd-kérdés HU-eredménye (QA* + D78 EU-imázs). NEM per-hullám (túl durva, egy
// blob/kvartál, nem triázsolható kérdésenként), NEM per-válaszopció (nincs önálló
// jelentése), NEM demográfia (D11A kor/foglalkozás = mintakompozíció). Ez az
// europeelects pollToItem mintája egy szinttel lejjebb: ott egy poll az összes pártot
// EGY tétel summary-jába csomagolja; itt egy kérdés az összes válaszopciót.
// ============================================================================

const contentCells = () => {
  const files = unzipXlsx(XLSX);
  const map = sheetFileMap(files.get("xl/workbook.xml").toString("utf8"), files.get("xl/_rels/workbook.xml.rels").toString("utf8"));
  return { files, map, content: parseWorksheet(files.get(map.get("Content")).toString("utf8")) };
};
const sheetCells = (code) => {
  const { files, map } = contentCells();
  return parseWorksheet(files.get(map.get(code)).toString("utf8"));
};

test("parseFieldwork: a Content-ből wave (105.3) + fieldwork-vég ISO (2026-05-04)", () => {
  const { content } = contentCells();
  const fw = parseFieldwork(content);
  assert.equal(fw.wave, "105.3");
  // B3 = "9/4 - 4/5/2026" → a VÉGE 2026. május 4.
  assert.equal(fw.fieldworkEnd, "2026-05-04");
});

test("questionLabelsEN: a Content C-oszlopából kód→angol kérdésszöveg (QA4)", () => {
  const { content, map } = contentCells();
  const labels = questionLabelsEN(content, [...map.keys()]);
  assert.match(labels.get("QA4"), /benefited/i);
  assert.match(labels.get("D78"), /EU conjure up|image/i);
});

test("parseQuestionSheet: HU mintaméret + %-opciók angol címkével (QA4: Benefited 0.81)", () => {
  const q = parseQuestionSheet(sheetCells("QA4"));
  assert.equal(q.N, 1020);
  // a %-sorok tört értékűek, angol címkével; a részösszeg ("Total 'X'") megjelölve.
  const benefited = q.options.find((o) => /^Benefited$/i.test(o.label));
  assert.equal(benefited.pct, 0.81);
  assert.ok(q.options.some((o) => /Not benefited/i.test(o.label) && o.pct === 0.16));
  // a "Ne sait pas/Don't know" is opció (itt 0.03)
  assert.ok(q.options.some((o) => /Don.t know/i.test(o.label)));
});

test("parseQuestionSheet: a hiányzó % (QA1 Don't know = '-') null, nem 0", () => {
  const q = parseQuestionSheet(sheetCells("QA1"));
  const dk = q.options.find((o) => /Don.t know/i.test(o.label));
  assert.equal(dk.pct, null);
  assert.ok(q.options.some((o) => /^Yes$/i.test(o.label) && o.pct === 0.78));
});

test("parseQuestionSheet: a részösszeg-sorok (Total 'Positive') isSubtotal=true", () => {
  const q = parseQuestionSheet(sheetCells("D78"));
  const sub = q.options.find((o) => /Total .Positive./i.test(o.label));
  assert.ok(sub, "van részösszeg-sor D78-ban");
  assert.equal(sub.isSubtotal, true);
  // a bázisopciók NEM részösszegek (az opció-címke a pct-sorról ANGOL: "Very positive")
  assert.ok(q.options.some((o) => /^Very positive$/i.test(o.label) && !o.isSubtotal));
});

test("parseQuestionSheet: a recap-blokk (első Total-tól) NEM szennyezi a bázist dupla 'Neutral'-lal", () => {
  const q = parseQuestionSheet(sheetCells("D78"));
  const baseNeutral = q.options.filter((o) => /^Neutral$/i.test(o.label) && !o.isSubtotal);
  assert.equal(baseNeutral.length, 1, "pontosan EGY bázis-'Neutral' (a recap-ismétlés isSubtotal)");
  // a recap-blokk MINDEN sora (Total Positive / ismételt Neutral / Total Negative) részösszeg
  assert.ok(q.options.filter((o) => /^Neutral$/i.test(o.label)).some((o) => o.isSubtotal), "a recap-Neutral isSubtotal");
});

test("parseQuestionSheet: a count===1 sor NEM lesz téves pct=1.0 (pozicionális párosítás)", () => {
  const q = parseQuestionSheet(sheetCells("QA7ab")); // max-answer: az utolsó DK count=1, pct='-'
  // egyetlen opció-címke sem francia (a pct-sor angol címkéje nyer)
  assert.ok(!q.options.some((o) => /Ne sait pas|santé|économie/i.test(o.label)), "nincs francia címke");
  // nincs hamis 100%-os "Ne sait pas"
  assert.ok(!q.options.some((o) => o.pct === 1), "nincs pct===1.0 bogus opció");
  const dk = q.options.find((o) => /Don.t know/i.test(o.label));
  assert.ok(dk && dk.pct === null && dk.count === 1, "a DK: angol címke, pct=null ('-'), count=1");
});

test("isSubstantiveQuestion: QA* + D78 tartalmi; D11A/D25/B/SD27 demográfia kimarad", () => {
  assert.equal(isSubstantiveQuestion("QA4"), true);
  assert.equal(isSubstantiveQuestion("QA10_1"), true);
  assert.equal(isSubstantiveQuestion("D78"), true);   // EU-imázs, allowlist
  assert.equal(isSubstantiveQuestion("D11A"), false); // kor
  assert.equal(isSubstantiveQuestion("D25"), false);
  assert.equal(isSubstantiveQuestion("B"), false);    // ország
  assert.equal(isSubstantiveQuestion("SD27"), false);
});

test("validateQuestion: fail-closed — N a [300,5000] sávban ÉS ≥1 érvényes %", () => {
  assert.equal(validateQuestion({ N: 1020, options: [{ label: "Yes", pct: 0.78 }] }).ok, true);
  assert.equal(validateQuestion({ N: 50, options: [{ label: "Yes", pct: 0.78 }] }).ok, false);      // minta túl kicsi
  assert.equal(validateQuestion({ N: 1020, options: [{ label: "Yes", pct: null }] }).ok, false);    // nincs érvényes %
  assert.equal(validateQuestion({ N: 1020, options: [{ label: "Yes", pct: 1.5 }] }).ok, false);     // %>1 (oszlop-eltolás)
  assert.equal(validateQuestion({ N: NaN, options: [{ label: "Yes", pct: 0.78 }] }).ok, false);
});

// --- title-rövidítés (B2 aktiválás előfeltétele; a levélben olvashatatlan a nyers kérdés) ---

test("shortenQuestion: mátrix (::-) esetén a kettőspont UTÁNI konkrét állítás", () => {
  const raw = "Please tell me whether you totally agree, tend to agree, tend to disagree or totally disagree with the following statement::-The European Union is a place of stability in a troubled world";
  assert.equal(shortenQuestion(raw), "The European Union is a place of stability in a troubled world");
});

test("shortenQuestion: a survey-adminisztrációs farok levágva (Firstly?/And then?/(MAX. N ANSWERS))", () => {
  const raw = "Which are the main reasons? Firstly? And then? (MAX. 3 ANSWERS)";
  const out = shortenQuestion(raw);
  assert.ok(!/Firstly\?|And then\?|MAX\.|ANSWERS/i.test(out), `farok maradt: "${out}"`);
  assert.match(out, /reasons\?$/);
});

test("shortenQuestion: a (MULTIPLE ANSWERS POSSIBLE) farok is levágva", () => {
  assert.match(shortenQuestion("For you, which are most important for a good quality of life? (MULTIPLE ANSWERS POSSIBLE)"), /quality of life\?$/);
});

test("shortenQuestion: az orphan követő-kérdés (csak 'And then?') üresre redukálódik", () => {
  assert.equal(shortenQuestion("And then? (MAX. 2 ANSWERS)"), "");
  assert.equal(shortenQuestion("And then?"), "");
});

test("shortenQuestion: hossz-cap szó-határon, ellipszissel (struktúra nélküli hosszú kérdés)", () => {
  const raw = "Regardless of whether you think your country has benefited or not from being a member of the European Union over the past several decades of shared policy";
  const out = shortenQuestion(raw);
  assert.ok(out.length <= 91, `túl hosszú: ${out.length}`);
  assert.match(out, /…$/);
  assert.ok(!/\s\S*…$/.test(out.slice(0, -1)) || /\s/.test(raw.slice(0, out.length)), "szó-határon vág");
});

test("questionToItem: europeelects-tükör shape (guid/title/publishedAt/summary/dataBacked/survey)", () => {
  const q = parseQuestionSheet(sheetCells("QA4"));
  const it = questionToItem(
    { code: "QA4", questionEN: "QA4. ...has benefited...", N: q.N, options: q.options },
    { wave: "105.3", fieldworkEnd: "2026-05-04" },
    { id: "eurobarometer", list_url: "https://europa.eu/eurobarometer/" },
  );
  assert.equal(it.guid, "eurobarometer:105.3:QA4");
  assert.match(it.title, /Eurobarometer 105\.3/);
  assert.match(it.title, /81%/);                         // a summary a címben
  assert.equal(it.publishedAt, "2026-05-04T00:00:00.000Z");
  assert.equal(it.dateOnly, true);
  assert.equal(it.dataBacked, true);
  assert.match(it.summary, /Benefited 81%/i);
  // a részösszeg NEM szennyezi a summary-t (D78-nál lenne releváns; QA4-nél nincs)
  assert.equal(it.survey.wave, "105.3");
  assert.equal(it.survey.N, 1020);
});

test("questionToItem: a summary KIHAGYJA a részösszegeket (D78 nem duplázza a %-ot)", () => {
  const q = parseQuestionSheet(sheetCells("D78"));
  const it = questionToItem(
    { code: "D78", questionEN: "D78. EU image", N: q.N, options: q.options },
    { wave: "105.3", fieldworkEnd: "2026-05-04" },
    { id: "eurobarometer", list_url: "x" },
  );
  assert.ok(!/Total .Positive./i.test(it.summary), "a summary nem tartalmaz részösszeget");
});

test("questionToItem: a cím a RÖVIDÍTETT kérdést használja (mátrix → :- utáni állítás)", () => {
  const q = parseQuestionSheet(sheetCells("QASD"));
  const it = questionToItem(
    { code: "QASD", questionEN: "Please tell me whether you totally agree...::-The European Union is a place of stability in a troubled world", N: q.N, options: q.options },
    { wave: "105.3", fieldworkEnd: "2026-05-04" },
    { id: "eurobarometer", list_url: "x" },
  );
  assert.match(it.title, /place of stability/);
  assert.ok(!/totally agree, tend to agree/i.test(it.title), "a skála-preambulum nincs a címben");
});

// --- fetchNew: teljes lánc offline stubbal (a resolveVolumeA fixture-chainje) ---

const chainStub = () => async (url) => {
  let body, ct = "application/json";
  if (url.includes("survey/get/latest")) body = fx("survey_latest.json");
  else if (url.includes("survey/get/one")) body = fx("survey_one_3752.json");
  else if (url.includes("api/hub/search/datasets/")) body = fx("odp_dataset.json");
  else if (url.includes("webgate.ec.europa.eu")) { body = XLSX; ct = "application/octet-stream"; }
  else throw new Error(`váratlan URL: ${url}`);
  return { ok: true, status: 200, headers: { get: () => ct }, text: async () => body.toString("utf8"),
    bytes: async () => body, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
};
const SRC = { id: "eurobarometer", name: "Eurobarometer", list_url: "https://europa.eu/eurobarometer/", kind: "nemzetkozi" };

test("fetchNew: tartalmi kérdésekből ad tételt (QA4 igen), demográfiából NEM (D11A/D25 nem)", async () => {
  const { items, check } = await fetchNew(SRC, { fetchImpl: chainStub(), now: Date.parse("2026-05-10") });
  assert.equal(check.status, "OK_UJ");
  const codes = items.map((it) => it.survey.code);
  assert.ok(codes.includes("QA4"), "QA4 tétel megvan");
  assert.ok(codes.includes("D78"), "D78 (EU-imázs) tétel megvan");
  assert.ok(!codes.includes("D11A"), "D11A (kor) NINCS tétel");
  assert.ok(!codes.includes("D25"), "D25 (demográfia) NINCS tétel");
  assert.ok(!codes.includes("B"), "B (ország) NINCS tétel");
  // minden tétel bájt-alapú, data_backed, ugyanabból a hullámból
  assert.ok(items.every((it) => it.dataBacked === true && it.survey.wave === "105.3"));
  // az orphan "b" követő-kérdések (QA5b/6b/7b/8b/11b/14b, csak "And then?") KIMARADNAK,
  // az "a" (első) és "ab" (összevont) VÁLTOZAT viszont megmarad (önálló jelentésű).
  assert.ok(!codes.includes("QA5b"), "QA5b orphan követő NINCS");
  assert.ok(!codes.includes("QA6b"), "QA6b orphan követő NINCS");
  assert.ok(codes.includes("QA5a"), "QA5a (első) megvan");
  assert.ok(codes.includes("QA5ab"), "QA5ab (összevont) megvan");
  assert.equal(items.length, 30, "35 QA + D78 − 6 orphan 'b' = 30");
  // a címek a rendszer poll-tétel normájába esnek (europeelects: med 127, max 147; a régi nyers
  // EB med 288, max 1110 volt). A dinamikus summary-budget garantálja a korlátot.
  const lens = items.map((it) => it.title.length).sort((a, b) => a - b);
  assert.ok(lens[lens.length - 1] <= 170, `leghosszabb cím ${lens[lens.length - 1]} > 170`);
  assert.ok(lens[lens.length >> 1] <= 155, `medián cím ${lens[lens.length >> 1]} > 155`);
});

test("fetchNew: since-szűrés a fieldwork-vég szerint (az előző hullám után → OK_NINCS_UJ)", async () => {
  const { items, check } = await fetchNew(SRC, { fetchImpl: chainStub(), since: Date.parse("2026-06-01"), now: Date.parse("2026-06-10") });
  assert.equal(items.length, 0);
  assert.equal(check.status, "OK_NINCS_UJ");
});

// 2026-08-24 incidens: a volumeA.xlsx body-download némán beragadt; a HIBA-detail a puszta
// megjelenítés-URL-t adta, NEM azt, hogy a lánc MELYIK lépése akadt el. A lánc-lépés
// log-jelzése: egy elakadt lépés HIBA-detailje NEVESÍTI a lépést (itt a webgate volumeA).
test("fetchNew: a lánc-lépés hibája NEVESÍTI a lépést (volumeA body-timeout → diagnosztizálható)", async () => {
  const abortOnWebgate = async (url) => {
    let body, ct = "application/json";
    if (url.includes("survey/get/latest")) body = fx("survey_latest.json");
    else if (url.includes("survey/get/one")) body = fx("survey_one_3752.json");
    else if (url.includes("api/hub/search/datasets/")) body = fx("odp_dataset.json");
    else if (url.includes("webgate.ec.europa.eu")) {
      // a fejléc megjön, a TÖRZS elakad → időtúllépés (a http.js törzs-timeout-ja utánozva)
      return { ok: true, status: 200, headers: { get: () => "application/octet-stream" },
        text: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; },
        bytes: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; },
        arrayBuffer: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; } };
    } else throw new Error(`váratlan URL: ${url}`);
    return { ok: true, status: 200, headers: { get: () => ct }, text: async () => body.toString("utf8"),
      bytes: async () => body, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  };
  const { items, check } = await fetchNew(SRC, { fetchImpl: abortOnWebgate });
  assert.equal(items.length, 0);
  assert.equal(check.status, "HIBA");
  assert.match(check.detail, /volumeA/i, "a HIBA-detail nevesíti az elakadt lánc-lépést (webgate volumeA)");
  assert.match(check.detail, /időtúllépés/, "és jelzi, hogy időtúllépés volt");
});
