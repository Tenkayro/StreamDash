import type { ProEntitlements } from '../types'

const MANUAL_COOLDOWN_AFTER_SYNC_MS = 8_000
const MANUAL_COOLDOWN_NOOP_MS = 3_000
const MANUAL_WINDOW_MS = 60_000
const MANUAL_BURST_LIMIT = 4
const MANUAL_BURST_COOLDOWN_MS = 25_000

const RECONCILE_MIN_GAP_MS = 60_000
const HISTORY_SYNC_MIN_GAP_MS = 120_000
const ENTITLEMENTS_TTL_MS = 300_000
const SUPPORT_AUTO_GAP_MS = 60_000
const SUPPORT_MANUAL_COOLDOWN_MS = 8_000

const ACTIVATE_WINDOW_MS = 60_000
const ACTIVATE_BURST_LIMIT = 4
const ACTIVATE_COOLDOWN_MS = 5_000

/**
 * Lightweight client-side limiter + short-TTL cache to prevent button spamming
 * and avoid unnecessary VPS requests when multiple devices/users sync.
 */
class CloudSyncClientLimiter {
  private manualTimestamps: number[] = []
  private cooldownUntil = 0
  private lastReconcileByUser = new Map<string, number>()
  private lastHistorySyncByUser = new Map<string, number>()
  private lastHistoryFingerprintByUser = new Map<string, string>()
  private lastHistoryRemoteShaByUser = new Map<string, string>()
  private entitlementsCache = new Map<string, { value: ProEntitlements; fetchedAt: number }>()
  private lastEntitlementsAutoFetchByUser = new Map<string, number>()
  private activateTimestamps: number[] = []
  private activateCooldownUntil = 0
  private lastSupportFetchByUser = new Map<string, number>()
  private supportRefreshCooldownUntil = 0
  private lastStorageFetchByUser = new Map<string, number>()
  private storageRefreshCooldownUntil = 0

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
    this.supportRefreshCooldownUntil = Math.max(this.supportRefreshCooldownUntil, until)
    this.storageRefreshCooldownUntil = Math.max(this.storageRefreshCooldownUntil, until)
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
    this.lastEntitlementsAutoFetchByUser.set(userId, now)
  }

  canAutoRefreshEntitlements(userId: string, force = false, now = Date.now()): boolean {
    if (force) return true
    if (this.getManualRemainingMs(now) > 0) return false
    const last = this.lastEntitlementsAutoFetchByUser.get(userId) ?? 0
    return now - last >= SUPPORT_AUTO_GAP_MS
  }

  invalidateEntitlements(userId?: string): void {
    if (userId) {
      this.entitlementsCache.delete(userId)
      this.lastEntitlementsAutoFetchByUser.delete(userId)
    } else {
      this.entitlementsCache.clear()
      this.lastEntitlementsAutoFetchByUser.clear()
    }
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

  canFetchSupportTicket(userId: string, force = false, now = Date.now()): { allowed: boolean; waitSeconds: number } {
    if (force) {
      if (this.supportRefreshCooldownUntil > now) {
        return {
          allowed: false,
          waitSeconds: Math.ceil((this.supportRefreshCooldownUntil - now) / 1000),
        }
      }
      return { allowed: true, waitSeconds: 0 }
    }
    const last = this.lastSupportFetchByUser.get(userId) ?? 0
    if (now - last < SUPPORT_AUTO_GAP_MS) {
      return { allowed: false, waitSeconds: 0 }
    }
    return { allowed: true, waitSeconds: 0 }
  }

  markSupportTicketFetched(userId: string, manual: boolean, now = Date.now()): void {
    this.lastSupportFetchByUser.set(userId, now)
    if (manual) {
      this.supportRefreshCooldownUntil = now + SUPPORT_MANUAL_COOLDOWN_MS
    }
  }

  canFetchStorageTicket(userId: string, force = false, now = Date.now()): { allowed: boolean; waitSeconds: number } {
    if (force) {
      if (this.storageRefreshCooldownUntil > now) {
        return {
          allowed: false,
          waitSeconds: Math.ceil((this.storageRefreshCooldownUntil - now) / 1000),
        }
      }
      return { allowed: true, waitSeconds: 0 }
    }
    const last = this.lastStorageFetchByUser.get(userId) ?? 0
    if (now - last < SUPPORT_AUTO_GAP_MS) {
      return { allowed: false, waitSeconds: 0 }
    }
    return { allowed: true, waitSeconds: 0 }
  }

  markStorageTicketFetched(userId: string, manual: boolean, now = Date.now()): void {
    this.lastStorageFetchByUser.set(userId, now)
    if (manual) {
      this.storageRefreshCooldownUntil = now + SUPPORT_MANUAL_COOLDOWN_MS
    }
  }

  canSyncHistory(userId: string, force = false, now = Date.now()): boolean {
    if (force) return true
    const last = this.lastHistorySyncByUser.get(userId) ?? 0
    return now - last >= HISTORY_SYNC_MIN_GAP_MS
  }

  markHistorySynced(
    userId: string,
    options?: { fingerprint?: string; remoteSha?: string },
    now = Date.now(),
  ): void {
    this.lastHistorySyncByUser.set(userId, now)
    if (options?.fingerprint !== undefined) {
      this.lastHistoryFingerprintByUser.set(userId, options.fingerprint)
    }
    if (options?.remoteSha !== undefined) {
      this.lastHistoryRemoteShaByUser.set(userId, options.remoteSha)
    }
  }

  getLastHistoryState(userId: string): { fingerprint?: string; remoteSha?: string } {
    return {
      fingerprint: this.lastHistoryFingerprintByUser.get(userId),
      remoteSha: this.lastHistoryRemoteShaByUser.get(userId),
    }
  }
}

export const cloudSyncLimiter = new CloudSyncClientLimiter()

export function parseRateLimitWaitSeconds(message: string): number | undefined {
  const match = /rate_limited(?::(\d+))?/i.exec(message)
  if (!match) return undefined
  return Math.min(60, Math.max(1, match[1] ? Number(match[1]) : 12))
}
