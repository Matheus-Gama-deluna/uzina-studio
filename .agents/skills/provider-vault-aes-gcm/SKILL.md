---
name: provider-vault-aes-gcm
description: >-
  Implementa e testa o Cofre Criptografico de Provedores (Provider Vault) da Fabrica de Software
  com AES-256-GCM (IV de 12 bytes, AuthTag de 16 bytes), mascaramento seguro e roteamento de LLMs.
  Use esta skill ao criar, alterar ou auditar o armazenamento de chaves de API (OpenAI, Anthropic,
  Google, OpenRouter, Daytona) na fabrica.
---

# Provider Vault AES-256-GCM — Cofre de Credenciais da Fabrica

Esta skill define o procedimento exato de implementacao e verificacao TDD do **Provider Vault** da Fabrica de Software.

---

## 1. Especificacao Criptografica Obrigatoria

1. **Master Key (`VAULT_MASTER_KEY`)**:
   - Deve ter exatos **32 bytes (256 bits)** (fornecida em hex de 64 caracteres ou base64 decodificado para 32 bytes).
   - Validada com schema **Zod** no boot da aplicacao. Jamais use valor default ou fallback.
2. **Envelope de Cifragem (`encryptSecret`)**:
   - Algoritmo: `aes-256-gcm` via modulo nativo `node:crypto`.
   - Gere um IV exclusivo por operacao: `const iv = crypto.randomBytes(12)`.
   - Opcionais de autenticacao adicional (AAD): vincule o `organizationId` e `provider` em `cipher.setAAD(Buffer.from(\`\${orgId}:\${provider}\`))` para impedir transplante de ciphertext entre tenants!
   - Extraia a tag de autenticacao de 16 bytes: `const authTag = cipher.getAuthTag()`.
   - Armazene no banco (`drizzle`): `ciphertext` (base64/hex), `iv` (12 bytes), `authTag` (16 bytes), `keyPreview` (ex.: `sk-...a9f2`) e `keyVersion`.
3. **Envelope de Decifragem (`decryptSecret`)**:
   - Configure `decipher.setAAD(...)` e `decipher.setAuthTag(authTag)` (validando que `authTag.length === 16`).
   - Se o ciphertext, IV, AuthTag ou AAD (`orgId:provider`) forem adulterados, `decipher.final()` deve lancar erro imediatamente.

---

## 2. Suite Minima de Testes TDD (Obrigatoria)

Antes de implementar o servico do cofre, escreva os seguintes testes em Vitest:
1. **Round-trip valido**: Cifra e decifra uma chave retornando o plaintext original.
2. **Unicidade de IV**: Duas cifragens do mesmo segredo produzem `iv` e `ciphertext` diferentes.
3. **Deteccao de Adulteracao (Tamper Resistance)**: Alterar 1 bit no `ciphertext`, no `iv`, na `authTag` ou tentar decifrar com `organizationId` diferente (violacao de AAD) falha com excecao.
4. **Nao-exposicao**: A listagem de chaves do cofre retorna apenas `keyPreview` (`sk-...xxxx`), nunca o segredo descriptografado.
