import { ThrottleConfig } from './types'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Default throttling configurations
 */
const DEFAULT_OPERATION_THROTTLE: ThrottleConfig = {
  enabled: true,
  maxOperations: 100, // 100 operations per minute
  windowMs: 60 * 1000, // 1 minute
  operationDelay: 0 // No artificial delay by default
}

/**
 * Operation tracking for throttling
 */
interface OperationRecord {
  timestamp: number
}

/**
 * Throttle manager for HTTP requests and WebSocket messages
 */
export default class ThrottleManager {
  private operationConfig: ThrottleConfig
  private operationHistory: OperationRecord[] = []
  private lastOperationTime: number = 0

  constructor (options?: ThrottleConfig) {
    this.operationConfig = { ...DEFAULT_OPERATION_THROTTLE, ...(options || {}) }
  }

  /**
   * Update throttling configuration
   */
  updateConfig (options: ThrottleConfig) {
    this.operationConfig = { ...this.operationConfig, ...options }
  }

  /**
   * Clean up old records outside the time window
   */
  private cleanupHistory (history: OperationRecord[], windowMs: number): void {
    const cutoff = Date.now() - windowMs
    const validIndex = history.findIndex(record => record.timestamp > cutoff)
    if (validIndex > 0) {
      history.splice(0, validIndex)
    } else if (validIndex === -1) {
      // All records are old
      history.length = 0
    }
  }

  /**
   * Check if operation is allowed under current throttling rules
   */
  private isAllowed (history: OperationRecord[], maxOperations: number, windowMs: number): boolean {
    this.cleanupHistory(history, windowMs)
    return history.length < maxOperations
  }

  /**
   * Calculate delay needed before next operation
   */
  private calculateDelay (lastTime: number, configDelay: number): number {
    if (configDelay === 0) return 0
    const timeSinceLastOperation = Date.now() - lastTime
    return Math.max(0, configDelay - timeSinceLastOperation)
  }

  /**
   * Throttle a HTTP request or a WebSocket message
   * @returns Promise that resolves when the operation is allowed to proceed
   * @throws Error if operation would exceed throttle limits
   */
  async throttleOperation (): Promise<void> {
    if (!this.operationConfig.enabled) return

    // Check if operation is allowed
    if (!this.isAllowed(this.operationHistory, this.operationConfig.maxOperations!, this.operationConfig.windowMs!)) {
      throw new Error(
        `Operation rate limit exceeded. Maximum ${this.operationConfig.maxOperations} operations per ${this.operationConfig.windowMs}ms allowed.`
      )
    }

    // Apply artificial delay if configured
    const delay = this.calculateDelay(this.lastOperationTime, this.operationConfig.operationDelay!)
    if (delay > 0) {
      await wait(delay)
    }

    // Record this operation
    const now = Date.now()
    this.operationHistory.push({ timestamp: now })
    this.lastOperationTime = now
  }

  /**
   * Get current operation throttling status
   */
  getOperationStatus () {
    this.cleanupHistory(this.operationHistory, this.operationConfig.windowMs!)
    return {
      enabled: this.operationConfig.enabled,
      currentCount: this.operationHistory.length,
      maxOperations: this.operationConfig.maxOperations,
      windowMs: this.operationConfig.windowMs,
      remaining: Math.max(0, this.operationConfig.maxOperations! - this.operationHistory.length)
    }
  }

  /**
   * Reset all throttling state (useful for testing or manual resets)
   */
  reset (): void {
    this.operationHistory.length = 0
    this.lastOperationTime = 0
  }
}
