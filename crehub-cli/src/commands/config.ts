import pc from 'picocolors'
import { readConfig, writeConfig, setConfigKey, getConfigKey, CONFIG_FILE } from '../utils/config.ts'

// re-export path for help display
export { CONFIG_FILE }

export function cmdConfig(args: string[]) {
  const [sub, key, value] = args

  switch (sub) {
    case 'set': {
      if (!key || value === undefined) {
        console.log(pc.red('  Usage: crehub config set <key> <value>'))
        process.exit(1)
      }
      setConfigKey(key, value)
      console.log(`  ${pc.green('✓')} ${key} saved to ~/.crehub/config.json`)
      break
    }

    case 'get': {
      if (!key) {
        console.log(pc.red('  Usage: crehub config get <key>'))
        process.exit(1)
      }
      const val = getConfigKey(key)
      if (val === undefined) console.log(pc.dim(`  ${key}: (not set)`))
      else console.log(`  ${key}: ${key.toLowerCase().includes('key') ? pc.dim('*'.repeat(Math.min(val.length, 20))) : val}`)
      break
    }

    case 'show': {
      const cfg = readConfig()
      const keys = Object.keys(cfg)
      if (keys.length === 0) {
        console.log(pc.dim('  No config stored. Use: crehub config set <key> <value>'))
        break
      }
      console.log('')
      console.log(pc.bold('  ~/.crehub/config.json'))
      console.log(pc.dim('  ' + '─'.repeat(40)))
      for (const k of keys) {
        const v = (cfg as Record<string, string>)[k]
        const display = k.toLowerCase().includes('key') || k.toLowerCase().includes('secret')
          ? pc.dim('*'.repeat(Math.min(v.length, 20)))
          : v
        console.log(`  ${pc.dim(k.padEnd(20))} ${display}`)
      }
      console.log('')
      break
    }

    case 'clear': {
      writeConfig({})
      console.log(`  ${pc.green('✓')} Config cleared.`)
      break
    }

    default: {
      console.log('')
      console.log(pc.bold('  crehub config'))
      console.log(pc.dim('  ─────────────────────────────────────────────'))
      console.log(`  ${pc.white('crehub config set <key> <value>')}   Save a config value`)
      console.log(`  ${pc.white('crehub config get <key>')}           Read a config value`)
      console.log(`  ${pc.white('crehub config show')}                Show all stored config`)
      console.log(`  ${pc.white('crehub config clear')}               Remove all stored config`)
      console.log('')
      console.log(pc.dim('  Keys: gatewayPublicKey · registryAddress · rpcUrl · privateKey'))
      console.log('')
    }
  }
}
