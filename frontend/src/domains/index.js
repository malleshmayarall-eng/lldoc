/**
 * Domain Config Registry
 *
 * Central lookup for domain-specific constants (document types, categories,
 * workflow templates, create-dialog hints). Each domain folder exports a
 * `config.js` with the same shape.
 *
 * Usage:
 *   import { getDomainConfig } from '../domains';
 *   const { DOCUMENT_TYPES, CATEGORIES } = getDomainConfig('procurement');
 */

import defaultConfig from './default/config';
import procurementConfig from './procurement/config';

/* ------------------------------------------------------------------ */
/*  Registry — add new domains here                                    */
/* ------------------------------------------------------------------ */

const DOMAIN_CONFIGS = {
  default: defaultConfig,
  procurement: procurementConfig,
};

/* ------------------------------------------------------------------ */
/*  Public helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Get the full config object for a domain.
 * Falls back to `default` if the domain isn't registered.
 */
export function getDomainConfig(domain) {
  return DOMAIN_CONFIGS[domain] || DOMAIN_CONFIGS.default;
}

/**
 * Get DOCUMENT_TYPES for the given domain.
 */
export function getDomainDocumentTypes(domain) {
  return getDomainConfig(domain).DOCUMENT_TYPES;
}

/**
 * Get CATEGORIES for the given domain.
 */
export function getDomainCategories(domain) {
  return getDomainConfig(domain).CATEGORIES;
}

/**
 * Get FILTER_CATEGORIES (emoji-labelled chips for Documents page filter bar).
 */
export function getDomainFilterCategories(domain) {
  return getDomainConfig(domain).FILTER_CATEGORIES;
}

/**
 * Get WORKFLOW_TEMPLATES for the given domain.
 */
export function getDomainWorkflowTemplates(domain) {
  return getDomainConfig(domain).WORKFLOW_TEMPLATES;
}

/**
 * Get CREATE_DIALOG hints for the given domain.
 */
export function getCreateDialogConfig(domain) {
  return getDomainConfig(domain).CREATE_DIALOG;
}

/**
 * Get SIDEBAR config (navOrder, newDocumentAction, newDocumentLabel).
 */
export function getSidebarConfig(domain) {
  return getDomainConfig(domain).SIDEBAR || {};
}

/**
 * List all registered domain keys.
 */
export function getRegisteredDomains() {
  return Object.keys(DOMAIN_CONFIGS);
}

export default DOMAIN_CONFIGS;
