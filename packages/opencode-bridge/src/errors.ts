export class OpenCodeBridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class MissingRoleBindingError extends OpenCodeBridgeError {
  constructor(role: string) {
    super(
      "MISSING_ROLE_BINDING",
      `Nenhum modelo configurado em roleBindings para o papel '${role}'.`
    );
  }
}

export class MissingProviderApiKeyError extends OpenCodeBridgeError {
  constructor(providerType: string) {
    super(
      "MISSING_PROVIDER_API_KEY",
      `Provedor '${providerType}' exige encryptedApiKey cadastrada no Cofre AES-256-GCM.`
    );
  }
}

export class VaultDecryptionError extends OpenCodeBridgeError {
  constructor(message: string, cause?: unknown) {
    super("VAULT_DECRYPTION_FAILED", message, { cause });
  }
}

export class PromptCacheModelSwitchError extends OpenCodeBridgeError {
  constructor(expectedModel: string, actualModel: string) {
    super(
      "PROMPT_CACHE_MODEL_SWITCH",
      `Violação de higiene de Prompt Cache: sessão travada em '${expectedModel}', mas turno retornou '${actualModel}'.`
    );
  }
}

export class PlanModeWriteViolationError extends OpenCodeBridgeError {
  constructor(message: string) {
    super("PLAN_MODE_WRITE_VIOLATION", message);
  }
}

export class DangerousCommandError extends OpenCodeBridgeError {
  constructor(message: string) {
    super("DANGEROUS_COMMAND_BLOCKED", message);
  }
}

export class StructuredOutputValidationError extends OpenCodeBridgeError {
  constructor(message: string, cause?: unknown) {
    super("STRUCTURED_OUTPUT_INVALID", message, { cause });
  }
}

export class WorktreeError extends OpenCodeBridgeError {
  constructor(message: string, cause?: unknown) {
    super("WORKTREE_ERROR", message, { cause });
  }
}

export class OpenCodeTransportError extends OpenCodeBridgeError {
  constructor(message: string, cause?: unknown) {
    super("OPENCODE_TRANSPORT_ERROR", message, { cause });
  }
}
