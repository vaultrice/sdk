import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const sampleEnv = `BASE_PATH=https://some-domain.app
API_KEY=some-api-key
API_SECRET=some-api-secret
PROJECT_ID=some-project-id
CLASS_NAME=_undefined_
`

await writeFile(join(process.cwd(), '.env.dev'), sampleEnv)
await writeFile(join(process.cwd(), '.env.local'), sampleEnv)
