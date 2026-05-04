/**
 * Extrait provincesData et kinshasaQuarters depuis les .ts du frontend
 * et genere backend/src/rdcData.generated.js (JSON) pour validation serveur.
 * Usage : node scripts/extract-rdc-data.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, "..");
const projectRoot = path.join(backendRoot, "..");

function extractBracedObject(src, exportName) {
  const marker = `export const ${exportName}`;
  const idx = src.indexOf(marker);
  if (idx < 0) throw new Error(`Export introuvable: ${exportName}`);
  const eq = src.indexOf("=", idx);
  const brace = src.indexOf("{", eq);
  if (brace < 0) throw new Error(`Pas d'objet pour ${exportName}`);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(brace, i + 1);
    }
  }
  throw new Error(`Accolades non equilibrees pour ${exportName}`);
}

const provincesTs = fs.readFileSync(
  path.join(projectRoot, "frontend/lib/provinces-data.ts"),
  "utf8"
);
const kinTs = fs.readFileSync(
  path.join(projectRoot, "frontend/lib/kinshasa-quarters-data.ts"),
  "utf8"
);

const provincesLiteral = extractBracedObject(provincesTs, "provincesData");
const kinLiteral = extractBracedObject(kinTs, "kinshasaQuarters");

const provincesData = new Function(`return ${provincesLiteral}`)();
const kinshasaQuarters = new Function(`return ${kinLiteral}`)();

const out = `/* Genere par scripts/extract-rdc-data.mjs — ne pas editer */
export const provincesData = ${JSON.stringify(provincesData)};
export const kinshasaQuarters = ${JSON.stringify(kinshasaQuarters)};
`;

const outPath = path.join(backendRoot, "src/rdcData.generated.js");
fs.writeFileSync(outPath, out);
console.log("OK :", outPath);
