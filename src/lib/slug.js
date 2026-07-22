// Slug- és kanonikus-kulcs képzés (tisztán determinisztikus — spec 13. pont).
// A dedup alapja: azonos tétel → azonos kulcs, futásról futásra.

/** ASCII-slug: kisbetű, ékezet nélkül, nem-alfanumerikus → egyetlen kötőjel. */
export function slug(input) {
  return String(input ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // kombináló ékezetek eldobása (á→a, ő→o, ű→u)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * F1 kanonikus kulcs: `slug(source_id):slug(guid|url|title)`.
 * A guid a legstabilabb; híján az URL, végül a cím. Üres azonosító → null.
 * A gazdagabb, forrásokon átívelő szemantikus kulcs (téma + időszak) az F2/F3.
 */
export function canonicalKey(sourceId, { guid, url, title } = {}) {
  const basis = guid ?? url ?? title ?? "";
  const basisSlug = slug(basis);
  if (!basisSlug) return null;
  return `${slug(sourceId)}:${basisSlug}`;
}
