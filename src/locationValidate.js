import { provincesData, kinshasaQuarters } from "./rdcData.generated.js";

const KINSHASA = "Kinshasa";

/**
 * Verifie que la combinaison province / ville / commune / quartier
 * correspond au referentiel RDC (meme logique que le formulaire public).
 * @returns {string|null} message d'erreur ou null si OK
 */
export function validateSubmissionLocation(data) {
  const province = String(data.province || "").trim();
  const cityOrTerritory = String(data.cityOrTerritory || "").trim();
  const communeOrSector = String(data.communeOrSector || "").trim();
  const quarter = String(data.quarter || "").trim();

  const pData = provincesData[province];
  if (!pData) {
    return "Province inconnue ou non autorisee.";
  }

  if (province === KINSHASA) {
    if (cityOrTerritory !== KINSHASA) {
      return "Pour Kinshasa, la ville attendue est Kinshasa.";
    }
    const communes = pData.communes?.[KINSHASA] || [];
    if (!communes.includes(communeOrSector)) {
      return "Commune de Kinshasa invalide.";
    }
    const quarters = kinshasaQuarters[communeOrSector] || [];
    if (!quarter || !quarters.includes(quarter)) {
      return "Quartier invalide pour la commune selectionnee.";
    }
    return null;
  }

  const cities = pData.cities || [];
  const territories = pData.territories || [];

  if (cities.includes(cityOrTerritory)) {
    const list = pData.communes?.[cityOrTerritory] || [];
    if (!list.includes(communeOrSector)) {
      return "Commune ou secteur invalide pour cette ville.";
    }
    return null;
  }

  if (territories.includes(cityOrTerritory)) {
    const list = pData.territorySubdivisions?.[cityOrTerritory] || [];
    if (!list.includes(communeOrSector)) {
      return "Secteur ou commune invalide pour ce territoire.";
    }
    return null;
  }

  return "Ville ou territoire invalide pour cette province.";
}
