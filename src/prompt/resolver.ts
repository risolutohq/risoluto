/**
 * Template resolver factory.
 *
 * Extracted from `src/cli/services.ts` to keep the service registry thin.
 * Encapsulates the priority chain for resolving a prompt template for a
 * given issue identifier:
 *
 *   1. Per-issue override (IssueConfigStorePort.getTemplateId)
 *   2. System-selected template (config.system.selectedTemplateId)
 *   3. The "default" template
 *   4. Empty string with a warning log
 */

import type { RisolutoLogger } from "../core/types.js";
import type { IssueConfigStorePort } from "../core/issue-config-port.js";
import type { PromptTemplateStore } from "./store.js";
import { isRecord, toErrorString } from "../utils/type-guards.js";
import type { ConfigStore } from "../config/store.js";
import { validatePromptTemplate } from "./template-policy.js";

export interface TemplateResolverDeps {
  templateStore: PromptTemplateStore | undefined;
  issueConfigStore: IssueConfigStorePort;
  configStore: ConfigStore;
  logger: RisolutoLogger;
}

/**
 * Returns an async function that resolves the prompt template body for a
 * given issue identifier, following the 4-level priority chain.
 */
export function createTemplateResolver(deps: TemplateResolverDeps): (identifier: string) => Promise<string> {
  const { templateStore, issueConfigStore, configStore, logger } = deps;

  const readSelectedTemplateId = (): string | null => {
    const mergedConfigMap = configStore.getMergedConfigMap();
    const systemConfig = mergedConfigMap.system;
    if (!isRecord(systemConfig)) {
      return null;
    }
    const selectedTemplateId = systemConfig.selectedTemplateId;
    return typeof selectedTemplateId === "string" && selectedTemplateId.trim() ? selectedTemplateId : null;
  };

  /**
   * Re-validate a stored template body against the prompt policy before it is
   * handed to the renderer. Stored bodies are untrusted at read time: a body
   * could have been persisted before the policy existed, written through a path
   * that bypassed validation, or tampered with at rest. A body that fails the
   * policy is rejected (fail closed) so the resolver falls through to the next
   * candidate rather than rendering an unvetted template.
   */
  const acceptValidatedBody = (body: string, source: string, identifier: string): string | null => {
    try {
      validatePromptTemplate(body);
      return body;
    } catch (error) {
      logger.warn(
        { identifier, source, error: toErrorString(error) },
        "stored prompt template failed policy re-validation — skipping",
      );
      return null;
    }
  };

  return async (identifier: string): Promise<string> => {
    if (templateStore) {
      const overrideTemplateId = issueConfigStore.getTemplateId(identifier);
      if (overrideTemplateId) {
        const tmpl = templateStore.get(overrideTemplateId);
        if (tmpl) {
          const body = acceptValidatedBody(tmpl.body, `override:${overrideTemplateId}`, identifier);
          if (body !== null) return body;
        }
      }
      const selectedTemplateId = readSelectedTemplateId();
      if (selectedTemplateId) {
        const tmpl = templateStore.get(selectedTemplateId);
        if (tmpl) {
          const body = acceptValidatedBody(tmpl.body, `selected:${selectedTemplateId}`, identifier);
          if (body !== null) return body;
        }
      }
      const def = templateStore.get("default");
      if (def) {
        const body = acceptValidatedBody(def.body, "default", identifier);
        if (body !== null) return body;
      }
    }
    logger.warn({ identifier }, "no prompt template found — using empty string");
    return "";
  };
}
