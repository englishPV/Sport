import { createServer } from 'vite'

// Sous Windows (cmd.exe), `#` n'est pas un commentaire :
// `npm run dev # http://localhost:5173` passait `#` comme dossier racine à Vite -> 404.
// Ce lanceur ignore tout argument à partir de `#` et démarre toujours sur la racine du projet.
const rawArgs = process.argv.slice(2)
const hashIndex = rawArgs.findIndex((arg) => arg.startsWith('#'))
const cleanArgs = hashIndex >= 0 ? rawArgs.slice(0, hashIndex) : rawArgs

const portFlagIndex = cleanArgs.findIndex((arg) => arg === '--port' || arg === '-p')
const customPort =
  portFlagIndex >= 0 && cleanArgs[portFlagIndex + 1]
    ? Number(cleanArgs[portFlagIndex + 1])
    : undefined

const server = await createServer({
  configFile: './vite.config.ts',
  server: {
    host: '0.0.0.0',
    ...(customPort && Number.isFinite(customPort) ? { port: customPort } : {}),
  },
})

await server.listen()
server.printUrls()
server.bindCLIShortcuts({ print: true })
