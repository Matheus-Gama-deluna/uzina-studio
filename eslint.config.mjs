import tseslint from "typescript-eslint";

export const baseEslintConfig = tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/drizzle/**",
      "**/coverage/**",
      "**/.turbo/**",
      "data/**",
      "docs/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "TSAsExpression[expression.type='TSAsExpression'][expression.typeAnnotation.type='TSUnknownKeyword']",
          message:
            "Proibido usar 'as unknown as' (AGENTS.md §3.3). Modele o tipo ou valide com Zod."
        }
      ]
    }
  }
);

export default baseEslintConfig;
