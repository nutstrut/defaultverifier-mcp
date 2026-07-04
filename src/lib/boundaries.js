/**
 * Canonical boundary declarations for DefaultVerifier MCP.
 *
 * Capability ≠ Authority ≠ Execution ≠ Verification.
 * Verification must leave evidence.
 */

export const VERIFY_RECEIPT_PROVES = [
  'receipt_id matches canonical signed core digest',
  'signature verifies under the named public key',
];

export const VERIFY_RECEIPT_DOES_NOT_PROVE = [
  'task quality',
  'payment finality',
  'legal settlement finality',
  'authorization to execute',
  'fund custody or release',
  'escrow',
  'approval',
];

export const LOG_DOES_NOT_PROVE = [
  'partnership',
  'endorsement',
  'official integration',
  'adoption',
  'standardization',
];

export const NOT_CLAIMED = [
  'DefaultVerifier does not execute tasks',
  'DefaultVerifier does not approve actions',
  'DefaultVerifier does not release funds',
  'DefaultVerifier does not custody funds',
  'DefaultVerifier does not prove payment or legal finality',
];
