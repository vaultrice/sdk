import { LogLevel } from './types.ts'

const levels: LogLevel[] = [
  'error',
  'warn',
  'info',
  'debug'
]

export class Logger {
  constructor (private level: LogLevel) {}

  log (level: LogLevel, message: string) {
    if (levels.indexOf(this.level) < levels.indexOf(level)) return
    console[level](message)
  }
}

export default (level: LogLevel = 'warn') => {
  return new Logger(level)
}
