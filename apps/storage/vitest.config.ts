import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 15000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
  },
})
