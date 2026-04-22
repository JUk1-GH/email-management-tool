import { useAccountStore } from '@/stores/account-store'

export default function GroupBadge({ group }: { group: string }) {
  const getGroupColor = useAccountStore((s) => s.getGroupColor)
  const color = getGroupColor(group)

  return (
    <span
      className="inline-flex items-center px-2 py-1 rounded-md text-[11px] font-medium border backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
      style={{
        backgroundColor: color + '18',
        borderColor: color + '30',
        color: color,
      }}
    >
      {group || '默认分组'}
    </span>
  )
}
