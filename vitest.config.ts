import { defineConfig } from "vitest/config";

// Unit tests cover pure logic (parsing, matching, verification) and run in Node.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
