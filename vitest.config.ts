import { defineConfig } from 'vitest/config'
import dotenv from 'dotenv'

export default defineConfig(({ mode }) => {
  if (mode && mode.startsWith('integration')) {
    const env = mode.split('-')[1]
    dotenv.config({ path: `.env.${env}` })

    return {
      test: {
        // Default include patterns can be empty,
        // will be overridden in CLI or scripts by --include
        include: ['test/integration/**/*.test.ts']
      }
    }
  }

  // For unit or default tests, load the default .env
  dotenv.config()

  return {
    test: {
      // Default include patterns can be empty,
      // will be overridden in CLI or scripts by --include
      include: ['test/unit/**/*.test.ts']
    }
  }
})
