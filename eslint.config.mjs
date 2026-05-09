import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // The new React 19 lint rule (`react-hooks/refs`) flags any `.current`
      // access in a function component body — including reads inside
      // `useCallback`/`useMemo`/`useEffect`, which is fine in practice and the
      // intended pattern for ref-stable closures. Downgrade to warn so it
      // surfaces the pattern but doesn't block the build.
      "react-hooks/refs": "warn",
      // The "set state synchronously inside an effect" rule fires false
      // positives on subscribe callbacks (the whole point of which is to push
      // store state into React). Downgrade to warn.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
