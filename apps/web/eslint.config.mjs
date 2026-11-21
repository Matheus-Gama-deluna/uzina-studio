import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { baseEslintConfig } from "../../eslint.config.mjs";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  ...baseEslintConfig,
];

export default eslintConfig;
