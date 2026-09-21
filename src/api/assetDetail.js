

// Per-vehicle detail panel data.

import ASSET_DETAILS from "../data/assetDetailData";

export async function getAssetDetail(vehicleId) {

  return ASSET_DETAILS[vehicleId] || ASSET_DETAILS["KBU 123A"];
}
