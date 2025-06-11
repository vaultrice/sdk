import { access, readdir, lstat, readFile, writeFile, constants } from 'node:fs/promises'
import { join } from 'node:path'

async function fileExists (path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

// function to recurse dirs finding files
async function fromDir (startPath, filter) {
  if (!(await fileExists(startPath))) {
    throw new Error(`no dir ${startPath}`)
  }

  const foundFiles = []
  const files = await readdir(startPath)
  for (let i = 0; i < files.length; i++) {
    const filename = join(startPath, files[i])
    const stat = await lstat(filename)
    if (stat.isDirectory()) {
      const subFiles = await fromDir(filename, filter) // recurse
      foundFiles.push(...subFiles)
    } else if (filter.test(filename)) {
      foundFiles.push(filename)
    }
  }
  return foundFiles
}

// this add .ts to lines like:  import .* from "\.  <-- only imports from ./ or ../ are touched
async function addDotTsToLocalImports (filename) {
  const buf = await readFile(filename)
  const replaced = buf.toString().replace(/(import .* from\s+['"])(?!.*\.ts['"])(\..*?)(?=['"])/g, '$1$2.ts')
  if (replaced !== buf.toString()) {
    await writeFile(filename, replaced)
    console.log(`fixed imports at ${filename}`)
  }
}
const folder = process.argv[2]
if (folder && (await fileExists(join(process.cwd(), folder)))) {
  // add .ts to generated imports so tsconfig.json module:"ES2020" works with node
  // see: https://github.com/microsoft/TypeScript/issues/16577
  const tsFiles = await fromDir(join(process.cwd(), folder), /\.ts$/)
  for (const tsFile of tsFiles) {
    await addDotTsToLocalImports(tsFile)
  }
} else {
  throw new Error('no folder in argument')
}
