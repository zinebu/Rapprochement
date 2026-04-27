/**
 * COMPANY_IDENTITY represents the company that OWNS this application instance.
 *
 * canonicalName : official company name (as it appears on invoices)
 * aliases       : all variants that may appear in OCR-extracted text
 * siret         : 14-digit SIRET of the main entity
 * relatedSirets : SIRETs of sister/subsidiary entities belonging to the same group
 *                 (invoices between these entities are INTRA-GROUP)
 * addressHints  : partial address strings used as tie-breakers
 */
export const COMPANY_IDENTITY = {
  canonicalName: "CONSULT-IT",
  aliases: [
    "CONSULT-IT",
    "CONSULT IT",
    "Consult IT",
    "Consult-It",
    "Consult IT SAS",
  ],
  siret: "75318490200066",
  // Known suppliers / partners — each entry maps a known external company to their SIRET.
  // These are NOT treated as "our company" but allow the parser to assign correct SIRETs.
  relatedEntities: [
    {
      name: "CONSULT HIGHTECH",
      aliases: [
        "CONSULT HIGHTECH",
        "CONSULT-HIGHTECH",
        "Consult Hightech",
        "CONSULT HIGHTECH SARL",
        "Consult Hightech SARL",
      ],
      siret: "87930331100010",
    },
  ],
  addressHints: [],
};