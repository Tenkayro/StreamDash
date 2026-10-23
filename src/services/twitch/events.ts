import type { ActivityEvent, ActivityType } from '../../types'

type Raw = Record<string, unknown>
const text = (v: unknown) => typeof v === 'string' ? v : undefined
const num = (v: unknown) => typeof v === 'number' ? v : undefined

export function normalizeTwitch(messageId: string, subscriptionType: string, raw: Raw, timestamp: string): ActivityEvent | null {
  const map: Record<string, ActivityType> = {
    'channel.follow': 'follow', 'channel.subscribe': 'subscription', 'channel.subscription.message': 'resubscription',
    'channel.subscription.gift': num(raw.total) && Number(raw.total) > 1 ? 'community_gift' : 'gift_subscription',
    'channel.cheer': 'cheer', 'channel.raid': 'raid', 'channel.channel_points_custom_reward_redemption.add': 'channel_point',
    'stream.online': 'stream_online', 'stream.offline': 'stream_offline',
  }
  const eventType = map[subscriptionType]
  if (!eventType) return null
  const reward = raw.reward as Raw | undefined
  return {
    id: `twitch:${messageId}`, source: 'twitch', eventType,
    username: text(raw.user_login) ?? text(raw.from_broadcaster_user_login),
    displayName: text(raw.user_name) ?? text(raw.from_broadcaster_user_name),
    timestamp: text(raw.followed_at) ?? text(raw.redeemed_at) ?? text(raw.started_at) ?? timestamp,
    message: text(raw.message) ?? text((raw.message as Raw | undefined)?.text) ?? text(raw.user_input),
    tier: text(raw.tier), giftCount: num(raw.total), bits: num(raw.bits), viewerCount: num(raw.viewers),
    metadata: reward ? { rewardTitle: reward.title, rewardCost: reward.cost } : {},
  }
}
