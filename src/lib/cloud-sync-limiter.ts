import type { ProEntitlements } from '../types'

const MANUAL_COOLDOWN_AFTER_SYNC_MS = 3_500
const MANUAL_COOLDOWN_NOOP_MS = 1_500
const MANUAL_WINDOW_MS = 60_000
const MANUAL_BURST_LIMIT = 6
const MANUAL_BURST_COOLDOWN_MS = 15_000

const RECONCILE_MIN_GAP_MS = 15_000
const ENTITLEMENTS_TTL_MS = 120_000

const ACTIVATE_WINDOW_MS = 60_000
const ACTIVATE_BURST_LIMIT = 4
const ACTIVATE_COOLDOWN_MS = 3_000

/**
 * Lightweight client-side limiter + short-TTL cache to prevent button spamming
 * and avoid unnecessary VPS requests when multiple devices/users sync.
 */
class CloudSyncClientLimiter {
  private manualTimestamps: number[] = []
  private cooldownUntil = 0
  private lastReconcileByUser = new Map<string, number>()
  private entitlementsCache = new Map<string, { value: ProEntitlements; fetchedAt: number }>()
  private activateTimestamps: number[] = []
  private activateCooldownUntil = 0

  private pruneWindow(list: number[], windowMs: number, now: number): number[] {
    return list.filter((ts) => now - ts < windowMs)
  }

  getManualRemainingMs(now = Date.now()): number {
    return Math.max(0, this.cooldownUntil - now)
  }

  canRunManualAction(allowDuringCooldown = false, now = Date.now()): { allowed: boolean; waitMs: number } {
    if (allowDuringCooldown) return { allowed: true, waitMs: 0 }
    this.manualTimestamps = this.pruneWindow(this.manualTimestamps, MANUAL_WINDOW_MS, now)
    const remaining = this.getManualRemainingMs(now)
    if (remaining > 0) {
      return { allowed: false, waitMs: remaining }
    }
    if (this.manualTimestamps.length >= MANUAL_BURST_LIMIT) {
      const oldestFreeAt = this.manualTimestamps[0] + MANUAL_WINDOW_MS
      const burstWait = Math.min(MANUAL_BURST_COOLDOWN_MS, Math.max(1_000, oldestFreeAt - now))
      this.cooldownUntil = now + burstWait
      return { allowed: false, waitMs: burstWait }
    }
    return { allowed: true, waitMs: 0 }
  }

  recordManualOutcome(options: { serverWork: boolean }, now = Date.now()): number {
    this.manualTimestamps = this.pruneWindow(this.manualTimestamps, MANUAL_WINDOW_MS, now)
    if (options.serverWork) {
      this.manualTimestamps.push(now)
    }
    const baseCooldown = options.serverWork
      ? MANUAL_COOLDOWN_AFTER_SYNC_MS
      : MANUAL_COOLDOWN_NOOP_MS
    let nextUntil = now + baseCooldown
    if (options.serverWork && this.manualTimestamps.length >= MANUAL_BURST_LIMIT) {
      const oldestFreeAt = this.manualTimestamps[0] + MANUAL_WINDOW_MS
      const burstWait = Math.min(MANUAL_BURST_COOLDOWN_MS, Math.max(baseCooldown, oldestFreeAt - now))
      nextUntil = now + burstWait
    }
    this.cooldownUntil = Math.max(this.cooldownUntil, nextUntil)
    return this.cooldownUntil
  }

  applyServerRateLimit(errorMessage: string, now = Date.now()): number | undefined {
    const match = /rate_limited(?::(\d+))?/i.exec(errorMessage)
    if (!match) return undefined
    const seconds = Math.min(60, Math.max(5, match[1] ? Number(match[1]) : 12))
    const until = now + seconds * 1000
    this.cooldownUntil = Math.max(this.cooldownUntil, until)
    this.activateCooldownUntil = Math.max(this.activateCooldownUntil, until)
    return seconds
  }

  canAutoReconcile(userId: string, force = false, now = Date.now()): boolean {
    if (force) return true
    if (this.getManualRemainingMs(now) > 0) return false
    const last = this.lastReconcileByUser.get(userId) ?? 0
    return now - last >= RECONCILE_MIN_GAP_MS
  }

  markAutoReconciled(userId: string, now = Date.now()): void {
    this.lastReconcileByUser.set(userId, now)
  }

  getCachedEntitlements(userId: string, now = Date.now()): ProEntitlements | undefined {
    const entry = this.entitlementsCache.get(userId)
    if (!entry) return undefined
    if (now - entry.fetchedAt > ENTITLEMENTS_TTL_MS) {
      this.entitlementsCache.delete(userId)
      return undefined
    }
    return entry.value
  }

  setCachedEntitlements(userId: string, value: ProEntitlements, now = Date.now()): void {
    this.entitlementsCache.set(userId, { value, fetchedAt: now })
  }

  invalidateEntitlements(userId?: string): void {
    if (userId) this.entitlementsCache.delete(userId)
    else this.entitlementsCache.clear()
  }

  canActivatePro(now = Date.now()): { allowed: boolean; waitSeconds: number } {
    this.activateTimestamps = this.pruneWindow(this.activateTimestamps, ACTIVATE_WINDOW_MS, now)
    if (this.activateCooldownUntil > now) {
      return { allowed: false, waitSeconds: Math.ceil((this.activateCooldownUntil - now) / 1000) }
    }
    if (this.activateTimestamps.length >= ACTIVATE_BURST_LIMIT) {
      const oldestFreeAt = this.activateTimestamps[0] + ACTIVATE_WINDOW_MS
      const until = Math.min(now + 20_000, Math.max(now + 3_000, oldestFreeAt))
      this.activateCooldownUntil = until
      return { allowed: false, waitSeconds: Math.ceil((until - now) / 1000) }
    }
    return { allowed: true, waitSeconds: 0 }
  }

  recordProActivateAttempt(now = Date.now()): void {
    this.activateTimestamps = this.pruneWindow(this.activateTimestamps, ACTIVATE_WINDOW_MS, now)
    this.activateTimestamps.push(now)
    this.activateCooldownUntil = now + ACTIVATE_COOLDOWN_MS
  }
}

export const cloudSyncLimiter = new CloudSyncClientLimiter()

export function parseRateLimitWaitSeconds(message: string): number | undefined {
  const match = /rate_limited(?::(\d+))?/i.exec(message)
  if (!match) return undefined
  return Math.min(60, Math.max(1, match[1] ? Number(match[1]) : 12))
}
