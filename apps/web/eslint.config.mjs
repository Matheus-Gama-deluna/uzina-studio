import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { baseEslintConfig } from "../../eslint.config.mjs";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  ...baseEslintConfig,
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@uzina/core",
              message:
                "Use apenas subpaths browser-safe de @uzina/core/* em Client Components (ex.: @uzina/core/strategy-router, @uzina/core/design-md).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
