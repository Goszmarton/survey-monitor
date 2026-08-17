import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  pickLatestSurvey, openDataUrlOf, datasetIdFromOpenDataUrl, volumeADownloadUrl,
  resolveVolumeA, unzipXlsx, sheetFileMap, parseWorksheet, findCountryColumn, columnLetter,
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
