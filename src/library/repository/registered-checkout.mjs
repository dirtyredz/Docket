// Public facade for docket/repository/registered-checkout (docs/LIBRARY.md): re-exports only the supported names.
export {
  inspectCheckout,
  unavailableReason,
  openCheckoutAt,
  createCheckoutOpener,
} from "../../repository/registered-checkout.mjs";
