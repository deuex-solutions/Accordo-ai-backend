import { NegotiationState } from "../state.js";
import { VendorNegotiationProfile } from "../../../../../models/vendor-negotiation-profile.js";
import { buildPreferenceProfile } from "../../meso.js";

/**
 * VendorProfilingAgent (Track 3: Adarsh)
 * 
 * @source src/modules/chatbot/engine/meso.ts
 * 
 * Synergy Mandate:
 * - Implements preference learning persistence layer
 * - Populates vendorProfile state channel
 */
export const vendorProfilingNode = async (state: NegotiationState) => {
  // Use the legacy profile builder logic
  // state might be missing mesoSelections in the root schema, so we cast to any for the legacy function
  const profileData = buildPreferenceProfile(state as any);

  if (!state.vendorId) {
    return { vendorProfile: profileData };
  }

  try {
    // Attempt to persist the learned preferences to the DB
    const [profile] = await VendorNegotiationProfile.findOrCreate({
      where: { vendorId: state.vendorId },
      defaults: {
        vendorId: state.vendorId,
        negotiationStyle: 'unknown',
      }
    });

    // Update with new meso preferences
    await profile.update({
      mesoPreferences: {
        scores: {
          price: profileData.priceWeight,
          paymentTerms: profileData.termsWeight,
          delivery: profileData.deliveryWeight,
          warranty: profileData.warrantyWeight,
          quality: 0.5 // Default
        },
        primaryPreference: profileData.lastSelectedOfferType || 'unknown',
        confidence: 0.8, // Arbitrary confidence for now
        mesoRoundsAnalyzed: profileData.selectionHistory.length
      }
    });

    return {
      vendorProfile: profileData
    };
  } catch (error) {
    // Fallback: If DB is not available or errors out (like in testing environments), 
    // we still return the profile for the state graph
    return {
      vendorProfile: profileData
    };
  }
};
